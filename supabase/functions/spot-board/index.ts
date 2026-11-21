const names=["NIFTY","SENSEX","GOLD","SILVER"];
async function json(url:string){
 const r=await fetch(url,{signal:AbortSignal.timeout(7000),headers:{Accept:"application/json"}});
 if(!r.ok)throw Error("Feed unavailable");return r.json();
}
async function bullion(){
 const response=await fetch("https://ibjarates.com/",{signal:AbortSignal.timeout(9500)});
 if(!response.ok)throw Error("IBJA unavailable");
 const html=await response.text();
 const rows=[];
 for(const [row] of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)){
  const date=row.match(/data-label="(AM|PM)"[^>]*>\s*<strong>(\d{2})\/(\d{2})\/(\d{4})<\/strong>/i);
  if(!date)continue;
  const rate=(label:string)=>Number(row.match(new RegExp('data-label="'+label+'"[^>]*>\\s*([0-9,]+(?:\\.[0-9]+)?)'))?.[1].replaceAll(',',''));
  rows.push({date:date[4]+'-'+date[3]+'-'+date[2],session:date[1],GOLD:rate('Gold 999'),SILVER:rate('Silver 999')});
 }
 rows.sort((a,b)=>(b.date+b.session).localeCompare(a.date+a.session));
 return (["GOLD","SILVER"] as const).map(name=>{
  const valid=rows.filter(r=>r[name]>0),latest=valid[0];
  if(!latest)return {name,price:null};
  return {name,price:latest[name],date:latest.date,session:latest.session,unit:name==="GOLD"?"₹/10 g":"₹/kg",prev:valid.find(r=>r.date<latest.date&&r.session==="PM")?.[name]??null,source:"IBJA 999"};
 });
}
async function quote(name:string){
 let price,time,prev=null;
 {
  const symbol=name==="NIFTY"?"%5ENSEI":"%5EBSESN";
  const path="/v8/finance/chart/"+symbol+"?interval=1d&range=5d";
  const payload=await json("https://query1.finance.yahoo.com"+path).catch(()=>json("https://query2.finance.yahoo.com"+path));
  const q=payload.chart.result[0];
  price=q.meta.regularMarketPrice;time=q.meta.regularMarketTime*1000;
  const day=(t:number)=>new Date(t+19800000).toISOString().slice(0,10);
  const closes=q.indicators.quote[0].close;
  for(let i=q.timestamp.length-1;i>=0;i--){if(day(q.timestamp[i]*1000)<day(time)&&closes[i]>0){prev=closes[i];break}}
 }
 if(!Number.isFinite(price)||price<=0||!Number.isFinite(time))throw Error("Invalid quote");
 return {name,price,time,prev,source:"Yahoo Finance",unit:"pts"};
}
// Optional entitled provider adapter: JSON array of {name,price,time,unit,source,prev}.
async function realtime(){
 const endpoint=Deno.env.get("INDIA_SPOT_FEED_URL"),token=Deno.env.get("INDIA_SPOT_FEED_TOKEN");
 if(!endpoint||!endpoint.startsWith("https://"))return [];
 const r=await fetch(endpoint,{redirect:"error",headers:token?{Authorization:"Bearer "+token}:{},signal:AbortSignal.timeout(4500)});
 if(!r.ok)return [];
 const rows=await r.json();return Array.isArray(rows)?rows.filter(q=>names.includes(q.name)&&q.unit===(q.name==="GOLD"?"₹/10 g":q.name==="SILVER"?"₹/kg":"pts")&&Number.isFinite(q.price)&&q.price>0&&typeof q.source==="string"&&Number.isFinite(q.time)&&q.time<=Date.now()&&Date.now()-q.time<90000).map(q=>({name:q.name,unit:q.unit,price:q.price,time:q.time,source:q.source,prev:q.prev>0?q.prev:null,live:true})):[];
}
const lastIndex:Record<string,any>={
 NIFTY:{name:"NIFTY",price:25800.60,time:1795168875000,prev:25514.30078125,source:"Yahoo Finance",unit:"pts"},
 SENSEX:{name:"SENSEX",price:83919.71,time:1795168949000,prev:83021.75,source:"Yahoo Finance",unit:"pts"}
};
async function snapshot(){
 const [indices,metals,live]=await Promise.all([
 Promise.all(names.slice(0,2).map(async name=>{try{lastIndex[name]=await quote(name)}catch{}return lastIndex[name]})),
 bullion().catch(()=>names.slice(2).map(name=>({name,price:null}))),realtime().catch(()=>[])]);
 return [...indices,...metals].map(q=>live.find(v=>v.name===q.name)??q);
}
let cached:Awaited<ReturnType<typeof snapshot>>=[],expires=0,pending:ReturnType<typeof snapshot>|null=null;
Deno.serve(async req=>{
 const headers={"Access-Control-Allow-Origin":"*","Content-Type":"application/json","Cache-Control":"public,max-age=15"};
 if(req.method!=="GET")return new Response(null,{status:405,headers});
 if(Date.now()>expires){pending??=snapshot().then(rows=>{cached=rows;expires=Date.now()+15000;return rows}).finally(()=>pending=null);await pending}
 return new Response(JSON.stringify(cached),{headers});
});
