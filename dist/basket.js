let legSequence=0;
function builderPage(){
 const rangeEnd=new Date(Date.now()+19800000).toISOString().slice(0,10);
 $('app').innerHTML=heading('Strategy studio','Backtester','Build a strategy from minute candles. Times are in IST.',importButton+' <button onclick="strategyLibrary()">Saved strategies</button>')+'<form id="strategy" class="panel"><div class="row">'+select('Strategy','strategyMode',['Options','Stock','Basket'])+'<button type="button" id="addLeg">＋ Add leg</button></div><div class="fields">'+select('Dates','bp',presetNames)+input('From','bf',presetStart(rangeEnd,'7D'),'date')+input('Through','bt',rangeEnd,'date')+'</div><div id="legs"></div><h3>Algo targets · all legs</h3><div class="fields">'+riskField('Total profit target','algoTarget','algoTU',0)+riskField('Total stop loss','algoStop','algoSU',0)+'</div><p class="hint">Checked at each minute open using combined gross P&amp;L. % uses entry value. Points sum the signed moves per leg. Zero is off.</p><h3>Daily transactions</h3><div class="fields">'+input('Transactions per day','maxEntries',1,'number','readonly')+'</div><h3>Algo expiry and exit</h3><div class="fields">'+ select('Trade type','holding',['Intraday','Delivery'])+select('Delivery exit','deliveryBasis',['Sessions after entry','Sessions before expiry'])+input('Trading sessions','deliveryN',1,'number','min="0" step="1"')+input('Delivery exit · IST','deliveryTime','15:15','time')+input('Algo entry from · IST','algoStart','09:15','time')+input('Algo exit by · IST','algoEnd','15:29','time')+input('Slippage · bps per fill','slip',0,'number','min="0" step="any"')+'</div><div class="row"><button class="primary">Run backtest</button></div><p role="status" id="runMessage"></p><details><summary>Execution rules</summary>Price above and below use the first qualifying minute open after the entry window starts. Limit orders fill at the limit or a better open. For a limit touched inside a candle, only an adverse stop can exit in that candle. Each strategy opens once per eligible day when every leg qualifies. All legs together count as one transaction. Automatic re-entry is off. Stops take priority inside an ambiguous candle. Gaps fill at the open. Incomplete candle windows skip the session. Delivery uses the selected session count and the earlier applicable exit time.</details></form><div id="results"></div>';
 const legs=$('legs'),sources=[...[...groups.flat(),'NIFTY 50','SENSEX','BANKNIFTY','NIFTY MIDCAP 100'].map(s=>({s,id:'market:'+s,title:s+' · Market minute candles'})),...testSources().filter(x=>!x.id.startsWith('demo:'))];
 fetch('market/shares.json').then(r=>r.json()).then(rows=>{const bySymbol=new Map(sources.filter(x=>x.id.startsWith('market:')).map(x=>[x.s,x]));for(const [s,name,key] of rows){let item=bySymbol.get(s);if(!item){item={s,id:'market:'+s};sources.push(item);bySymbol.set(s,item)}Object.assign(item,{title:s+' · '+name,key})}const active=document.activeElement;if(legs.contains(active)&&active.type==='search'&&!sources.some(s=>s.title===active.value))active.dispatchEvent(new Event('input'))}).catch(()=>{});
 function add(kind){
 const n=++legSequence,el=document.createElement('section');el.className='legrow';
 const field=(label,key,value,type='number',attrs='min="0" step="any"')=>input(label,key+n,value,type,attrs);
 const choice=(label,key,items)=>select(label,key+n,items);
 el.innerHTML='<div class="row"><h3></h3><button type="button" aria-label="Remove leg">×</button></div><div class="fields">'+'<label>Search<input required type="search" id="symbol'+n+'" aria-controls="names'+n+'" aria-autocomplete="list" autocomplete="off" placeholder="Name or symbol"><span class="searchMatches" id="names'+n+'"></span></label>'+field('Entry when · IST','et','09:30','time','')+field('Exit when · IST','xt','15:15','time','')+choice('Direction','side',['Buy','Sell'])+field('Lots / quantity','lots',1,'number','min="1" step="1"')+field('Units per lot','units',1,'number','min="1" step="1"')+'</div><div class="fields legRisk">'+choice('Entry condition','rule',[])+field('Price ₹','value','','number','step="any"')+riskField('Stop loss','sl'+n,'su'+n,0.6)+riskField('Take profit','tp'+n,'tu'+n,1)+'<button type="button" class="trailEdit" aria-label="Edit trailing stop loss">✎ Trailing SL · Off</button></div><button type="button" class="legCharges">Charges &amp; taxes</button>';
 legs.append(el);let get=k=>$(k+n);
 if(kind==='Options'){
  const fields=document.createElement('div');fields.className='fields optionTerms';
  fields.innerHTML=choice('Call / Put','cp',['CE','PE'])+choice('Expiry','expiry',['This week','Next week','Monthly'])+choice('Strike selection','basis',['Spot Based','Market price','Future Based','Strike price','Strike above','Strike below','Premium near','Premium greater','Premium lesser','Delta near','Delta greater','Delta lesser'])+choice('Moneyness','money',['ATM',...Array.from({length:5},(_,i)=>(i+1)+' ITM'),...Array.from({length:5},(_,i)=>(i+1)+' OTM')])+field('Strike steps','steps',1,'number','min="1" step="1"')+field('Strike price','strike','','number','min="0.01" step="any"');
  el.querySelector('.legRisk').before(fields);
  for(const opt of get('basis').options){if(opt.value==='Market price')opt.textContent='Market price · ATM';if(['Future Based','Delta near','Delta greater','Delta lesser'].includes(opt.value)){opt.disabled=true;opt.textContent+=' · historical input required'}}
  function refresh(){
   const mode=get('basis').value,manual=mode!=='Spot Based';if(mode==='Market price')get('strike').value='';get('strike').parentElement.firstChild.textContent=mode.startsWith('Premium')?'Premium ₹':'Strike price';
   for(const [key,hide] of [['strike',!manual||mode==='Market price'],['money',manual],['steps',true]]){get(key).disabled=hide;get(key).parentElement.hidden=hide}
  }
  get('basis').onchange=refresh;refresh();
  get('units').value='';get('units').placeholder='From contract';get('units').disabled=true;

 }
 let fees=[...feeSchedule];const chargeButton=el.querySelector('.legCharges');
 chargeButton.onclick=()=>{modal(el.querySelector('h3').textContent+' · Charges & taxes','<form id="legFees"><div class="fields">'+feeLabels.map((label,i)=>input(label,'lf'+i,fees[i],'number','min="0" step="any"')).join('')+'</div><button class="primary">Apply to this leg</button></form>');$('legFees').onsubmit=e=>{e.preventDefault();fees=feeLabels.map((_,i)=>+$('lf'+i).value);chargeButton.textContent='Charges & taxes · configured';dlg.close()}};
 let trailX=0,trailY=0;const pencil=el.querySelector('.trailEdit');
 pencil.onclick=()=>{modal('Trailing stop loss','<form id="trailForm"><div class="fields">'+input('When price moves in your favour by (pts)','moveX',trailX,'number','min="0" step="any"')+input('Move stop loss by (pts)','moveY',trailY,'number','min="0" step="any"')+'</div><div class="row"><button type="button" id="clearTrail">Clear</button><button class="primary">Save</button></div></form>');function save(x,y){trailX=x;trailY=y;pencil.dataset.on=String(x>0);pencil.textContent='✎ Trailing SL · '+(x?x+' → '+y+' pts':'Off');dlg.close()}$('clearTrail').onclick=()=>save(0,0);$('trailForm').onsubmit=e=>{e.preventDefault();const x=+$('moveX').value,y=+$('moveY').value;if((x>0)!==(y>0)){const zero=x?$('moveY'):$('moveX');zero.setCustomValidity('Enter two positive values, or zero for both to turn off.');zero.reportValidity();zero.setCustomValidity('');return}save(x,y)}};
 function ruleFields(){const rule=get('rule').value,node=get('value');node.parentElement.hidden=false;node.disabled=rule==='Market price';node.placeholder=node.disabled?'At market':'Enter value';node.required=rule!=='Market price';node.parentElement.firstChild.textContent=rule==='Market price'?'Entry price':rule==='Strike price'?'Strike price ₹':rule.includes('Delta')?'Delta':rule.includes('Indicator')?'Indicator value':rule+' ₹'}
 get('rule').onchange=ruleFields;
 for(let k of ['su','tu'])segmentedIds.add(k+n);
 for(const key of (kind==='Options'?['cp','side']:['side'])){
   const control=get(key),button=document.createElement('button');button.type='button';button.className='flipChoice';control.after(button);control.hidden=true;
   function paint(){button.textContent=control.value;button.dataset.negative=String(control.selectedIndex===1);button.setAttribute('aria-label',control.value+' · switch to '+control.options[1-control.selectedIndex].text)}
   button.onclick=e=>{e.preventDefault();control.selectedIndex=1-control.selectedIndex;control.dispatchEvent(new Event('change',{bubbles:true}))};control.addEventListener('change',paint);paint();
 }
 const quoteHost=document.createElement('div');quoteHost.className='legEstimate';quoteHost.setAttribute('aria-live','polite');el.querySelector('.legRisk').before(quoteHost);
 let lastQuote=null;
 function paintEstimate(){
  if(!lastQuote)return;
  const qty=Number(get('lots').value)*Number(get('units').value);
  quoteHost.firstChild.textContent=lastQuote.label+' ₹'+fmt(lastQuote.price)+' · '+lastQuote.stamp+'  |  Estimated capital '+(qty>0?'₹'+fmt(lastQuote.price*qty)+' ('+qty+' units)':'—');
 }
 for(const key of ['lots','units'])get(key).addEventListener('input',paintEstimate);
 function showLegQuote(x){
  lastQuote=null;const marker=document.createElement('span');quoteHost.replaceChildren(marker);
  if(!x.id?.startsWith('market:')){
   const bar=x.data?.rows?.at(-1);
   if(bar?.c>0){lastQuote={price:bar.c,label:'Imported close',stamp:bar.d};paintEstimate()}
   else marker.textContent='Imported price unavailable';
   return;
  }
  marker.textContent='Fetching latest price…';
  async function readPrice(){
   const q=(await stockQuotes([x.s]).catch(()=>[]))[0];
   if(q?.price>0)return {price:q.price,label:'Latest price',stamp:'FYERS · '+(q.time?quoteTime(q.time):'Time unavailable')};
   const url=authOrigin+'/functions/v1/market-minute?mode=quote&symbol='+encodeURIComponent(x.s);
   const fallback=await fetch(url,{signal:AbortSignal.timeout(6000)}).then(r=>r.ok?r.json():null).catch(()=>null);
   if(fallback?.price>0)return {price:fallback.price,label:'Latest price',stamp:(fallback.source||'Market quote')+' · '+(fallback.asOf||(fallback.time?quoteTime(fallback.time):'Time unavailable'))};
   const to=new Date(Date.now()+19800000).toISOString().slice(0,10);
   const res=await fyersRequest('archiveRank',{from:presetStart(to,'30D'),to,cap:kind==='Index'?'Indices':'All stocks',query:x.s,cut:1,limit:20});
   const bar=res.stocks.find(item=>item.symbol===x.s)?.bars.at(-1);
   if(!bar)throw Error('No price available');
   return {price:bar[2]/100,label:'Last closing price',stamp:bar[0]};
  }
  pollWhile(marker,30000,readPrice,quote=>{
   lastQuote=quote;paintEstimate();
  },()=>{if(lastQuote){lastQuote.label='Last known price';paintEstimate()}else marker.textContent='Price unavailable · estimated capital unavailable'});
 }
 function available(){if(kind==='Options')return ['NIFTY','SENSEX'].map(s=>({s,title:s,id:'option:'+s}));return sources.filter(x=>kind==='Index'?indices.includes(x.s):!indices.includes(x.s)&&!['Index','Option contract','Future'].includes(x.data?.kind))}
 get('rule').replaceChildren(...['Market price','Price above','Price below','Limit price'].map(v=>new Option(v,v)));
 ruleFields();
 function suggest(){lastQuote=null;quoteHost.replaceChildren();const input=get('symbol'),box=get('names'),norm=s=>s.toUpperCase().replace(/[^A-Z0-9]/g,''),q=norm(input.value);box.replaceChildren();if(!q)return;
 const options=available();
 const matches=options.filter(x=>norm(x.title).includes(q)||norm(x.s).includes(q)).sort((a,b)=>Number(norm(b.s)===q)-Number(norm(a.s)===q)||Number(b.id?.startsWith('market:')||false)-Number(a.id?.startsWith('market:')||false)).slice(0,20);
 for(const x of matches){const button=document.createElement('button');button.type='button';button.textContent=x.title;button.onclick=e=>{e.preventDefault();input.value=x.title;box.replaceChildren();if(kind==='Options'){
   const expiries=get('expiry');expiries.replaceChildren(...['This week','Next week','Monthly'].map(v=>new Option(v,v)));
   optionChain().then(rows=>{if(input.value!==x.s)return;const dates=[...new Set(rows.filter(c=>c[0].startsWith(x.s+' ')).map(c=>c[2]))].sort();for(const d of dates)expiries.append(new Option(d,d));const sizes=[...new Set(rows.filter(c=>c[0].startsWith(x.s+' ')).map(c=>c[5]))];get('units').value=sizes.length===1?sizes[0]:''}).catch(err=>quoteHost.textContent=err.message);
   const node=document.createElement('span');quoteHost.replaceChildren(node);node.textContent='Checking index spot…';pollWhile(node,30000,()=>stockQuotes([x.s==='NIFTY'?'NIFTY 50':x.s]),qs=>{node.textContent=qs[0]?.price?'Index spot ₹'+fmt(qs[0].price)+' · '+quoteTime(qs[0].time):'Index spot unavailable'},()=>node.textContent='Index spot unavailable');
  }else showLegQuote(x)};box.append(button)}
 if(!matches.length)box.textContent='No matches';
 }
 get('symbol').addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();get('names').querySelector('button')?.focus()}if(e.key==='Escape')get('names').replaceChildren()});
 get('symbol').parentElement.addEventListener('focusout',e=>{if(!e.currentTarget.contains(e.relatedTarget))get('names').replaceChildren()});

 if(kind==='Options'){
  el.classList.add('numberedLeg');
  const wrap=document.createElement('div');wrap.className='legSteps';el.append(wrap);
  const label=k=>get(k).closest('label');
  const steps=[
   ['Index',[label('symbol'),quoteHost]],['Lots and lot quantity',[label('lots'),label('units')]],['Entry and exit · IST',[label('et'),label('xt')]],
   ['Expiry',[label('expiry')]],['Call / Put',[label('cp')]],['Contract selection',[label('basis')]],['Selection value',[label('money'),label('strike')]],
   ['Action',[label('side')]],['Target',[get('tp').closest('.riskPair')]],['Stop loss',[get('sl').closest('.riskPair')]],['Trailing SL',[pencil]],['Charges',[chargeButton]]
  ];
  steps.forEach(([title,items],i)=>{const box=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=(i+1)+'. '+title;box.append(legend,...items);wrap.append(box)});
  for(const field of el.querySelectorAll(':scope > .fields'))field.hidden=true;
 }
 get('symbol').oninput=suggest;
 el.config=()=>{const q=get('symbol').value.trim().toUpperCase(),src=available().find(x=>x.title.toUpperCase()===q)||available().find(x=>x.s===q);
 if(!src)throw Error('Select a name from the search results.');
 let p={id:src.id,s:src.s,contractKey:src.key,source:src.title,mode:kind,side:get('side').value,qty:+get('lots').value*+get('units').value,stop:+get('sl').value,target:+get('tp').value,stopUnit:get('su').value,targetUnit:get('tu').value,trailX,trailY,rule:get('rule').value,ruleValue:+get('value').value,expiry:'',dte:'',term:'',fees:[...fees],entry:toMin(get('et').value),exit:toMin(get('xt').value)};
 if((p.trailX||p.trailY)&&!(p.trailX&&p.trailY&&p.stop))throw Error('Trailing requires a stop and positive X and Y values.');
 if(kind==='Options'){Object.assign(p,{cp:get('cp').value,optionExpiry:get('expiry').value,strikeMode:get('basis').value,money:get('money').value.split(' ').at(-1),steps:parseInt(get('money').value)||0,strikePrice:+get('strike').value,lots:+get('lots').value});return {p,rows:null}}
 return {p,rows:src.id.startsWith('market:')?null:src.data?.rows||(candleCache[src.id]??=demoBars(src.s))}};
 el.querySelector('button').onclick=()=>{el.remove();if(!legs.children.length)add($('strategyMode').value==='Options'?'Options':'Equity');renumber()};renumber();
 }
 function renumber(){[...legs.children].forEach((el,i)=>el.querySelector('h3').textContent='Leg '+(i+1))}
 let currentMode='Options';
 $('strategyMode').onchange=()=>{const mode=$('strategyMode').value;if(mode===currentMode)return;syncDelivery(mode);if(mode==='Basket'&&currentMode==='Stock'){currentMode=mode;return}currentMode=mode;legs.replaceChildren();add(mode==='Options'?'Options':'Equity')};
 $('addLeg').onclick=()=>{if(currentMode==='Options'){add('Options');return}$('strategyMode').value='Basket';$('strategyMode').dispatchEvent(new Event('change'));add('Equity')};
 function syncDelivery(mode){
  const delivery=$('holding').value==='Delivery',options=mode==='Options';
  $('deliveryBasis').value=options?'Sessions before expiry':'Sessions after entry';
  $('deliveryN').value=options?2:1;$('deliveryN').readOnly=options;
  for(const id of ['algoStart','algoEnd','deliveryBasis','deliveryN','deliveryTime']){
   const hide=id.startsWith('algo')?delivery:!delivery;
   $(id).parentElement.hidden=hide;$(id).disabled=hide||id==='deliveryBasis';
  }
 }
 $('holding').onchange=()=>syncDelivery(currentMode);syncDelivery(currentMode);
 $('bp').onchange=()=>{let custom=$('bp').value==='Custom';$('bf').disabled=$('bt').disabled=!custom;if(!custom)$('bf').value=presetStart($('bt').value,$('bp').value)};$('bp').onchange();add('Options');
 $('strategy').onsubmit=async e=>{e.preventDefault();try{const configs=[...legs.children].map(l=>l.config());if(!Number.isInteger(+$('maxEntries').value)||+$('maxEntries').value!==1)throw Error('One strategy transaction is allowed per day.');
 const common={from:$('bf').value,to:$('bt').value,holding:$('holding').value==='Delivery'?'Positional':'Intraday',slip:+$('slip').value};
 if(common.holding==='Intraday'){const start=toMin($('algoStart').value),end=toMin($('algoEnd').value);if(start>=end)throw Error('Algo exit must follow algo entry.');for(const {p} of configs){p.entry=Math.max(p.entry,start);p.exit=Math.min(p.exit,end);if(p.entry>=p.exit)throw Error('Leg times must overlap the algo window.')}}
 if(common.holding==='Positional'){
  common.holdDays=+$('deliveryN').value;common.beforeExpiry=$('deliveryBasis').value==='Sessions before expiry';common.deliveryExit=toMin($('deliveryTime').value);
  if(common.beforeExpiry&&configs.some(c=>c.p.mode!=='Options'))throw Error('Days before expiry applies to option contracts.');
  if(!common.beforeExpiry&&common.holdDays<1)throw Error('Enter at least one session after entry.');
  for(const c of configs)c.p.exit=Math.min(c.p.exit,common.deliveryExit);
 }
 const form=e.target,button=form.querySelector('.primary');if(button.disabled)return;
 button.disabled=true;
 const optionData=new Map();
 async function load(symbol,key,from,to){
  const id=JSON.stringify([symbol,key,from,to]);if(optionData.has(id))return optionData.get(id);
  const pending=(async()=>{let rows=[];
   for(let start=Date.parse(from);start<=Date.parse(to);start+=7*86400000){
    const a=new Date(start).toISOString().slice(0,10),b=new Date(Math.min(Date.parse(to),start+6*86400000)).toISOString().slice(0,10);
    if(!key&&session){const history=await fyersRequest('history',{symbol,from:a,to:b}).catch(()=>null);if(history?.rows?.length){rows.push(...history.rows);continue}}
    const qs=new URLSearchParams({symbol,from:a,to:b,...(key?{contract:key}:{})});
    const res=await fetch(authOrigin+'/functions/v1/market-minute?'+qs),data=await res.json();
    if(!res.ok){if(key&&res.status===404)continue;throw Error(data.error||'Minute history unavailable')}
    rows.push(...data.rows);
   }return rows})();
  optionData.set(id,pending);return pending;
 }
 try{await Promise.all(configs.map(async c=>{if(c.p.mode==='Options'){$('runMessage').textContent='Loading index and option minute candles…';c.run=await simulateOptions(c.p,common,load);return}if(c.rows)return;$('runMessage').textContent='Loading observed minute candles…';
 const first=Date.parse(common.from),last=Date.parse(common.to);
 const useFyers=['Equity','Index'].includes(c.p.mode)&&!!session;
 if(!Number.isFinite(first)||!Number.isFinite(last)||last<first)throw Error('Check the selected dates.');
 const rows=[],providers=new Set();
 for(let i=first;i<=last;i+=7*86400000){
  const from=new Date(i).toISOString().slice(0,10),to=new Date(Math.min(last,i+6*86400000)).toISOString().slice(0,10);
  const recent=i>Date.now()-30*86400000;
  let data;
  if(useFyers){
   try{data=await fyersRequest('history',{symbol:c.p.s,from,to})}catch(err){if(!recent)throw err}
  }
  if(!data){
   if(!recent)throw Error('Older equity and index history requires a FYERS connection. For this contract, import minute CSV data.');
   const qs=new URLSearchParams({symbol:c.p.mode==='Options'?c.p.s.split(' ')[0]:c.p.s,...(c.p.contractKey?{contract:c.p.contractKey}:{}),from,to});
   const response=await fetch(authOrigin+'/functions/v1/market-minute?'+qs);
   data=await response.json();
   if(!response.ok)throw Error(c.p.s+' · '+(data.error||'Market feed unavailable'));
  }
  rows.push(...data.rows);if(data.rows.length)providers.add(data.source);
 }
 if(!rows.length)throw Error(c.p.s+' · No minute candles in this date range.');
 c.p.source=[...providers].join(' / ')+' · observed minute candles · '+c.p.s;
 c.rows=rows;
 }))}finally{button.disabled=false}if(!form.isConnected)return;
 const runs=configs.map(({p,rows,run})=>run||simulate(rows,{...p,...common}));let shared=new Set(runs[0].trades.map(t=>t.entryDay));for(let r of runs){let dates=new Set(r.trades.map(t=>t.entryDay));shared=new Set([...shared].filter(d=>dates.has(d)))}
 let trades=runs.flatMap((r,i)=>r.trades.filter(t=>shared.has(t.entryDay)).map(t=>({...t,s:t.s||r.p.s,side:r.p.side,qty:t.qty??r.p.qty,stop:r.p.stop,stopUnit:r.p.stopUnit,leg:i+1}))).sort((a,b)=>(a.d+a.exit).localeCompare(b.d+b.exit)||a.leg-b.leg);
 const limits={target:+$('algoTarget').value,stop:+$('algoStop').value,tu:$('algoTU').value,su:$('algoSU').value};
 if(limits.target||limits.stop)trades=applyAlgoTargets(trades,configs,common,limits);
 for(const t of trades)delete t.marks;
 let net=0,peak=0,dd=0,value=0;for(let t of trades){net+=t.net;peak=Math.max(peak,net);t.cum=net;t.dd=net-peak;dd=Math.min(dd,t.dd);value+=t.qty*t.ep;t.tip=t.d+' '+t.exit+' · '+t.s+' · Net ₹'+fmt(t.net)+' · Cumulative ₹'+fmt(net)}
 let p={...runs[0].p,limits,legs:runs.map(r=>r.p),s:configs.map(c=>c.p.s).join(' + '),id:configs.map(c=>c.p.id).join('|'),source:configs.map(c=>c.p.source).join(' / ')};
 const prices=configs.flatMap(c=>c.run?c.run.prices:[{name:c.p.s,bars:dailyOHLC(c.rows.filter(row=>row.d>=common.from&&row.d<=common.to))}]).filter(x=>x?.bars.length);
 lastRun={p,trades,prices,net,dd,ret:value?100*net/value:0,win:trades.length?100*trades.filter(t=>t.net>0).length/trades.length:0,skipped:[...new Set(runs.flatMap(r=>r.skipped))]};lastMonth='';$('runMessage').textContent=shared.size+' eligible basket sessions';showResults();
 }catch(err){$('results').replaceChildren();$('runMessage').textContent=err.message}};
}
segmentedIds.add('algoTU');segmentedIds.add('algoSU');segmentedIds.add('strategyMode');segmentedIds.add('holding');
backtester=builderPage;
