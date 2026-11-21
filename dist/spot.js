(()=>{
 const board=document.getElementById('spotBoard'),names=['NIFTY','SENSEX','GOLD','SILVER'];
 let previous={};try{previous=JSON.parse(localStorage.getItem('ak-spot-last')||'{}')}catch{}
 const cards=names.map(name=>{const card=document.createElement('div');card.className='quoteCard';card.tabIndex=0;card.innerHTML='<strong>'+name+'</strong><b>—</b><small>Connecting…</small>';board.append(card);return card});
 let busy=false;function draw(quotes){



  names.forEach((name,i)=>{const incoming=quotes.find(x=>x.name===name&&x.price&&(i<2||x.unit===(i===2?'₹/10 g':'₹/kg')));if(incoming)previous[name]=incoming;const q=previous[name],card=cards[i],price=card.querySelector('b'),status=card.querySelector('small');if(!q?.price){price.textContent='—';status.textContent='Feed unavailable';return}
   const fresh=Date.now()-q.time<90000&&Date.now()>=q.time;
   price.textContent=(i>=2?'₹':'')+q.price.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})+ (i>=2?q.unit.replace('₹',''):'');
   if(q.prev){const change=q.price-q.prev,span=document.createElement('span');span.className=change>=0?'gainText':'lossText';span.textContent=' '+(change>=0?'▲':'▼')+' '+Math.abs(change).toFixed(2)+' ('+(change>=0?'+':'')+(100*change/q.prev).toFixed(2)+'%)';price.append(span)}
   const stamp=q.date?q.date+' '+q.session:new Date(q.time).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false});
   status.textContent=(q.live&&incoming&&fresh?'Live':q.date?'IBJA 999':'Last quote')+' · '+stamp+(q.date?'':' IST');card.title=q.source+' · '+status.textContent;
  });try{localStorage.setItem('ak-spot-last',JSON.stringify(previous))}catch{}
 }
 async function refresh(){if(document.hidden||busy)return;busy=true;try{const r=await fetch(authOrigin+'/functions/v1/spot-board',{signal:AbortSignal.timeout(17000)});draw(r.ok?await r.json():[])}catch{draw([])}finally{busy=false}}
 draw([]);refresh();setInterval(refresh,30000);document.addEventListener('visibilitychange',refresh);
})();
