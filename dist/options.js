let optionDirectory;
function optionChain(){
 return optionDirectory??=fetch('market/contracts.json').then(r=>{
  if(!r.ok)throw Error('Could not load option expiries.');
  return r.json();
 }).catch(err=>{optionDirectory=null;throw err});
}
function pickOption(chain,p,day,spot){
 const dates=[...new Set(chain.map(c=>c[2]))].sort();
 let expiry=p.optionExpiry;
 if(expiry==='This week'||expiry==='Next week'){
  const monday=Date.parse(day)-((new Date(day).getUTCDay()+6)%7)*86400000;
  const start=monday+(expiry==='Next week'?7:0)*86400000;
  expiry=dates.find(d=>d>=day&&Date.parse(d)>=start&&Date.parse(d)<start+7*86400000);
 }else if(expiry==='Monthly'){
  expiry=dates.find(d=>d>=day&&d.slice(0,7)===day.slice(0,7)&&chain.some(c=>c[2]===d&&c[6]===true));
 }
 const strikes=chain.filter(c=>c[2]===expiry&&c[4]===p.cp&&day<=expiry).sort((a,b)=>a[3]-b[3]);
 if(p.strikeMode==='Strike price')return strikes.find(c=>c[3]===p.strikePrice);
 if(!strikes.length||!(spot>0)||spot<strikes[0][3]||spot>strikes.at(-1)[3])return;
 let atm=0;for(let i=1;i<strikes.length;i++)if(Math.abs(strikes[i][3]-spot)<Math.abs(strikes[atm][3]-spot))atm=i;
 const offset=p.money==='ATM'?0:p.steps*(p.money==='OTM'?1:-1)*(p.cp==='CE'?1:-1);
 return strikes[atm+offset];
}
async function simulateOptions(p,common,load){
 const index=p.s==='NIFTY'?'NIFTY 50':p.s;
 const chain=(await optionChain()).filter(c=>c[0].startsWith(p.s+' '));
 const spot=await load(index,null,common.from,common.to);
 const days=[...new Set(spot.map(r=>r.d))].sort(),opens=new Map(spot.filter(r=>r.m===p.entry).map(r=>[r.d,r.o]));
 const candles=new Map(),trades=[],skipped=[];let busy='';
 for(const [i,day] of days.entries()){
  if(day<=busy)continue;
  const contract=pickOption(chain,p,day,opens.get(day));
  if(!contract){skipped.push(day);continue}
  const [name,key,expiry]=contract;
  const through=common.holding==='Positional'?days[i+1]:day;
  if(!through||through>expiry){skipped.push(day);continue}
  const rows=await load(p.s,key,day,through);
  if(!rows.some(r=>r.d===day)){skipped.push(day);continue}
  if(!candles.has(name))candles.set(name,new Map());
  for(const bar of dailyOHLC(rows))candles.get(name).set(bar.d,bar);
  const qty=p.lots*contract[5];
  const run=simulate(rows,{...p,...common,from:day,to:through,qty,expiry});
  const fill=run.trades.find(t=>t.entryDay===day);
  if(fill){trades.push({...fill,s:name,qty});busy=fill.d}
  else if(run.skipped.includes(day))skipped.push(day);
 }
 return {p:{...p,...common,source:'Index options · observed contract minute candles'},trades,skipped,prices:[...candles].map(([name,days])=>({name,bars:[...days.values()]}))};
}
