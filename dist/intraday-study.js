const intradayStudyAsset = 'research/options-5bd18f4e189598d4f7ee.gz';
const intradayStrategies = {
  'directional-credit': ['Trend credit spread','If the previous completed minute closes above the session open, sell an ATM put and buy a put two strikes lower. Below the open, sell an ATM call and buy a call two strikes higher.'],
  'expiry-straddle': ['Short ATM straddle','On expiry days, sell the ATM call and put together. Both legs are unhedged. The short call has uncapped loss exposure.'],
  'expiry-iron-fly': ['Hedged iron fly','On expiry days, sell the ATM call and put together and buy protective call and put wings about 1% away.'],
  'expiry-otm': ['OTM expiry spread · win-rate study','At 10:29 IST compare spot with the session open. On strength, sell an OTM put and buy a lower put. On weakness use calls. Select the short strike at least 0.8 times the ATM straddle premium from spot. Hedge 100 NIFTY points or 300 SENSEX points farther out. Open at 10:30 and exit at 15:00.']
};

async function intradayStudyPage(){
  const app=$('app');
  app.innerHTML=heading('Historical Backtest','Intraday option studies','Compare results after estimated costs at the same dates and times.','<a href="#historical">Strategy library</a>')+'<section class="panel" id="studyControls" role="region">Opening the research report…</section><section class="panel" id="studyCompare"></section><div id="studyDetail"></div>';
  const panel=$('studyControls');
  try{
    const archive=await privateArchiveJSON(intradayStudyAsset);
    if(!panel.isConnected)return;
    const groups=[...new Set(archive.models.map(m=>m.strategy))];
    panel.innerHTML='<div class="fields"><label>Study<select id="isModel">'+groups.map(s=>'<option value="'+esc(s)+'">'+esc(intradayStrategies[s]?.[0]||s)+'</option>').join('')+'</select></label>'+select('Index','isIndex',['NIFTY','SENSEX'])+input('Lots','isLots',1,'number','min="1" step="1"')+select('Period','isPeriod',['Latest year','Historical year','Year to 21-07-2026','Custom'])+input('From','isFrom','','date')+input('Through','isThrough','','date')+'</div><p id="isRule"></p><p id="isCosts"></p>';
    let picked='';
    const money=v=>v==null?'—':cash(v);
    const tm=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
    const highWin=()=>$('isModel').value==='expiry-otm';
    const ranges=()=>highWin()?archive.hedgeRanges:archive.rrRanges;
    function dates(){
      const rr=ranges(),period=$('isPeriod'),july=period.querySelector('option:nth-child(3)');
      july.hidden=july.disabled=!rr.july;
      if(!rr.july&&period.value==='Year to 21-07-2026')period.value='Historical year';
      const preset=period.value==='Latest year'?rr.recent:period.value==='Year to 21-07-2026'?rr.july:rr.year;
      for(const [id,val] of [['isFrom',preset.from],['isThrough',preset.to]]){
        const f=$(id);f.min=[rr.year.from,rr.recent.from].sort()[0];f.max=[rr.year.to,rr.recent.to].sort().at(-1);
        if($('isPeriod').value!=='Custom')f.value=val;
      }
    }
    function summarize(model,from,to,split,lots){
      const fixed=model.fixedFees;
      const trades=model.trades.filter(r=>r[0]>=from&&r[0]<=to).map(r=>{
        if(lots===1)return r;
        const scaled=[...r];scaled[5]*=lots;scaled[12]*=lots;scaled[13]=fixed+(r[13]-fixed)*lots;
        scaled[14]*=lots;scaled[15]=scaled[12]-scaled[13]-scaled[14];return scaled;
      });
      const skips=model.skips.filter(([d])=>d>=from&&d<=to);
      let net=0,peak=0,dd=0,wins=0,early=0,late=0,earlyN=0,lateN=0,gross=0,fees=0,slip=0;
      const curve=trades.map(t=>{
        const v=t[15];gross+=t[12];fees+=t[13];slip+=t[14];net+=v;peak=Math.max(peak,net);dd=Math.min(dd,net-peak);
        if(v>0)wins++;
        if(t[0]<split){early+=v;earlyN++;}else{late+=v;lateN++;}
        return {d:t[0],v:net,tip:t[0]+' · Net ₹'+fmt(v)+' · Total ₹'+fmt(net)};
      });
      const missing=skips.filter(([,s])=>!['not expiry','flat opening','no signal','not expiry session'].includes(s.toLowerCase()));
      const noSignal=skips.filter(([,s])=>['flat opening','no signal'].includes(s.toLowerCase())).length;
      return {model,trades,curve,skips,missing,net,dd,wins,early,late,earlyN,lateN,gross,fees,slip,eligible:trades.length+missing.length+noSignal};
    }
    function showDetail(s){
      const {model:m,trades:t}=s, detail=$('studyDetail');
      const pct=t.length?(100*s.wins/t.length).toFixed(1)+'%':'—';
      const entryToExit=m.entry+'–'+m.exit+' IST';
      const quarterly=new Map();
      for(const row of t){const key=row[0].slice(0,4)+' Q'+Math.ceil(Number(row[0].slice(5,7))/3);quarterly.set(key,(quarterly.get(key)||0)+row[15])}
      detail.innerHTML='<section class="panel"><h2>'+esc(m.symbol)+' · '+esc(intradayStrategies[m.strategy]?.[0]||m.strategy)+'</h2><p>'+entryToExit+(m.rr?' · 1:'+m.rr:'')+' · '+$('isLots').value+' lot(s)</p>'+metrics([['Net P&L',t.length?money(s.net):'—'],['Win rate',pct],['Maximum closed-trade drawdown',t.length?money(s.dd):'—'],['Gross P&L',t.length?money(s.gross):'—'],['Estimated charges',t.length?money(s.fees):'—'],['Estimated slippage',t.length?money(s.slip):'—'],['Wins / priced trades',s.wins+' / '+t.length],['Worst trade',t.length?money(Math.min(...t.map(r=>r[15]))):'—']])+plot(s.curve,'v')+'</section>'
        +'<section class="panel"><h2>Coverage</h2><p>'+t.length+' priced trades across '+s.eligible+' eligible sessions. '+s.missing.length+' sessions excluded for missing or unusable data.</p>'+ (s.missing.length?'<details><summary>Excluded dates</summary>'+table(['Date','Reason'],s.missing.map(([d,w])=>[displayDates(d),esc(w)]).reverse())+'</details>':'')+'</section>'
        +'<section class="panel"><h2>Quarterly net P&amp;L</h2>'+table(['Period','Net'],Array.from(quarterly,([q,v])=>[q,money(v)]).reverse())+'</section>'
        +'<section class="panel"><h2>Trade log</h2>'+table(['Trade','Date','Expiry','Units','Legs · entry → exit premiums','Entry','Exit','Reason','Gross','Charges','Slippage','Net','Candle source'],t.map((r,i)=>{
          const parts=['Sell '+r[3]+' '+r[2]+' · '+fmt(r[6])+' → '+fmt(r[9])];
          const multiShort=['expiry-straddle','expiry-iron-fly'].includes(m.strategy);
          parts.push((multiShort?'Sell ':'Buy ')+r[4]+' '+(multiShort?'PE':r[2])+' · '+fmt(r[7])+' → '+fmt(r[10]));
          if(m.strategy==='expiry-iron-fly'){
            parts.push('Buy '+r[19]+' CE · '+fmt(r[21])+' → '+fmt(r[23]));
            parts.push('Buy '+r[20]+' PE · '+fmt(r[22])+' → '+fmt(r[24]));
          }
          return ['T/'+(i+1),displayDates(r[0]),displayDates(r[1]),r[5],parts.map(esc).join('<br>'),m.entry,tm(r[8]),esc(r[11]),money(r[12]),money(r[13]),money(r[14]),money(r[15]),esc(r[18])];
        }).reverse())+'</section>';
    }
    function render(){
      const from=$('isFrom').value,to=$('isThrough').value,range=ranges(),cmp=$('studyCompare');
      const lots=Number($('isLots').value);
      const kind=$('isModel').value,rule=intradayStrategies[kind]?.[1]||'';
      $('isRule').textContent=rule+(highWin()?'':' Risk is 20% of the entry credit. The profit trigger is 40% for 1:2 and 60% for 1:3. A trigger at a completed minute close exits at the next synchronized traded open. A time exit allows up to two minutes for a synchronized open.');
      $('isCosts').textContent=highWin()?'Estimated costs include brokerage and GST of ₹94.40 per spread, 0.20% of premium turnover and 0.5 points slippage on each of four fills.':'Per fill, costs assume ₹20 brokerage plus ₹3.60 GST on brokerage and 0.20% of premium turnover. Adverse slippage is the larger of 0.10% of premium and 0.5 NIFTY points or 1 SENSEX point. The realised loss can exceed the stop.';
      if(!Number.isSafeInteger(lots)||lots<1){cmp.textContent='Enter a positive whole number of lots.';$('studyDetail').replaceChildren();return}
      if(!from||!to||from>to||from<$('isFrom').min||to>$('isThrough').max){
        cmp.textContent='Choose dates within '+displayDates($('isFrom').min+' – '+$('isThrough').max)+'.';$('studyDetail').replaceChildren();return;
      }
      const preset=Object.values(range).find(r=>r.from===from&&r.to===to);
      const split=preset?.holdoutFrom||new Date((Date.parse(from)+Date.parse(to))/2+43200000).toISOString().slice(0,10);
      const results=archive.models.filter(m=>m.strategy===kind&&m.symbol===$('isIndex').value).map(m=>summarize(m,from,to,split,lots));
      const key=s=>[s.model.strategy,s.model.symbol,s.model.entry,s.model.exit,s.model.rr].join('/');
      const chosen=results.find(s=>key(s)===picked)||results[0];
      cmp.innerHTML='<h2>'+ (highWin()?'Win-rate study':'Entry and exit comparison')+'</h2><p>'+displayDates(from+' – '+to)+' · Early period ends before '+displayDates(split)+'. All totals include only priced trades. Lot changes assume the same fills and one order per leg at entry and exit.</p>'+table(['Entry','Exit','Risk / reward','Trades / eligible','Missing','Win rate','Early net','Later net','Net P&L','Drawdown','Details'],results.map((s,i)=>[s.model.entry,s.model.exit,s.model.rr?'1:'+s.model.rr:'Time exit',s.trades.length+' / '+s.eligible,s.missing.length,s.trades.length?(s.wins*100/s.trades.length).toFixed(1)+'%':'—',money(s.earlyN?s.early:null),money(s.lateN?s.late:null),money(s.trades.length?s.net:null),money(s.trades.length?s.dd:null),'<button type="button" data-study="'+i+'" aria-pressed="'+(s===chosen)+'">View</button>']));
      cmp.insertAdjacentHTML('beforeend','<button type="button" id="studyCsv">Download comparison CSV</button>');
      $('studyCsv').onclick=()=>{
        const headers=['Index','Strategy','From','Through','Later period starts','Lots','Entry IST','Exit IST','Reward per unit risk','Trades','Eligible sessions','Missing data','Net wins','Win rate %','Early net INR','Later net INR','Net P&L INR','Maximum closed-trade drawdown INR'];
        const rows=results.map(s=>[s.model.symbol,intradayStrategies[kind]?.[0]||kind,displayDates(from),displayDates(to),displayDates(split),lots,s.model.entry,s.model.exit,s.model.rr??'',s.trades.length,s.eligible,s.missing.length,s.wins,s.trades.length?(100*s.wins/s.trades.length).toFixed(2):'',s.earlyN?s.early.toFixed(2):'',s.lateN?s.late.toFixed(2):'',s.trades.length?s.net.toFixed(2):'',s.trades.length?s.dd.toFixed(2):'']);
        const csv=[headers,...rows].map(row=>row.map(cell=>'"'+String(cell).replaceAll('"','""')+'"').join(',')).join('\r\n');
        const url=URL.createObjectURL(new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}));
        const link=document.createElement('a');link.href=url;link.download='AlgoKing-'+$('isIndex').value+'-'+kind+'-'+from+'-'+to+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
      };
      if(highWin()&&$('isIndex').value==='NIFTY'){
        const b=archive.settlement,summary=b.annual;
        cmp.insertAdjacentHTML('beforeend','<details><summary>Separate NIFTY test · opening prints to expiry settlement</summary><p>'+displayDates(b.fromDate+' – '+b.toDate)+' · Fixed one-lot benchmark. The previous session selects the spread. Entry uses the two reported opening prices, which may occur at different times. Both options settle at expiry. Source: '+esc(b.source)+'.</p>'+table(['Priced / eligible expiries','Net wins','Win rate','Net after costs','Closed-trade drawdown'],[[summary.n+' / '+b.eligible,summary.wins,summary.rate.toFixed(2)+'%',cash(summary.net),cash(summary.dd)]])+'</details>');
      }
      if(chosen)showDetail(chosen);else $('studyDetail').replaceChildren();
      cmp.onclick=e=>{const btn=e.target.closest('[data-study]');if(!btn)return;const s=results[Number(btn.dataset.study)];picked=key(s);for(const b of cmp.querySelectorAll('[data-study]'))b.setAttribute('aria-pressed',String(b===btn));showDetail(s)};
    }
    $('isModel').onchange=()=>{dates();render()};$('isIndex').onchange=$('isLots').onchange=render;
    $('isPeriod').onchange=()=>{dates();render()};
    $('isFrom').onchange=$('isThrough').onchange=()=>{$('isPeriod').value='Custom';render()};
    dates();render();
  }catch(err){if(panel.isConnected)panel.textContent='Could not open the comparison. '+err.message}
}
