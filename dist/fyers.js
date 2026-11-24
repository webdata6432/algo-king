pages.angel='Broker connections';
const historicalReads=new Map();
function cachedRead(key,ttl,load){
 const old=historicalReads.get(key);
 if(old&&old.until>Date.now())return old.promise;
 if(historicalReads.size>=80)historicalReads.delete(historicalReads.keys().next().value);
 const entry={until:Date.now()+ttl};
 entry.promise=Promise.resolve().then(load).catch(err=>{
  if(historicalReads.get(key)===entry)historicalReads.delete(key);throw err;
 });
 historicalReads.set(key,entry);return entry.promise;
}
async function savedMarketRead(key,ttl,read){
 let store,url;
 try{
  if(globalThis.caches){
   store=await caches.open('ak-observed-history-v1');
   url=new URL('saved-market/'+encodeURIComponent(key),document.baseURI).href;
   const hit=await store.match(url);
   if(hit&&Date.now()-Number(hit.headers.get('x-saved-at'))<ttl)return await hit.json();
  }
 }catch{store=null}
 const data=await read();
 if(store && (data.candles?.length||data.rows?.length||data.bars?.length||data.stocks?.length||data.chunks&&Object.keys(data.chunks).length)&&!data.pending){
  try{
   await store.put(url,new Response(JSON.stringify(data),{headers:{'content-type':'application/json','x-saved-at':String(Date.now())}}));
   const keys=await store.keys();
   if(keys.length>120)await store.delete(keys[0]);
  }catch{}
 }
 return data;
}
function fyersRequest(action,details={}){
 if(!session||!['archiveRank','stockSessions','history'].includes(action))return brokerRequest(action,details);
 const historical=details.to<new Date(Date.now()+19800000).toISOString().slice(0,10);
 const ttl=historical&&action==='history'?3600000:60000;
 const key=JSON.stringify([session.user?.id,action,details]);
 return cachedRead(key,ttl,()=>savedMarketRead(key,ttl,()=>brokerRequest(action,details)));
}
function publicMinutes(params){
 const key=params.toString(),url=authOrigin+'/functions/v1/market-minute?'+key;
 const past=params.get('to')<new Date(Date.now()+19800000).toISOString().slice(0,10);
 const ttl=past?3600000:30000;
 return cachedRead(url,ttl,()=>savedMarketRead(url,ttl,async()=>{
  const response=await fetch(url),data=await response.json();
  if(!response.ok)throw Object.assign(Error(data.error||'Minute history unavailable'),{status:response.status});
  return data;
 }));
}
async function brokerRequest(action,details={}){
 const owner=session;
 if(!owner)throw Error('Unlock Algo King to connect.');
 if(owner.expires_at*1000<Date.now()+30000){
  const refreshed=await accountRequest('/auth/v1/token?grant_type=refresh_token',{refresh_token:owner.refresh_token});
  if(session!==owner)throw Error('Reopen your workspace.');
  sessionChanged(refreshed);
 }
 if(action==='weaknessReport')return accountRequest('/rest/v1/rpc/read_weakness_report',{},session.access_token);
 if(action==='firstFiveReport')return accountRequest('/rest/v1/rpc/read_first_five_report',{},session.access_token);
 if(action==='verifiedSector')return accountRequest('/rest/v1/rpc/read_sector_report',{p_reward:details.rr},session.access_token);
 if(action==='openingBatch')return accountRequest('/functions/v1/basket-openings',details,session.access_token);
 if(action==='archiveRank'){
  const {from,to,cap,query,cut,limit}=details;
  return accountRequest('/rest/v1/rpc/owner_momentum_archive',{p_from:from,p_to:to,p_cap:cap,p_query:query,p_cut:cut,p_limit:limit},session.access_token);
 }
 return accountRequest('/functions/v1/fyers-account',{action,...details},session.access_token);
}
const angelPanel=angel;
angel=function(){
 angelPanel();
 if(!session)return;
 const section=document.createElement('section');
 section.className='panel';
 section.innerHTML='<h2>FYERS market data</h2><p>Connect your non-trading app to check NIFTY and SENSEX quotes.</p><form><details open><summary>FYERS app details</summary><div class="fields"><label>App ID<input name="id" autocomplete="off"></label><label>Secret ID<input name="secret" type="password" autocomplete="off"></label><label>Registered redirect URL<input name="redirect" type="url" placeholder="Paste from FYERS"></label></div></details><div class="row"><button class="primary">Connect FYERS</button><button type="button">Test quotes</button></div><p role="status"></p></form>';
 $('app').prepend(section);
 const form=section.querySelector('form'),message=form.querySelector('[role=status]');
 fyersRequest('status').then(s=>{if(s.configured)form.querySelector('details').open=false}).catch(e=>message.textContent=e.message);
 form.onsubmit=async e=>{
  e.preventDefault();const button=form.querySelector('button');button.disabled=true;
  try{
   const details=Object.fromEntries(Array.from(new FormData(form),([k,v])=>[k,v.trim()]));
   const login=await fyersRequest('start',details);
   sessionStorage.setItem('ak-fyers-state',login.state);
   form.reset();location.assign(login.url);
  }catch(err){message.textContent=err.message;button.disabled=false}
 };
 form.querySelector('[type=button]').onclick=async()=>{
  try{const {quotes}=await fyersRequest('quotes');message.textContent=quotes.map(q=>q.name+' '+fmt(q.price)).join(' · ')||'No quotes returned.'}catch(e){message.textContent=e.message}
 };
 if(window.fyersNotice)message.textContent=window.fyersNotice;
};
(async()=>{
 const params=new URLSearchParams(location.search);
 if(!params.has('state')||(!params.has('auth_code')&&!params.has('error')&&!params.has('s')))return;
 const expected=sessionStorage.getItem('ak-fyers-state');
 history.replaceState(null,'',location.pathname+'#angel');
 if(!expected||params.get('state')!==expected){window.fyersNotice='Login mismatch. Start Connect FYERS again.';return}
 sessionStorage.removeItem('ak-fyers-state');
 try{
  await fyersRequest('finish',{state:expected,code:params.get('auth_code')});
  window.fyersNotice='Connected. Use Test quotes to verify the feed.';
 }catch(e){window.fyersNotice=e.message}
 if(location.hash==='#angel')angel();
})();

