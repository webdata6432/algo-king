const feeLabels=['Brokerage ₹ per executed order','STT % of sell value','Exchange % of turnover','GST % on brokerage, exchange and SEBI','Stamp duty % of buy value','SEBI / other % of turnover'];
let feeSchedule=[0,0,0,0,0,0];
function chargesPanel(){modal('Charges & taxes','<form id="chargeForm">'+note('Set rates for your segment and broker before running. Zero excludes that charge. All percentages are entered as displayed percentages.')+'<div class="fields">'+feeLabels.map((l,i)=>input(l,'charge'+i,feeSchedule[i],'number','min="0" step="any"')).join('')+'</div><button class="primary">Apply charges</button></form>');$('chargeForm').onsubmit=e=>{e.preventDefault();feeSchedule=feeLabels.map((_,i)=>+$('charge'+i).value);$('feeSummary').textContent=feeSchedule.some(Boolean)?'Custom charges configured':'Zero charges configured';dlg.close()}}
function costs(p,ep,xp){let f=p.fees;if(!f)return 2*p.fee+(ep+xp)*p.qty*p.rate/100;let buy=(p.side==='Buy'?ep:xp)*p.qty,sell=(p.side==='Buy'?xp:ep)*p.qty,turn=buy+sell,service=2*f[0]+turn*(f[2]+f[5])/100;return service*(1+f[3]/100)+sell*f[1]/100+buy*f[4]/100}
function distance(value,unit,ep,qty){return unit==='₹'?value/qty:unit==='Pts'?value:ep*value/100}
function entryCapital(t,p){return Math.abs(t.ep*(t.qty??p.qty))}
function entryOrder(a,b){return ((a.entryDay||a.d)+a.entry).localeCompare((b.entryDay||b.d)+b.entry)||(a.leg||1)-(b.leg||1)}
function peakCapital(r){
 const events=[];
 for(const t of r.trades){
  const value=entryCapital(t,r.p);
  events.push([(t.entryDay||t.d)+t.entry,value],[t.d+t.exit,-value]);
 }
 events.sort((a,b)=>a[0].localeCompare(b[0])||b[1]-a[1]);
 let open=0,peak=0;
 for(const [,change] of events){open+=change;peak=Math.max(peak,open)}
 return peak;
}
function runStats(r){let t=r.trades,w=t.filter(x=>x.net>0),l=t.filter(x=>x.net<0),ws=0,ls=0,mw=0,ml=0,under=0,longest=0;for(let x of t){ws=x.net>0?ws+1:0;ls=x.net<0?ls+1:0;mw=Math.max(mw,ws);ml=Math.max(ml,ls);under=x.dd<0?under+1:0;longest=Math.max(longest,under)}let net=a=>a.reduce((v,x)=>v+x.net,0),risk=mean(t.map(x=>distance(x.stop??r.p.stop,x.stopUnit||r.p.stopUnit,x.ep,x.qty||r.p.qty)/x.ep*100));const capital=peakCapital(r);return [['Gross P&L',cash(t.reduce((v,x)=>v+x.gross,0))],['Total charges','₹'+fmt(t.reduce((v,x)=>v+x.charges,0))],['Net P&L',cash(r.net)],['Peak capital used','₹'+fmt(capital)],['Return on capital',capital?pct(100*r.net/capital):'—'],['Total trades',t.length],['Winning probability',fmt(r.win)+'%'],['Wins : losses',w.length+' : '+l.length],['Avg stop / entry value',r.p.stop?fmt(risk)+'%':'No fixed stop'],['Max drawdown',cash(r.dd)],['Longest drawdown',longest+' trade closes'],['Average win',w.length?cash(net(w)/w.length):'—'],['Average loss',l.length?cash(net(l)/l.length):'—'],['Max profit',w.length?cash(Math.max(...w.map(x=>x.net))):'—'],['Max loss',l.length?cash(Math.min(...l.map(x=>x.net))):'—'],['Longest win / loss streak',mw+' / '+ml],['Expectancy per trade',cash(r.net/t.length)]]}
function calendarReport(r){let months=Object.fromEntries(groupByPeriod(r.trades,false)),years=[...new Set(r.trades.map(x=>x.d.slice(0,4)))];return '<section class="panel"><h2>Profit & loss calendar</h2>'+years.map(y=>'<h3>'+y+'</h3><div class="calendar">'+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m,i)=>{let k=y+'-'+String(i+1).padStart(2,'0'),a=months[k];return a?'<button class="'+(total(a)>=0?'gain':'loss')+'" onclick="drill(\''+k+'\');document.getElementById(\'daily\').scrollIntoView()">'+m+'<br>₹'+fmt(total(a),0)+'</button>':'<button disabled>'+m+'<br>—</button>'}).join('')+'</div>').join('')+'</section>'}
function dayTiles(a){return '<div class="calendar">'+a.map(t=>'<button title="'+t.d+' · ₹'+fmt(t.net)+'" class="'+(t.net>=0?'gain':'loss')+'" onclick="document.getElementById(\'dailyLog\').scrollIntoView()">'+t.d.slice(5)+'<br>₹'+fmt(t.net)+'</button>').join('')+'</div>'}
function strategyLibrary(){modal('Saved strategies',saved.length?table(['Name','Period','Instrument','Trades','Net','Details'],saved.map((r,i)=>[esc(r.name),r.p.from+' — '+r.p.to,esc(r.p.s),r.trades.length,cash(r.net),'<button onclick="openStrategy('+i+')">Open run</button>'])):empty('Save a completed run to build your strategy list.'))}
function openStrategy(i){let r=saved[i];chosen=r.p.id;lastRun=r;feeSchedule=r.p.fees||[r.p.fee||0,0,r.p.rate||0,0,0,0];contractMode=r.p.mode||'Equity';lastMonth='';dlg.close();backtester();showResults()}
function entryMatches(c,p){
 if(p.rule==='Time only')return true;
 if(!c)return false;let n=p.ruleValue;
 switch(p.rule){case 'Strike price':return p.strike===n;case 'Premium above':return c.o>n;case 'Premium below':return c.o<n;case 'Premium near':return Math.abs(c.o-n)<=p.tolerance;default:let [field,relation]=p.rule.toLowerCase().split(' ');return Number.isFinite(c[field])&&(relation==='above'?c[field]>n:c[field]<n)}
}
function riskField(name,id,unit,value){return '<div class="riskPair"><label for="'+id+'">'+name+'</label><div>'+select(name+' unit',unit,['%','₹','Pts'])+'<input aria-label="'+name+' value" id="'+id+'" type="number" min="0" step="any" value="'+value+'" required></div></div>'}
let searchTimer,searchSeq=0;
function instrumentSearch(query){
 clearTimeout(searchTimer);let seq=++searchSeq,host=$('liveSearch');host.textContent='';
 if(query.trim().length<2)return;
 searchTimer=setTimeout(async()=>{try{
 let hits=await api('search?q='+encodeURIComponent(query.trim()));
 if(seq!==searchSeq||!host.isConnected)return;
 host.innerHTML='<div class="actions">'+hits.map((x,i)=>'<button type="button" data-id="'+i+'">'+esc(x.symbol)+' · '+esc(x.type)+'</button>').join('')+'</div>';
 if(!hits.length)host.textContent='No API matches.';
 host.querySelectorAll('button').forEach(b=>b.onclick=async()=>{let item=hits[+b.dataset.id],from=$('bf').value,to=$('bt').value;host.textContent='Loading minute prices…';try{
 let rows=await api('candles?'+new URLSearchParams({key:item.key,from,to}));if(!rows.length)throw Error('No minute candles for this period.');
 let f={id:crypto.randomUUID(),s:item.symbol,minute:true,kind:item.kind,optionType:item.type,expiry:item.expiry,strike:item.strike,src:'Upstox',name:from+' to '+to,rows};await persist('files',f);imports.push(f);chosen=f.id;contractMode=item.kind==='Option contract'?'Options':item.kind==='Future'?'Future':'Equity';if(item.type==='PE'||item.type==='CE')optionSide=item.type;backtester();$('bp').value='Custom';$('bp').dispatchEvent(new Event('change'));$('bf').value=from;$('bt').value=to;enhanceSelectors();}catch(e){host.textContent=e.message}})
 }catch(e){if(seq===searchSeq&&host.isConnected)host.textContent='Local matches below. API search: '+e.message}},350)
}
