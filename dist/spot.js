(()=>{
 const board=document.getElementById('spotBoard'),names=['NIFTY','SENSEX','GOLD','SILVER'];
 let previous={};try{previous=JSON.parse(localStorage.getItem('ak-spot-last')||'{}')}catch{}
 const cards=names.map(name=>{const card=document.createElement('div');card.className='quoteCard';card.tabIndex=0;card.innerHTML='<strong>'+name+'</strong><b>—</b><small>Connecting…</small>';board.append(card);return card});
 let busy=false;function draw(quotes){



  names.forEach((name,i)=>{const incoming=quotes.find(x=>x.name===name&&x.price&&(i<2||x.unit===(i===2?'₹/10 g':'₹/kg')));if(incoming&&!['Angel One','FYERS'].includes(incoming.source))previous[name]=incoming;const q=incoming||previous[name],card=cards[i],price=card.querySelector('b'),status=card.querySelector('small');if(!q?.price){price.textContent='—';status.textContent='Feed unavailable';return}
   const fresh=Date.now()-q.time<=180000&&Date.now()>=q.time;
   price.textContent=(i>=2?'₹':'')+q.price.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})+ (i>=2?q.unit.replace('₹',''):'');
   if(q.prev){const change=q.price-q.prev,span=document.createElement('span');span.className=change>=0?'gainText':'lossText';span.textContent=' '+(change>=0?'▲':'▼')+' '+Math.abs(change).toFixed(2)+' ('+(change>=0?'+':'')+(100*change/q.prev).toFixed(2)+'%)';price.append(span)}
   const stamp=q.date?q.date+' '+q.session:new Date(q.time).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false});
   status.textContent=(fresh?'Within 3 min':q.date?'AM/PM benchmark':'Last known')+' · '+stamp+(q.date?'':' IST');card.title=q.source+' · '+status.textContent;
  });try{localStorage.setItem('ak-spot-last',JSON.stringify(previous))}catch{}
 }
 async function refresh(){if(document.hidden||busy)return;busy=true;try{const r=await fetch(authOrigin+'/functions/v1/spot-board',{signal:AbortSignal.timeout(17000)});const rows=r.ok?await r.json():[];const owner=session;
 if(owner&&owner.expires_at*1000>Date.now()){await Promise.all(['NIFTY 50','SENSEX'].map(async(symbol,i)=>{try{const q=await accountRequest('/functions/v1/angel-account',{action:'quote',symbol},owner.access_token);const m=String(q.asOf||'').match(/^(\d{2})-([A-Za-z]{3})-(\d{4}) (\d{2}:\d{2}:\d{2})$/);const time=m?Date.parse(m[1]+' '+m[2]+' '+m[3]+' '+m[4]+' GMT+0530'):NaN;const old=rows.find(x=>x.name===names[i]);if(session===owner&&q.price>0&&time>=(old?.time||0))rows.unshift({name:names[i],price:q.price,time,unit:'pts',source:'Angel One',prev:q.prev})}catch{}}))}
 if(owner&&owner.expires_at*1000>Date.now()){
  try{const {quotes}=await fyersRequest('quotes');for(const q of quotes){const old=rows.find(x=>x.name===q.name);if(session===owner&&q.time>0&&q.time>=(old?.time||0))rows.unshift(q)}}catch{}
 }
 draw(rows)}catch{draw([])}finally{busy=false}}
 draw([]);refresh();setInterval(refresh,30000);document.addEventListener('visibilitychange',refresh);
})();
