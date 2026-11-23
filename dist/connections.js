async function api(path){if(!['localhost','127.0.0.1'].includes(location.hostname))throw Error('Private connector offline. Start python3 server.py on your personal computer.');let r=await fetch('/api/'+path,{cache:'no-store'});if(!r.headers.get('content-type')?.includes('application/json'))throw Error('Private connector offline. Start python3 server.py.');let j=await r.json();if(!r.ok)throw Error(j.error||'Provider unavailable');return j}
function angel(){$('app').innerHTML=heading('Personal connections','Angel One SmartAPI','Test personal market-data access from the private server.')+'<section class="panel"><div class="row"><h2>Market-data connection</h2><span class="pill">Read only</span></div><div class="fields"><div><small>Connection status</small><h3 id="astat">Checking configuration…</h3></div></div><p id="amsg" class="hint">The test requests an NSE equity quote.</p><button class="primary" id="atest">Test connection</button><details open><summary>Private server setup</summary><p>Install the official Python SmartAPI SDK and its dependencies from requirements.txt. Set ANGEL_API_KEY and ANGEL_ACCESS_TOKEN in the personal server environment. Use a current personal session token. Run <code>python3 server.py</code> and open its localhost address. Credentials stay in the server process.</p></details></section>';let check=async test=>{let version=serial;try{let v=await api(test?'angel/test':'status');if(version!==serial)return;$('astat').textContent=test?'Connected':v.angel?'Configured · test required':'Credentials pending';$('amsg').textContent=test?'Quote received · '+v.checked:'Use Test connection to validate a quote request.'}catch(err){if(version!==serial)return;$('astat').textContent='Disconnected';$('amsg').textContent=err.message}};$('atest').onclick=()=>check(true);check(false)}
const stamp=v=>{if(!v)return 'Unavailable';let d=new Date(/^\d+$/.test(v)?+v:v);return isNaN(d)?String(v):istStamp(d)+' IST'};
function depth(){
 $('app').innerHTML=heading('Market data','Market Depth','Choose an NSE stock to see its FYERS bid and ask levels.')+
 '<section class="panel"><form id="bookform"><label>Search<input id="ds" type="search" placeholder="Name or symbol" autocomplete="off" aria-controls="depthMatches"><span class="searchMatches" id="depthMatches"></span></label></form><div id="book" aria-live="polite"></div></section>';
 const form=$('bookform'),search=$('ds'),list=$('depthMatches'),book=$('book');
 let shares=groups.flat().map(s=>[s,s]);
 fetch('market/shares.json').then(r=>r.json()).then(items=>{shares=items;if(document.activeElement===search)suggest()}).catch(()=>{});
 const norm=v=>v.toUpperCase().replace(/[^A-Z0-9]/g,'');
 function suggest(){
  list.replaceChildren();const q=norm(search.value);if(!q)return;
  const matches=shares.filter(([s,n])=>norm(s).includes(q)||norm(n).includes(q)).sort(([a],[b])=>Number(norm(b)===q)-Number(norm(a)===q)||Number(norm(b).startsWith(q))-Number(norm(a).startsWith(q))).slice(0,20);
  for(const item of matches){const b=document.createElement('button');b.type='button';b.textContent=item[0]+' · '+item[1];b.onclick=()=>choose(item);list.append(b)}
  if(!matches.length)list.textContent='No matching stock';
 }
 search.oninput=()=>{book.replaceChildren();suggest()};
 search.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();list.querySelector('button')?.focus()}if(e.key==='Escape')list.replaceChildren()};
 form.onsubmit=e=>{e.preventDefault();const item=shares.find(([s])=>norm(s)===norm(search.value));if(item)choose(item);else list.querySelector('button')?.click()};
 function choose(item){
  search.value=item[0];list.replaceChildren();
  const symbol=item[0],panel=document.createElement('div');book.replaceChildren(panel);panel.textContent='Loading '+symbol+' order book…';
  const ladder=(title,levels)=>'<div><h3>'+title+'</h3>'+(levels.length?table(['Price ₹','Quantity','Orders'],levels.map(v=>[fmt(v.price),v.quantity,v.orders??'—'])):empty('No open orders reported'))+'</div>';
  pollWhile(panel,15000,()=>fyersRequest('depth',{symbols:[symbol]}),d=>{
   panel.innerHTML=metrics([['Stock',esc(symbol)],['Last price',d.price>0?'₹'+fmt(d.price):'—']])+note('FYERS · Last trade '+esc(quoteTime(d.time))+' · Snapshot fetched '+esc(stamp(d.received)))+'<div class="pair">'+ladder('Buy bids',d.bids)+ladder('Sell asks',d.asks)+'</div>';
  },err=>{panel.textContent=err.message+' ';const link=document.createElement('a');link.href='#angel';link.textContent='Broker connections';panel.append(link)});
 };
}
