import { createClient } from "npm:@supabase/supabase-js@2";
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(Deno.env.get("SUPABASE_URL")!, service);
const headers = {"Access-Control-Allow-Origin":"https://webdata6432.github.io","Access-Control-Allow-Headers":"authorization,apikey,content-type","Content-Type":"application/json","Cache-Control":"no-store"};
const reply = (body:unknown,status=200) => new Response(JSON.stringify(body),{status,headers});
const utf = new TextEncoder();
const sha = (s:string) => crypto.subtle.digest("SHA-256",utf.encode(s));
const key = sha("fyers-store-v1:"+service).then(raw=>crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt","decrypt"]));
const b64 = (a:Uint8Array)=>btoa(String.fromCharCode(...a));
const bytes = (s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
type Config = {id:string,hash:string,redirect:string,token?:string};
async function seal(cfg:Config,uid:string){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:utf.encode(uid)},await key,utf.encode(JSON.stringify(cfg)));
  return b64(iv)+"."+b64(new Uint8Array(data));
}
async function read(value:string,uid:string):Promise<Config>{
  const [iv,cipher]=value.split(".").map(bytes);
  const data=await crypto.subtle.decrypt({name:"AES-GCM",iv,additionalData:utf.encode(uid)},await key,cipher);
  return JSON.parse(new TextDecoder().decode(data));
}
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response(null,{headers});
  if(req.method!=="POST")return reply({error:"POST required"},405);
  try{
    const bearer=req.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
    if(!bearer)return reply({error:"Unlock Algo King first"},401);
    const {data:{user}}=await db.auth.getUser(bearer);
    if(!user?.email_confirmed_at||user.email?.toLowerCase()!=="webdata6432@gmail.com")return reply({error:"Owner access required"},403);
    const body=await req.json(),table=db.from("fyers_connections"),uid=user.id;
    const {data:row,error}=await table.select("*").eq("user_id",uid).maybeSingle();
    if(error)throw error;
    if(body.action==="status")return reply({configured:!!row});
    if(body.action==="start"){
      let cfg:Config;
      if(body.id||body.secret||body.redirect){
        if(!/^[A-Za-z0-9-]{4,100}$/.test(body.id||"")||typeof body.secret!=="string"||!body.secret||body.secret.length>256)return reply({error:"Check the App ID and Secret ID"},400);
        if(!["https://webdata6432.github.io/algo-king/","https://webdata6432.github.io/algo-king/index.html","https://webdata6432.github.io/algo-king"].includes(body.redirect))return reply({error:"Set the FYERS Redirect URL to https://webdata6432.github.io/algo-king/ and paste it here."},400);
        const hash=Array.from(new Uint8Array(await sha(body.id+":"+body.secret)),n=>n.toString(16).padStart(2,"0")).join("");
        cfg={id:body.id,hash,redirect:body.redirect};
      }else if(row) cfg=await read(row.sealed,uid);
      else return reply({error:"Enter the FYERS app details"},400);
      const state=crypto.randomUUID();
      const {error}=await table.upsert({user_id:uid,sealed:await seal(cfg,uid),pending_state:state,state_expires:new Date(Date.now()+600000).toISOString()});
      if(error)throw error;
      const login=new URL("https://api-t1.fyers.in/api/v3/generate-authcode");
      login.search=new URLSearchParams({client_id:cfg.id,redirect_uri:cfg.redirect,response_type:"code",state}).toString();
      return reply({url:login.href,state});
    }
    if(!row)return reply({error:"Configure FYERS first"},409);
    const cfg=await read(row.sealed,uid);
    if(body.action==="finish"){
      if(!body.state||body.state!==row.pending_state||Date.parse(row.state_expires)<=Date.now()||typeof body.code!=="string"||!body.code||body.code.length>10000)return reply({error:"Login expired. Connect again."},400);
      const {data:claim,error}=await table.update({pending_state:null,state_expires:null}).eq("user_id",uid).eq("pending_state",body.state).select("user_id").maybeSingle();
      if(error||!claim)return reply({error:"Start a new FYERS login"},409);
      const res=await fetch("https://api-t1.fyers.in/api/v3/validate-authcode",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({grant_type:"authorization_code",appIdHash:cfg.hash,code:body.code}),signal:AbortSignal.timeout(12000)});
      const auth=await res.json();
      if(!res.ok||!auth.access_token)return reply({error:"FYERS declined the login. Check the app details and reconnect."},400);
      cfg.token=auth.access_token;
      const saved=await table.update({sealed:await seal(cfg,uid)}).eq("user_id",uid).eq("sealed",row.sealed).is("pending_state",null).select("user_id").maybeSingle();
      if(saved.error||!saved.data)throw Error();
      return reply({connected:true});
    }
    if(body.action!=="quotes"||!cfg.token)return reply({error:"Connect to FYERS first"},409);
    const res=await fetch("https://api-t1.fyers.in/data/quotes?symbols=NSE%3ANIFTY50-INDEX%2CBSE%3ASENSEX-INDEX",{headers:{Authorization:cfg.id+":"+cfg.token},signal:AbortSignal.timeout(8000)});
    const q=await res.json();
    if(!res.ok||q.s!=="ok")return reply({error:"FYERS quotes unavailable. Reconnect if your session expired."},409);
    const quotes=(q.d||[]).filter((x:any)=>x.s==="ok"&&x.v?.lp>0).map((x:any)=>({name:x.n==="NSE:NIFTY50-INDEX"?"NIFTY":"SENSEX",price:x.v.lp,prev:x.v.prev_close_price,time:Number(x.v.tt||0)*1000,source:"FYERS",unit:"pts"}));
    return reply({quotes});
  }catch{return reply({error:"FYERS connection request failed. Please retry."},502)}
});
