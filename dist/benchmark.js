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
