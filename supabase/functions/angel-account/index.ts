import { createClient } from "npm:@supabase/supabase-js@2";
const url=Deno.env.get("SUPABASE_URL")!, secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin=createClient(url,secret,{auth:{persistSession:false}});
const headers={"Access-Control-Allow-Origin":"https://webdata6432.github.io","Access-Control-Allow-Headers":"authorization,apikey,content-type","Cache-Control":"no-store","Content-Type":"application/json"};
const reply=(v:unknown,status=200)=>new Response(JSON.stringify(v),{headers,status});
const enc=new TextEncoder(), b64=(b:Uint8Array)=>btoa(String.fromCharCode(...b)), bytes=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const key=crypto.subtle.digest("SHA-256",enc.encode("angel-store-v1:"+secret)).then(raw=>crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt","decrypt"]));
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{headers});
 if(req.method!=="POST")return reply({error:"POST required"},405);
 try{
 const token=req.headers.get("Authorization")?.replace(/^Bearer /,"");
 if(!token)return reply({error:"Sign in first"},401);
 const {data:{user},error}=await admin.auth.getUser(token);
 if(error||!user)return reply({error:"Sign in again"},401);
 const {action,apiKey,accessToken}=await req.json(), table=admin.from("angel_connections");
 const aad=enc.encode(user.id);
 if(action==="save"){
 if(typeof apiKey!=="string"||typeof accessToken!=="string"||!apiKey.trim()||!accessToken.trim()||apiKey.length>256||accessToken.length>12000)return reply({error:"Enter valid credentials"},400);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:aad},await key,enc.encode(JSON.stringify([apiKey.trim(),accessToken.trim()])));
 const {error}=await table.upsert({user_id:user.id,sealed:b64(iv)+"."+b64(new Uint8Array(cipher))});if(error)throw error;
 return reply({message:"Saved · test required"});
 }
 if(action==="disconnect"){const {error}=await table.delete().eq("user_id",user.id);if(error)throw error;return reply({message:"Disconnected"})}
 const {data,error:readError}=await table.select("sealed").eq("user_id",user.id).maybeSingle();if(readError)throw readError;
 if(action==="status"||!data)return reply({message:data?"Credentials saved · test required":"No connection configured"});
 if(action!=="test")return reply({error:"Unknown action"},400);
 const [iv,ct]=data.sealed.split(".").map(bytes);
 const [ak,jwt]=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv,additionalData:aad},await key,ct)));
 const res=await fetch("https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json",Authorization:"Bearer "+jwt,"X-PrivateKey":ak,"X-UserType":"USER","X-SourceID":"WEB"},body:JSON.stringify({mode:"LTP",exchangeTokens:{NSE:["2885"]}}),signal:AbortSignal.timeout(10000)});
 const quote=await res.json();return res.ok&&quote.status&&quote.data?.fetched?.length?reply({message:"Market-data quote verified"}):reply({error:"Quote unavailable. Check the API key and current session token."},400);
 }catch{return reply({error:"Connection request failed. Try again."},502)}
});
