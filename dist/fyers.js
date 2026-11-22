pages.angel='Broker connections';
async function fyersRequest(action,details={}){
 const owner=session;
 if(!owner)throw Error('Unlock Algo King to connect.');
 if(owner.expires_at*1000<Date.now()+30000){
  const refreshed=await accountRequest('/auth/v1/token?grant_type=refresh_token',{refresh_token:owner.refresh_token});
  if(session!==owner)throw Error('Reopen your workspace.');
  sessionChanged(refreshed);
 }
 if(action==='archiveRank'){
  const {from,to,cap,query,cut,limit}=details;
  return accountRequest('/rest/v1/rpc/owner_momentum_archive',{p_from:from,p_to:to,p_cap:cap,p_query:query,p_cut:cut,p_limit:limit},session.access_token);
 }
 return accountRequest('/functions/v1/fyers-account',{action,...details},session.access_token);
}
const angelPanel=angel;
angel=function(){
 angelPanel();
 if(!session)return;
 const section=document.createElement('section');
 section.className='panel';
 section.innerHTML='<h2>FYERS market data</h2><p>Connect your non-trading app to check NIFTY and SENSEX quotes.</p><form><details open><summary>FYERS app details</summary><div class="fields"><label>App ID<input name="id" autocomplete="off"></label><label>Secret ID<input name="secret" type="password" autocomplete="off"></label><label>Registered redirect URL<input name="redirect" type="url" placeholder="Paste from FYERS"></label></div></details><div class="row"><button class="primary">Connect FYERS</button><button type="button">Test quotes</button></div><p role="status"></p></form>';
 $('app').prepend(section);
 const form=section.querySelector('form'),message=form.querySelector('[role=status]');
 fyersRequest('status').then(s=>{if(s.configured)form.querySelector('details').open=false}).catch(e=>message.textContent=e.message);
 form.onsubmit=async e=>{
  e.preventDefault();const button=form.querySelector('button');button.disabled=true;
  try{
   const details=Object.fromEntries(Array.from(new FormData(form),([k,v])=>[k,v.trim()]));
   const login=await fyersRequest('start',details);
   sessionStorage.setItem('ak-fyers-state',login.state);
   form.reset();location.assign(login.url);
  }catch(err){message.textContent=err.message;button.disabled=false}
 };
 form.querySelector('[type=button]').onclick=async()=>{
  try{const {quotes}=await fyersRequest('quotes');message.textContent=quotes.map(q=>q.name+' '+fmt(q.price)).join(' · ')||'No quotes returned.'}catch(e){message.textContent=e.message}
 };
 if(window.fyersNotice)message.textContent=window.fyersNotice;
};
(async()=>{
 const params=new URLSearchParams(location.search);
 if(!params.has('state')||(!params.has('auth_code')&&!params.has('error')&&!params.has('s')))return;
 const expected=sessionStorage.getItem('ak-fyers-state');
 history.replaceState(null,'',location.pathname+'#angel');
 if(!expected||params.get('state')!==expected){window.fyersNotice='Login mismatch. Start Connect FYERS again.';return}
 sessionStorage.removeItem('ak-fyers-state');
 try{
  await fyersRequest('finish',{state:expected,code:params.get('auth_code')});
  window.fyersNotice='Connected. Use Test quotes to verify the feed.';
 }catch(e){window.fyersNotice=e.message}
 if(location.hash==='#angel')angel();
})();

function quoteTime(time){
 if(!Number.isFinite(time)||time<=0||time>Date.now()+1000)return 'Provider time unavailable';
 const age=(Date.now()-time)/60000;
 return new Date(time).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'})+' IST · '+(age<3?'within 3 min':age<30?'within 30 min':'last known');
}
async function stockQuotes(symbols){
 const quotes=[];
 for(let i=0;i<symbols.length;i+=50){
  const data=await fyersRequest('stockQuotes',{symbols:symbols.slice(i,i+50)});
  quotes.push(...data.quotes);
 }
 return quotes;
}
function pollWhile(node,interval,read,paint,onError){
 async function refresh(){
  if(!node.isConnected)return;
  if(!document.hidden){
   try{const result=await read();if(node.isConnected)paint(result)}
   catch(err){if(node.isConnected)onError(err)}
  }
  if(node.isConnected)setTimeout(refresh,interval);
 }
 refresh();
}
