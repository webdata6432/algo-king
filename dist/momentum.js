const levels=[1,2,3,5], presetNames=['7D','15D','30D','1Y','Custom'];
let leaderboard=[],filters={period:'7D',from:'2026-10-22',to:end,cap:'All stocks',cut:'1%',limit:10,query:''};
function presetStart(to,period){let d=new Date(to+'T00:00Z');if(period==='1Y')d.setUTCFullYear(d.getUTCFullYear()-1);else d.setUTCDate(d.getUTCDate()-(parseInt(period)-1));return d.toISOString().slice(0,10)}
function score(rows,cut){let hits=levels.map(n=>rows.filter(r=>Math.abs(r.i)>=n).length);return {hits,score:cut==='All'?hits[0]:hits[levels.indexOf(parseInt(cut))]}}
function aggregate(rows){
 const first=rows[0],last=rows.at(-1);
 const base=first.a==null?first.o:first.c/(1+first.a/100);
 let peak=base,drawdown=0;
 for(const row of rows){
  peak=Math.max(peak,row.c);
  drawdown=Math.min(drawdown,100*(row.c/peak-1));
 }
 return {base,points:last.c-base,actual:100*(last.c/base-1),peakReturn:100*(peak/base-1),drawdown};
}
const marketIndices=[
 ['NIFTY 50','Nifty 50','Index','NSE:NIFTY50-INDEX'],['SENSEX','Sensex','Index','BSE:SENSEX-INDEX'],
 ['BANKNIFTY','Nifty Bank','Index','NSE:NIFTYBANK-INDEX'],['NIFTY MIDCAP 100','Nifty Midcap 100','Index','NSE:NIFTYMIDCAP100-INDEX']
];
let capDirectory,scanCache,directoryRequest;
function stockDirectory(){
 return directoryRequest??=fetch('market/caps.json').then(async r=>{
  if(!r.ok)throw Error('Stock directory unavailable');
  capDirectory=await r.json();return [...capDirectory.companies,...marketIndices];
 }).catch(err=>{directoryRequest=null;throw err});
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function market(){
 const today=new Date(Date.now()+19800000).toISOString().slice(0,10);
 $('app').innerHTML=heading('Market returns','Intraday momentum','Scan saved exchange sessions for the selected period.')+
 '<section class="panel"><h2>Dates</h2><div class="fields">'+select('Date range','period',presetNames)+input('From','mf',filters.from,'date')+input('Through','mt',filters.to,'date')+select('Absolute move ≥','cut',['1%','2%','3%','5%','All'])+'</div></section>'+
 '<section class="panel"><h2>Stock filters</h2><div class="fields">'+input('Search','query',filters.query,'search','placeholder="Name or symbol"')+input('Show top','topN',filters.limit,'number','min="1" step="1"')+'</div><div class="fields">'+select('Stock group','universeCap',['All stocks',...caps,'Indices'])+'</div><button class="primary" id="scan">Scan stocks</button> <button id="brokerScan" hidden>Scan directly with FYERS</button><p id="scanStatus" role="status"></p><div id="rank"></div></section>';
 const host=$('rank'),status=$('scanStatus'),button=$('scan');
 const search=$('query'),suggestions=document.createElement('span');
 suggestions.className='searchMatches';suggestions.id='momentumNames';search.after(suggestions);
 search.autocomplete='off';search.setAttribute('aria-controls',suggestions.id);
 let selected=null,version=0;
 async function suggest(){
  selected=null;changed();suggestions.replaceChildren();
  const raw=search.value.trim(),normalize=s=>s.toUpperCase().replace(/[^A-Z0-9]/g,''),q=normalize(raw);
  if(!q)return;
  try{
   const all=await stockDirectory();
   if(search.value.trim()!==raw||document.activeElement!==search)return;
   const found=all.filter(([symbol,name])=>normalize(symbol).includes(q)||normalize(name).includes(q))
    .sort((a,b)=>Number(normalize(b[0])===q)-Number(normalize(a[0])===q)||Number(normalize(b[0]).startsWith(q))-Number(normalize(a[0]).startsWith(q))).slice(0,20);
   for(const row of found){
    const option=document.createElement('button');option.type='button';option.textContent=row[0]+' · '+row[1];
    option.onclick=e=>{e.preventDefault();selected=row;search.value=row[0];suggestions.replaceChildren();scan()};
    suggestions.append(option);
   }
   if(!found.length)suggestions.textContent='No matches';
  }catch{if(search.value.trim()===raw)suggestions.textContent='Could not load names. Type again to retry.'}
 }
 search.oninput=suggest;
 search.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();suggestions.querySelector('button')?.focus()}if(e.key==='Escape')suggestions.replaceChildren()};
 search.parentElement.addEventListener('focusout',e=>{if(!e.currentTarget.contains(e.relatedTarget))suggestions.replaceChildren()});

 $('period').value=filters.period;$('cut').value=filters.cut;$('universeCap').value=filters.cap;
 function read(){
  const preset=$('period').value,custom=preset==='Custom';
  if(!custom){$('mt').value=today;$('mf').value=presetStart(today,preset)}
  $('mt').disabled=$('mf').disabled=!custom;
  Object.assign(filters,{period:preset,from:$('mf').value,to:$('mt').value,cap:$('universeCap').value,query:$('query').value.trim(),cut:$('cut').value,limit:Math.max(1,Math.floor(+$('topN').value||1))});
 }
 function changed(){document.getElementById("brokerScan").hidden=true;version++;read();host.replaceChildren();button.disabled=false;status.textContent='Select Scan stocks to rank this group.'}
 async function scan(broker=false){
  read();const v=++version,active=()=>v===version&&host.isConnected;
  const {from,to,cap}=filters,query=selected?selected[0]+' '+selected[1]:filters.query;
  host.replaceChildren();
  if(!from||!to||from>to||to>today){status.textContent='Select a valid range ending today or earlier.';return}
  button.disabled=true;
  try{
   if(!broker){
    status.textContent='Ranking stored sessions…';
    const result=await fyersRequest('archiveRank',{from,to,cap,query,cut:filters.cut==='All'?1:parseInt(filters.cut),limit:filters.limit});
    if(!active())return;
    if(selected&&result.pending&&!result.withData)return await scan(true);
    leaderboard=result.stocks.map(stock=>{
     let prev=stock.prev==null?null:stock.prev/100;
     const rows=stock.bars.map(([d,o,c])=>{const b=bar(d,o/100,c/100,prev);prev=c/100;return b});
     return {s:stock.symbol,category:stock.cap,ticker:stock.ticker,source:'Supabase · Upstox daily',rows,...score(rows,filters.cut),...aggregate(rows)};
    });
    const pending=result.pending;
    status.textContent=(pending?'Archive updating · provisional ranking · '+pending+' pending. ':'Full archive scan · ')+result.total+' in group · '+result.unavailable+' unavailable · '+result.withData+' with sessions · '+result.matched+' matching · '+leaderboard.length+' shown.';
    document.getElementById('brokerScan').hidden=!pending;
    renderRankings();return;
   }
   if(!capDirectory)await stockDirectory();
   if(!active())return;
   const q=query.toUpperCase(),list=(q?[...capDirectory.companies,...marketIndices]:cap==='Indices'?marketIndices:capDirectory.companies)
    .filter(([s,n,c])=>q?(s+' '+n).toUpperCase().includes(q):cap==='All stocks'||cap==='Indices'||c===cap);
   const range=from+'|'+to;
   if(scanCache?.range!==range||Date.now()-scanCache.at>300000)scanCache={range,bars:new Map(),at:Date.now()};
   const cache=scanCache.bars;
   const tickers=[...new Set(list.map(i=>i[3]).filter(Boolean))],missing=tickers.filter(t=>!cache.has(t));
   const day=86400000;
   // Query many cached instruments together. Only cache misses need broker calls.
   let checked=tickers.length-missing.length;
   const width=Math.max(24,Math.min(200,Math.floor(10000/(1+(Date.parse(to)-Date.parse(from))/day))));
   for(let offset=0;offset<missing.length;offset+=width){
    if(!active())return;
    const group=missing.slice(offset,offset+width),series=new Map(group.map(t=>[t,[]]));
    const append=(data)=>{
     for(const t of data.unavailable)series.set(t,null);
     for(const [t,bars] of Object.entries(data.rows)){const saved=series.get(t);if(saved)saved.push(...bars)}
    };
    for(let start=Date.parse(from);start<=Date.parse(to);start+=350*day){
     if(!active())return;
     const dates={from:new Date(start).toISOString().slice(0,10),to:new Date(Math.min(Date.parse(to),start+349*day)).toISOString().slice(0,10)};
     status.textContent='Checking saved FYERS candles · '+checked+' / '+tickers.length;
     const found=await fyersRequest('cachedScan',{tickers:group,...dates});
     append(found);
     for(let n=0;n<found.missing.length;n+=20){
      const batch=found.missing.slice(n,n+20);
      for(let attempt=0;;attempt++){
       if(!active())return;
       status.textContent='Fetching FYERS history · '+(checked+group.length-found.missing.length+n)+' / '+tickers.length;
       try{append(await fyersRequest('dailyScan',{tickers:batch,...dates}));break}
       catch(err){if(attempt>=2||!String(err.message).includes('rate limit'))throw err;
        status.textContent='FYERS rate limit · resuming in one minute.';await delay(61000)}
      }
     }
    }
    for(const [t,a] of series)cache.set(t,a);
    checked+=group.length;
   }
   if(!active())return;
   const matches=[];let noData=0,unmapped=0;
   const candles=raw=>raw.map(([t,o,c,p])=>bar(new Date(t*1000+19800000).toISOString().slice(0,10),o,c,p));
   for(const [s,,category,ticker] of list){
    const raw=cache.get(ticker);
    if(!ticker||raw===null){unmapped++;continue}
    if(!raw?.length){noData++;continue}
    const rows=candles(raw);
    const stats=score(rows,filters.cut);
    if(stats.score||q||cap==='Indices')matches.push({s,category,ticker,source:'FYERS daily',...stats,...aggregate(rows)});
   }
   matches.sort((a,b)=>b.score-a.score||b.hits[3]-a.hits[3]||b.hits[2]-a.hits[2]||b.hits[1]-a.hits[1]||a.s.localeCompare(b.s));
   leaderboard=(q||cap==='Indices'?matches:matches.slice(0,filters.limit)).map(x=>({...x,rows:candles(cache.get(x.ticker))}));
   status.textContent=list.length+' in group · '+(list.length-unmapped-noData)+' with candles · '+matches.length+' matching · '+leaderboard.length+' shown · '+noData+' with no sessions · '+unmapped+' unavailable. Current AMFI classification.';
   renderRankings();
  }catch(err){if(active())status.textContent=err.message+' Scan again to resume this range.'}
  finally{if(active())button.disabled=false}
 }
 $('universeCap').onchange=()=>{selected=null;search.value='';suggestions.replaceChildren();changed()};
 for(const id of ['period','mf','mt'])$(id).addEventListener('change',changed);
 for(const id of ['cut','topN'])$(id).onchange=()=>{if(host.children.length)scan();else changed()};
 button.onclick=()=>scan();document.getElementById("brokerScan").onclick=()=>scan(true);changed();
}
function inspectRank(i){let x=leaderboard[i],rs=x.rows,base=x.base,rows=rs.map(r=>({...r,cumulative:100*(r.c/base-1),tip:r.d+'\nOpen '+fmt(r.o)+' · Close '+fmt(r.c)+'\nIntraday '+signed(r.i)+'% · Actual '+(r.a==null?'—':signed(r.a)+'%')})),headers=['Session','Open','Close','Points','Intraday %','Actual %','Cumulative actual %',...levels.map(n=>'≥'+n+'%')];modal(x.s+' · Session detail','<p class="hint" id="latestMarketQuote">Checking latest market quote…</p>'+note(esc(x.source)+' · '+rs[0].d+' — '+rs.at(-1).d+' · '+rs.length+' sessions')+metrics([['Period incl. gaps',pct(x.actual)],['Peak return',pct(x.peakReturn)],['Max drawdown',pct(x.drawdown)],['Change in points',signed(x.points)],['Last session · '+rs.at(-1).d,pct(rs.at(-1).i)]])+'<h3>Daily open-to-close move</h3>'+plot(rows.map(r=>({...r,tip:r.d+' · '+signed(r.i)+'%'})),'i','#42d995',true)+'<h3>Cumulative actual return</h3>'+plot(rows.map(r=>({...r,tip:r.d+' · '+signed(r.cumulative)+'%'})),'cumulative','#4fe3ac')+'<div class="row"><h3>Historical candles</h3><button id="historyCSV">Export CSV</button></div>'+table(headers,rows.map(r=>[r.d,fmt(r.o),fmt(r.c),signed(r.c-r.o),pct(r.i),pct(r.a),pct(r.cumulative),...levels.map(n=>Math.abs(r.i)>=n?'✓':'—')])));trackMarketQuote(x.s,$('latestMarketQuote'),x.ticker);$('historyCSV').onclick=()=>csv(x.s+'-history',[headers,...rows.map(r=>[r.d,r.o,r.c,r.c-r.o,r.i,r.a,r.cumulative,...levels.map(n=>Math.abs(r.i)>=n)])])}
let marketTab='Rankings',reportSymbol='',direction='Both';
function renderRankings(){
 const root=$('rank');root.innerHTML='<div class="viewtabs">'+['Rankings','Daily report'].map(n=>'<button class="'+(marketTab===n?'selected':'')+'">'+n+'</button>').join('')+'</div><div id="rankBody"></div>';
 root.querySelectorAll('.viewtabs button').forEach(b=>b.onclick=()=>{marketTab=b.textContent;renderRankings()});
 const body=$('rankBody');if(!leaderboard.length){body.innerHTML=empty('No matching sessions. Try another date or stock.');
 return}
 if(marketTab==='Daily report'){
  let x=leaderboard.find(x=>x.s===reportSymbol)||leaderboard[0];reportSymbol=x.s;
  let rs=x.rows.filter(r=>direction==='Both'||(direction==='Up'?r.i>=0:r.i<0)).slice().reverse();
  let cols=['Date','Stock','Open','Close','Change ₹ / pts','Open → close %','Incl. gap %',...levels.map(n=>'≥'+n+'%')];
  const row=r=>[r.d,x.s,r.o,r.c,r.c-r.o,r.i,r.a,...levels.map(n=>Math.abs(r.i)>=n?'Yes':'—')];
  body.innerHTML='<div class="actions reportFilters">'+select('Stock','reportStock',leaderboard.map(x=>x.s))+select('Direction','reportDirection',['Both','Up','Down'])+'<button id="downloadReport">Export CSV</button></div>'+note(esc(x.source)+' · '+rs.length+' sessions')+table(cols,rs.map(r=>[r.d,esc(x.s),fmt(r.o),fmt(r.c),'<span class="'+col(r.c-r.o)+'">'+signed(r.c-r.o)+'</span>',pct(r.i),pct(r.a),...row(r).slice(7)]));
  $('reportStock').value=x.s;$('reportDirection').value=direction;$('reportStock').onchange=e=>{reportSymbol=e.target.value;renderRankings()};$('reportDirection').onchange=e=>{direction=e.target.value;renderRankings()};$('downloadReport').onclick=()=>csv(x.s+'-daily',[cols,...rs.map(row)]);return
 }

 let cols=['Rank · Stock','Group','Hit days','Hit rate','Avg |move|','Max up','Max down','Latest date','Change ₹ / pts','Open → close %','Incl. gap %',...(filters.cut==='All'?levels.map(n=>'≥'+n+'% hits'):[]),'Period incl. gaps','Peak return','Max drawdown'];
 let rows=leaderboard.map(x=>{let r=x.rows.at(-1),moves=x.rows.map(r=>r.i);return [x.s,x.category,x.score+'/'+moves.length,100*x.score/moves.length,mean(moves.map(Math.abs)),Math.max(0,...moves),Math.min(0,...moves),r.d,r.c-r.o,r.i,r.a,...(filters.cut==='All'?x.hits:[]),x.actual,x.peakReturn,x.drawdown]});
 body.innerHTML='<div class="row"><p class="hint">Peak return uses the highest close above the starting baseline (previous close, or first open if unavailable). Max drawdown is the largest closing fall from a peak within these dates.</p><button id="rankCSV">Export rankings</button></div>'+table(cols,rows.map((r,i)=>['<button onclick="inspectRank('+i+')">'+(i+1)+'. '+esc(r[0])+'</button>','<span class="capBadge">'+esc(r[1])+'</span>',r[2],'<span class="hitTrack"><i style="width:'+r[3]+'%"></i></span>'+fmt(r[3],1)+'%',fmt(r[4])+'%',pct(r[5]),pct(r[6]),r[7],'<span class="'+col(r[8])+'">'+signed(r[8])+'</span>',pct(r[9]),pct(r[10]),...r.slice(11,-3),...r.slice(-3).map(pct)]));
 $('rankCSV').onclick=()=>csv('momentum-rankings',[cols,...rows])
}

