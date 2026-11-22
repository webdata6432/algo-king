let optionDirectory;
function optionChain(){
 return optionDirectory??=fetch('market/contracts.json').then(r=>{
  if(!r.ok)throw Error('Could not load option expiries.');
  return r.json();
 }).catch(err=>{optionDirectory=null;throw err});
}
function eligibleOptions(chain,p,day){
 const dates=[...new Set(chain.map(c=>c[2]))].sort();
 let expiry=p.optionExpiry;
 if(expiry==='This week'||expiry==='Next week'){
  const monday=Date.parse(day)-((new Date(day).getUTCDay()+6)%7)*86400000;
  const start=monday+(expiry==='Next week'?7:0)*86400000;
  expiry=dates.find(d=>d>=day&&Date.parse(d)>=start&&Date.parse(d)<start+7*86400000);
 }else if(expiry==='Monthly'){
  expiry=dates.find(d=>d>=day&&d.slice(0,7)===day.slice(0,7)&&chain.some(c=>c[2]===d&&c[6]===true));
 }
 return chain.filter(c=>c[2]===expiry&&c[4]===p.cp&&day<=expiry).sort((a,b)=>a[3]-b[3]);
 }
function pickOption(chain,p,day,spot){
 const strikes=eligibleOptions(chain,p,day);
 if(p.strikeMode==='Strike above')return strikes.find(c=>c[3]>p.strikePrice);
 if(p.strikeMode==='Strike below')return strikes.filter(c=>c[3]<p.strikePrice).at(-1);
 if(p.strikeMode==='Strike price')return strikes.find(c=>c[3]===p.strikePrice);
 if(!strikes.length||!(spot>0)||spot<strikes[0][3]||spot>strikes.at(-1)[3])return;
 let atm=0;for(let i=1;i<strikes.length;i++)if(Math.abs(strikes[i][3]-spot)<Math.abs(strikes[atm][3]-spot))atm=i;
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
async function simulateOptions(p,common,load){
 const index=p.s==='NIFTY'?'NIFTY 50':p.s;
 const chain=(await optionChain()).filter(c=>c[0].startsWith(p.s+' '));
 const spot=await load(index,null,common.from,common.to);
 const days=[...new Set(spot.map(r=>r.d))].sort(),opens=new Map(spot.filter(r=>r.m===p.entry).map(r=>[r.d,r.o]));
 const candles=new Map(),trades=[],skipped=[];let busy='';
 for(const [i,day] of days.entries()){
  if(day<=busy)continue;
  const contract=p.strikeMode.startsWith('Premium')?await premiumContract(chain,p,day,load):pickOption(chain,p,day,opens.get(day));
  if(!contract){skipped.push(day);continue}
  const [name,key,expiry]=contract;
  let through=day;
  if(common.holding==='Positional'){
   if(common.beforeExpiry){const expIndex=days.indexOf(expiry);through=expIndex<0?null:days[expIndex-common.holdDays]}
   else through=days[i+(common.holdDays??1)];
  }
  if(!through||through<day||through>expiry){skipped.push(day);continue}
  const rows=await load(p.s,key,day,through);
  if(!rows.some(r=>r.d===day)){skipped.push(day);continue}
  if(!candles.has(name))candles.set(name,new Map());
  for(const bar of dailyOHLC(rows))candles.get(name).set(bar.d,bar);
  const qty=p.lots*contract[5];
  const run=simulate(rows,{...p,...common,from:day,to:through,qty,expiry,holdDays:days.indexOf(through)-i,holding:day===through?'Intraday':common.holding});
  const fill=run.trades.find(t=>t.entryDay===day);
  if(fill){trades.push({...fill,s:name,qty,marks:rows.filter(r=>r.d>=day&&r.d<=fill.d)});busy=fill.d}
  else if(run.skipped.includes(day))skipped.push(day);
 }
 return {p:{...p,...common,source:'Index options · observed contract minute candles'},trades,skipped,prices:[...candles].map(([name,days])=>({name,bars:[...days.values()]}))};
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