function quoteTime(time){
 if(!Number.isFinite(time)||time<=0||time>Date.now()+1000)return 'Provider time unavailable';
 const age=(Date.now()-time)/60000;
 return istStamp(time)+' IST · '+(age<3?'within 3 min':age<30?'within 30 min':'last known');
}
async function stockQuotes(symbols){
 const quotes=[];
 for(let i=0;i<symbols.length;i+=50){
  const data=await fyersRequest('stockQuotes',{symbols:symbols.slice(i,i+50)});
  quotes.push(...data.quotes);
 }
 return quotes;
}
function pollWhile(node,interval,read,paint,onError){
 async function refresh(){
  if(!node.isConnected)return;
  if(!document.hidden){
   try{const result=await read();if(node.isConnected)paint(result)}
   catch(err){if(node.isConnected)onError(err)}
  }
  if(node.isConnected)setTimeout(refresh,interval);
 }
 refresh();
}

async function equityDirectory(){
 return cachedRead('all-equity-directory',3600000,async()=>{
  async function read(file){const r=await fetch('market/'+file+'.json');if(!r.ok)throw Error('Stock directory unavailable');return r.json()}
  const [shares,caps]=await Promise.allSettled([read('shares'),read('caps')]);
  const rows=new Map();
  for(const [symbol,name,,ticker,,key] of caps.value?.companies||[]){
   if(/^(NSE|BSE)_EQ\|[A-Z0-9]{12}$/.test(key))rows.set(key,[symbol,name,key,ticker]);
  }
  for(const [symbol,name,key] of shares.value||[]){
   rows.set(key,[symbol,name,key,rows.get(key)?.[3]||null]);
  }
  if(!rows.size)throw Error('Stock directory unavailable');
  return [...rows.values()].sort((a,b)=>Number(b[2].startsWith('NSE_EQ|'))-Number(a[2].startsWith('NSE_EQ|')));
 });
}

