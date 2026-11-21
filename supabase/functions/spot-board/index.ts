const names=["NIFTY","SENSEX","GOLD","SILVER"];
async function json(url:string){
 const r=await fetch(url,{signal:AbortSignal.timeout(7000),headers:{Accept:"application/json"}});
 if(!r.ok)throw Error("Feed unavailable");return r.json();
}
async function quote(name:string){
 const metal=name==="GOLD"||name==="SILVER";
 let price,time,prev=null;
 if(metal){
  const q=await json("https://api.gold-api.com/price/"+(name==="GOLD"?"XAU":"XAG"));
  price=q.price;time=Date.parse(q.updatedAt);
 }else{
  const symbol=name==="NIFTY"?"%5ENSEI":"%5EBSESN";
  const q=(await json("https://query1.finance.yahoo.com/v8/finance/chart/"+symbol+"?interval=1d&range=5d")).chart.result[0];
  price=q.meta.regularMarketPrice;time=q.meta.regularMarketTime*1000;
  const day=(t:number)=>new Date(t+19800000).toISOString().slice(0,10);
  const closes=q.indicators.quote[0].close;
  for(let i=q.timestamp.length-1;i>=0;i--){if(day(q.timestamp[i]*1000)<day(time)&&closes[i]>0){prev=closes[i];break}}
 }
 if(!Number.isFinite(price)||price<=0||!Number.isFinite(time))throw Error("Invalid quote");
 return {name,price,time,prev,source:metal?"Gold API":"Yahoo Finance",unit:metal?"USD/oz":"pts"};
}
async function snapshot(){return Promise.all(names.map(async name=>{try{return await quote(name)}catch{return {name,price:null}}}))}
let cached:Awaited<ReturnType<typeof snapshot>>=[],expires=0,pending:ReturnType<typeof snapshot>|null=null;
Deno.serve(async req=>{
 const headers={"Access-Control-Allow-Origin":"*","Content-Type":"application/json","Cache-Control":"public,max-age=15"};
 if(req.method!=="GET")return new Response(null,{status:405,headers});
 if(Date.now()>expires){pending??=snapshot().then(rows=>{cached=rows;expires=Date.now()+15000;return rows}).finally(()=>pending=null);await pending}
 return new Response(JSON.stringify(cached),{headers});
});
