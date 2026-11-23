async function historicalBacktest() {
  const page = document.createElement('section');
  page.className = 'panel';
  document.getElementById('app').replaceChildren(page);
  page.innerHTML = '<h1>Historical Backtest</h1><p>NIFTY weekly options · NSE F&O daily reports</p><label>Lots <input type="number" min="1" step="1" value="1"></label><div class="historyResults" aria-live="polite">Loading results…</div>';
  const lots = page.querySelector('input');
  const output = page.querySelector('.historyResults');
  const money = n => n.toLocaleString('en-IN', {style:'currency',currency:'INR',maximumFractionDigits:2});
  const date = s => s.split('-').reverse().join('-');
  try {
    const response = await fetch('market/historical.json');
    if (!response.ok) throw Error();
    const archive = await response.json();
    const sessions = Object.keys(archive).sort();
    const all = sessions.flatMap(d => archive[d]);
    const strategies = [['S1','ATM','CE','Sell'],['S2','ATM','PE','Sell'],['S3a','ATM','CE','Buy'],['S3b','ATM','PE','Buy'],['S4a','Under 200','CE','Sell'],['S4b','Under 200','PE','Sell'],['S5a','Near 300','CE','Sell'],['S5b','Near 300','PE','Sell']];
    function render() {
      const qty = lots.valueAsNumber;
      if (!Number.isSafeInteger(qty) || qty < 1) {output.textContent='Enter a positive whole number of lots.';return;}
      const lines = strategies.map(([id,rule,side,action]) => {
        const rows = all.filter(r=>r[1]===rule && r[2]===side);
        const pnl = r => (action==='Buy'?1:-1)*(r[6]-r[5])*r[7]*qty;
        const results = rows.map(pnl);
        const log = rows.slice().reverse().map(r=>'<tr>'+[date(r[0]),date(r[3]),r[4],r[7],r[5],r[6],money(pnl(r))].map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('');
        return '<tr><td><details><summary>'+id+' · '+action+' '+side+' · '+rule+'</summary><table><thead><tr><th>Date</th><th>Expiry</th><th>Strike</th><th>Units/lot</th><th>Open</th><th>Close</th><th>Gross P&L</th></tr></thead><tbody>'+log+'</tbody></table></details></td><td>'+rows.length+'</td><td>'+results.filter(n=>n>0).length+'</td><td>'+money(results.reduce((a,b)=>a+b,0))+'</td><td>'+(rows.length?money(Math.max(...results)):'—')+'</td><td>'+(rows.length?money(Math.min(...results)):'—')+'</td></tr>';
      });
      output.innerHTML='<p>'+date(sessions[0])+' – '+date(sessions.at(-1))+' · '+sessions.length+' evaluated sessions</p><div style="overflow:auto"><table><thead><tr><th>Strategy / trade log</th><th>Trades</th><th>Wins</th><th>Total gross P&L</th><th>Best trade</th><th>Worst trade</th></tr></thead><tbody>'+lines.join('')+'</tbody></table></div><p>Strikes use the previous session’s close. ATM uses the nearest strike to NIFTY. Under ₹200 uses the closest lower premium and skips an opening premium of ₹200 or more. Near ₹300 selects the closest closing premium. Each model enters at the published open and exits at the published close. Premium changes include market moves and volatility. Gross results exclude fees and slippage.</p>';
    }
    lots.addEventListener('input',render);
    render();
  } catch {output.textContent='Historical results could not be loaded. Reopen this page to retry.';}
}
