async function readOptionArchive(url) {
  const res = await fetch(url);
  if (!res.ok) throw Error();
  return res.json();
}
async function dailyModels(){
  const version='__DAILY_MODEL_VERSION__';
  if(!/^[a-f0-9]{40}$/.test(version))return readOptionArchive('market/historical.json');
  return cachedRead('daily-models-'+version,86400000,async()=>{
    const {url}=await fyersRequest('dailyModels',{version});
    const file=await fetch(url);
    if(!file.ok)throw Error('Daily option archive unavailable');
    return new Response(file.body.pipeThrough(new DecompressionStream('gzip'))).json();
  });
}
async function optionHistory(initial=0) {
  const page = document.createElement('section');
  page.className = 'panel';
  document.getElementById('app').replaceChildren(page);
  page.textContent = 'Loading historical trades…';
  try {
    const [archive, minutes, research] = await Promise.all([dailyModels(), readOptionArchive('market/historical-minutes.json'), readOptionArchive('market/monthly-research.json')]);
    const days = Object.keys(archive).sort();
    const end = days.at(-1);
    const strategies = [['S1','ATM','CE','Sell'],['S2','ATM','PE','Sell'],['S3a','ATM','CE','Buy'],['S3b','ATM','PE','Buy'],['S4a','Under 200','CE','Sell'],['S4b','Under 200','PE','Sell'],['S5a','Near 300','CE','Sell'],['S5b','Near 300','PE','Sell']];
    strategies.push(['R1','Trend ATM','CE/PE','Sell'],['R2','Trend OTM','CE/PE','Sell'],['R3','Monthly put','PE','Sell']);
    const researchMode = () => Number(field('strategy').value) >= strategies.length-3;
    page.innerHTML = '<h1>Historical Backtest</h1><div class="fields"><label>Period<select name="period">'+['7D','15D','30D','1Y','3Y','5Y','All history','Custom'].map(x=>'<option '+(x==='30D'?'selected':'')+'>'+x+'</option>').join('')+'</select></label><label>From<input type="date" name="from"></label><label>To<input type="date" name="to"></label><label>Session<select name="mode"><option>Open to close</option><option>Custom time</option></select></label><label hidden>Entry · IST<input name="entry" type="time" value="09:30"></label><label hidden>Exit · IST<input name="exit" type="time" value="15:15"></label><label>Lots<input name="lots" type="number" min="1" step="1" value="1"></label><label>Strategy<select name="strategy">'+strategies.map(([id,rule,side,act],i)=>'<option value="'+i+'">'+id+' · '+act+' '+side+' · '+rule+'</option>').join('')+'</select></label></div><div class="historyResults" aria-live="polite"></div>';
    const field = name=>page.querySelector('[name="'+name+'"]');
    const output = page.querySelector('.historyResults');
    function period() {
      if(field('period').value==='Custom')return;
      const available = researchMode() ? Object.keys(research).sort() : days;
      const all=field('period').value==='All history';
      // Move the date boundary to the regular 15:30 IST market close.
      const last=all?available.at(-1):new Date(Date.now()-10*3600000).toISOString().slice(0,10);
      field('from').value=all?available[0]:presetStart(last,field('period').value);
      field('to').value=last;
    }
    const money=n=>'₹'+fmt(n);
    function render() {
      const custom=field('mode').value==='Custom time';
      for(const name of ['entry','exit'])field(name).parentElement.hidden=!custom;
      const lots=field('lots').valueAsNumber;
      const entry=field('entry').value, exit=field('exit').value;
      const from=field('from').value,to=field('to').value;
      if(!Number.isSafeInteger(lots)||lots<1||!from||!to||from>to||(custom&&(!entry||!exit||entry<'09:15'||exit>'15:29'||entry>=exit))){
        output.textContent='Check the dates, whole lots and entry before exit (09:15–15:29 IST).';return;
      }
      const [,rule,side,action]=strategies[+field('strategy').value];
      const study=researchMode();
      const source=study?research:archive;
      const range=Object.keys(source).sort();
      const inRange=range.filter(d=>d>=from&&d<=to);
      const dates=inRange.filter(d=>Array.isArray(source[d]));
      const missingDays=inRange.length-dates.length;
      const trades=[];let cum=0,peak=0,drawdown=0,missing=0;
      for(const day of dates){
        const row=source[day].find(r=>r[1]===rule&&(study||r[2]===side));
        if(!row)continue;
        const [,,contractSide,expiry,strike,open,close,unit]=row;
        let ep=open,xp=close;
        if(custom){
          const bars=minutes[[day,expiry,strike,contractSide].join('/')];
          ep=bars?.[toMin(entry)-555]/100;xp=bars?.[toMin(exit)-555]/100;
          if(!(ep>0&&xp>0)){missing++;continue;}
          if(rule==='Under 200'&&ep>=200)continue;
        }
        const qty=lots*unit, gross=(action==='Buy'?1:-1)*(xp-ep)*qty;
        const configured=costs({fees:feeSchedule,side:action,qty},ep,xp);
        const charges=study?Math.max(configured,60*lots)+2*qty:configured;
        const net=gross-charges;
        cum+=net;peak=Math.max(peak,cum);drawdown=Math.max(drawdown,peak-cum);
        trades.push({d:day,expiry,contractSide,strike,qty,ep,xp,gross,charges,net,cum,id:trades.length+1,exit:custom?exit:'Close'});
      }
      const periodLabel=from.split('-').reverse().join('-')+' to '+to.split('-').reverse().join('-');
      const slack=(study?34:6)*86400000;
      const outside=Date.parse(range[0])-Date.parse(from)>slack||Date.parse(to)-Date.parse(range.at(-1))>slack;
      const partial=custom&&missing>0;
      const coverage='<p>'+periodLabel+' · '+dates.length+(study?' scheduled monthly dates in range':' archived sessions in range')+(custom?' · '+missing+' qualifying setups missing exact Upstox candles':'')+'</p>';
      if(outside||partial||missingDays){
        output.innerHTML='<strong>Incomplete history for '+periodLabel+'</strong>'+coverage+'<p>'+ (missingDays?missingDays+' exchange reports still need recovery.':partial?'Exact entry or exit candles are missing for '+missing+' setups.':'The requested dates extend beyond the available archive.')+' Available exchange history: '+displayDates(range[0]+' – '+range.at(-1))+'. Choose a covered period to calculate P&amp;L.</p>';return;
      }
      if(!trades.length){output.innerHTML=coverage+'<p>No verified fills for this selection.</p>';return;}
      const nets=trades.map(t=>t.net),wins=nets.filter(n=>n>0).length;
      const metrics=[['Net P&L',money(cum)],['Max drawdown',money(drawdown)],['Best trade',money(Math.max(...nets))],['Worst trade',money(Math.min(...nets))],['Win rate',(100*wins/trades.length).toFixed(1)+'%'],['Wins / trades',wins+' / '+trades.length],[study?'Costs + slippage':'Total charges',money(trades.reduce((sum,t)=>sum+t.charges,0))]];
      if(study){
        for(const [name,start,stop] of [['Development','2022','2025'],['2025 onward','2025','9999']]){
          const sample=trades.filter(t=>t.d>=start&&t.d<stop);
          metrics.push([name+' · '+sample.length+' trades',sample.length?money(sample.reduce((s,t)=>s+t.net,0)):'—']);
        }
      }
      output.innerHTML=coverage+(study?note(metrics.slice(-2).map(([k,v])=>k+' '+v).join(' · ')):'')+'<div id="results"></div>';
      const p={id:rule+side+action,s:rule+' '+side,side:action,from,to,source:custom?'Upstox · minute candles':'NSE F&O · open to close',stop:0,slip:0};
      let high=0;
      for(const t of trades){high=Math.max(high,t.cum);Object.assign(t,{dd:t.cum-high,entryDay:t.d,s:'NIFTY '+t.strike+' '+t.contractSide+' '+t.expiry,side:action,entry:custom?entry:'09:15',exit:custom?exit:'15:30',reason:custom?'Timed exit':'Session close'});}
      lastMonth='';lastRun={p,trades,net:cum,dd:-drawdown,win:100*wins/trades.length,skipped:[]};showResults();
    }
    page.oninput=e=>{
      if(e.target.name==='strategy' && researchMode()){
        field('period').value='All history';field('mode').value='Open to close';period();
      }
      if(e.target.name==='period')period();
      if(['from','to'].includes(e.target.name))field('period').value='Custom';
      render();
    };
    field('strategy').value=String(initial);
    if(researchMode())field('period').value='All history';
    const back=document.createElement('button');back.textContent='← Strategy library';back.onclick=historicalBacktest;page.prepend(back);
    period();render();
  } catch {page.textContent='Historical results could not be loaded. Reopen this page to retry.';}
}

