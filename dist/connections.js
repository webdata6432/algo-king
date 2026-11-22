async function api(path){if(!['localhost','127.0.0.1'].includes(location.hostname))throw Error('Private connector offline. Start python3 server.py on your personal computer.');let r=await fetch('/api/'+path,{cache:'no-store'});if(!r.headers.get('content-type')?.includes('application/json'))throw Error('Private connector offline. Start python3 server.py.');let j=await r.json();if(!r.ok)throw Error(j.error||'Provider unavailable');return j}
function angel(){$('app').innerHTML=heading('Personal connections','Angel One SmartAPI','Test personal market-data access from the private server.')+'<section class="panel"><div class="row"><h2>Market-data connection</h2><span class="pill">Read only</span></div><div class="fields"><div><small>Connection status</small><h3 id="astat">Checking configuration…</h3></div></div><p id="amsg" class="hint">The test requests an NSE equity quote.</p><button class="primary" id="atest">Test connection</button><details open><summary>Private server setup</summary><p>Install the official Python SmartAPI SDK and its dependencies from requirements.txt. Set ANGEL_API_KEY and ANGEL_ACCESS_TOKEN in the personal server environment. Use a current personal session token. Run <code>python3 server.py</code> and open its localhost address. Credentials stay in the server process.</p></details></section>';let check=async test=>{let version=serial;try{let v=await api(test?'angel/test':'status');if(version!==serial)return;$('astat').textContent=test?'Connected':v.angel?'Configured · test required':'Credentials pending';$('amsg').textContent=test?'Quote received · '+v.checked:'Use Test connection to validate a quote request.'}catch(err){if(version!==serial)return;$('astat').textContent='Disconnected';$('amsg').textContent=err.message}};$('atest').onclick=()=>check(true);check(false)}
const stamp=v=>{if(!v)return 'Unavailable';let d=new Date(/^\d+$/.test(v)?+v:v);return isNaN(d)?String(v):istStamp(d)+' IST'};
function depth(){
 $('app').innerHTML=heading('Market data','Market Depth','Choose an NSE stock to see its FYERS bid and ask levels.')+
 '<section class="panel"><form id="bookform"><div class="fields">'+input('Search stock','ds','','search','list="stocks" maxlength="40" placeholder="Name or symbol"')+
 '<datalist id="stocks"></datalist></div><button class="primary">Show depth</button></form><div id="book"></div></section>';
 const form=$('bookform'),search=$('ds'),list=$('stocks'),book=$('book');
 let shares=groups.flat().map(s=>[s,s]);
 fetch('market/shares.json').then(r=>r.json()).then(items=>{shares=items;if(search.value)suggest()}).catch(()=>{});
 function suggest(){const q=search.value.trim().toUpperCase();list.replaceChildren();
  if(q)for(const [symbol,name] of shares.filter(([s,n])=>(s+' '+n).toUpperCase().includes(q)).slice(0,30)){
   const option=document.createElement('option');option.value=symbol;option.label=name;list.append(option);
  }
 }
 search.oninput=()=>{book.replaceChildren();suggest()};
 form.onsubmit=e=>{
  e.preventDefault();const q=search.value.trim().toUpperCase();
  const item=shares.find(([s])=>s===q)||shares.find(([,n])=>n.toUpperCase()===q);
  if(!item){book.textContent='Choose a stock from the search results.';return}
  const symbol=item[0],panel=document.createElement('div');book.replaceChildren(panel);panel.textContent='Loading '+symbol+' order book…';
  const ladder=(title,levels)=>'<div><h3>'+title+'</h3>'+(levels.length?table(['Price ₹','Quantity','Orders'],levels.map(v=>[fmt(v.price),v.quantity,v.orders??'—'])):empty('No open orders reported'))+'</div>';
  pollWhile(panel,15000,()=>fyersRequest('depth',{symbols:[symbol]}),d=>{
   panel.innerHTML=metrics([['Stock',esc(symbol)],['Last price',d.price>0?'₹'+fmt(d.price):'—']])+note('FYERS · Last trade '+esc(quoteTime(d.time))+' · Snapshot fetched '+esc(stamp(d.received)))+'<div class="pair">'+ladder('Buy bids',d.bids)+ladder('Sell asks',d.asks)+'</div>';
  },err=>panel.textContent=err.message);
 };
}
