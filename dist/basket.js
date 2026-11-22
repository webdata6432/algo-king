let legSequence=0;
function builderPage(){
 $('app').innerHTML=heading('Strategy studio','Backtester','Build a strategy from minute candles. Times are in IST.',importButton+' <button onclick="strategyLibrary()">Saved strategies</button>')+'<form id="strategy" class="panel"><div class="row">'+select('Strategy','strategyMode',['Equity','Index','Basket'])+'<button type="button" id="addLeg">＋ Add leg</button></div><div class="fields">'+select('Dates','bp',presetNames)+input('From','bf',presetStart(end,'7D'),'date')+input('Through','bt',end,'date')+'</div><div id="legs"></div><h3>Algo trade exit</h3><div class="fields">'+select('Trade type','holding',['Intraday','Delivery'])+input('Max entries per day · all legs','maxEntries',4,'number','min="1"')+input('Slippage · bps per fill','slip',0,'number','min="0" step="any"')+'</div><div class="row"><button class="primary">Run backtest</button></div><p role="status" id="runMessage"></p><details><summary>Execution rules</summary>Price above and below use the first qualifying minute open after the entry window starts. Limit orders fill at the limit or a better open. For a limit touched inside a candle, only an adverse stop can exit in that candle. Each basket opens once per eligible day, only when every leg qualifies. The entry limit counts legs. Stops take priority inside an ambiguous candle. Gaps fill at the open. Incomplete candle windows skip the session. Delivery exits on the next observed session.</details></form><div id="results"></div>';
 const legs=$('legs'),sources=[...[...groups.flat(),'NIFTY 50','SENSEX','BANKNIFTY','NIFTY MIDCAP 100'].map(s=>({s,id:'market:'+s,title:s+' · Market minute candles'})),...testSources().filter(x=>!x.id.startsWith('demo:'))];
 fetch('market/shares.json').then(r=>r.json()).then(rows=>{const bySymbol=new Map(sources.filter(x=>x.id.startsWith('market:')).map(x=>[x.s,x]));for(const [s,name,key] of rows){let item=bySymbol.get(s);if(!item){item={s,id:'market:'+s};sources.push(item);bySymbol.set(s,item)}Object.assign(item,{title:s+' · '+name,key})}const active=document.activeElement;if(legs.contains(active)&&active.type==='search'&&!sources.some(s=>s.title===active.value))active.dispatchEvent(new Event('input'))}).catch(()=>{});
 function add(kind){
 const n=++legSequence,el=document.createElement('section');el.className='legrow';
 const field=(label,key,value,type='number',attrs='min="0" step="any"')=>input(label,key+n,value,type,attrs);
 const choice=(label,key,items)=>select(label,key+n,items);
 el.innerHTML='<div class="row"><h3></h3><button type="button" aria-label="Remove leg">×</button></div><div class="fields">'+'<label>Search<input required type="search" id="symbol'+n+'" aria-controls="names'+n+'" aria-autocomplete="list" autocomplete="off" placeholder="Name or symbol"><span class="searchMatches" id="names'+n+'"></span></label>'+field('Entry when · IST','et','09:30','time','')+field('Exit when · IST','xt','15:15','time','')+choice('Direction','side',['Buy','Sell'])+field('Lots / quantity','lots',1,'number','min="1" step="1"')+field('Units per lot','units',1,'number','min="1" step="1"')+'</div><div class="fields legRisk">'+choice('Entry condition','rule',[])+field('Price ₹','value','','number','step="any"')+riskField('Stop loss','sl'+n,'su'+n,0.6)+riskField('Take profit','tp'+n,'tu'+n,1)+'<button type="button" class="trailEdit" aria-label="Edit trailing stop loss">✎ Trailing SL · Off</button></div><button type="button" class="legCharges">Charges &amp; taxes</button>';
 legs.append(el);let get=k=>$(k+n);
 let fees=[...feeSchedule];const chargeButton=el.querySelector('.legCharges');
 chargeButton.onclick=()=>{modal(el.querySelector('h3').textContent+' · Charges & taxes','<form id="legFees"><div class="fields">'+feeLabels.map((label,i)=>input(label,'lf'+i,fees[i],'number','min="0" step="any"')).join('')+'</div><button class="primary">Apply to this leg</button></form>');$('legFees').onsubmit=e=>{e.preventDefault();fees=feeLabels.map((_,i)=>+$('lf'+i).value);chargeButton.textContent='Charges & taxes · configured';dlg.close()}};
 let trailX=0,trailY=0;const pencil=el.querySelector('.trailEdit');
 pencil.onclick=()=>{modal('Trailing stop loss','<form id="trailForm"><div class="fields">'+input('When price moves in your favour by (pts)','moveX',trailX||40,'number','min="0.01" step="any"')+input('Move stop loss by (pts)','moveY',trailY||20,'number','min="0.01" step="any"')+'</div><div class="row"><button type="button" id="clearTrail">Clear</button><button class="primary">Save</button></div></form>');function save(x,y){trailX=x;trailY=y;pencil.textContent='✎ Trailing SL · '+(x?x+' → '+y+' pts':'Off');dlg.close()}$('clearTrail').onclick=()=>save(0,0);$('trailForm').onsubmit=e=>{e.preventDefault();save(+$('moveX').value,+$('moveY').value)}};
 function ruleFields(){const rule=get('rule').value,node=get('value');node.parentElement.hidden=false;node.disabled=rule==='Market price';node.placeholder=node.disabled?'At market':'Enter value';node.required=rule!=='Market price';node.parentElement.firstChild.textContent=rule==='Market price'?'Entry price':rule==='Strike price'?'Strike price ₹':rule.includes('Delta')?'Delta':rule.includes('Indicator')?'Indicator value':rule+' ₹'}
 get('rule').onchange=ruleFields;
 for(let k of ['su','tu'])segmentedIds.add(k+n);
 for(const key of ['side']){
   const control=get(key),button=document.createElement('button');button.type='button';button.className='flipChoice';control.after(button);control.hidden=true;
   function paint(){button.textContent=control.value;button.dataset.negative=String(control.selectedIndex===1);button.setAttribute('aria-label',control.value+' · switch to '+control.options[1-control.selectedIndex].text)}
   button.onclick=e=>{e.preventDefault();control.selectedIndex=1-control.selectedIndex;control.dispatchEvent(new Event('change',{bubbles:true}))};control.addEventListener('change',paint);paint();
 }
 const quoteHost=document.createElement('small');get('symbol').parentElement.append(quoteHost);
 function showLegQuote(x){
  quoteHost.replaceChildren();
  if(!x.id?.startsWith('market:'))return;
  const node=document.createElement('span');quoteHost.append(node);node.textContent='Checking latest quote…';
  pollWhile(node,30000,()=>stockQuotes([x.s]),quotes=>{
   const q=quotes[0];node.textContent=q?'FYERS · '+fmt(q.price)+' · '+quoteTime(q.time):'Latest quote unavailable';
  },err=>node.textContent=err.message);
 }
 function available(){return sources.filter(x=>kind==='Index'?indices.includes(x.s):!indices.includes(x.s)&&!['Index','Option contract','Future'].includes(x.data?.kind))}
 get('rule').replaceChildren(...['Market price','Price above','Price below','Limit price'].map(v=>new Option(v,v)));
 ruleFields();
 function suggest(){quoteHost.replaceChildren();const input=get('symbol'),box=get('names'),norm=s=>s.toUpperCase().replace(/[^A-Z0-9]/g,''),q=norm(input.value);box.replaceChildren();if(!q)return;
 const options=available();
 const matches=options.filter(x=>norm(x.title).includes(q)||norm(x.s).includes(q)).sort((a,b)=>Number(norm(b.s)===q)-Number(norm(a.s)===q)||Number(b.id?.startsWith('market:')||false)-Number(a.id?.startsWith('market:')||false)).slice(0,20);
 for(const x of matches){const button=document.createElement('button');button.type='button';button.textContent=x.title;button.onclick=e=>{e.preventDefault();input.value=x.title;box.replaceChildren();showLegQuote(x)};box.append(button)}
 if(!matches.length)box.textContent='No matches';
 }
 get('symbol').addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();get('names').querySelector('button')?.focus()}if(e.key==='Escape')get('names').replaceChildren()});
 get('symbol').parentElement.addEventListener('focusout',e=>{if(!e.currentTarget.contains(e.relatedTarget))get('names').replaceChildren()});

 get('symbol').oninput=suggest;
 el.config=()=>{const q=get('symbol').value.trim().toUpperCase(),src=available().find(x=>x.title.toUpperCase()===q)||available().find(x=>x.s===q);
 if(!src)throw Error('Select a name from the search results.');
 let p={id:src.id,s:src.s,contractKey:src.key,source:src.title,mode:kind,side:get('side').value,qty:+get('lots').value*+get('units').value,stop:+get('sl').value,target:+get('tp').value,stopUnit:get('su').value,targetUnit:get('tu').value,trailX,trailY,rule:get('rule').value,ruleValue:+get('value').value,expiry:'',dte:'',term:'',fees:[...fees],entry:toMin(get('et').value),exit:toMin(get('xt').value)};
 if((p.trailX||p.trailY)&&!(p.trailX&&p.trailY&&p.stop))throw Error('Trailing requires a stop and positive X and Y values.');
 return {p,rows:src.id.startsWith('market:')?null:src.data?.rows||(candleCache[src.id]??=demoBars(src.s))}};
 el.querySelector('button').onclick=()=>{el.remove();if(!legs.children.length)add($('strategyMode').value==='Index'?'Index':'Equity');renumber()};renumber();
 }
 function renumber(){[...legs.children].forEach((el,i)=>el.querySelector('h3').textContent='Leg '+(i+1))}
 let currentMode='Equity';
 $('strategyMode').onchange=()=>{const mode=$('strategyMode').value;if(mode===currentMode)return;if(mode==='Basket'&&currentMode==='Equity'){currentMode=mode;return}currentMode=mode;legs.replaceChildren();add(mode==='Index'?'Index':'Equity')};
 $('addLeg').onclick=()=>{$('strategyMode').value='Basket';$('strategyMode').dispatchEvent(new Event('change'));add('Equity')};
 $('bp').onchange=()=>{let custom=$('bp').value==='Custom';$('bf').disabled=$('bt').disabled=!custom;if(!custom)$('bf').value=presetStart($('bt').value,$('bp').value)};$('bp').onchange();add('Equity');
 $('strategy').onsubmit=async e=>{e.preventDefault();try{const configs=[...legs.children].map(l=>l.config());if(configs.length>+$('maxEntries').value)throw Error('Increase max entries per day to cover every basket leg.');
 const common={from:$('bf').value,to:$('bt').value,holding:$('holding').value==='Delivery'?'Positional':'Intraday',slip:+$('slip').value};
 const form=e.target,button=form.querySelector('.primary');if(button.disabled)return;
 button.disabled=true;
 try{await Promise.all(configs.map(async c=>{if(c.rows)return;$('runMessage').textContent='Loading observed minute candles…';
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
 const runs=configs.map(({p,rows})=>simulate(rows,{...p,...common}));let shared=new Set(runs[0].trades.map(t=>t.entryDay));for(let r of runs){let dates=new Set(r.trades.map(t=>t.entryDay));shared=new Set([...shared].filter(d=>dates.has(d)))}
 let trades=runs.flatMap((r,i)=>r.trades.filter(t=>shared.has(t.entryDay)).map(t=>({...t,s:r.p.s,side:r.p.side,qty:r.p.qty,stop:r.p.stop,stopUnit:r.p.stopUnit,leg:i+1}))).sort((a,b)=>(a.d+a.exit).localeCompare(b.d+b.exit)||a.leg-b.leg);
 let net=0,peak=0,dd=0,value=0;for(let t of trades){net+=t.net;peak=Math.max(peak,net);t.cum=net;t.dd=net-peak;dd=Math.min(dd,t.dd);value+=t.qty*t.ep;t.tip=t.d+' '+t.exit+' · '+t.s+' · Net ₹'+fmt(t.net)+' · Cumulative ₹'+fmt(net)}
 let p={...runs[0].p,legs:runs.map(r=>r.p),s:configs.map(c=>c.p.s).join(' + '),id:configs.map(c=>c.p.id).join('|'),source:configs.map(c=>c.p.source).join(' / ')};
 lastRun={p,trades,net,dd,ret:value?100*net/value:0,win:trades.length?100*trades.filter(t=>t.net>0).length/trades.length:0,skipped:[...new Set(runs.flatMap(r=>r.skipped))]};lastMonth='';$('runMessage').textContent=shared.size+' eligible basket sessions';showResults();
 }catch(err){$('results').replaceChildren();$('runMessage').textContent=err.message}};
}
segmentedIds.add('strategyMode');segmentedIds.add('holding');
backtester=builderPage;