async function archivedMinutes(instrument,from,to){
 const early=[];
 if(from<'2022-01-01'){
  const stocks=await equityDirectory();
  if(instrument.startsWith('BSE_EQ|'))throw Error('BSE stock minute archive starts in January 2022.');
  const symbol=instrument==='NSE_INDEX|Nifty 50'?'NIFTY 50':instrument==='BSE_INDEX|SENSEX'?'SENSEX':stocks.find(r=>r[2]===instrument)?.[0];
  if(!symbol)throw Error('No historical symbol mapping before January 2022.');
  const stop=[to,'2021-12-31'].sort()[0];
  for(let d=from;d<=stop;d=shiftDate(d,28)){
   const r=await fyersRequest('history',{symbol,from:d,to:[stop,shiftDate(d,27)].sort()[0]});
   if(!r.rows.length)throw Error('FYERS has no minute history for '+symbol+' in the requested period starting '+d);
   early.push(...r.rows);
  }
  from='2022-01-01';if(from>to)return early;
 }
 const months=[];
 for(let month=from.slice(0,7);month<=to.slice(0,7);){
  months.push(month);
  const next=new Date(month+'-01T00:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);month=next.toISOString().slice(0,7);
 }
 let pendingSources;
 function sources(){
  if(!pendingSources){
   pendingSources=months.length<2?Promise.resolve({links:{},packs:{}}):fyersRequest('minuteLinks',{instrument,month:months[0],months}).then(({links,yearLinks={}})=>{
    const packs={};
    for(const [year,{end,url}] of Object.entries(yearLinks)){
     const key=JSON.stringify(['year-archive',instrument,end]),ttl=86400000;
     packs[year]=cachedRead(key,ttl,()=>savedMarketRead(key,ttl,async()=>{
      const r=await fetch(url);if(!r.ok)throw Error('Year archive unavailable');
      return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json();
     })).catch(()=>null);
    }
    return {links,packs};
   });
  }
  return pendingSources;
 }
 const result=early,missing=[];
 for(let i=0;i<months.length;i+=4){
  const chunks=await Promise.all(months.slice(i,i+4).map(async month=>{
   const key=JSON.stringify(['minuteMonth',instrument,month]),ttl=month===new Date(Date.now()+19800000).toISOString().slice(0,7)?60000:86400000;
   return cachedRead(key,ttl,()=>savedMarketRead(key,ttl,async()=>{
    const {links,packs}=await sources();
    const year=await packs[month.slice(0,4)];
    if(year?.chunks?.[month]?.length)return {candles:year.chunks[month]};
    if(links[month]){
     try{
      const response=await fetch(links[month]);if(!response.ok)throw Error();
      const pack=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
      if(pack.final&&pack.rows?.length)return {candles:pack.rows};
     }catch{}
    }
    return fyersRequest('minuteMonth',{instrument,month});
   }));
  }));
  for(const [j,chunk] of chunks.entries()){
   const month=months[i+j];
   const endOfMonth=new Date(Date.UTC(+month.slice(0,4),+month.slice(5),0)).toISOString().slice(0,10);
   if(!chunk.candles.length&&from<=month+'-01'&&endOfMonth<=to)missing.push(month);
   let tradingDay=-1,d;
   for(const [epoch,o,h,l,c] of chunk.candles){
    const day=Math.floor((epoch+330)/1440);
    if(day!==tradingDay){tradingDay=day;d=new Date(day*86400000).toISOString().slice(0,10)}
    if(d>=from&&d<=to)result.push({d,m:(epoch+330)%1440,o,h,l,c});
   }
  }
  const msg=$('runMessage');if(msg)msg.textContent='Loading minute archive · '+instrument+' · '+Math.min(i+4,months.length)+' / '+months.length+' months';
 }
 if(missing.length)throw Error('Incomplete minute archive. No data for '+missing.join(', ')+'. Choose a covered range.');
 return result;
}
