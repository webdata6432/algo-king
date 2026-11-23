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
const minuteStore=db.storage.from("minute-archive");
async function archiveRead(path:string){
 const {data,error}=await minuteStore.download(path);
 if(error||!data)return null;
 return await new Response(data.stream().pipeThrough(new DecompressionStream("gzip"))).json();
}
async function archiveWrite(path:string,data:unknown){
 const blob=await new Response(new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
 const {error}=await minuteStore.upload(path,blob,{contentType:"application/gzip",upsert:true});
 if(error)throw Error("Minute archive write failed");
}
async function minuteMonth(body:any){
 const {instrument,month}=body;
 const indices=["NSE_INDEX|Nifty 50","BSE_INDEX|SENSEX","NSE_INDEX|Nifty Bank","NSE_INDEX|NIFTY MIDCAP 100"];
 if(typeof instrument!=="string"||(!indices.includes(instrument)&&!/^NSE_EQ\|[A-Z0-9]{12}$/.test(instrument))||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return reply({error:"Invalid instrument or month"},400);
 const now=new Date(Date.now()+19800000),today=now.toISOString().slice(0,10),current=today.slice(0,7);
 const safe=instrument.replace(/[^A-Za-z0-9]/g,"_");
 const yearFolder="yearly/"+safe;
 if(body.action==="minuteYear"){
  const yr=month.slice(0,4);
  const last=yr===current.slice(0,4)?now.getUTCMonth():12;
  if(yr<"2022"||yr>current.slice(0,4)||last<1)return reply({error:"No completed months for this year"},422);
  const through=yr+"-"+String(last).padStart(2,"0"),path=yearFolder+"/"+through+".gz";
  const existing=await minuteStore.list(yearFolder,{search:through+".gz",limit:1});
  if(existing.data?.some(f=>f.name===through+".gz"))return reply({through,ready:true});
  const chunks:Record<string,number[][]>={};
  for(let i=1;i<=last;i+=3){
   const months=Array.from({length:Math.min(3,last+1-i)},(_,j)=>yr+"-"+String(i+j).padStart(2,"0"));
   const packs=await Promise.all(months.map(m=>archiveRead("spot/"+safe+"/"+m+".gz")));
   if(packs.some(pack=>!pack?.final||!pack.rows?.length))return reply({through,ready:false});
   months.forEach((m,j)=>chunks[m]=packs[j].rows);
  }
  await archiveWrite(path,{chunks});
  return reply({through,ready:true});
 }
 if(body.action==="minuteLinks"){
  if(!Array.isArray(body.months)||body.months.length>72||!body.months.every((m:string)=>/^\d{4}-(0[1-9]|1[0-2])$/.test(m)))return reply({error:"Invalid archive months"},400);
  const prefix="spot/"+instrument.replace(/[^A-Za-z0-9]/g,"_")+"/";
  const paths=body.months.filter((m:string)=>m<current).map((m:string)=>prefix+m+".gz");
  const [links,listed]=await Promise.all([paths.length?minuteStore.createSignedUrls(paths,900):null,minuteStore.list(yearFolder,{limit:100,sortBy:{column:"name",order:"desc"}})]);
  const ends:Record<string,string>={};
  for(const f of listed.data||[]){
   const end=f.name.slice(0,7),yr=end.slice(0,4);
   if(!ends[yr]&&/^\d{4}-\d{2}\.gz$/.test(f.name)&&body.months.filter((m:string)=>m.startsWith(yr+"-")&&m<=end).length>=4)ends[yr]=end;
  }
  const years=Object.values(ends);
  const signatures=years.length?await minuteStore.createSignedUrls(years.map(end=>yearFolder+"/"+end+".gz"),900):null;
  const yearLinks=Object.fromEntries((signatures?.data||[]).filter(x=>x.path&&x.signedUrl&&!x.error).map(x=>{const end=x.path!.slice(-10,-3);return [end.slice(0,4),{end,url:x.signedUrl}]}));
  return reply({yearLinks,links:Object.fromEntries((links?.data||[]).filter(x=>x.signedUrl&&!x.error&&x.path).map(x=>[x.path!.slice(-10,-3),x.signedUrl]))});
 }
 if(month<"2022-01"||month>current)return reply({error:"Minute history starts January 2022. Choose an available month."},422);
 const from=month+"-01",end=new Date(Date.UTC(+month.slice(0,4),+month.slice(5),0)).toISOString().slice(0,10),to=end<today?end:today;
 const path="spot/"+instrument.replace(/[^A-Za-z0-9]/g,"_")+"/"+month+".gz";
 let pack=await archiveRead(path);
 if(!pack|| (month===current && Date.now()-pack.at>300000) || (month!==current && !pack.final)){
  const response=await fetch("https://api.upstox.com/v3/historical-candle/"+encodeURIComponent(instrument)+"/minutes/1/"+to+"/"+from,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)return reply({error:"Upstox minute history unavailable for "+month+" ("+response.status+")"},502);
  const payload=await response.json(),candles=payload.data?.candles;
  if(!Array.isArray(candles))return reply({error:"Incomplete provider response for "+month},502);
  const rows=candles.filter(([t,o,h,l,c]:any[])=>typeof t==="string"&&t.startsWith(month+"-")&&t.endsWith("+05:30")&&t.slice(11,16)>="09:15"&&t.slice(11,16)<"15:30"&&Date.parse(t)+60000<=Date.now()&&[o,h,l,c].every(v=>Number.isFinite(v)&&v>0)&&h>=Math.max(o,c)&&l<=Math.min(o,c)).map(([t,o,h,l,c]:any[])=>[Math.floor(Date.parse(t)/60000),o,h,l,c]).sort((a:number[],b:number[])=>a[0]-b[0]);
  pack={rows,at:Date.now(),final:month!==current};
  if(rows.length)await archiveWrite(path,pack);
 }
 return reply(body.warm?{count:pack.rows.length,month,instrument}:{candles:pack.rows,source:"Upstox · Supabase minute archive"});
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response(null,{headers});
  if(req.method!=="POST")return reply({error:"POST required"},405);
  try{
    const worker=req.headers.get("x-worker-key");
    if(worker){
      if(!(await db.rpc("daily_worker_auth",{candidate:worker})).data)return reply({error:"Worker access required"},403);
      const job=await req.json();
      if(job.action!=="minuteMonth"||job.warm!==true)return reply({error:"Invalid archive job"},400);
      const result=await minuteMonth(job);
      if(result.ok){
        const {count}=await result.clone().json();
        if(count===0)await db.from("minute_fetch_queue").update({retry_at:new Date(Date.now()+7*86400000).toISOString()}).eq("instrument",job.instrument).eq("month",job.month);
      }
      return result;
    }
    const bearer=req.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
    if(!bearer)return reply({error:"Unlock Algo King first"},401);
    const {data:{user}}=await db.auth.getUser(bearer);
    if(!user?.email_confirmed_at||user.email?.toLowerCase()!=="webdata6432@gmail.com")return reply({error:"Owner access required"},403);
    const body=await req.json(),table=db.from("fyers_connections"),uid=user.id;
    if(body.action==="minuteMonth"||body.action==="minuteLinks"||body.action==="minuteYear")return await minuteMonth(body);
    // Read durable expired-contract data before checking today's broker login.
    if(["expiredBars","expiredChain","expiredDates"].includes(body.action)){
      const historicalDates=body.action==="expiredDates"&&typeof body.to==="string"&&body.to<new Date(Date.now()-86400000).toISOString().slice(0,10);
      const validDate=(v:unknown)=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v);
      if(typeof body.symbol==="string"&&/^(NIFTY|SENSEX|(NSE:NIFTY|BSE:SENSEX)[0-9A-Z.]+(CE|PE))$/.test(body.symbol)){
        const suffix=body.action==="expiredChain"&&validDate(body.expiry)?body.expiry:validDate(body.from)&&validDate(body.to)?body.from+"_"+body.to:null;
        if(suffix&&(body.action!=="expiredDates"||historicalDates)){
          const file="expired/"+uid+"/"+body.symbol.replace(":","_")+"/"+suffix+".gz";
          const archive=await archiveRead(file);
          if(archive)return reply(archive);
        }
      }
    }
    if(body.action==="stockSessions"){
      const {ticker,from,to}=body;
      const valid=(v:unknown)=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v));
      if(typeof ticker!=="string"||ticker.length>90||!valid(from)||!valid(to)||from>to||from<"2000-01-01"||to>new Date(Date.now()+19800000).toISOString().slice(0,10))return reply({error:"Check the instrument and dates"},400);
      const {data:stock,error}=await db.from("daily_directory").select("instrument,symbol,stage,anchor,checked,desired,unverifiable").eq("ticker",ticker).eq("active",true).maybeSingle();
      if(error)throw error;
      if(!stock)return reply({error:"Stock missing from the archive directory"},404);
      const day=86400000,ready=!stock.unverifiable&&stock.stage>0&&stock.checked>=(to<stock.desired?to:stock.desired)&&(stock.stage===3||Date.parse(from)>=Date.parse(stock.anchor)-(stock.stage*3650-1)*day);
      if((ready||stock.unverifiable)&&body.ohlc!==true){
        const {data:years,error}=await db.from("daily_prices").select("days,opens,closes").eq("ticker",ticker).gte("yr",Number(from.slice(0,4))-1).lte("yr",Number(to.slice(0,4))).order("yr");
        if(error)throw error;
        const bars=[];let prev=null;
        for(const y of years||[])for(const [i,d] of y.days.entries()){
          if(d<from)prev=y.closes[i]/100;else if(d<=to)bars.push([d,y.opens[i]/100,y.closes[i]/100]);
        }
        if(bars.length)return reply({bars,prev,source:stock.unverifiable?"NSE daily reports · available sessions":"Supabase daily history"});
      }
      const values=new Map<string,number[]>();
      for(let start=Math.max(Date.parse("2000-01-01"),Date.parse(from)-14*day);start<=Date.parse(to);start+=3650*day){
        const lo=new Date(start).toISOString().slice(0,10),hi=new Date(Math.min(start+3649*day,Date.parse(to))).toISOString().slice(0,10);
        const res=await fetch("https://api.upstox.com/v3/historical-candle/"+encodeURIComponent(stock.instrument)+"/days/1/"+hi+"/"+lo,{signal:AbortSignal.timeout(12000)});
        const json=await res.json();
        if(!res.ok||!Array.isArray(json.data?.candles))return reply({error:"Daily history provider unavailable"},502);
        for(const [stamp,o,h,l,c] of json.data.candles){const d=stamp.slice(0,10);if(d>=lo&&d<=hi&&o>0&&c>0)values.set(d,body.ohlc===true?[o,c,h,l]:[o,c])}
      }
      const bars=[];let prev=null;
      for(const d of [...values.keys()].sort()){const prices=values.get(d)!;if(d<from)prev=prices[1];else bars.push([d,...prices])}
      return reply({bars,prev,source:"Upstox daily history"});
    }
    const {data:row,error}=await table.select("*").eq("user_id",uid).maybeSingle();
    if(error)throw error;
    if(body.action==="archiveRank"){
      const {from,to,cap,query,cut,limit}=body;
      if(![from,to].every(d=>typeof d==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(d))||from>to||![1,2,3,5].includes(cut)||!Number.isInteger(limit)||limit<1||typeof query!=="string"||query.length>100||!["All stocks","Indices","Small Cap","Large Cap","Mid Cap"].includes(cap))return reply({error:"Check scan filters"},400);
      const scan=await db.rpc("momentum_archive",{p_from:from,p_to:to,p_cap:cap,p_query:query,p_cut:cut,p_limit:limit});
      if(scan.error)throw scan.error;
      return reply(scan.data);
    }
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
    if(body.action==="dailyScan"||body.action==="cachedScan"){
      if(!cfg.token)return reply({error:"Connect FYERS before scanning."},409);
      const {tickers,from,to}=body;
      const valid=(d:string)=>typeof d==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
      if(!Array.isArray(tickers)||!tickers.length||tickers.length>(body.action==="cachedScan"?200:20)||!tickers.every(t=>typeof t==="string"&&/^(NSE|BSE):[A-Z0-9&._ -]{1,65}$/.test(t))||!valid(from)||!valid(to)||from>to||Date.parse(to)-Date.parse(from)>349*86400000)return reply({error:"Invalid scan range or instruments."},400);
      const rows:Record<string,number[][]>={},unavailable:string[]=[];
      const {data:cached,error:cacheError}=await db.rpc("read_fyers_scan",{p_owner:uid,p_symbols:tickers,p_from:from,p_to:to});
      if(cacheError)throw cacheError;
      const found=new Set<string>();
      for(const item of cached){
        found.add(item.ticker);
        if(item.bars===null)unavailable.push(item.ticker);else rows[item.ticker]=item.bars;
      }
      const missing=tickers.filter((t:string)=>!found.has(t));
      if(body.action==="cachedScan"||!missing.length)return reply({rows,unavailable,missing});
      const since=new Date(Date.parse(from)-12*86400000).toISOString().slice(0,10);
      const ist=new Date(Date.now()+19800000),today=ist.toISOString().slice(0,10);
      for(let i=0;i<missing.length;i+=3){
        await Promise.all(missing.slice(i,i+3).map(async ticker=>{
          const params=new URLSearchParams({symbol:ticker,resolution:"D",date_format:"1",range_from:since,range_to:to,cont_flag:"1"});
          const res=await fetch("https://api-t1.fyers.in/data/history?"+params,{headers:{Authorization:cfg.id+":"+cfg.token},signal:AbortSignal.timeout(16000)});
          const data=await res.json();
          if(res.status===429||data.code===429)throw Error("RATE");
          if(res.status===401||[-8,-15,-16,-17].includes(data.code))throw Error("AUTH");
          if(data.s==="no_data"){rows[ticker]=[];return}
          if(data.code===-300){unavailable.push(ticker);return}
          if(!res.ok||data.s!=="ok"||!Array.isArray(data.candles))throw Error("HISTORY");
          const bars:number[][]=[];let prev=0;
          for(const [t,o,,,c] of data.candles.sort((a:number[],b:number[])=>a[0]-b[0])){
            if(!Number.isFinite(t)||!(o>0&&c>0))continue;
            const day=new Date(t*1000+19800000).toISOString().slice(0,10);
            if(day>=from&&day<=to&&day<=today&&(day!==today||ist.getUTCHours()*60+ist.getUTCMinutes()>=930))bars.push([t,o,c,prev]);
            prev=c;
          }
          rows[ticker]=bars;
        }));
        if(i+3<missing.length)await new Promise(resolve=>setTimeout(resolve,900));
      }
      const records=missing.map((ticker:string)=>({user_id:uid,ticker,first_day:from,last_day:to,bars:rows[ticker]??null,refreshed_at:new Date().toISOString()}));
      const {error:saveError}=await db.from("fyers_daily_cache").upsert(records);
      if(saveError)throw saveError;
      return reply({rows,unavailable});
    }
    if(["expiredDates","expiredChain","expiredBars"].includes(body.action)){
      if(!cfg.token)return reply({error:"Connect FYERS to load expired contracts."},409);
      const {action,symbol,from,to,expiry}=body,dates=action==="expiredDates",chain=action==="expiredChain";
      const index=symbol==="NIFTY"?"NSE:NIFTY50-INDEX":symbol==="SENSEX"?"BSE:SENSEX-INDEX":"";
      const valid=(d:unknown)=>typeof d==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d));
      if((dates||chain)?!index:typeof symbol!=="string"||!/^(NSE:NIFTY|BSE:SENSEX)[0-9A-Z.]+(PE|CE)$/.test(symbol))return reply({error:"Invalid option symbol"},400);
      if(chain?!valid(expiry):(!valid(from)||!valid(to)||from>to||Date.parse(to)-Date.parse(from)>(dates?365:99)*86400000))return reply({error:"Invalid historical date range"},400);
      const savedPath=(chain||!dates||to<new Date(Date.now()-86400000).toISOString().slice(0,10))?"expired/"+uid+"/"+symbol.replace(":","_")+"/"+(chain?expiry:from+"_"+to)+".gz":null;
      const args=new URLSearchParams({symbol:index||symbol});
      if(chain)args.set("expiry_date",expiry);
      else{args.set("range_from",from);args.set("range_to",to);args.set("date_format","1");if(!dates){args.set("resolution","1");args.set("include_oi","0");args.set("include_greeks","0")}}
      const path=dates?"expiry-dates":chain?"underlying-symbols":"historical-data";
      const res=await fetch("https://api-t1.fyers.in/data/history/fno/expired/"+path+"?"+args,{headers:{Authorization:cfg.id+":"+cfg.token},signal:AbortSignal.timeout(16000)});
      const data=await res.json();
      if(res.status===401||[-8,-15,-16,-17,-99].includes(data.code))throw Error("AUTH");
      if(res.status===429||data.code===429)throw Error("RATE");
      if(!dates&&!chain&&data.s==="no_data")return reply({candles:[]});
      if(!res.ok||data.s!=="ok"){
        const message=[data.message,...Object.values(data.data||{})].filter(x=>typeof x==="string").join(" ").toLowerCase();
        if(/requests\/day|daily limit/.test(message))return reply({error:"FYERS daily expired-history allowance reached. Completed downloads are cached on this device. Retry after the provider resets the quota."},429);
        if(/rate limit|too many requests|per minute/.test(message))throw Error("RATE");
        if(data.s==="error"&&/no data|data not available for.*range/.test(message)&&action==="expiredBars")return reply({candles:[]});
        return reply({error:"FYERS "+action+" unavailable for "+symbol+" (HTTP "+res.status+", provider code "+Number(data.code||0)+"). "+[data.message,...["range_from","range_to","symbol","resolution","include_oi","include_greeks","date_format"].map(k=>data.data?.[k])].filter(x=>typeof x==="string").join(" · ").slice(0,350).replace(/[A-Za-z0-9_.=-]{30,}/g,"[redacted]")},409);
      }
      const output=dates?{dates:data.data.expiry_dates}:chain?{symbols:data.data.contracts.options}:{candles:data.candles};
      if(savedPath&&(output.candles?.length||output.symbols?.length||output.dates?.options?.length))await archiveWrite(savedPath,output);
      return reply(output);
    }
    if((body.action==="stockQuotes"||body.action==="depth")&&cfg.token){
      const symbols=body.symbols;
      const indices:Record<string,string>={"NIFTY 50":"NSE:NIFTY50-INDEX",SENSEX:"BSE:SENSEX-INDEX",BANKNIFTY:"NSE:NIFTYBANK-INDEX","NIFTY MIDCAP 100":"NSE:NIFTYMIDCAP100-INDEX"};
      const aliases:Record<string,string>={GMRINFRA:"GMRAIRPORT",BIRLASOFT:"BSOFT"};
      const depth=body.action==="depth";
      if(!Array.isArray(symbols)||!symbols.length||symbols.length>(depth?1:50)||!symbols.every(s=>typeof s==="string"&&(/^[A-Z0-9&-]{1,32}$/.test(s)||Object.hasOwn(indices,s)||(!depth&&/^(BSE|NSE):[A-Z0-9&._ -]{1,65}$/.test(s)))))return reply({error:"Choose a valid instrument"},400);
      const instruments=new Map<string,string>();
      for(const s of symbols){
        const ticker=s.includes(":")?s:indices[s]||"NSE:"+(aliases[s]||s)+(s==="HFCL"?"-BE":"-EQ");
        instruments.set(ticker,s);
      }
      const tickers=[...instruments.keys()].join(",");
      const params=depth?new URLSearchParams({symbol:tickers,ohlcv_flag:"1"}):new URLSearchParams({symbols:tickers});
      const res=await fetch("https://api-t1.fyers.in/data/"+(depth?"depth":"quotes")+"?"+params,{headers:{Authorization:cfg.id+":"+cfg.token},signal:AbortSignal.timeout(9000)});
      const result=await res.json();
      if(res.status===401||[-8,-15,-16,-17,-99].includes(result.code))throw Error("AUTH");
      if(res.status===429||result.code===429)throw Error("RATE");
      if(!res.ok||result.s!=="ok")return reply({error:"FYERS could not supply this feed. Check the symbol and your FYERS session."},409);
      if(depth){
        const d=result.d?.[tickers];
        if(!d||d.s==="error"||(!Array.isArray(d.bids)&&!Array.isArray(d.ask)&&!Array.isArray(d.asks)))return reply({error:"No order book available for this stock."},404);
        const levels=(items:any[])=>Array.isArray(items)?items.filter(x=>Number.isFinite(x.price)&&x.price>0&&Number.isFinite(x.volume)&&x.volume>0).map(x=>({price:x.price,quantity:x.volume,orders:x.ord??null})):[];
        return reply({symbol:symbols[0],price:d.ltp,time:Number(d.ltt||0)*1000,bids:levels(d.bids),asks:levels(d.ask??d.asks),received:Date.now()});
      }
      const quotes=(result.d||[]).filter((x:any)=>instruments.has(x.n)&&x.s==="ok"&&x.v?.lp>0).map((x:any)=>({symbol:instruments.get(x.n),price:x.v.lp,open:x.v.open_price,prev:x.v.prev_close_price,time:Number(x.v.tt||0)*1000,source:"FYERS"}));
      return reply({quotes});
    }
    if(body.action==="history"&&cfg.token){
      const {symbol,from,to}=body;
      const indices:Record<string,string>={"NIFTY 50":"NSE:NIFTY50-INDEX",SENSEX:"BSE:SENSEX-INDEX",BANKNIFTY:"NSE:NIFTYBANK-INDEX","NIFTY MIDCAP 100":"NSE:NIFTYMIDCAP100-INDEX"};
      const aliases:Record<string,string>={GMRINFRA:"GMRAIRPORT",BIRLASOFT:"BSOFT"};
      const validDate=(s:unknown)=>typeof s==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
      if(typeof symbol!=="string"||!(Object.hasOwn(indices,symbol)||/^[A-Z0-9&-]{1,32}$/.test(symbol))||!validDate(from)||!validDate(to)||to<from||Date.parse(to)-Date.parse(from)>27*86400000)return reply({error:"Check the stock and date range"},400);
      const ticker=indices[symbol]||"NSE:"+(aliases[symbol]||symbol)+"-EQ";
      const params=new URLSearchParams({symbol:ticker,resolution:"1",date_format:"1",range_from:from,range_to:to,cont_flag:"1"});
      const response=await fetch("https://api-t1.fyers.in/data/history?"+params,{headers:{Authorization:cfg.id+":"+cfg.token},signal:AbortSignal.timeout(14000)});
      const data=await response.json();
      if(data.s==="no_data")return reply({source:"FYERS",symbol,rows:[]});
      if(!response.ok||data.s!=="ok"||!Array.isArray(data.candles))return reply({error:"FYERS history unavailable for "+symbol+". Check the symbol or reconnect."},409);
      const unique=new Map<number,{d:string,m:number,o:number,h:number,l:number,c:number}>();
      for(const [epoch,o,h,l,c] of data.candles){
        if(!Number.isSafeInteger(epoch)||epoch<=0||epoch>Math.floor(Date.now()/1000)||![o,h,l,c].every(n=>Number.isFinite(n)&&n>0)||l>Math.min(o,c)||h<Math.max(o,c))continue;
        const ist=new Date(epoch*1000+19800000),d=ist.toISOString().slice(0,10),m=ist.getUTCHours()*60+ist.getUTCMinutes();
        if(d>=from&&d<=to&&m>=555&&m<930)unique.set(epoch,{d,m,o,h,l,c});
      }
      return reply({source:"FYERS",symbol,rows:[...unique.values()].sort((a,b)=>a.d.localeCompare(b.d)||a.m-b.m)});
    }
    if(body.action!=="quotes"||!cfg.token)return reply({error:"Connect to FYERS first"},409);
    const res=await fetch("https://api-t1.fyers.in/data/quotes?symbols=NSE%3ANIFTY50-INDEX%2CBSE%3ASENSEX-INDEX",{headers:{Authorization:cfg.id+":"+cfg.token},signal:AbortSignal.timeout(8000)});
    const q=await res.json();
    if(!res.ok||q.s!=="ok")return reply({error:"FYERS quotes unavailable. Reconnect if your session expired."},409);
    const quotes=(q.d||[]).filter((x:any)=>x.s==="ok"&&x.v?.lp>0).map((x:any)=>({name:x.n==="NSE:NIFTY50-INDEX"?"NIFTY":"SENSEX",price:x.v.lp,prev:x.v.prev_close_price,time:Number(x.v.tt||0)*1000,source:"FYERS",unit:"pts"}));
    return reply({quotes});
  }catch(err){
    const reason=err instanceof Error?err.message:"";
    if(reason==="RATE")return reply({error:"FYERS rate limit. Retry after a minute."},429);
    if(reason==="AUTH")return reply({error:"FYERS session expired. Reconnect FYERS and retry."},401);
    return reply({error:"FYERS connection request failed. Please retry."},502);
  }
});
