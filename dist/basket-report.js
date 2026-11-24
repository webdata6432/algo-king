let universeRead;
function breadthUniverse(){
 if(!universeRead)universeRead=fetch('market/breadth-universe.json').then(r=>{
  if(!r.ok)throw Error('Historical constituent list unavailable');return r.json();
 }).catch(e=>{universeRead=null;throw e});
 return universeRead;
}
function completedDate(){
 const now=new Date(Date.now()+19800000);
 if(now.getUTCHours()*60+now.getUTCMinutes()<930)now.setUTCDate(now.getUTCDate()-1);
 return now.toISOString().slice(0,10);
}
async function exchangeDays(from,to){
 const until=[to,completedDate()].sort()[0];
 if(from>until)return [];
 const {sessions}=await breadthUniverse();
 const known=sessions.filter(d=>d>=from&&d<=until);
 if(from<sessions[0]||until>sessions.at(-1)){
  const response=await fyersRequest('stockSessions',{ticker:'NSE:NIFTY50-INDEX',from,to:until});
  if(!Array.isArray(response.bars))throw Error('Session calendar unavailable');
  return [...new Set([...known,...response.bars.map(b=>b[0])])].sort();
 }
 return known;
}
function heatStyle(value){
 const level=Math.abs(value)/(Math.abs(value)+1.5);
 const hue=value<0?5:150;
 return value?'style="background:hsl('+hue+' 54% '+(88-level*62)+'%);color:'+(level>.58?'white':'#132027')+'"':'style="background:#25303e;color:white"';
}
function basketReport(r){
 const byDay=new Map(),stocks=new Map(),missing=new Set(r.skipped||[]);
 const stock=s=>{if(!stocks.has(s))stocks.set(s,[]);return stocks.get(s)};
 for(const item of r.legStats||[])stock(item.name);
 for(const t of r.trades){
  stock(t.s||r.p.s).push(t);
  if(!byDay.has(t.d))byDay.set(t.d,[]);byDay.get(t.d).push(t);
 }
 const cal=r.sessionDates||[],dates=[...new Set([...cal,...byDay.keys(),...missing])].sort();
 const buckets={'3% and above':0,'2% to under 3%':0,'Above 0% to under 2%':0,'Loss':0,'Flat':0,'No trade':0,'Position held':0,'Incomplete':0};
 const rate=(n,d)=>d?100*n/d:0,openDays=new Set();
 for(const t of r.trades)if(t.entryDay&&t.entryDay<t.d)for(const d of dates)if(d>=t.entryDay&&d<t.d)openDays.add(d);
 const items=dates.map(d=>{
  const fills=byDay.get(d)||[],net=total(fills),capital=fills.reduce((s,t)=>s+entryCapital(t,r.p),0),ret=rate(net,capital);
  const label=missing.has(d)?'Incomplete':!fills.length?(openDays.has(d)?'Position held':'No trade'):ret>=3?'3% and above':ret>=2?'2% to under 3%':ret>0?'Above 0% to under 2%':ret<0?'Loss':'Flat';
  buckets[label]++;return [displayDates(d),label,fills.length,fills.length?cash(net):'—',capital?pct(ret):'—'];
 });
 const trades=r.trades,w=trades.filter(t=>t.net>0),l=trades.filter(t=>t.net<0),peak=peakCapital(r);
 const percent=(n,d)=>d?pct(100*n/d):'—';
 const avgPct=a=>a.length?pct(a.reduce((n,t)=>n+rate(t.net,entryCapital(t,r.p)),0)/a.length):'—';
 const slipKnown=trades.length&&trades.every(t=>Number.isFinite(t.slippageCost)),slip=trades.reduce((a,t)=>a+(t.slippageCost||0),0),fees=trades.reduce((a,t)=>a+t.charges,0);
 const summary=[['Sessions in report',dates.length],['No-trade sessions',r.sessionDates?buckets['No trade']:'—'],['Incomplete sessions',missing.size],['Profit factor',l.length?fmt(total(w)/-total(l)):w.length?'∞':'—'],['Average winner · %',avgPct(w)],['Average loser · %',avgPct(l)],['Gross return'+(slipKnown?' before costs':' after modeled slippage'),percent(r.net+fees+(slipKnown?slip:0),peak)],[slipKnown?'Charges + slippage':'Charges',percent(-fees-(slipKnown?slip:0),peak)],['Max drawdown · %',percent(r.dd,peak)],['Expectancy / active exit day',byDay.size?cash(r.net/byDay.size):'—']];
 const signal=r.signals?'<details class="panel"><summary>09:30 market breadth and selected stocks</summary>'+table(['Date','Up / down / flat','Coverage','Side','Selected stocks / status'],r.signals.slice().reverse().map(s=>[displayDates(s.d),s.up+' / '+s.down+' / '+s.flat,s.seen+' / '+s.size,s.side||'—',esc((s.names||[]).join(', ')+(s.reason?' · '+s.reason:''))]))+'</details>':'';
 return signal+'<section class="panel"><h2>Basket performance</h2>'+metrics(summary)+note((r.sessionDates?'Date coverage uses the exchange session calendar.':'Date coverage uses observed sessions only.')+' Daily return uses the combined entry value of fills exiting that day. Period returns and drawdown use peak deployed entry value.'+(missing.size?' Incomplete dates are flagged separately from no-trade sessions.':''))+'</section><section class="panel"><h2>Day-by-day breakdown</h2>'+table(['Daily basket result','Sessions'],Object.entries(buckets).filter(([k,v])=>v||k!=='Position held').concat([['Total',dates.length]]))+'<details><summary>Daily basket returns</summary>'+table(['Date','Result','Fills','Net P&L','Return'],items.reverse())+'</details></section><section class="panel"><h2>Stock-by-stock performance</h2>'+table(['Stock','Trades','Wins','Losses','Net P&L'],[...stocks].filter(([s,a])=>a.length||!trades.some(t=>t.s?.startsWith(s+' '))).map(([s,a])=>[esc(s),a.length,a.filter(t=>t.net>0).length,a.filter(t=>t.net<0).length,cash(total(a))]))+'</section>';
}
