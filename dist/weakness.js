async function weaknessPage(savedRun){
 const app=$('app');
 app.innerHTML=heading('Historical Backtest','NIFTY 500 · 09:45 confirmed weakness','Short five stocks from different sectors when at least 55% of the universe is below its 09:15 open.','<a href="#historical">Strategy library</a>')+'<section class="panel" id="weakControls" role="region"><p role="status">Opening verified candles and fills…</p></section><div id="weakReview"></div><div id="results"></div>';
 const panel=$('weakControls');
 try{
  const model=await cachedRead('confirmed-weakness-v1/'+session.user.id,60000,()=>fyersRequest('weaknessReport'));
  if(!panel.isConnected)return;
  if(!model?.sessions?.length)throw Error('The archived report is unavailable.');
  const cfg=savedRun?.weakness||{},bounds='min="'+model.first+'" max="'+model.last+'"';
  panel.innerHTML='<form id="weakForm"><div class="fields">'+input('From','weakFrom',cfg.from||model.first,'date',bounds)+input('Through','weakTo',cfg.to||model.last,'date',bounds)+input('Budget per stock ₹','weakBudget',cfg.budget??20000,'number','min="1" step="any"')+'</div><button class="primary">Show results</button></form><p>At the 09:44 candle close, rank stocks down at least 1% and under 6% from the open. Their 09:44 close must also be below their 09:39 close. Sell at the 09:45 open, taking the largest decline from each of five sectors. Use a 1% stop, a 2% target, and a 15:00 time exit. All five stocks must qualify and fit the per-stock budget.</p><details><summary>Data and execution assumptions</summary><p>Signals use completed candles and the historical constituent list. At least 98% of the traded roster must have a session open and a 09:44 close. Stocks also need a known sector and a complete opening half hour. A gap exits at the available open, and the stop takes priority if a minute touches both levels. Estimated charges and adverse slippage are each 0.05% per fill. The model assumes the short can be filled.</p></details><p id="weakStatus" role="status"></p>';
  function render(){
   try{
    const run=rankedBasketRun(model,$('weakFrom').value,$('weakTo').value,+$('weakBudget').value,'confirmed-weakness','NIFTY 500 · 09:45 confirmed weakness','weakness',true);
    const months=[...new Set(run.sessionDates.map(s=>s.slice(0,7)))];
    const periods=months.map(m=>{
     const fills=run.trades.filter(t=>t.d.startsWith(m));
     return [m,m==='2026-10'?'Rule selection':m<'2026-10'?'Earlier independent check':'Later validation',new Set(fills.map(t=>t.d)).size,fills.length,cash(total(fills))];
    });
    const signals=model.sessions.filter(s=>s.d>=run.p.from&&s.d<=run.p.to).map(s=>[displayDates(s.d),s.down+' / '+s.size,s.observed,s.missing||s.status||(s.orders.some(t=>t.ep>run.weakness.budget)?'Budget below one share on a selected leg':s.orders.map(t=>esc(t.s)).join(', '))]);
    $('weakReview').innerHTML='<section class="panel"><h2>Performance by period</h2>'+table(['Month','Test phase','Trading days','Trades','Net P&L'],periods)+note('Six variants were compared in October. The highest net result with at least five active sessions was selected. The same settings were applied to the independent checks.')+'<details><summary>Daily breadth and selections</summary>'+table(['Date','Declining / traded roster','Observed','Selections or status'],signals)+'</details></section>';
    lastRun={...run,savedId:savedRun?.id};lastMonth='';showResults();
    $('weakStatus').textContent=run.sessionDates.length+' sessions · '+run.trades.length+' trades · '+run.skipped.length+' incomplete sessions';
   }catch(err){$('weakReview').replaceChildren();$('results').replaceChildren();$('weakStatus').textContent=err.message}
  }
  $('weakForm').onsubmit=e=>{e.preventDefault();render()};render();
 }catch(err){if(panel.isConnected)panel.textContent=err.message}
}
