const authOrigin='https://wpqcyyevhxqbhudsxydd.supabase.co';
const publicKey='sb_publishable_B-pFfyhNKmR3npMnJE2D1A_Z94lv22f';
let session=JSON.parse(sessionStorage.getItem('ak-session')||'null');
function sessionChanged(value){
 session=value;sessionStorage.setItem('ak-session',JSON.stringify(value));
 if(!value)paintProfile(null);
 $('account').textContent=value?'My account':'Log in / Sign up';
}
sessionChanged(session);
async function accountRequest(path,body,bearer){
 const r=await fetch(authOrigin+path,{method:'POST',headers:{apikey:publicKey,'Content-Type':'application/json',...(bearer?{Authorization:'Bearer '+bearer}:{})},body:JSON.stringify(body)});
 const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.msg||j.error_description||j.error||'Request failed');return j;
}
function accountPanel(){
 if(session){openMemberProfile();return}
 modal('Account','<form id="loginForm"><div class="fields">'+input('Email or mobile number','identity','','text','autocomplete="username" placeholder="Email or +91 mobile number"')+input('Password','password','','password','minlength="6"')+'</div><div class="row"><button class="primary" value="login">Sign in</button><button value="signup">Sign up</button></div><p role="status" id="authMsg"></p></form>');
 $('loginForm').onsubmit=async e=>{e.preventDefault();const signup=e.submitter?.value==='signup',msg=$('authMsg');try{
 const id=$('identity').value.trim(),email=id.includes('@'),identity=email?{email:id}:{phone:mobileNumber(id)};
 msg.textContent='Please wait…';
 const j=await accountRequest(signup?'/auth/v1/signup?redirect_to='+encodeURIComponent(location.origin+location.pathname):'/auth/v1/token?grant_type=password',{...identity,password:$('password').value});
 if(j.access_token){sessionChanged(j);openMemberProfile();return}
 if(email){msg.textContent='Check your email to confirm your account, then sign in.';return}
 modal('Verify mobile number','<form id="otpForm">'+input('SMS code','otp','','text','autocomplete="one-time-code"')+'<button>Verify</button><p id="otpStatus"></p></form>');
 $('otpForm').onsubmit=async ev=>{ev.preventDefault();try{sessionChanged(await accountRequest('/auth/v1/verify',{phone:identity.phone,token:$('otp').value.trim(),type:'sms'}));openMemberProfile()}catch(err){$('otpStatus').textContent=err.message}};
 }catch(err){msg.textContent=/phone.*(disabled|enabled|unsupported)|unsupported.*phone/i.test(err.message)?'Mobile login is awaiting SMS provider setup. Email login is available.':err.message}};

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
function mobileNumber(input){
 let s=input.replace(/[\s()-]/g,'');if(/^\d{10}$/.test(s))s='+91'+s;
 if(!/^\+[1-9]\d{7,14}$/.test(s))throw Error('Enter a valid mobile number with country code.');return s;
}
function paintProfile(photo){
 const host=document.querySelector('.profileIcon');let img=host.querySelector('img');
 if(!photo){img?.remove();host.querySelector('svg').hidden=false;host.querySelector('svg').style.display='';return}
 if(!img){img=document.createElement('img');img.alt='My profile';host.append(img)}
 img.src=photo;host.querySelector('svg').style.display='none';
}
async function memberAPI(body){
 const owner=session;if(!owner)throw Error('Sign in first.');
 if(owner.expires_at*1000<Date.now()+30000){const renewed=await accountRequest('/auth/v1/token?grant_type=refresh_token',{refresh_token:owner.refresh_token});if(session!==owner)throw Error('Account changed');sessionChanged(renewed)}
 const r=await fetch(authOrigin+'/rest/v1/member_profiles'+(body?'?on_conflict=user_id':'?select=mobile,photo&limit=1'),{method:body?'POST':'GET',headers:{apikey:publicKey,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'},body:body?JSON.stringify({...body,user_id:owner.user.id}):undefined});
 if(!r.ok)throw Error('Profile request failed. Please sign in again or retry.');
 return body?null:(await r.json())[0];
}
async function openMemberProfile(){
 const uid=session.user.id;
 modal('My profile','<form id="memberForm"><p></p><img class="memberPhoto" alt="Profile preview" hidden><label>Profile photo<input type="file" accept="image/jpeg,image/png,image/webp"></label><label>Contact mobile<input id="memberMobile" type="tel" placeholder="+91 mobile number"></label><div class="row"><button class="primary" disabled>Save profile</button><button type="button" id="signout">Sign out</button></div><small role="status"></small></form>');
 const form=$('memberForm'),preview=form.querySelector('img'),status=form.querySelector('small'),save=form.querySelector('.primary'),mobile=$('memberMobile');let photo=null;
 form.querySelector('p').textContent=session.user.email||session.user.phone;
 $('signout').onclick=async()=>{let token=session.access_token;sessionChanged(null);dlg.close();route();await accountRequest('/auth/v1/logout',{},token).catch(()=>{})};
 try{const row=await memberAPI();if(session?.user.id!==uid||!form.isConnected)return;photo=row?.photo||null;mobile.value=row?.mobile||session.user.phone||'';if(photo){preview.src=photo;preview.hidden=false;paintProfile(photo)}save.disabled=false}catch(e){status.textContent=e.message;return}
 form.querySelector('[type=file]').onchange=async e=>{const file=e.target.files[0];if(!file)return;save.disabled=true;try{if(file.size>12e6)throw Error('Choose a photo smaller than 12 MB.');const image=await createImageBitmap(file),canvas=document.createElement('canvas');canvas.width=canvas.height=192;let edge=Math.min(image.width,image.height);canvas.getContext('2d').drawImage(image,(image.width-edge)/2,(image.height-edge)/2,edge,edge,0,0,192,192);image.close();photo=canvas.toDataURL('image/jpeg',.82);preview.src=photo;preview.hidden=false;status.textContent='Ready to save.'}catch(e){status.textContent=e.message}finally{save.disabled=false}};
 form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{await memberAPI({mobile:mobile.value.trim()?mobileNumber(mobile.value):null,photo});if(session?.user.id===uid){paintProfile(photo);status.textContent='Profile saved.'}}catch(err){status.textContent=err.message}finally{save.disabled=false}};
}
if(session){const uid=session.user.id;memberAPI().then(row=>{if(session?.user.id===uid)paintProfile(row?.photo)}).catch(()=>{})}
