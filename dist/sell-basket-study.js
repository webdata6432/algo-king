const sellBasketAssets = {
  sensex: 'research/sensex-points-3c5909e09c53a1be950f.gz',
  premiums: 'research/sensex-premiums-80e87170f8ef5d4f408a.gz',
  stocks: 'research/sector-cash-4bd3399281264e6677ed.gz'
};
const equityBasketRules = {
  'Opening volume continuation': 'At 09:45, follow the opening move when at least 55% of the observed universe agrees. Require a 1% move and at least 1.5 times typical opening volume.',
  'Opening volume reversal': 'Use the same 09:45 breadth, move and volume filters as opening continuation, then trade against the selected moves.',
  'Gap rejection': 'At 09:45, follow the opening half-hour against an overnight gap of at least 1%. Require a 0.35% opening move and at least typical opening volume.',
  'Gap continuation': 'At 09:45, follow an overnight gap of at least 1% when the first half-hour moves at least 0.35% in the same direction on at least typical volume.',
  'Prior-day pullback': 'In an uptrend, buy the previous session’s strongest intraday decliners. In a downtrend, sell the strongest gainers. Enter at the first regular print.',
  'Prior-day breakout': 'In an uptrend, buy the previous session’s strongest intraday gainers. In a downtrend, sell the strongest decliners. Enter at the first regular print.',
  'Prior-day losers buy': 'Before the open, select the largest previous-session open-to-close declines, one per sector. Buy at the first regular print.',
  'Two-source weakness at 09:15': 'Replay the same pre-open short basket at 09:15 with FYERS minute candles. Use Upstox minute history by ISIN on stock dates missing from FYERS.',
  'Two-source weakness at 09:16': 'Replay the same pre-open short basket at 09:16 with FYERS minute candles. Use Upstox minute history by ISIN on stock dates missing from FYERS.',
  'FYERS weakness at 09:15': 'Replay the same persistent-weakness sector basket using FYERS one-minute prints from 09:15, with minute-level stops, targets and an exit at 14:45.',
  'FYERS weakness at 09:16': 'Use the same names chosen before the open and enter one minute later at 09:16. Replay stops and targets on the FYERS minute candles, exiting at 14:45.',
  'Persistent intraday strength': 'Buy four or five sector leaders at the open. In the previous 20 complete sessions the stock must have gained from the open to 14:45 on at least 12 days, with mean gain at least 0.25% after clipping each return to ±5%. Rank by that mean.',
  'Persistent intraday weakness': 'Sell four or five sector laggards at the open. In the previous 20 complete sessions the stock must have fallen from the open to 14:45 on at least 12 days, with mean decline at least 0.25% after clipping each return to ±5%. Rank by that mean decline.',
  'Sector pairs continuation': 'At 09:45, buy two sector-relative leaders and sell two laggards across four sectors. Each must move at least one percentage point relative to its sector median on typical or higher opening volume.',
  'Sector pairs reversal': 'Use the same four sector-relative outliers at 09:45. Buy the two laggards and sell the two leaders across four different sectors.',
  'Prior-day gainers sell': 'Before the open, select the largest previous-session open-to-close advances, one per sector. Sell at the first regular print.'
};
function sectorSellSummary(model, fields, from, to, options, lots, expiryDays) {
  const sessions = model.sessions.filter(([date]) => date >= from && date <= to && (!expiryDays || expiryDays.has(date)));
  const fills = [], daily = new Map();
  let gross = 0, fees = 0, slip = 0, partialNet = 0, partialFills = 0;
  const fixedCharge = model.structure === 'unhedged' ? 47.2 : 94.4;
  for (const row of model.fills) {
    if (row[0] < from || row[0] > to || (expiryDays && !expiryDays.has(row[0]))) continue;
    const trade = Object.fromEntries(fields.map((field, i) => [field, row[i]]));
    if (!options && !trade.complete_basket) { partialNet+=trade.net; partialFills++; continue; }
    if (options && lots > 1) {
      trade.qty *= lots;
      if (trade.expiry_risk != null) trade.expiry_risk *= lots;
      trade.gross *= lots;
      trade.slippage *= lots;
      trade.fees = fixedCharge + lots * (trade.fees - fixedCharge);
      trade.net = trade.gross - trade.fees - trade.slippage;
    }
    fills.push(trade);
    gross += trade.gross;
    fees += trade.fees;
    slip += trade.slippage;
    daily.set(trade.date, (daily.get(trade.date) || 0) + trade.net);
  }
  let net = 0, peak = 0, dd = 0;
  const curve = Array.from(daily).sort(([a], [b]) => a.localeCompare(b)).map(([d, amount]) => {
    net += amount;
    peak = Math.max(peak, net);
    dd = Math.max(dd, peak - net);
    return {d, amount, net, tip: d + ' · Day ₹' + fmt(amount) + ' · Total ₹' + fmt(net)};
  });
  const noSignal = sessions.filter(([, status]) => ['no cross', 'flat open', 'no basket'].includes(status)).length;
  const gaps = sessions.filter(([, status]) => !['no cross','flat open','no basket','filled','basket complete'].includes(status));
  return {sessions, fills, curve, net, dd, fees, slip, gross, gaps, noSignal, partialNet, partialFills, wins: fills.filter(r=>r.net>0).length};
}
async function sellBasketPage(kind) {
  const options = kind === 'sensex';
  const app = $('app');
  app.innerHTML = heading('Historical Backtest', options ? 'SENSEX option selling' : 'NIFTY 500 stock baskets',
    options ? 'Full-day sells and premium crossings with fixed stops.' : 'Four or five stocks from different sectors per basket, with ₹1 lakh allocated across five slots.',
    '<a href="#historical">Strategy library</a>') + '<section id="sellBasketForm" class="panel" aria-live="polite">Loading results…</section><section class="panel" id="sellBasketResults"></section>';
  const form = $('sellBasketForm');
  try {
    const sources = await Promise.all((options ? [sellBasketAssets.sensex,sellBasketAssets.premiums] : [sellBasketAssets.stocks]).map(privateArchiveJSON));
    const data = {...sources[0], models:sources.flatMap(s=>s.models)};
    if (!form.isConnected) return;
    const rules = [...new Set(data.models.map(m=>m.rule))];
    const start = options ? '2025-07-17' : '2025-11-28', end = '2026-11-27';
    const periodDates = options ? {
      'Latest year': ['2025-11-28',end], 'Earlier year': [start,'2026-07-16']
    } : {'Latest year': [start,end], 'Development': [start,'2026-05-27'], 'Later test': ['2026-05-28',end]};
    form.innerHTML = (options ? '<div class="actions"><button type="button" id="sbHedge">Expiry-day PE hedge</button><button type="button" id="sbPremium">Premium crossing</button><button type="button" id="sbFull">Full-day PE</button><a class="btn" href="#sensex-atm-five">Five-year ATM CE / PE</a></div>' : '') + '<div class="fields">' + select('Strategy','sbRule',rules) +
      (options ? select('Position','sbWing',['unhedged','100-point hedge','300-point hedge','500-point hedge']) +
        select('Trading days','sbDays',['All sessions','Expiry days only']) +
        select('Stop · points','sbStop',['30','40']) + select('Time exit · IST','sbTime',['15:29','15:24']) +
        input('Lots','sbLots',1,'number','min="1" max="100" step="1"') : '') +
      select('Period','sbPeriod',[...Object.keys(periodDates),'Custom']) +
      input('From','sbFrom','2025-11-28','date','min="'+start+'" max="'+end+'"') + input('Through','sbTo',end,'date','min="'+start+'" max="'+end+'"') + '</div>';
    $('sbRule').value = options ? 'Nearest premium below 300' : (data.selected || rules[0]);
    const out = $('sellBasketResults');
    function show() {
      const from = $('sbFrom').value, to = $('sbTo').value, lots = options ? Number($('sbLots').value) : 1;
      if (!from || !to || from < start || to > end || from > to || !Number.isInteger(lots) || lots<1 || lots>100) {
        out.textContent = 'Choose dates within the study and a valid number of lots.'; return;
      }
      const rule = $('sbRule').value;
      const current = data.models.find(m=>m.rule===rule && (!options || (m.cutoff===$('sbTime').value && m.sl===Number($('sbStop').value) && m.structure===$('sbWing').value)));
      const expiryDays = options && $('sbDays').value==='Expiry days only' ? new Set(sources[1].expiries) : null;
      const s = sectorSellSummary(current,data.fields,from,to,options,lots,expiryDays);
      const amount = x => s.fills.length ? cash(x) : '—';
      const text = options ?
        (rule.startsWith('Nearest') ? 'For the nearest expiry, fix the call and the put whose observed 09:15 premium is closest at or above the chosen level. Require the adjacent OTM strike below that level. Sell the first side to close below it on a one-minute bar if its next open remains below. CE wins a simultaneous confirmed close.' : rule.startsWith('Cross') ? 'Fix the nearest-expiry ATM call and put after 09:15. Sell the first side whose one-minute close crosses below the level and whose next open is still below it. CE takes priority on a simultaneous confirmed close.' :
        'Fix the nearest-expiry ATM strike from the completed 09:15 minute. Sell at 09:16. The opening-direction rule sells a put after a green minute or a call after a red one.') +
        ' One entry per day. Stop on the short premium, with adverse gaps filled at the opening price. For a hedged position buy a same-expiry wing. After a short stop the wing exits at the next minute open. Open positions close at the selected time. Historical broker margin is unavailable. The spread width describes expiry risk, and actual capital required can differ. FYERS generally starts F&O auto-square-off at 15:25.' :
        equityBasketRules[rule] + ' Up to five sectors, one stock per slot, each capped at one fifth of the smaller of ₹1 lakh and prior strategy capital. Share quantity uses the last known price with a buffer. Use the dated index-fund universe, liquid stocks and a 1% stop, 2% target or 14:45 exit. If both levels occur within one candle the stop is counted first. ' +
        (data.selected ? 'The development-period selection was '+data.selected+'.' : 'No model met the minimum development sample.');
      const totals = [['Net P&L',amount(s.net)],['Max day-close drawdown',amount(-s.dd)],['Winning trades',s.wins+' / '+s.fills.length],
        ['Priced trading days',s.curve.length+' / '+s.sessions.length],['No signal',s.noSignal],['Unpriced days',s.gaps.length],
        ['Gross P&L',amount(s.gross)],['Charges',amount(s.fees)],['Slippage',amount(s.slip)]];
      if (options && current.structure!=='unhedged' && s.fills.length) {
        const maxRisk=Math.max(...s.fills.map(t=>t.expiry_risk));
        totals.push(['Highest expiry payoff loss at entry, before charges','₹'+fmt(maxRisk)]);
      }
      if (!options) {
        const exposure=new Map();
        for (const t of s.fills) exposure.set(t.date,(exposure.get(t.date)||0)+t.qty*t.entry_fill);
        if(exposure.size) totals.push(['Largest daily entry value','₹'+fmt(Math.max(...exposure.values()))]);
        totals.push(['Return on ₹1 lakh',s.fills.length?pct(s.net/1000):'—']);
        if(s.partialFills) totals.push(['Known net on excluded partial days',cash(s.partialNet)+' · '+s.partialFills+' fills']);
      }
      out.innerHTML='<h2>'+esc(rule)+'</h2><p>'+esc(text)+'</p>'+metrics(totals)+'<h3>Net P&amp;L</h3>'+plot(s.curve,'net');
      if (options) {
        const grid=rules.map(name=>{
          const values=[30,40].map(sl=>{
            const model=data.models.find(m=>m.rule===name && m.sl===sl && m.structure===current.structure && m.cutoff===current.cutoff);
            const stat=sectorSellSummary(model,data.fields,from,to,true,lots,expiryDays);
            return [stat.fills.length?cash(stat.net):'—',stat.fills.length+' / '+stat.sessions.length];
          });
          return [esc(name),...values[0],...values[1]];
        });
        out.insertAdjacentHTML('beforeend','<details open><summary>30 vs 40 point stop</summary>'+table(['Sell rule','30 pt · net','Trades / sessions','40 pt · net','Trades / sessions'],grid)+'</details>');
      } else {
        const comparison=data.models.map(m=>{
          const stat=sectorSellSummary(m,data.fields,from,to,false,1,null);
          return [esc(m.rule),stat.curve.length,stat.fills.length,stat.gaps.length,stat.fills.length?cash(stat.net):'—',stat.fills.length?cash(-stat.dd):'—'];
        });
        out.insertAdjacentHTML('beforeend','<details><summary>Compare stock basket rules</summary>'+table(['Rule','Active days','Trades','Unpriced days','Net','Drawdown'],comparison)+'</details>');
      }
      const months = new Map();
      for (const day of s.curve) {
        const key=day.d.slice(0,7), item=months.get(key)||[0,0];
        item[0]++; item[1]+=day.amount; months.set(key,item);
      }
      if (months.size) {
        const max=Math.max(1,...Array.from(months.values(), v=>Math.abs(v[1])));
        const monthRows=[...months].reverse().map(([k,v])=>{
          const rgb=v[1]>=0?'50,186,140':'219,85,97', alpha=(.10+.45*Math.abs(v[1])/max).toFixed(2);
          return [k.slice(5)+'-'+k.slice(0,4),v[0],'<span style="display:inline-block;padding:.2em .55em;border-radius:4px;background:rgba('+rgb+','+alpha+')">'+cash(v[1])+'</span>'];
        });
        out.insertAdjacentHTML('beforeend','<details><summary>Monthly P&amp;L</summary>'+table(['Month','Active days','Net'],monthRows)+'</details><details><summary>Day-wise P&amp;L</summary>'+table(['Date','Day net','Total net'],s.curve.slice().reverse().map(r=>[displayDates(r.d),cash(r.amount),cash(r.net)]))+'</details>');
      }
      if (s.gaps.length) out.insertAdjacentHTML('beforeend','<details><summary>Unpriced dates ('+s.gaps.length+')</summary>'+table(['Date','Reason'],s.gaps.map(r=>[displayDates(r[0]),esc(r[1])]))+'</details>');
      if (!options && rule===data.selected) {
        const timing=data.timing.filter(t=>t.fromDate===from && t.through===to);
        const matched=data.matched.filter(t=>t.start===from && t.end===to);
        if(timing.length) out.insertAdjacentHTML('beforeend','<h3>Entry time check</h3><p>The same stock selection is replayed with the displayed entry time and candle source. Each row uses its own observable complete baskets.</p>'+table(['Entry IST','Source','Complete days','Unpriced days','Net','Drawdown','Double slippage net'],timing.map(t=>[esc(t.entry),esc(t.source),t.days,t.missing,cash(t.net),cash(-t.drawdown),cash(t.stress)])));
        if(matched.length) out.insertAdjacentHTML('beforeend','<h3>09:15 and 09:16 on matching days</h3>'+table(['Minute candles','Same complete baskets','09:15 net','09:16 net'],matched.map(t=>[esc(t.source),Number(t.same_basket_days),cash(Number(t.net_at_0915)),cash(Number(t.net_at_0916))])));
      }
      if (!options) {
        const perStock = new Map();
        s.fills.forEach(t=>{const a=perStock.get(t.symbol)||[0,0,0];a[0]++;a[1]+=t.net>0;a[2]+=t.net;perStock.set(t.symbol,a)});
        out.insertAdjacentHTML('beforeend','<details><summary>Stock-by-stock P&amp;L</summary>'+table(['Stock','Trades','Wins','Net'],[...perStock].sort((a,b)=>b[1][2]-a[1][2]).map(([k,v])=>[esc(k),v[0],v[1],cash(v[2])]))+'</details>');
      }
      const headers=options?['ID','Date','Expiry','Sell','Hedge strike','Qty','Entry','Short exit','Hedge exit','Short ₹ entry → exit','Hedge ₹ entry → exit','Reason','Net']:
        ['ID','Date','Stock','Sector','Side','Qty','Entry','Exit bar · IST','Fill ₹ entry → exit','Reason','Net'];
      const rows=s.fills.map((t,i)=>options?['T/'+(i+1),displayDates(t.date),displayDates(t.expiry),t.strike+' '+esc(t.side),t.hedge_strike||'—',t.qty,t.entry,t.exit,t.hedge_exit_time||'—',fmt(t.short_entry)+' → '+fmt(t.short_exit),t.hedge_strike?fmt(t.hedge_entry)+' → '+fmt(t.hedge_exit):'—',esc(t.reason),cash(t.net)]:
        ['T/'+(i+1),displayDates(t.date),esc(t.symbol),esc(t.sector),esc(t.side),t.qty,t.entry_time,t.exit_bar_start,fmt(t.entry_fill)+' → '+fmt(t.exit_fill),esc(t.reason),cash(t.net)]).reverse();
      out.insertAdjacentHTML('beforeend','<h3>Trade log</h3>'+table(headers,rows));
    }
    form.onchange = e => {
      if (e.target.id==='sbPeriod' && periodDates[e.target.value]) {
        [$('sbFrom').value,$('sbTo').value]=periodDates[e.target.value];
      } else if (['sbFrom','sbTo'].includes(e.target.id)) $('sbPeriod').value='Custom';
      show();
    };
    if (options) {
      function preset(rule, wing, days, time) {
        $('sbRule').value=rule; $('sbWing').value=wing;
        $('sbDays').value=days; $('sbTime').value=time;
        show();
      }
      $('sbHedge').onclick=()=>preset('Full day PE','500-point hedge','Expiry days only','15:24');
      $('sbPremium').onclick=()=>preset('Nearest premium below 300','unhedged','All sessions','15:29');
      $('sbFull').onclick=()=>preset('Full day PE','unhedged','All sessions','15:29');
      $('sbPeriod').value='Earlier year';
      [$('sbFrom').value,$('sbTo').value]=periodDates['Earlier year'];
      $('sbHedge').onclick();
    } else show();
  } catch (err) {
    if (form.isConnected) form.textContent = 'Unable to open this private study. '+err.message;
  }
}

