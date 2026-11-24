let optionDirectory;
function optionChain(){
 return optionDirectory??=fetch('market/contracts.json').then(r=>{
  if(!r.ok)throw Error('Could not load option expiries.');
  return r.json();
 }).catch(err=>{optionDirectory=null;throw err});
}
function eligibleOptions(chain,p,day){
 const dates=[...new Set(chain.map(c=>c[2]))].filter(d=>d>=day).sort();
 let expiry=p.optionExpiry;
 if(expiry==='This week')expiry=dates[0];
 if(expiry==='Next week')expiry=dates[1];
 if(expiry==='Monthly')expiry=dates.find(d=>chain.some(c=>c[2]===d&&c[6]===true));
 return chain.filter(c=>c[2]===expiry&&c[4]===p.cp&&day<=expiry).sort((a,b)=>a[3]-b[3]);
 }
function pickOption(chain,p,day,spot){
 const strikes=eligibleOptions(chain,p,day);
 if(p.strikeMode==='Strike above')return strikes.find(c=>c[3]>p.strikePrice);
 if(p.strikeMode==='Strike below')return strikes.filter(c=>c[3]<p.strikePrice).at(-1);
 if(p.strikeMode==='Strike price')return strikes.find(c=>c[3]===p.strikePrice);
 if(!strikes.length||!(spot>0)||spot<strikes[0][3]||spot>strikes.at(-1)[3])return;
 let atm=0;for(let i=1;i<strikes.length;i++)if(Math.abs(strikes[i][3]-spot)<Math.abs(strikes[atm][3]-spot))atm=i;
 if(p.strikeMode==='Market price')return strikes[atm];
 const offset=p.money==='ATM'?0:p.steps*(p.money==='OTM'?1:-1)*(p.cp==='CE'?1:-1);
 return strikes[atm+offset];
}
async function premiumContract(chain,p,day,load){
 const candidates=eligibleOptions(chain,p,day);
 let best=null,distance=Infinity;
 for(let i=0;i<candidates.length;i+=6){
  const batch=candidates.slice(i,i+6);
  const prices=await Promise.all(batch.map(async c=>(await load(p.s,c[1],day,day)).find(r=>r.d===day&&r.m===p.entry)?.o));
  for(const [j,price] of prices.entries()){
   if(!(price>0)||(p.strikeMode==='Premium greater'&&price<=p.strikePrice)||(p.strikeMode==='Premium lesser'&&price>=p.strikePrice))continue;
   const diff=Math.abs(price-p.strikePrice);if(diff<distance){best=batch[j];distance=diff}
  }
 }
 return best;
}
const expiredRequests=new Map();
function expiredRead(action,params){
 const id=JSON.stringify([action,params]);
 if(!expiredRequests.has(id)){
  if(expiredRequests.size>=400)expiredRequests.delete(expiredRequests.keys().next().value);
  const request=async()=>{
   // Only completed contract history is immutable enough to reuse after a reload.
   const reusable=action==='expiredChain'||action==='expiredBars';
   let cache,key;
   if(reusable && globalThis.caches){
    try{
     cache=await caches.open('algo-king-expired-history-v1');
     key=new URL('cached-history/'+encodeURIComponent(id),document.baseURI).href;
     const hit=await cache.match(key);if(hit)return await hit.json();
    }catch{cache=null}
   }
   const result=await fyersRequest(action,params);
   if(cache && (result.symbols?.length||result.candles?.length)){
    try{
     await cache.put(key,new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}}));
     const keys=await cache.keys();if(keys.length>350)await cache.delete(keys[0]);
    }catch{}
   }
   return result;
  };
  expiredRequests.set(id,request().catch(e=>{expiredRequests.delete(id);throw e}));
 }
 return expiredRequests.get(id);
}
function shiftDate(day,count){return new Date(Date.parse(day)+count*86400000).toISOString().slice(0,10)}
function expiredContracts(symbol,expiry,names,monthly){
 const dt=new Date(expiry+'T00:00Z'),yy=expiry.slice(2,4),mon=dt.getUTCMonth();
 const prefix=(symbol==='NIFTY'?'NSE:NIFTY':'BSE:SENSEX')+yy;
 const week=prefix+'123456789OND'[mon]+expiry.slice(8);
 const month=prefix+['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][mon];
 if(expiry<(symbol==='SENSEX'?'2023-08-07':'2022-01-01')||expiry>'2026-12-31')throw Error('Historical lot size has not been verified for '+expiry);
 const lot=symbol==='SENSEX'?(expiry<(monthly?'2025-02-01':'2025-01-07')?10:20)
   :expiry<'2024-05-02'?50:expiry<(monthly?'2025-02-01':'2025-01-02')?25:expiry<='2025-12-30'?75:65;
 return names.flatMap(name=>{
  const start=[month,week].find(x=>name.startsWith(x));if(!start)return [];
  const m=/^(\d+(?:\.\d+)?)(CE|PE)$/.exec(name.slice(start.length));
  return m?[[name,name,expiry,+m[1],m[2],lot,monthly]]:[];
 });
}
async function simulateOptions(p,common,load){
 const index=p.s==='NIFTY'?'NIFTY 50':p.s;
 const [active,archive]=await Promise.all([optionChain(),cachedRead('retired-directory',3600000,async()=>{const r=await fetch('market/retired-options.json');if(!r.ok)throw Error('Historical option directory unavailable. Reload and retry.');return r.json()})]);
 const chain=[...active,...archive.rows.map(r=>[r[0],r[0],...r.slice(2)])].filter(c=>c[0].startsWith(p.s+' '));
 const retired=new Map(archive.rows.filter(c=>c[0].startsWith(p.s+' ')).map(c=>[c[0],c]));
 const windowData=await compressedMarket('option-window').catch(()=>({}));
 const unpack=(d,b)=>b.map(([m,o,h,l,c])=>({d,m,o:o/100,h:h/100,l:l/100,c:c/100}));
 const cachedSpot=Object.keys(windowData).filter(k=>k.startsWith(p.s+'|')).map(k=>k.split('|')[1]).sort();
 const longRange=Date.parse(common.from)<Date.now()-29*86400000;
 const expiryMeta=new Map(),byExpiry=new Map();
 let calendarRequest,brokerBlock;
 async function historicalRead(action,params){
  if(brokerBlock)throw brokerBlock;
  try{return await expiredRead(action,params)}
  catch(err){if(/daily.*allowance|requests.per.day|reconnect|connect FYERS|login expired/i.test(err.message))brokerBlock=err;throw err}
 }
 async function loadCalendar(){
  if(!calendarRequest)calendarRequest=(async()=>{
   const last=[shiftDate(archive.since,34),shiftDate(common.to,35),new Date(Date.now()+19800000).toISOString().slice(0,10)].sort()[0];
   for(let a=common.from;a<=last;a=shiftDate(a,366)){
    const b=[shiftDate(a,365),last].sort()[0];
    const {dates}=await historicalRead('expiredDates',{symbol:p.s,from:a,to:b});
    for(const d of dates.options)expiryMeta.set(d,dates.futures.includes(d));
   }
  })();
  await calendarRequest;
 }
 const recent=cachedSpot.filter(d=>d>=common.from&&d<=common.to);
 let spot;
 if(recent.length===1&&common.from===common.to){
   spot=recent.flatMap(d=>unpack(d,windowData[p.s+'|'+d]));
 }else{
   const observed=await load(index,null,common.from,common.to);
   const byDate=new Map(recent.map(d=>[d,unpack(d,windowData[p.s+'|'+d])]));
   const fresh=new Map();
   for(const r of observed){if(!fresh.has(r.d))fresh.set(r.d,[]);fresh.get(r.d).push(r)}
   for(const [day,rows] of fresh)if(rows.length>=(byDate.get(day)?.length||0))byDate.set(day,rows);
   spot=[...byDate].sort(([a],[b])=>a.localeCompare(b)).flatMap(([,rows])=>rows);
 }
 const networkLoad=load;
 load=async(symbol,key,from,to)=>{
   if(key&&/^(NSE:NIFTY|BSE:SENSEX)/.test(key)){
     const expiry=byExpiry.get(key),monday=shiftDate(from,-((new Date(from).getUTCDay()+6)%7));
     const start=[monday,common.from].sort().at(-1),end=[expiry,common.to,[shiftDate(monday,6),to].sort().at(-1)].sort()[0];
     const {candles}=await historicalRead('expiredBars',{symbol:key,from:start,to:end});
     return candles.map(([t,o,h,l,c])=>{const ist=new Date(t*1000+19800000);return {d:ist.toISOString().slice(0,10),m:ist.getUTCHours()*60+ist.getUTCMinutes(),o,h,l,c}}).filter(r=>r.d>=from&&r.d<=to&&r.m>=555&&r.m<930&&0<r.l&&r.l<=Math.min(r.o,r.c)&&r.h>=Math.max(r.o,r.c)).sort((a,b)=>a.d.localeCompare(b.d)||a.m-b.m);
   }
   const c=retired.get(key)||active.find(r=>r[1]===key&&r[0].startsWith(symbol+' '));
   if(c&&from===to){
    const bars=windowData[c[0]+'|'+from];
    if(bars?.length)return unpack(from,bars);
   }
   if(retired.has(key)){
    const {symbols}=await historicalRead('expiredChain',{symbol,expiry:c[2]});
    const exact=expiredContracts(symbol,c[2],symbols,c[6]).find(r=>r[3]===c[3]&&r[4]===c[4]);
    if(!exact)return [];
    byExpiry.set(exact[1],c[2]);
    return load(symbol,exact[1],from,to);
   }
   return networkLoad(symbol,key,from,to);
 };
 const days=[...new Set(spot.map(r=>r.d))].sort(),opens=new Map(spot.filter(r=>r.m===p.entry).map(r=>[r.d,r.o]));
 if(longRange){
  const covered=new Set(days.map(d=>d.slice(0,7)));
  for(let date=common.from.slice(0,7)+'-01';date<=common.to;){
   const next=shiftDate(date,32).slice(0,7)+'-01';
   if(common.from<=date&&shiftDate(next,-1)<=common.to&&!covered.has(date.slice(0,7)))
     throw Error('Incomplete index history for '+date.slice(0,7)+'. Requested '+common.from+' to '+common.to+'.');
   date=next;
  }
 }
 const candles=new Map(),trades=[],skipped=[];let busy='';
 async function resolve(day,i){
  let candidates=chain,terms=p;
  if(day<archive.since){
   await loadCalendar();
   const placeholders=[...expiryMeta].map(([d,monthly])=>['','',d,0,p.cp,0,monthly]);
   const expiry=eligibleOptions([...placeholders,...chain],p,day)[0]?.[2];
   if(!expiry)return null;
   terms={...p,optionExpiry:expiry};
   if(!chain.some(c=>c[2]===expiry)){
    const {symbols}=await historicalRead('expiredChain',{symbol:p.s,expiry});
    candidates=expiredContracts(p.s,expiry,symbols,expiryMeta.get(expiry));
    if(!candidates.length)throw Error('FYERS returned no recognised option contracts for '+expiry);
    for(const c of candidates)byExpiry.set(c[1],expiry);
   }
   const msg=document.getElementById('runMessage');if(msg)msg.textContent=p.s+' · '+day+' · session '+(i+1)+' / '+days.length;
  }
  return p.strikeMode.startsWith('Premium')?await premiumContract(candidates,terms,day,load):pickOption(candidates,terms,day,opens.get(day));
 }
 const failures=new Map();
 for(const [i,day] of days.entries()){
  if(day<=busy)continue;
  try{
  const contract=await resolve(day,i);if(!contract){skipped.push(day);failures.set(day,'No eligible '+p.cp+' contract for '+p.optionExpiry+' and the selected strike rule.');continue}
  const [name,key,expiry]=contract;
  let through=day;
  if(common.holding==='Positional'){
   if(common.beforeExpiry){const expIndex=days.indexOf(expiry);through=expIndex<0?null:days[expIndex-common.holdDays]}
   else through=days[i+(common.holdDays??1)];
  }
  if(!through||through<day||through>expiry){skipped.push(day);continue}
  const rows=await load(p.s,key,day,through);
  if(!rows.some(r=>r.d===day)){skipped.push(day);failures.set(day,'Minute candles unavailable for '+name);continue}
  if(!candles.has(name))candles.set(name,new Map());
  for(const bar of dailyOHLC(rows))candles.get(name).set(bar.d,bar);
  const qty=p.lots*contract[5];
  const run=simulate(rows,{...p,...common,from:day,to:through,qty,expiry,holdDays:days.indexOf(through)-i,holding:day===through?'Intraday':common.holding});
  const fill=run.trades.find(t=>t.entryDay===day);
  if(fill){trades.push({...fill,s:name,qty,marks:rows.filter(r=>r.d>=day&&r.d<=fill.d)});busy=fill.d}
  else if(run.skipped.includes(day)){skipped.push(day);failures.set(day,'Incomplete minute candles for '+name+' between the selected entry and exit.');}
  }catch(err){
   skipped.push(day);failures.set(day,err.message);
  }
 }
 if(longRange&&['This week','Next week','Monthly'].includes(p.optionExpiry)){
  const unavailable=new Set(skipped);
  for(const month of new Set(days.map(d=>d.slice(0,7)))){
   if(days.filter(d=>d.startsWith(month)).every(d=>unavailable.has(d)))throw Error('Incomplete option coverage for '+month+' in the requested '+common.from+' to '+common.to+' run. Check the expiry, entry and candle availability.');
  }
 }
 if(!trades.length)throw Error(p.s+' · No complete option fills for '+common.from+' to '+common.to+'. '+(failures.values().next().value||'No exact contract candles covering the requested entry and exit times.'));
 return {issues:[...failures].map(([d,message])=>({d,message})),p:{...p,...common,source:'Index options · observed contract minute candles · index coverage '+(days[0]||'—')+' to '+(days.at(-1)||'—')+' · '+trades.length+' fills / '+days.length+' observed index sessions'},trades,skipped,prices:[...candles].map(([name,days])=>({name,bars:[...days.values()]}))};
}
function applyAlgoTargets(trades,configs,common,limits){
 const groups=new Map(),output=[];
 for(const t of trades){if(!groups.has(t.entryDay))groups.set(t.entryDay,[]);groups.get(t.entryDay).push(t)}
 for(const [day,group] of groups){
  const times=new Set(),legs=group.map(t=>{
   const start=day+' '+t.entry,end=t.d+' '+t.exit;
   const prices=new Map();
   for(const r of t.marks||configs[t.leg-1].rows){
    const stamp=r.d+' '+timeOf(r.m);if(stamp>=start&&stamp<=end){prices.set(stamp,r.o);times.add(stamp)}
   }
   return {t,start,end,prices,sign:t.side==='Buy'?1:-1};
  });
  let cutoff='';
  for(const stamp of [...times].sort()){
   const entered=legs.filter(l=>l.start<=stamp),open=entered.filter(l=>stamp<=l.end);
   if(!open.length||open.some(l=>!l.prices.has(stamp)))continue;
   let points=0,gross=0,capital=0;
   for(const l of entered){const move=l.sign*((stamp>l.end?l.t.xp:l.prices.get(stamp))-l.t.ep);points+=move;gross+=move*l.t.qty;capital+=l.t.ep*l.t.qty}
   const amount=u=>u==='Pts'?points:u==='%'?100*gross/capital:gross;
   const stop=limits.stop>0&&amount(limits.su)<=-limits.stop,target=limits.target>0&&amount(limits.tu)>=limits.target;
   if(!target&&!stop)continue;
   cutoff=stamp;
   for(const l of open){
    const t=l.t,p={...configs[t.leg-1].p,qty:t.qty},xp=l.prices.get(stamp)*(1-l.sign*common.slip/10000);
    t.xp=xp;t.d=stamp.slice(0,10);t.exit=stamp.slice(11);t.gross=l.sign*(xp-t.ep)*t.qty;t.charges=costs(p,t.ep,xp);t.net=t.gross-t.charges;t.reason=stop?'Algo stop loss':'Algo profit target';
   }
   break;
  }
  for(const l of legs)if(!cutoff||l.start<=cutoff)output.push(l.t);
 }
 return output.sort((a,b)=>(a.d+a.exit).localeCompare(b.d+b.exit)||a.leg-b.leg);
}
