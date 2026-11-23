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
    trades.push({d,entryDay:d,s,qty,side:model.side,entry:'09:15',exit:time,ep,xp,gross,charges,net:gross-charges,reason:reason==='Time'?'15:15 exit':reason+' · hourly candle'});
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
  app.innerHTML=heading('Historical backtest','Strategy library','Open a strategy to see its rules, quarterly results and trade log.')+'<section class="panel"><h2>Stock baskets</h2><div class="basketCards" id="basketCards">Loading stock results…</div></section><section class="panel"><h2>Index options</h2><div id="optionCards" class="basketCards"></div></section>';
  const cards=$('basketCards');
  ['ATM call sell','ATM put sell','ATM call buy','ATM put buy','Under ₹200 call sell','Under ₹200 put sell','Near ₹300 call sell','Near ₹300 put sell','Monthly trend ATM','Monthly trend OTM','Monthly short put'].forEach((name,i)=>{
    const btn=document.createElement('button');btn.textContent=name;btn.onclick=()=>optionHistory(i);$('optionCards').append(btn);
  });
  try{
    const models=await compressedMarket('stock-baskets');if(!cards.isConnected)return;
    cards.replaceChildren();
    for(const m of models){
      const run=stockRun(m,'2023-10-01','2026-09-30'),qs=Object.values(run.quarters);
      const btn=document.createElement('button');
      btn.innerHTML='<b>'+esc(m.name)+'</b><span>'+cash(run.net)+'</span><small>'+qs.filter(v=>v>0).length+'/12 positive quarters · 5 sectors</small>';
      btn.onclick=()=>openBasket(m);cards.append(btn);
    }
  }catch(err){cards.textContent=err.message}
}
function openBasket(model){
  $('app').innerHTML='<button id="libraryBack">← Strategy library</button>'+heading('Stock basket',model.name,'Tuesday 09:15 entry. In each sector pair, rank the prior session’s open-to-close return. '+(model.name.startsWith('Leader')?'Select the stronger stock.':'Select the weaker stock.')+' '+model.side+' five names. Stop '+model.stop+'%, target '+model.target+'%, time exit 15:15 IST.')+'<section class="panel"><p>Sector pairs: Infosys / TCS, HDFC Bank / ICICI Bank, Maruti / M&amp;M, Sun Pharma / Cipla, ITC / Hindustan Unilever. Budget ₹20,000 per sector, whole shares. Costs include fees and slippage estimated at 0.10% per side. Stop wins ambiguous hourly candles. Exit time for a barrier marks its hour. A basket requires all five legs.</p><div class="fields">'+input('From','stockFrom','2023-10-01','date')+input('Through','stockTo','2026-09-30','date')+'</div><div id="quarters"></div></section><div id="results"></div>';
  $('libraryBack').onclick=historicalBacktest;
  function render(){
    lastRun=stockRun(model,$('stockFrom').value,$('stockTo').value);lastMonth='';
    $('quarters').innerHTML=table(['Quarter','Net P&L'],Object.entries(lastRun.quarters).map(([q,v])=>[q,cash(v)]));showResults();
  }
  $('stockFrom').onchange=$('stockTo').onchange=render;render();
}