async function expiryPutPage(){
  const app=$('app');
  app.innerHTML=heading('Historical Backtest','NIFTY · pre-expiry short put','Sell the nearest-expiry ATM put one calendar day before its listed expiry.','<a href="#historical">Strategy library</a>')+'<section class="panel" id="expiryStudy">Loading exchange history…</section>';
  const panel=$('expiryStudy');
  try{
    const archive=await dailyModels();
    if(!panel.isConnected)return;
    const days=Object.keys(archive).filter(d=>d>='2022-01-01' && archive[d]?.length).sort();
    if(!days.length)throw Error('No exchange history available.');
    const first='2022-01-01',last=days.at(-1);
    const bounds='min="'+first+'" max="'+last+'"';
    panel.innerHTML='<form id="expiryForm"><div class="fields">'+input('From','expiryFrom',first,'date',bounds)+input('Through','expiryTo',last,'date',bounds)+input('Lots','expiryLots',1,'number','min="1" step="1"')+'</div><button class="primary">Show results</button></form><p>The prior close selects the ATM strike. Sell at the reported opening premium and buy back at the reported closing premium. One trade per eligible session, with no stop or intraday target. A weekend or holiday directly before expiry produces no entry.</p><p>Costs are modelled at ₹20 per order plus 0.20% of premium turnover and 0.5 points of adverse slippage per fill. Reported closes are execution proxies. Historical margin and intraday drawdown are unavailable. An unhedged short put can lose substantially more than its premium.</p><div id="expiryResults" aria-live="polite"></div>';
    function render(){
      const from=$('expiryFrom').value,to=$('expiryTo').value,lots=$('expiryLots').valueAsNumber,out=$('expiryResults');
      if(!from||!to||from>to||from<first||to>last||!Number.isSafeInteger(lots)||lots<1){out.textContent='Choose dates inside the archive and a positive whole number of lots.';return}
      const trades=[],quarters=new Map();
      let net=0,high=0,drawdown=0,gross=0,cost=0;
      for(const d of days){
        if(d<from||d>to)continue;
        const r=archive[d].find(x=>x[1]==='ATM'&&x[2]==='PE');
        if(!r||Date.parse(r[3])-Date.parse(d)!==86400000)continue;
        const qty=lots*r[7],profit=(r[5]-r[6])*qty,friction=40+0.002*(r[5]+r[6])*qty+qty;
        const gain=profit-friction;
        gross+=profit;cost+=friction;net+=gain;high=Math.max(high,net);drawdown=Math.max(drawdown,high-net);
        trades.push({d,net,gain,r,qty,friction,tip:d+' · Trade '+cash(gain)+' · Total '+cash(net)});
        const q=d.slice(0,4)+' Q'+Math.ceil(Number(d.slice(5,7))/3);
        quarters.set(q,(quarters.get(q)||0)+gain);
      }
      if(!trades.length){out.textContent='No qualifying archived trades in these dates.';return}
      const wins=trades.filter(t=>t.gain>0).length;
      out.innerHTML='<h2>Net P&amp;L</h2>'+table(['Gross','Costs + slippage','Net','Close-to-close drawdown','Wins / trades'],[[cash(gross),cash(cost),cash(net),cash(-drawdown),wins+' / '+trades.length]])+plot(trades,'net')+'<h2>Quarterly results</h2>'+table(['Quarter','Net P&L'],Array.from(quarters,([q,v])=>[q,cash(v)]).reverse())+'<h2>Trades</h2>'+table(['ID','Date','Expiry','PE strike','Units','Sell open','Buy close','Costs + slippage','Net P&L'],trades.map(({d,r,qty,friction,gain},i)=>['T/'+(i+1),displayDates(d),displayDates(r[3]),fmt(r[4]),qty,fmt(r[5]),fmt(r[6]),cash(friction),cash(gain)]).reverse());
      if(from<='2023-06-28'&&to>='2023-06-27')out.insertAdjacentHTML('beforeend',note('June 2023 expiry was revised on 27 June. The archive retains the expiry printed that day and has no selection on 28 June.'));
    }
    $('expiryForm').onsubmit=e=>{e.preventDefault();render()};render();
  }catch(e){if(panel.isConnected)panel.textContent='Could not load option history. Reopen this strategy to retry.'}
}
