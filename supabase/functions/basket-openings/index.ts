import {createClient} from "npm:@supabase/supabase-js@2.49.8";
const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const store=db.storage.from("minute-archive");
const headers={"Access-Control-Allow-Origin":"https://webdata6432.github.io","Access-Control-Allow-Headers":"authorization,apikey,content-type","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
type Mark=[string,number,number]; // session, regular-session opening price and close of first 15 minutes
const utcDate=(ms:number)=>new Date(ms).toISOString().slice(0,10);
async function loadMarks(isin:string,from:string,to:string):Promise<Mark[]>{
 const url="https://api.upstox.com/v3/historical-candle/"+encodeURIComponent("NSE_EQ|"+isin)+"/minutes/15/"+to+"/"+from;
 const r=await fetch(url,{signal:AbortSignal.timeout(16000)});
 const data=await r.json();
 if(data.errors?.some((e:{errorCode:string})=>e.errorCode==="UDAPI100011"))return [];
 if(!r.ok||!Array.isArray(data.data?.candles))throw Error("Opening candle source temporarily unavailable");
 const days=new Map<string,Mark>();
 for(const [stamp,o,h,l,c] of data.data.candles){
  if(typeof stamp!=="string"||!stamp.endsWith("T09:15:00+05:30")||![o,h,l,c].every(n=>Number.isFinite(n)&&n>0)||h<Math.max(o,c)||l>Math.min(o,c))continue;
  const d=stamp.slice(0,10);
  if(d>=from&&d<=to&&Date.parse(stamp)+900000<=Date.now())days.set(d,[d,o,c]);
 }
 return [...days.values()].sort((a,b)=>a[0].localeCompare(b[0]));
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{headers});
 if(req.method!=="POST")return reply({error:"POST required"},405);
 try{
  const token=req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if(!token)return reply({error:"Unlock Algo King first"},401);
  const {data:{user}}=await db.auth.getUser(token);
  if(!user?.email_confirmed_at||user.email?.toLowerCase()!=="webdata6432@gmail.com")return reply({error:"Owner access required"},403);
  const {month,keys}=await req.json(),today=utcDate(Date.now()+19800000),current=today.slice(0,7);
  if(typeof month!=="string"||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||month<"2022-01"||month>current||!Array.isArray(keys)||!keys.length||keys.length>16||!keys.every(k=>typeof k==="string"&&/^IN[A-Z0-9]{10}$/.test(k))||new Set(keys).size!==keys.length)return reply({error:"Invalid instruments or month"},400);
  keys.sort();
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(keys.join(",")))),b=>b.toString(16).padStart(2,"0")).join("");
  const path="opening15/"+month+"/"+hash+".gz", {data:cached}=await store.download(path);
  if(cached){
   const pack=await new Response(cached.stream().pipeThrough(new DecompressionStream("gzip"))).json();
   if(pack.final||(month===current&&Date.now()-pack.at<1800000))return reply(pack.rows);
  }
  const stop=utcDate(Date.UTC(+month.slice(0,4),+month.slice(5),0)),to=stop<today?stop:today;
  const rows:Record<string,Mark[]>={};
  for(let i=0;i<keys.length;i+=4)await Promise.all(keys.slice(i,i+4).map(async k=>{rows[k]=await loadMarks(k,month+"-01",to)}));
  const data={rows,at:Date.now(),final:month<current},blob=await new Response(new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
  const saved=await store.upload(path,blob,{upsert:true,contentType:"application/gzip"});
  if(saved.error)throw Error("Could not persist opening candles");
  return reply(rows);
 }catch(err){return reply({error:err instanceof Error?err.message:"Opening history unavailable"},502)}
});
