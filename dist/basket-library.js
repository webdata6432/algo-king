const marketFiles=new Map();
function compressedMarket(name){
  if(!marketFiles.has(name)){
    const file=fetch('market/'+name+'.json.gz').then(async res=>{
      if(!res.ok)throw Error('Archive unavailable. Reload to retry.');
      return new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).json();
    }).catch(err=>{marketFiles.delete(name);throw err});
    marketFiles.set(name,file);
  }
  return marketFiles.get(name);
}
function stockRun(model,from,to){
  const p={id:model.name,s:model.name,side:model.side,source:'Upstox · hourly stock candles',from,to,stop:model.stop,stopUnit:'%',slip:5};
  const trades=[];
  for(const [d,s,ep,xp,time,reason] of model.fills){
    if(d<from||d>to)continue;
    const qty=Math.floor(20000/ep),gross=(xp-ep)*qty*(model.side==='Buy'?1:-1);
    const charges=(ep+xp)*qty*0.001;
    trades.push({d,entryDay:d,s,qty,side:model.side,entry:model.entry||'09:15',exit:time,ep,xp,gross,charges,net:gross-charges,reason:reason==='Time'?'15:15 exit':reason+' · hourly candle'});
  }
  trades.sort((a,b)=>(a.d+a.exit).localeCompare(b.d+b.exit)||a.s.localeCompare(b.s));
  let net=0,peak=0,dd=0;const quarters={};
  for(const t of trades){
    net+=t.net;t.cum=net;peak=Math.max(peak,net);t.dd=net-peak;dd=Math.min(dd,t.dd);
    const q=t.d.slice(0,4)+' Q'+Math.ceil(Number(t.d.slice(5,7))/3);
    quarters[q]=(quarters[q]||0)+t.net;
  }
  return {p,trades,quarters,net,dd,win:100*trades.filter(t=>t.net>0).length/(trades.length||1),skipped:[]};
}
async function historicalBacktest(){
  const app=$('app');
  app.innerHTML=heading('Historical backtest','Strategy library','Open a strategy to see its rules, quarterly results and trade log.')+'<section class="panel"><h2>NIFTY 500 · 09:45 confirmed weakness</h2><p>Short five sectors in a falling market. Stop 1%, target 2%.</p><a class="button" href="#confirmed-weakness">Open backtest</a></section><section class="panel"><h2>NIFTY 500 · first five at ±2%</h2><p>09:20 breakout · 1% stop · 15:00 exit</p><a class="button" href="#first-five">Open backtest</a></section><section class="panel"><h2>NIFTY 500 sector momentum</h2><p>Trade five sectors on the side of the opening market breadth.</p><a class="button" href="#sector-momentum">Open strategy</a></section><section class="panel"><h2>Profitable in all 12 quarters</h2><div class="basketCards" id="basketCards">Loading stock results…</div><details><summary>Research results · below target</summary><div id="researchBaskets" class="basketCards"></div></details></section><section class="panel"><h2>Index options</h2><div id="optionCards" class="basketCards"></div></section>';
  savedStrategySection(app);
  const cards=$('basketCards');
  ['ATM call sell','ATM put sell','ATM call buy','ATM put buy','Under ₹200 call sell','Under ₹200 put sell','Near ₹300 call sell','Near ₹300 put sell','Monthly trend ATM','Monthly trend OTM','Monthly short put'].forEach((name,i)=>{
    const btn=document.createElement('button');btn.textContent=name;btn.onclick=()=>optionHistory(i);$('optionCards').append(btn);
  });
  try{
    const models=(await Promise.all(['stock-baskets','opening-baskets'].map(compressedMarket))).flat();if(!cards.isConnected)return;
    cards.replaceChildren();
    for(const m of models){
      const run=stockRun(m,'2023-10-01','2026-09-30'),qs=Object.values(run.quarters);
      const btn=document.createElement('button');
      btn.innerHTML='<b>'+esc(m.name)+'</b><span>'+cash(run.net)+'</span><small>'+qs.filter(v=>v>0).length+'/12 positive quarters · 5 sectors</small>';
      btn.onclick=()=>openBasket(m);
      const qualified=run.net>0 && qs.length===12 && qs.every(v=>v>0);
      (qualified?cards:$('researchBaskets')).append(btn);
    }
    if(!cards.children.length)cards.textContent='No tested stock basket finished positive after costs in all 12 quarters.';
  }catch(err){cards.textContent=err.message}
}
function openBasket(model){
  $('app').innerHTML='<button id="libraryBack">← Strategy library</button>'+heading('Stock basket',model.name,(model.entry?'10:15 IST entry after all five sectors show a qualifying opening-hour move. Choose the strongest stock per sector for buys (at least +0.5%), or the weakest for sells (at most −0.5%).':'Tuesday 09:15 entry. Rank the prior session’s open-to-close return in each sector. '+(model.name.startsWith('Leader')?'Select the stronger stock.':'Select the weaker stock.'))+' '+model.side+' five names. Stop '+model.stop+'%, target '+model.target+'%, time exit 15:15 IST.')+'<section class="panel"><p>Sector pairs: Infosys / TCS, HDFC Bank / ICICI Bank, Maruti / M&amp;M, Sun Pharma / Cipla, ITC / Hindustan Unilever. Budget ₹20,000 per sector, whole shares. Costs include fees and slippage estimated at 0.10% per side. Stop wins ambiguous hourly candles. Exit time for a barrier marks its hour. A basket requires all five legs.</p><div class="fields">'+input('From','stockFrom','2023-10-01','date')+input('Through','stockTo','2026-09-30','date')+'</div><div id="quarters"></div></section><div id="results"></div>';
  $('libraryBack').onclick=historicalBacktest;
  function render(){
    lastRun=stockRun(model,$('stockFrom').value,$('stockTo').value);lastMonth='';
    $('quarters').innerHTML=table(['Quarter','Net P&L'],Object.entries(lastRun.quarters).map(([q,v])=>[q,cash(v)]));showResults();
  }
  $('stockFrom').onchange=$('stockTo').onchange=render;render();
}
