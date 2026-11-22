const recorded=[["2026-10-21",74337.93,73709.69],["2026-10-22",73343.33,73249.39],["2026-10-23",73665.64,73123.83],["2026-10-26",72990.04,73606.75],["2026-10-27",73484.38,73598.67],["2026-10-28",73253.44,73246.03],["2026-10-29",73268.47,74151.04],["2026-10-30",74199.69,74459.53],["2026-11-02",75178.24,75692.78],["2026-11-03",76288.65,76917.85],["2026-11-04",76853.11,77301.4],["2026-11-05",78910.94,79310.01],["2026-11-06",79413.66,81028.02],["2026-11-08",81299.34,80999.4],["2026-11-09",81327.29,81106.65],["2026-11-11",82248.68,81879.4],["2026-11-12",81762.27,81911.01],["2026-11-13",81833.78,81592.45],["2026-11-16",81810.98,82104.79],["2026-11-17",82150.62,82532.19],["2026-11-18",82376.56,82031.81],["2026-11-19",82074.16,83021.75],["2026-11-20",82558.25,83919.71]];let previous=73852.90;db.SENSEX=recorded.map(([d,o,c])=>{const row=bar(d,o,c,previous);previous=c;return row});

async function refreshBenchmark(){
 try {
  const response=await fetch('https://wpqcyyevhxqbhudsxydd.supabase.co/rest/v1/market_bars?symbol=eq.SENSEX&select=session,open,close&order=session.desc&limit=1000',{headers:{apikey:'sb_publishable_B-pFfyhNKmR3npMnJE2D1A_Z94lv22f'}});
  if(!response.ok)return;
  const data=(await response.json()).reverse();
  if(!data.length)return;
  let prev=data[0].session===recorded[0][0]?73852.90:null;
  db.SENSEX=data.map(v=>{const row=bar(v.session,+v.open,+v.close,prev);prev=+v.close;return row});
  benchmarkSource='Supabase · historical';if(document.getElementById('rank')) market();
 } catch {}
}
let benchmarkSource='Bundled · historical';
window.addEventListener('load',refreshBenchmark);

let dailyStart='',earlierKeyMap;
let exchangeDaily=Object.create(null),exchangeStatus='Loading NSE history…';
async function loadExchangeHistory(){
 try{const response=await fetch('market/daily.json');if(!response.ok)throw Error();
 const data=await response.json();for(const [symbol,rows] of Object.entries(data))exchangeDaily[symbol]=rows.map(([d,o,c,prev])=>bar(d,o,c,prev));
 dailyStart=Object.values(exchangeDaily).filter(r=>r.length).map(r=>r[0].d).sort()[0];
 const dates=Object.values(exchangeDaily).flatMap(rows=>rows.length?[rows.at(-1).d]:[]).sort();
 if(filters.to===end&&dates.length&&dates.at(-1)>end)filters.to=dates.at(-1);
 exchangeStatus='Daily price history · '+Object.keys(data).length+' instruments · '+dailyStart+' — '+dates.at(-1);
 }catch{exchangeStatus='NSE history unavailable. Retry or import a daily CSV.'}
 if(document.getElementById('rank'))market();
}
window.addEventListener('load',loadExchangeHistory);

const earlierRequests=new Map();
async function loadEarlierDays(symbols,from,to){
 if(!earlierKeyMap){
  earlierKeyMap=fetch('market/shares.json').then(r=>r.json()).then(rows=>{
   const keys=Object.fromEntries(rows.map(([s,,key])=>[s,key]));
   return Object.assign(keys,{GMRINFRA:keys.GMRAIRPORT,BIRLASOFT:keys.BSOFT,SENSEX:'BSE_INDEX|SENSEX','NIFTY 50':'NSE_INDEX|Nifty 50',BANKNIFTY:'NSE_INDEX|Nifty Bank','NIFTY MIDCAP 100':'NSE_INDEX|NIFTY MIDCAP 100'});
  }).catch(e=>{earlierKeyMap=null;throw e});
 }
 const keys=await earlierKeyMap;
 const day=86400000,until=Math.min(Date.parse(to),Date.parse(dailyStart));
 const queue=[...symbols];
 async function worker(){
  while(queue.length){
   const symbol=queue.shift(),key=keys[symbol];
   if(!key)continue;
   for(let date=Date.parse(from);date<=until;date+=365*day){
    const start=new Date(date-10*day).toISOString().slice(0,10);
    const end=new Date(Math.min(date+364*day,until)).toISOString().slice(0,10);
    const id=[key,start,end].join('|');
    if(!earlierRequests.has(id)){
     const request=fetch('https://api.upstox.com/v3/historical-candle/'+encodeURIComponent(key)+'/days/1/'+end+'/'+start,{signal:AbortSignal.timeout(25000)}).then(async r=>{
      if(!r.ok)throw Error();const items=(await r.json()).data?.candles;
      if(!Array.isArray(items))throw Error();
      const rows=new Map();let prev=null;
      for(const [t,o,,,c] of items.sort((a,b)=>a[0].localeCompare(b[0]))){
       if(o>0&&c>0){rows.set(t.slice(0,10),bar(t.slice(0,10),o,c,prev));prev=c}
      }
      for(const row of exchangeDaily[symbol]||[])rows.set(row.d,row);
      exchangeDaily[symbol]=[...rows.values()].sort((a,b)=>a.d.localeCompare(b.d));
     }).catch(err=>{earlierRequests.delete(id);throw err});
     earlierRequests.set(id,request);
    }
    await earlierRequests.get(id);
   }
  }
 }
 await Promise.all(Array.from({length:Math.min(5,queue.length)},worker));
}
