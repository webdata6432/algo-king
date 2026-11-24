function firstFiveRun(model,from,to,budget){
 if(!from||from>to||from<model.first||to>model.last)throw Error('Choose dates inside the verified archive.');
 if(!(budget>0&&Number.isFinite(budget)))throw Error('Enter a positive budget per stock.');
 const days=model.sessions.filter(s=>from<=s.d&&s.d<=to),trades=[],selected=[];
 for(const day of days){
  for(const order of day.orders){
   const qty=Math.floor(budget/order.ep),sign=order.side==='Buy'?1:-1;
   selected.push({d:day.d,qty,...order});
   if(!qty)continue;
   const gross=sign*(order.xp-order.ep)*qty,charges=(order.ep+order.xp)*qty*.0005;
   const slippageCost=sign*((order.exitRef-order.entryRef)-(order.xp-order.ep))*qty;
   trades.push({...order,qty,d:day.d,entryDay:day.d,gross,charges,slippageCost,net:gross-charges,stop:1,stopUnit:'%'});
  }
 }
 trades.sort((a,b)=>(a.d+a.exit).localeCompare(b.d+b.exit)||a.leg-b.leg);
 let net=0,dd=0,peak=0;
 for(let i=0;i<trades.length;){
  let j=i;
  while(j<trades.length&&trades[j].d===trades[i].d&&trades[j].exit===trades[i].exit)net+=trades[j++].net;
  peak=Math.max(net,peak);dd=Math.min(dd,net-peak);
  for(;i<j;i++){trades[i].cum=net;trades[i].dd=net-peak}
 }
 return {p:{id:'first-five',s:'NIFTY 500 · first five at ±2%',from,to,source:'Upstox minute candles · traded symbols checked against NSE daily reports',stop:1,stopUnit:'%',slip:5},firstFive:{from,to,budget},sessionDates:days.map(s=>s.d),skipped:days.filter(s=>s.missing).map(s=>s.d),selected,trades,net,dd,win:100*trades.filter(t=>t.net>0).length/(trades.length||1)};
}
async function firstFivePage(savedRun){
 const app=$('app');
 app.innerHTML=heading('Historical Backtest','NIFTY 500 · first five at ±2%','Buy a fresh crossing above +2% or sell below −2% from the 09:15 open. Take the first five different stocks across both directions.','<a href="#historical">Strategy library</a>')+'<section id="fiveControls" class="panel"><p role="status">Opening verified results…</p></section><div id="fiveSelections"></div><div id="results"></div>';
 const panel=$('fiveControls');
 try{
  const model=await cachedRead('first-five-v1/'+session.user.id,60000,()=>fyersRequest('firstFiveReport'));
  if(!panel.isConnected)return;
  if(!model?.sessions)throw Error('The verified report is unavailable.');
  const cfg=savedRun?.firstFive||{},dates=displayDates(model.first+' – '+model.last);
  panel.innerHTML='<h2>Verified backtest</h2>'+note(dates+' · 09:20 signal start · 1% stop · 15:00 exit · no target')+'<form id="fiveForm"><div class="fields">'+input('From','fiveFrom',cfg.from||model.first,'date','min="'+model.first+'" max="'+model.last+'"')+input('Through','fiveTo',cfg.to||model.last,'date','min="'+model.first+'" max="'+model.last+'"')+input('Budget per stock ₹','fiveBudget',cfg.budget??20000,'number','min="1" step="any"')+'</div><button class="primary">Show results</button><p id="fiveMessage" role="status"></p></form><details><summary>Entry, exit and costs</summary><p>Scan completed one-minute candles starting at 09:20 IST. A buy needs a high above 102% of the opening price after a prior minute closed at or below the level. A sell needs a low below 98% after a close at or above it. A move completed before the window must cross again. Enter at the next minute open, strictly before 15:00. Break same-minute ties by the NSE trading symbol. A stock gets one slot per day, including when the budget is below one share.</p><p>The 1% stop is based on the executed entry price. A gap through the stop exits at the open. All remaining positions exit at the 15:00 candle open. Charges and adverse slippage are each estimated at 0.05% per fill. Sessions with uncertain first-five ranking or missing selected fills are excluded.</p></details>';
  function render(){
   try{
    const run=firstFiveRun(model,$('fiveFrom').value,$('fiveTo').value,+$('fiveBudget').value);
    lastRun={...run,savedId:savedRun?.id};lastMonth='';showResults();
    const days=model.sessions.filter(s=>s.d>=run.p.from&&s.d<=run.p.to);
    const gaps=days.filter(s=>s.missing).map(s=>[displayDates(s.d),esc(s.missing)]);
    $('fiveMessage').textContent=run.sessionDates.length+' sessions · '+run.trades.length+' fills · '+run.skipped.length+' incomplete · '+days.filter(s=>!s.missing&&s.sameMinuteExtras>0).length+' sessions with a tie for the fifth slot';
    $('fiveSelections').innerHTML='<button id="exportFirstFive">Download all trades · CSV</button><details class="panel"><summary>Selection order and 2% levels</summary>'+table(['Date','Slot','Stock','Side','09:15 open ₹','Trigger ₹','Signal IST','Fill IST','Units'],run.selected.slice().sort((a,b)=>b.d.localeCompare(a.d)||a.leg-b.leg).map(t=>[displayDates(t.d),t.leg,esc(t.s),t.side,fmt(t.sessionOpen),fmt(t.level),t.signal,t.qty?t.entry:'—',t.qty]))+(gaps.length?table(['Excluded session','Reason'],gaps):'')+'</details>';
    $('exportFirstFive').onclick=()=>{
     const header=['Date','Slot','NSE symbol','Side','Session open','2% level','Signal IST','Entry IST','Entry price','Stop price','Quantity','Exit IST','Exit price','Exit reason','Charges','Net P&L'];
     const rows=run.trades.slice().sort((a,b)=>a.d.localeCompare(b.d)||a.leg-b.leg).map(t=>[displayDates(t.d),t.leg,t.s,t.side,t.sessionOpen,t.level,t.signal,t.entry,t.ep,t.ep*(t.side==='Buy'?.99:1.01),t.qty,t.exit,t.xp,t.reason,t.charges,t.net]);
     csv('first-five-'+run.p.from+'-'+run.p.to,[header,...rows]);
    };
   }catch(err){$('fiveSelections').replaceChildren();$('results').replaceChildren();$('fiveMessage').textContent=err.message}
  }
  $('fiveForm').onsubmit=e=>{e.preventDefault();render()};render();
 }catch(err){if(panel.isConnected)panel.textContent=err.message}
}
