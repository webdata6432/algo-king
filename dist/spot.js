(()=>{
 const board=document.getElementById('spotBoard'),names=['NIFTY','SENSEX','GOLD','SILVER'];
 const cards=names.map(name=>{const card=document.createElement('div');card.className='quoteCard';card.innerHTML='<strong>'+name+'</strong><b>—</b><small>Connecting…</small>';board.append(card);return card});
 let busy=false;async function refresh(){
  if(document.hidden||busy)return;busy=true;let quotes=[];
  try{const r=await fetch(authOrigin+'/functions/v1/spot-board',{signal:AbortSignal.timeout(12000)});if(r.ok)quotes=await r.json()}catch{}
  names.forEach((name,i)=>{const q=quotes.find(x=>x.name===name),card=cards[i],price=card.querySelector('b'),status=card.querySelector('small');if(!q?.price){price.textContent='—';status.textContent='Feed unavailable';return}
   const fresh=Date.now()-q.time<90000&&Date.now()>=q.time;
   price.textContent=q.price.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+q.unit;
   if(q.prev){const change=q.price-q.prev,span=document.createElement('span');span.className=change>=0?'gainText':'lossText';span.textContent=' '+(change>=0?'▲':'▼')+' '+Math.abs(change).toFixed(2)+' ('+(change>=0?'+':'')+(100*change/q.prev).toFixed(2)+'%)';price.append(span)}
   const stamp=new Date(q.time).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false});
   status.textContent=(fresh&&i>=2?'Live':'Last quote')+' · '+stamp+' IST';card.title=q.source+' · '+status.textContent;
  });busy=false;
 }
 refresh();setInterval(refresh,30000);document.addEventListener('visibilitychange',refresh);
})();