async function trackMarketQuote(symbol,node,ticker){
 async function update(){
  if(!node.isConnected||!$('dlg').open)return;
  try{
   let q;if(session)q=(await stockQuotes([ticker||symbol]).catch(()=>[]))[0];if(!q?.price&&ticker?.startsWith('BSE:')&&symbol!=='SENSEX')throw Error();if(session&&!q?.price)q=await accountRequest('/functions/v1/angel-account',{action:'quote',symbol},session.access_token).catch(()=>null);
   if(!q?.price){const r=await fetch(authOrigin+'/functions/v1/market-minute?mode=quote&symbol='+encodeURIComponent(symbol));if(!r.ok)throw Error();q=await r.json()}
   const stamp=q.asOf||(q.time?new Date(q.time).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})+' IST':'Time unavailable');
   const match=String(q.asOf||'').match(/^(\d{2})-([A-Za-z]{3})-(\d{4}) (\d{2}:\d{2}:\d{2})$/);const timestamp=q.time||(match?Date.parse(match[1]+' '+match[2]+' '+match[3]+' '+match[4]+' GMT+0530'):NaN);const age=Date.now()-timestamp;const quality=Number.isFinite(age)&&age>=0?(age<=1800000?'Within 30 min':'Last known · over 30 min'):'Timestamp unverified';
   node.textContent=quality+' · '+fmt(q.price)+' · '+q.source+' · '+stamp;
  }catch{node.textContent='Latest quote unavailable · historical candles below'}
  if(node.isConnected&&$('dlg').open)setTimeout(update,30000);
 }
 await update();
}
