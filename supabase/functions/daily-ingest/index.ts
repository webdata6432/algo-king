import {createClient} from "npm:@supabase/supabase-js@2";
const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const shift=(date:string,days:number)=>new Date(Date.parse(date)+86400000*days).toISOString().slice(0,10);
async function ownerFeed(){
 const {data:connections}=await db.from("fyers_connections").select("user_id,sealed").limit(2);
 if(connections?.length!==1)return;
 const row=connections[0];
 const {data}=await db.auth.admin.getUserById(row.user_id);
 if(!data.user?.email_confirmed_at||data.user.email?.toLowerCase()!=="webdata6432@gmail.com")return;
 const utf=new TextEncoder();
 const raw=await crypto.subtle.digest("SHA-256",utf.encode("fyers-store-v1:"+Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")));
 const key=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["decrypt"]);
 const [iv,cipher]=row.sealed.split(".").map((v:string)=>Uint8Array.from(atob(v),c=>c.charCodeAt(0)));
 const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv,additionalData:utf.encode(row.user_id)},key,cipher);
 const cfg=JSON.parse(new TextDecoder().decode(plain));
 if(cfg.id&&cfg.token)return cfg.id+":"+cfg.token;
}
Deno.serve(async req=>{
 const key=req.headers.get("x-worker-key");
 if(req.method!=="POST"||!key||!(await db.rpc("daily_worker_auth",{candidate:key})).data)return new Response(null,{status:403});
 const body=await req.json().catch(()=>({}));
 if(body.directory){
  const source=await fetch("https://raw.githubusercontent.com/webdata6432/algo-king/main/dist/market/caps.json",{signal:AbortSignal.timeout(20000)});
  if(!source.ok)return new Response(null,{status:502});
  const catalog=(await source.json()).companies;
  if(!Array.isArray(catalog)||!catalog.every((r:any[])=>Array.isArray(r)&&r.length===6&&typeof r[5]==="string"))return new Response(null,{status:422});
  const saved=await db.rpc("sync_archive_directory",{catalog});
  return Response.json({updated:!saved.error},{status:saved.error?500:200});
 }
 const {data:jobs,error}=await db.rpc("claim_daily_work",{n:24});
 if(error)return new Response(null,{status:503});
 const incremental=(j:any)=>j.stage>0&&j.checked&&j.checked<j.desired&&!j.unverifiable;
 let feed=jobs.some(incremental)?await ownerFeed().catch(()=>undefined):undefined;
 async function process(job:any){
  const history=job.stage===0||(job.checked>=job.desired&&job.stage<3);
  // Three nonoverlapping intervals fit the provider's ten-year retrieval limit.
  const until=history?shift(job.anchor,-job.stage*3650):job.desired;
  const from=history?(job.stage===2?"2000-01-01":shift(until,-3649)):shift(job.checked,-2);
  try{
   if(feed&&incremental(job)&&Date.parse(until)-Date.parse(from)<349*86400000){
    const query=new URLSearchParams({symbol:job.ticker,resolution:"D",date_format:"1",range_from:from,range_to:until,cont_flag:"1"});
    const res=await fetch("https://api-t1.fyers.in/data/history?"+query,{headers:{Authorization:feed},signal:AbortSignal.timeout(9000)}).catch(()=>null);
    const data=await res?.json().catch(()=>null);
    if(res?.status===401||res?.status===429||[-8,-15,-16,-17,429].includes(data?.code))feed=undefined;
    if(res?.ok&&data?.s==="ok"&&Array.isArray(data.candles)){
     const bars=data.candles.filter(([t,o,,,c]:number[])=>Number.isFinite(t)&&o>0&&c>0)
      .map(([t,o,,,c]:number[])=>[new Date(t*1000+19800000).toISOString().slice(0,10),Math.round(o*100),Math.round(c*100)])
      .filter(([d]:[string,number,number])=>d>=from&&d<=until);
     if(bars.some(([d]:[string,number,number])=>d===until)){
      const saved=await db.rpc("finish_daily_work",{t:job.ticker,token:job.lease,history:false,through_day:until,observed:bars});
      if(saved.error)throw Error("Database write failed");
      return;
     }
    }
   }
   const url="https://api.upstox.com/v3/historical-candle/"+encodeURIComponent(job.instrument)+"/days/1/"+until+"/"+from;
   const res=await fetch(url,{signal:AbortSignal.timeout(20000)});
   const j=await res.json();
   if((job.stage===0||job.unverifiable)&&j.errors?.some((e:any)=>e.errorCode==="UDAPI100011")){
    await db.from("daily_directory").update({unverifiable:true,stage:3,checked:job.desired,lease:null,retry_at:new Date(Date.now()+7*86400000).toISOString(),last_error:"Instrument not recognized by Upstox"}).eq("ticker",job.ticker).eq("lease",job.lease);
    return;
   }
   if(job.unverifiable&&res.ok){
    await db.from("daily_directory").update({unverifiable:false,stage:0,lease:null,retry_at:new Date().toISOString()}).eq("ticker",job.ticker).eq("lease",job.lease);
    return;
   }
   if(!res.ok||!Array.isArray(j.data?.candles))throw Error("Provider "+res.status+" "+String(j.errors?.[0]?.errorCode||""));
   const rows=j.data.candles.filter(([date,o,,,c]:any[])=>date.slice(0,10)>=from&&date.slice(0,10)<=until&&o>0&&c>0)
    .map(([date,o,,,c]:any[])=>[date.slice(0,10),Math.round(o*100),Math.round(c*100)]);
   const done=await db.rpc("finish_daily_work",{t:job.ticker,token:job.lease,history,through_day:until,observed:rows});
   if(done.error)throw Error("Database write failed");
  }catch(err){
   const minutes=Math.min(1440,2**Math.min(11,job.attempts));
   await db.from("daily_directory").update({lease:null,attempts:job.attempts+1,retry_at:new Date(Date.now()+minutes*60000).toISOString(),last_error:String(err).slice(0,100)}).eq("ticker",job.ticker).eq("lease",job.lease);
  }
 }
 for(let i=0;i<jobs.length;i+=4)await Promise.all(jobs.slice(i,i+4).map(process));
 return Response.json({claimed:jobs.length});
});
