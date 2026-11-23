import {createClient} from "npm:@supabase/supabase-js@2";
import {unzipSync,strFromU8} from "npm:fflate@0.8.2";
const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
import {createRemoteJWKSet,jwtVerify} from "npm:jose@5.9.6";
const githubKeys=createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
Deno.serve(async req=>{
 const url=new URL(req.url),action=url.searchParams.get("action"),day=url.searchParams.get("day")||"";
 if(req.method!=="POST")return new Response(null,{status:405});
 try{
  const bearer=req.headers.get("authorization")?.replace(/^Bearer /,"")||"";
  const {payload}=await jwtVerify(bearer,githubKeys,{issuer:"https://token.actions.githubusercontent.com",audience:"algo-king-daily",algorithms:["RS256"]});
  if(payload.sub!=="repo:webdata6432/algo-king:ref:refs/heads/main"||payload.workflow_ref!=="webdata6432/algo-king/.github/workflows/archive-gap-repair.yml@refs/heads/main"||!["push","schedule","workflow_dispatch"].includes(String(payload.event_name)))throw Error();
 }catch{return new Response(null,{status:403})}
 const today=new Date(Date.now()+19800000).toISOString().slice(0,10);
 if(action==="list"){
  const queued=await db.from("exchange_reports").upsert({day:today},{onConflict:"day",ignoreDuplicates:true});
  if(queued.error)return new Response(null,{status:503});
  const found=await db.from("exchange_reports").select("day").eq("status","pending").lte("retry_at",new Date().toISOString()).order("day",{ascending:false}).limit(30);
  return found.error?new Response(null,{status:503}):Response.json({days:found.data.map(x=>x.day)});
 }
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day>today)return new Response(null,{status:400});
 if(action==="missing"||action==="retry"){
  const state=action==="missing"&&day<today?{status:"no report"}:{retry_at:new Date(Date.now()+3*3600000).toISOString()};
  const result=await db.from("exchange_reports").update(state).eq("day",day).eq("status","pending");
  return Response.json({saved:!result.error},{status:result.error?503:200});
 }
 if(action!=="report")return new Response(null,{status:400});
 const missing=await db.from("daily_directory").select("instrument").eq("active",true).eq("unverifiable",true).like("instrument","NSE_EQ|%").like("ticker","AMFI:%");
 if(missing.error)return new Response(null,{status:503});
 const wanted=new Set(missing.data.map(x=>x.instrument.split("|")[1]));
 try{
   const name="BhavCopy_NSE_CM_0_0_0_"+day.replaceAll("-","")+"_F_0000.csv";
   const bytes=new Uint8Array(await req.arrayBuffer());if(bytes.length>5000000)return new Response(null,{status:413});
   const data=unzipSync(bytes)[name];const [header,...lines]=strFromU8(data).trim().split(/\r?\n/);
   const cols=header.replace(/^\uFEFF/,"").split(","),indexes=["TradDt","ISIN","SctySrs","OpnPric","ClsPric","TtlTradgVol"].map(k=>cols.indexOf(k));
   if(indexes.includes(-1))throw Error("Unexpected exchange columns");
   const rows=new Map();let valid=false;
   for(const line of lines){
    const fields=line.match(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)?.map(x=>x.replace(/,$/,"").replace(/^"|"$/g,""))||[];
    const [d,isin,series,o,c,volume]=indexes.map(i=>fields[i]);
    if(d!==day)continue;valid=true;
    if(wanted.has(isin)&&["EQ","BE","BZ","SM","ST"].includes(series)&&+volume>0&&+o>0&&+c>0)rows.set(isin,[isin,Math.round(+o*100),Math.round(+c*100)]);
   }
   if(!valid)throw Error("Unexpected report date");
   const saved=await db.rpc("merge_exchange_session",{p_day:day,p_rows:[...rows.values()]});if(saved.error)throw Error("Database write failed");
   return Response.json({matches:saved.data});
 }catch(err){console.error(day,String(err));return new Response(null,{status:502})}
});
