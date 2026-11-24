async function boundedEach(items,count,visit){
 let i=0;
 await Promise.all(Array.from({length:Math.min(items.length,count)},async()=>{
  while(i<items.length){const item=items[i++];await visit(item)}
 }));
}
function membersOn(updates,day){
 const roster=new Map();
 for(const [stamp,changes,removed] of updates){
  if(stamp>day)break;
  for(const key of removed)roster.delete(key);
  for(const [key,value] of Object.entries(changes))roster.set(key,value);
 }
 return roster;
}
function openingKeys(updates,month){
 const days=[month+'-00',...updates.map(r=>r[0]).filter(d=>d.startsWith(month))];
 return [...new Set(days.flatMap(d=>[...membersOn(updates,d).keys()]))].sort();
}
function openingSignal(d,roster,marks){
 const rows=[];let up=0,down=0,flat=0;
 for(const [key,[name,sector]] of roster){
  const bar=marks.get(key)?.get(d);if(!bar)continue;
  const move=(bar[2]-bar[1])/bar[1];
  if(move>0)up++;else if(move<0)down++;else flat++;
  rows.push({key,name,sector,move});
 }
 const signal={d,size:roster.size,seen:rows.length,up,down,flat,side:'',picks:[],names:[]};
 if(!roster.size||rows.length<.95*roster.size)return {...signal,incomplete:true,reason:'Opening candles below 95% coverage'};
 if(up<=rows.length/2&&down<=rows.length/2)return {...signal,reason:'No majority'};
 signal.side=up>down?'Buy':'Sell';
 const sign=signal.side==='Buy'?1:-1,used=new Set();
 for(const row of rows.sort((a,b)=>sign*(b.move-a.move)||a.key.localeCompare(b.key))){
  if(sign*row.move<=0||!row.sector||used.has(row.sector))continue;
  signal.picks.push(row);used.add(row.sector);if(used.size===5)break;
 }
 signal.names=signal.picks.map(p=>p.name);
 if(used.size<5){signal.reason='Fewer than five qualifying sectors';signal.picks=[]}
 return signal;
}
async function runSectorMomentum(cfg,{progress=()=>{},calendar=exchangeDays,universe=breadthUniverse,openings=details=>cachedRead('opening15/'+details.month+'/'+details.keys.join(','),details.month===completedDate().slice(0,7)?60000:86400000,()=>fyersRequest('openingBatch',details)),minutes=archivedMinutes}={}){
 const {from,to,entry,exit,stop,rr,budget,fee,slip}=cfg;
 if(!from||from<'2022-01-01'||!to||from>to||!(entry>=570&&entry<exit&&exit<=929)||!(budget>0&&stop>0&&stop<100&&[2,3].includes(rr))||!(fee>=0&&slip>=0&&slip<10000))throw Error('Check dates, times, allocation and risk settings.');
 const [days,{updates}]=await Promise.all([calendar(from,to),universe()]);
 if(!days.length)throw Error('No completed exchange sessions in the selected dates.');
 const months=[...new Set(days.map(d=>d.slice(0,7)))],signals=[],trades=[];
 for(const [idx,month] of months.entries()){
  progress('Opening breadth · '+month+' · month '+(idx+1)+' of '+months.length);
  const keys=openingKeys(updates,month),chunks=[],marks=new Map(),failures=new Set();
  for(let i=0;i<keys.length;i+=16)chunks.push(keys.slice(i,i+16));
  await boundedEach(chunks,3,async keys=>{
   let data;
   for(let attempt=0;attempt<2;attempt++){
    try{data=await openings({keys,month});break}catch(e){if(attempt)keys.forEach(k=>failures.add(k))}
   }
   for(const [key,bars] of Object.entries(data||{}))marks.set(key,new Map(bars.map(b=>[b[0],b])));
  });
  const group=days.filter(d=>d.startsWith(month)).map(d=>{
   const roster=membersOn(updates,d),s=openingSignal(d,roster,marks);
   if([...failures].some(k=>roster.has(k))){s.incomplete=true;s.reason='Opening data request failed';s.picks=[]}
   return s;
  });
  const required=new Map(),fillsByDay=new Map();
  for(const s of group)for(const pick of s.picks){
   if(!required.has(pick.key))required.set(pick.key,[]);required.get(pick.key).push([s,pick]);
  }
  progress('Checking five-stock fills · '+month+' · '+required.size+' instruments');
  await boundedEach([...required],4,async ([key,list])=>{
   let rows;
   try{rows=await minutes('NSE_EQ|'+key,list[0][0].d,list.at(-1)[0].d)}catch{rows=[]}
   const byDay=new Map();
   for(const row of rows){if(!byDay.has(row.d))byDay.set(row.d,[]);byDay.get(row.d).push(row)}
   for(const [signal,pick] of list){
    const day=byDay.get(signal.d)||[],open=day.find(c=>c.m===entry)?.o;
    if(!(open>0)){signal.incomplete=true;signal.reason='Entry candle missing';continue}
    const qty=Math.floor(budget/(open*(1+(signal.side==='Buy'?1:-1)*slip/10000)));
    if(!qty){if(!signal.incomplete)signal.reason='Allocation below one share';continue}
    const p={from:signal.d,to:signal.d,entry,exit,side:signal.side,qty,stop,target:stop*rr,stopUnit:'%',targetUnit:'%',slip,fees:[0,0,fee/100,0,0,0],holding:'Intraday',rule:'Market price'};
    const fill=simulate(day,p).trades[0];
    if(!fill){signal.incomplete=true;signal.reason='Incomplete minute window';continue}
    const t={...fill,s:pick.name,isin:key,sector:pick.sector,side:signal.side,qty,leg:signal.picks.indexOf(pick)+1,stop,stopUnit:'%'};
    if(!fillsByDay.has(signal.d))fillsByDay.set(signal.d,[]);fillsByDay.get(signal.d).push(t);
   }
  });
  for(const s of group){
   if(!s.incomplete&&!s.reason&&fillsByDay.get(s.d)?.length===5)trades.push(...fillsByDay.get(s.d));
   delete s.picks;signals.push(s);
  }
 }
 trades.sort((a,b)=>(a.d+a.exit).localeCompare(b.d+b.exit)||a.leg-b.leg);
 let net=0,peak=0,dd=0;
 for(let i=0;i<trades.length;){
  let j=i;while(j<trades.length&&trades[j].d+trades[j].exit===trades[i].d+trades[i].exit)net+=trades[j++].net;
  peak=Math.max(peak,net);dd=Math.min(dd,net-peak);
  for(;i<j;i++){trades[i].cum=net;trades[i].dd=net-peak}
 }
 return {sectorConfig:cfg,p:{id:'sector-momentum',s:'NIFTY 500 sector momentum',source:'Upstox opening and minute candles · historical constituent disclosures',from,to,stop,stopUnit:'%',slip},signals,sessionDates:days,trades,net,dd,win:100*trades.filter(t=>t.net>0).length/(trades.length||1),skipped:signals.filter(s=>s.incomplete).map(s=>s.d)};
}
function sectorMomentumPage(savedRun){
 const cfg=savedRun?.sectorConfig||{},to=cfg.to||completedDate();
 $('app').innerHTML=heading('Historical Backtest','NIFTY 500 sector momentum','At 09:30 IST, buy when more than half of observed stocks are up from the open. Sell when more than half are down. Take the five strongest moves on that side, one per sector.','<a href="#historical">Strategy library</a>')+'<form id="sectorForm" class="panel"><div class="fields">'+select('Dates','sectorPeriod',['7D','15D','30D','1Y','3Y','5Y','Custom'])+input('From','secFrom',cfg.from||presetStart(to,'7D'),'date')+input('Through','secTo',to,'date')+input('Entry · IST','secEntry',timeOf(cfg.entry??570),'time','min="09:30" max="15:28"')+input('Exit · IST','secExit',timeOf(cfg.exit??915),'time','max="15:29"')+'</div><div class="fields">'+input('Budget per stock ₹','secBudget',cfg.budget??20000,'number','min="1" step="any"')+input('Stop loss %','secStop',cfg.stop??1,'number','min=".01" max="99" step=".01"')+select('Risk : reward','secReward',['1:2','1:3'])+input('Estimated charges · bps per fill','secFee',cfg.fee??5,'number','min="0" step=".1"')+input('Slippage · bps per fill','secSlip',cfg.slip??5,'number','min="0" max="999" step=".1"')+'</div><p class="hint">Prices use the completed 09:15–09:30 opening candle, followed by one-minute execution. At least 95% of the historical basket must have opening prices. No majority or fewer than five sectors means no trade. Missing execution data marks the entire session incomplete. Historical membership uses published index-fund holdings until the official daily snapshots begin. Fees are editable estimates.</p><button class="primary">Run backtest</button><p role="status" id="sectorMsg"></p></form><div id="results"></div>';
 const form=$('sectorForm'),period=$('sectorPeriod');
 if(cfg.rr)$('secReward').value='1:'+cfg.rr;
 period.value=savedRun?'Custom':'7D';
 period.onchange=()=>{if(period.value!=='Custom')$('secFrom').value=presetStart($('secTo').value,period.value)};
 for(const id of ['secFrom','secTo'])$(id).oninput=()=>period.value='Custom';
 form.onsubmit=async e=>{
  e.preventDefault();const btn=form.querySelector('button');if(btn.disabled)return;btn.disabled=true;$('results').replaceChildren();
  const msg=$('sectorMsg');msg.textContent='Checking trading calendar…';
  try{const run=await runSectorMomentum({from:$('secFrom').value,to:$('secTo').value,entry:toMin($('secEntry').value),exit:toMin($('secExit').value),budget:+$('secBudget').value,stop:+$('secStop').value,rr:+$('secReward').value.slice(-1),fee:+$('secFee').value,slip:+$('secSlip').value},{progress:s=>{if(msg.isConnected)msg.textContent=s}});
   if(!form.isConnected)return;
   lastRun={...run,savedId:savedRun?.id};lastMonth='';showResults();
   msg.textContent=run.sessionDates.length+' sessions · '+run.trades.length+' fills · '+run.skipped.length+' incomplete sessions';
  }catch(err){msg.textContent=err.message}finally{btn.disabled=false}
 };
}
