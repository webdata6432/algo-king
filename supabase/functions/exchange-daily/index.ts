import {createClient} from "npm:@supabase/supabase-js@2";
import {unzipSync,strFromU8} from "npm:fflate@0.8.2";
const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
Deno.serve(async req=>{
 const key=req.headers.get("x-worker-key");
 if(req.method!=="POST"||!key||!(await db.rpc("daily_worker_auth",{candidate:key})).data)return new Response(null,{status:403});
 const {data:days,error}=await db.from("exchange_reports").select("day").eq("status","pending").lte("retry_at",new Date().toISOString()).order("day",{ascending:false}).limit(6);
 const missing=await db.from("daily_directory").select("instrument").eq("active",true).eq("unverifiable",true).like("instrument","NSE_EQ|%").like("ticker","AMFI:%");
 if(error||missing.error)return new Response(null,{status:503});
 const wanted=new Set(missing.data.map(x=>x.instrument.split("|")[1]));
 const today=new Date(Date.now()+19800000).toISOString().slice(0,10);
 for(const {day} of days){
  try{
   const name="BhavCopy_NSE_CM_0_0_0_"+day.replaceAll("-","")+"_F_0000.csv";
   const r=await fetch("https://nsearchives.nseindia.com/content/cm/"+name+".zip",{signal:AbortSignal.timeout(9000)});
   if(r.status===404&&day<today){await db.from("exchange_reports").update({status:"no report"}).eq("day",day);continue}
   if(!r.ok)throw Error("NSE HTTP "+r.status);
   const data=unzipSync(new Uint8Array(await r.arrayBuffer()))[name];const [header,...lines]=strFromU8(data).trim().split(/\r?\n/);
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
  }catch(err){console.error(day,String(err));await db.from("exchange_reports").update({retry_at:new Date(Date.now()+3*3600000).toISOString()}).eq("day",day)}
 }
 return Response.json({checked:days.length});
});