async function sensexFivePage() {
  const app = $('app');
  app.innerHTML = heading('Historical Backtest','SENSEX full-day ATM sells',
    'One nearest-expiry contract at 09:16 IST. Compare the call and put separately after costs.',
    '<a href="#sensex-sell">SENSEX strategies</a>') + '<section class="panel" id="fiveControls">Loading verified trades…</section><section class="panel" id="fiveResults" aria-live="polite"></section>';
  const form = $('fiveControls'), output = $('fiveResults');
  try {
    const data = await privateArchiveJSON('research/sensex-atm-five-227d12e5b1db5f3b2422.gz');
    if (!form.isConnected) return;
    const end = '2026-11-27', start = '2021-11-28';
    form.innerHTML = '<div class="fields">' + input('From','fiveFrom',start,'date','min="'+start+'" max="'+end+'"') +
      input('Through','fiveTo',end,'date','min="'+start+'" max="'+end+'"') +
      select('Time exit · IST','fiveExit',['15:29','15:24']) + select('Option','fiveSide',['CE','PE']) +
      select('Stop · premium points','fiveStop',['30','40']) + input('Lots','fiveLots',1,'number','min="1" max="100" step="1"') +
      select('Compare dates','fiveCompare',['All priced dates','Only dates priced for all four']) + '</div>';
    function show() {
      const from=$('fiveFrom').value, to=$('fiveTo').value, lots=Number($('fiveLots').value);
      if (!from || !to || from<start || to>end || from>to || !Number.isInteger(lots) || lots<1 || lots>100) {
        output.textContent='Choose valid dates in the study and 1–100 lots.'; return;
      }
      const variants=data.models.filter(m=>m.cutoff===$('fiveExit').value);
      const commonOnly=$('fiveCompare').selectedIndex===1;
      const daySets=variants.map(m=>new Set(m.fills.map(f=>f[0])));
      const common=commonOnly?new Set(data.dates.filter(d=>daySets.every(set=>set.has(d)))):null;
      const expected=data.dates.filter(d=>from<=d && d<=to);
      const results=variants.map(model=>({model,stat:sectorSellSummary(model,data.fields,from,to,true,lots,common)}));
      const picked=results.find(r=>r.model.rule===$('fiveSide').value && r.model.sl===Number($('fiveStop').value));
      const {model,stat}=picked;
      const net=(values,value)=>values.length?cash(value):'—';
      const rows=results.map(({model:m,stat:s})=>[m.rule,m.sl,s.fills.length+' / '+expected.length,
        net(s.fills,s.net),net(s.fills,-s.dd),s.fills.length?s.wins+' / '+s.fills.length:'—']);
      output.innerHTML='<h2>Full-day comparison</h2>'+table(['Option','SL · pts','Trades / sessions','Net P&amp;L','Max drawdown','Wins / trades'],rows)+
        '<p>Unpriced dates carry unknown P&amp;L. Historical lot sizes and estimated charges apply. A 15:29 exit may fall after broker intraday square-off.</p>'+
        '<h2>'+model.rule+' sell · '+model.sl+' point SL</h2>'+metrics([['Net P&L',net(stat.fills,stat.net)],['Gross P&L',net(stat.fills,stat.gross)],['Charges',net(stat.fills,stat.fees)],['Slippage',net(stat.fills,stat.slip)]])+
        plot(stat.curve,'net');
      const years=[...new Set(expected.map(d=>d.slice(0,4)))];
      const annual=years.map(y=>[y,expected.filter(d=>d.startsWith(y)).length,...results.map(({stat:s})=>{
        const fills=s.fills.filter(f=>f.date.startsWith(y));
        return fills.length?cash(fills.reduce((total,f)=>total+f.net,0))+' · '+fills.length:'—';
      })]);
      output.insertAdjacentHTML('beforeend','<h3>Calendar years</h3>'+table(['Year','Sessions',...results.map(r=>r.model.rule+' '+r.model.sl+' · net / trades')],annual));
      const gapMap=new Map(model.sessions);
      const gaps=expected.filter(d=>gapMap.get(d)!=='filled'||(common&&!common.has(d))).map(d=>[displayDates(d),esc(gapMap.get(d)==='filled'?'Another variant lacks price data':gapMap.get(d))]);
      if(gaps.length) output.insertAdjacentHTML('beforeend','<details><summary>Excluded dates ('+gaps.length+')</summary>'+table(['Date','Reason'],gaps)+'</details>');
      const log=stat.fills.map((t,i)=>['T/'+(i+1),displayDates(t.date),displayDates(t.expiry),fmt(t.spot),t.strike,t.qty,t.entry,t.exit,fmt(t.short_entry),fmt(t.short_exit),esc(t.reason),cash(t.net)]).reverse();
      output.insertAdjacentHTML('beforeend','<h3>Trade log</h3>'+table(['ID','Date','Expiry','Spot','ATM strike','Qty','Entry','Exit','Sell fill','Buyback','Exit reason','Net'],log));
    }
    form.onchange=show; show();
  } catch(err) { if(form.isConnected) form.textContent='Unable to load the SENSEX report. '+err.message; }
}
