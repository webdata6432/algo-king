const authOrigin='https://wpqcyyevhxqbhudsxydd.supabase.co';
const publicKey='sb_publishable_B-pFfyhNKmR3npMnJE2D1A_Z94lv22f';
let session=JSON.parse(sessionStorage.getItem('ak-session')||'null');
function sessionChanged(value){
 session=value;sessionStorage.setItem('ak-session',JSON.stringify(value));
 $('account').textContent=value?'My account':'Log in / Sign up';
}
sessionChanged(session);
async function accountRequest(path,body,bearer){
 const r=await fetch(authOrigin+path,{method:'POST',headers:{apikey:publicKey,'Content-Type':'application/json',...(bearer?{Authorization:'Bearer '+bearer}:{})},body:JSON.stringify(body)});
 const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.msg||j.error_description||j.error||'Request failed');return j;
}
function accountPanel(){
 if(session){modal('My account',note(esc(session.user.email))+'<button id="signout">Log out</button>');$('signout').onclick=async()=>{const token=session.access_token;sessionChanged(null);dlg.close();route();await accountRequest('/auth/v1/logout',{},token).catch(()=>{})};return}
 modal('Account','<form id="loginForm"><div class="fields">'+input('Email','email','','email')+input('Password','password','','password','minlength="6"')+'</div><div class="row"><button class="primary" value="login">Log in</button><button value="signup">Sign up</button></div><p role="status" id="authMsg"></p></form>');
 $('loginForm').onsubmit=async e=>{e.preventDefault();let signup=e.submitter?.value==='signup',msg=$('authMsg');try{msg.textContent='Please wait…';let j=await accountRequest(signup?'/auth/v1/signup?redirect_to='+encodeURIComponent(location.origin+location.pathname):'/auth/v1/token?grant_type=password',{email:$('email').value.trim(),password:$('password').value});if(j.access_token){sessionChanged(j);dlg.close();route()}else msg.textContent='Check your email to confirm your account, then log in.'}catch(err){msg.textContent=err.message}};
}
const localAngel=angel;
angel=function(){
 if(['localhost','127.0.0.1'].includes(location.hostname)&&!session)return localAngel();
 $('app').innerHTML=heading('Personal connections','Angel One SmartAPI','Your read-only market-data connection.')+'<section class="panel">'+(session?'<form id="broker"><h2>My connection</h2><div class="fields">'+input('SmartAPI key','brokerKey','','password','autocomplete="off"')+input('Current access token','brokerToken','','password','autocomplete="off"')+'</div><div class="row"><button class="primary">Save connection</button><button type="button" id="checkBroker">Test connection</button><button type="button" id="removeBroker">Disconnect</button></div></form><p role="status" id="brokerStatus"></p>':'<button class="primary" onclick="accountPanel()">Log in / Sign up</button>')+'</section>';
 if(!session)return;
 async function send(action,extra={}){let msg=$('brokerStatus'),owner=session;try{if(owner.expires_at*1000<Date.now()+30000){let refreshed=await accountRequest('/auth/v1/token?grant_type=refresh_token',{refresh_token:owner.refresh_token});if(session!==owner)return;sessionChanged(refreshed)}let j=await accountRequest('/functions/v1/angel-account',{action,...extra},session.access_token);msg.textContent=j.message}catch(e){msg.textContent=e.message}}
 $('broker').onsubmit=e=>{e.preventDefault();let args={apiKey:$('brokerKey').value,accessToken:$('brokerToken').value};$('broker').reset();send('save',args)};
 $('checkBroker').onclick=()=>send('test');$('removeBroker').onclick=()=>send('disconnect');send('status');
}
