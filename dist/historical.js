async function historicalBacktest() {
  const page = document.createElement('section');
  page.className = 'panel';
  document.getElementById('app').replaceChildren(page);
  page.textContent = 'Loading historical trades…';
  try {
    async function read(url) {
      const res = await fetch(url);
      if (!res.ok) throw Error();
      return res.json();
    }
    const [archive, minutes] = await Promise.all([read('market/historical.json'), read('market/historical-minutes.json')]);
    const days = Object.keys(archive).sort();
    const end = days.at(-1);
    const strategies = [['S1','ATM','CE','Sell'],['S2','ATM','PE','Sell'],['S3a','ATM','CE','Buy'],['S3b','ATM','PE','Buy'],['S4a','Under 200','CE','Sell'],['S4b','Under 200','PE','Sell'],['S5a','Near 300','CE','Sell'],['S5b','Near 300','PE','Sell']];
    page.innerHTML = '<h1>Historical Backtest</h1><div class="fields"><label>Period<select name="period">'+['7D','15D','30D','1Y','Custom'].map(x=>'<option '+(x==='30D'?'selected':'')+'>'+x+'</option>').join('')+'</select></label><label>From<input type="date" name="from"></label><label>To<input type="date" name="to"></label><label>Session<select name="mode"><option>Open to close</option><option>Custom time</option></select></label><label hidden>Entry · IST<input name="entry" type="time" value="09:30"></label><label hidden>Exit · IST<input name="exit" type="time" value="15:15"></label><label>Lots<input name="lots" type="number" min="1" step="1" value="1"></label><label>Strategy<select name="strategy">'+strategies.map(([id,rule,side,act],i)=>'<option value="'+i+'">'+id+' · '+act+' '+side+' · '+rule+'</option>').join('')+'</select></label></div><div class="historyResults" aria-live="polite"></div>';
    const field = name=>page.querySelector('[name="'+name+'"]');
    const output = page.querySelector('.historyResults');
    function period() {
      if(field('period').value==='Custom')return;
      const n = ({'7D':7,'15D':15,'30D':30,'1Y':365})[field('period').value];
      field('from').value=new Date(Date.parse(end)-(n-1)*86400000).toISOString().slice(0,10);
      field('to').value=end;
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
      const dates=days.filter(d=>d>=from&&d<=to);
      const trades=[];let cum=0,peak=0,drawdown=0,missing=0;
      for(const day of dates){
        const row=archive[day].find(r=>r[1]===rule&&r[2]===side);
        if(!row)continue;
        const [,,,expiry,strike,open,close,unit]=row;
        let ep=open,xp=close;
        if(custom){
          const bars=minutes[[day,expiry,strike,side].join('/')];
          ep=bars?.[toMin(entry)-555]/100;xp=bars?.[toMin(exit)-555]/100;
          if(!(ep>0&&xp>0)){missing++;continue;}
          if(rule==='Under 200'&&ep>=200)continue;
        }
        const qty=lots*unit, gross=(action==='Buy'?1:-1)*(xp-ep)*qty;
        const charges=costs({fees:feeSchedule,side:action,qty},ep,xp),net=gross-charges;
        cum+=net;peak=Math.max(peak,cum);drawdown=Math.max(drawdown,peak-cum);
        trades.push({d:day,expiry,strike,qty,ep,xp,gross,charges,net,cum,id:trades.length+1,exit:custom?exit:'Close'});
      }
      const coverage='<p>NSE daily archive '+days[0]+' to '+end+' · '+dates.length+' archived sessions in range'+(custom?' · '+missing+' qualifying setups missing exact Upstox candles':'')+'</p>';
      if(!trades.length){output.innerHTML=coverage+'<p>No verified fills for this selection.</p>';return;}
      const nets=trades.map(t=>t.net),wins=nets.filter(n=>n>0).length;
      const metrics=[['Net P&L',money(cum)],['Max drawdown',money(drawdown)],['Best trade',money(Math.max(...nets))],['Worst trade',money(Math.min(...nets))],['Win rate',(100*wins/trades.length).toFixed(1)+'%'],['Wins / trades',wins+' / '+trades.length],['Total charges',money(trades.reduce((sum,t)=>sum+t.charges,0))]];
      const headings=['ID','Date','Contract','Qty','Entry IST','Entry ₹','Exit IST','Exit ₹','Gross','Charges','Net P&L','Total P&L'];
      const rows=trades.slice().reverse().map(t=>'<tr>'+['T/'+t.id,t.d,t.strike+' '+side+' · '+t.expiry,t.qty,custom?entry:'Open',fmt(t.ep),t.exit,fmt(t.xp),money(t.gross),money(t.charges),money(t.net),money(t.cum)].map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('');
      output.innerHTML=coverage+'<div class="fields">'+metrics.map(([k,v])=>'<div><small>'+k+'</small><h3>'+v+'</h3></div>').join('')+'</div>'+pnlChart(trades)+'<h3>Day-wise transaction details</h3><div style="overflow:auto"><table><thead><tr>'+headings.map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div><p>Nearest expiry and strike use the previous session’s close. Custom times use the traded minute’s opening premium. Charges use your backtester rates. Slippage excluded.</p>';
    }
    page.oninput=e=>{
      if(e.target.name==='period')period();
      if(['from','to'].includes(e.target.name))field('period').value='Custom';
      render();
    };
    period();render();
  } catch {page.textContent='Historical results could not be loaded. Reopen this page to retry.';}
}
