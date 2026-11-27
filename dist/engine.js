const toMin=t=>+t.slice(0,2)*60 + +t.slice(3,5);
const timeOf=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
function demoBars(symbol){
  let h=hash(symbol), rand=()=>((h=(Math.imul(h,1664525)+1013904223)>>>0)/4294967296);
  let rows=[],p={SENSEX:81100,RELIANCE:1450,TCS:3400}[symbol]||500+h%3000;
  for(let i=Date.parse('2026-09-01');i<=Date.parse(end);i+=86400000){
    let date=new Date(i),d=date.toISOString().slice(0,10);
    if([0,6].includes(date.getUTCDay()))continue;
    p*=1+(rand()-.49)*.009;
    for(let m=555;m<930;m++){
      let o=p,c=o*(1+(rand()-.499)*.0018);
      rows.push({d,m,o,c,h:Math.max(o,c)*(1+rand()*.0003),l:Math.min(o,c)*(1-rand()*.0003)});p=c;
    }
  }return rows;
}
function readCSV(text){
  let grid=[],row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){let c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}
    else if(c===','&&!quoted){row.push(cell.trim());cell=''}else if(c==='\n'&&!quoted){row.push(cell.trim());grid.push(row);row=[];cell=''}else cell+=c}
  if(quoted)throw Error('Unclosed CSV quote.');row.push(cell.trim());grid.push(row);return grid.filter(r=>r.some(Boolean))
}
function parseFile(text,symbol){
  const [head,...lines]=readCSV(text.replace(/^\uFEFF/,'')),keys=(head||[]).map(x=>x.toLowerCase());
  let minute=keys.includes('time'),needed=['date','open','close',...(minute?['high','low']:[])];
  if(!needed.every(k=>keys.includes(k)))throw Error('Required columns: '+needed.join(', '));
  let seen=new Set(),rows=lines.map((line,i)=>{let v=k=>line[keys.indexOf(k)]||'',d=v('date').replace(/^(\d{2})-(\d{2})-(\d{4})$/,'$3-$2-$1'),t=v('time');
    let invalid=()=>{throw Error('Invalid or duplicate candle at row '+(i+2)+'. Check the date, symbol, time and prices.')};
    if(keys.includes('symbol')&&v('symbol').toUpperCase()!==symbol)invalid();
    if(!/^\d{4}-\d\d-\d\d$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)invalid();
    if(minute&&!/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(t))invalid();
    let m=minute?toMin(t):null,o=+v('open'),c=+v('close'),h=minute?+v('high'):Math.max(o,c),l=minute?+v('low'):Math.min(o,c);
    if(![o,h,l,c].every(x=>Number.isFinite(x)&&x>0)||h<Math.max(o,c)||l>Math.min(o,c)||seen.has(d+'/'+m))invalid();
    seen.add(d+'/'+m);return {d,m,o,h,l,c,...Object.fromEntries(['spot','future','delta','indicator'].filter(k=>v(k)!==''&&Number.isFinite(+v(k))).map(k=>[k,+v(k)]))}
  }).sort((a,b)=>a.d.localeCompare(b.d)||a.m-b.m);
  if(!rows.length)throw Error('The file contains no candles.');return {minute,rows}
}
function dailyBars(rows){let out=[],prev=null;for(let r of rows){let last=out.at(-1);if(last?.d===r.d){last.c=r.c;Object.assign(last,bar(last.d,last.o,last.c,prev))}else{prev=last?.c;out.push(bar(r.d,r.o,r.c,prev))}}return out}
function simulate(rows,p){
  if(!(p.from<=p.to&&(p.holding==='Positional'||p.entry<p.exit)&&p.qty>0))throw Error('Check dates, quantity and times.');
  let groups=new Map();for(let r of rows)if(r.d>=p.from&&r.d<=p.to){if(!groups.has(r.d))groups.set(r.d,[]);groups.get(r.d).push(r)}
  let trades=[],skipped=[],cum=0,peak=0,dd=0;
  let busyUntil='';for(let [d,day] of groups){if(d<=busyUntil)continue;
    if(p.expiry && (d>p.expiry || (p.dte!=="" && p.dte!=null && (Date.parse(p.expiry)-Date.parse(d))/864e5!==+p.dte)))continue;
    if(p.expiry&&p.term&&p.term!=='Exact contract'){
      const day=new Date(d+'T00:00Z'),offset=(day.getUTCDay()+6)%7,delta=(Date.parse(p.expiry)-day.getTime())/86400000;
      if(p.term==='This week'&&(delta<0||delta>6-offset))continue;
      if(p.term==='Next week'&&(delta<7-offset||delta>13-offset))continue;
      if(p.term==='Monthly'&&(p.expiry!==p.latestExpiry||p.expiry.slice(0,7)!==d.slice(0,7)))continue;
    }
    let overnight=p.holding==='Positional',exitDay=d;
    let a=day.filter(r=>r.m>=p.entry&&r.m<=(overnight?929:p.exit));
    if(overnight){let dates=[...groups.keys()],offset=dates.indexOf(d),count=p.holdDays??1,next=dates[offset+count];if(!next||(p.expiry&&next>p.expiry)||p.exit>929||p.entry<555||a.length!==930-p.entry){skipped.push(d);continue}let tail=groups.get(next).filter(r=>r.m>=555&&r.m<=p.exit);if(tail.length!==p.exit-554){skipped.push(d);continue}const middle=dates.slice(offset+1,offset+count).map(date=>groups.get(date).filter(r=>r.m>=555&&r.m<930));if(middle.some(session=>session.length!==375)){skipped.push(d);continue}exitDay=next;a=a.concat(...middle,tail)}

    if(a[0]?.m!==p.entry||(overnight&&a.at(-1)?.m!==p.exit)){skipped.push(d);continue}
    // A later missing minute cannot invalidate an earlier observed stop or target.
    // A still-open position cannot be priced across that gap.
    if(!overnight){
      const gap=a.findIndex((r,i)=>r.m!==p.entry+i);
      if(gap>=0)a=a.slice(0,gap);
    }
    const incompleteTail=!overnight&&a.at(-1)?.m!==p.exit;
    let fill=a[0].o,touched=false;
    if(['Price above','Price below','Limit price'].includes(p.rule)){
      const limit=p.ruleValue,buy=p.side==='Buy';
      const idx=a.findIndex(r=>r.d===d&&(overnight||r.m<p.exit)&&(p.rule==='Price above'?r.o>limit:p.rule==='Price below'?r.o<limit:buy?r.l<=limit:r.h>=limit));
      if(idx<0){if(incompleteTail)skipped.push(d);continue;}
      a=a.slice(idx);fill=a[0].o;
      if(p.rule==='Limit price'){fill=buy?Math.min(fill,limit):Math.max(fill,limit);touched=fill!==a[0].o}
    }else if(p.rule&&p.rule!=='Market price'&&!entryMatches(a[0],p))continue;
    let sign=p.side==='Buy'?1:-1,slip=p.slip/10000,ep=p.rule==='Limit price'?(sign>0?Math.min:Math.max)(p.ruleValue,fill*(1+sign*slip)):fill*(1+sign*slip),best=ep,reason='Timed exit',out=a.at(-1).o,m=p.exit;
    let fillDay=exitDay;for(let r of a){
      let fixed=p.stop?ep-sign*distance(p.stop,p.stopUnit,ep,p.qty):null,trail=p.trailX&&fixed!==null?fixed+sign*Math.floor(Math.max(0,sign*(best-ep))/p.trailX)*p.trailY:p.trail?best*(1-sign*p.trail/100):null;
      let stops=[fixed,trail].filter(x=>x!==null),stop=stops.length?(sign>0?Math.max(...stops):Math.min(...stops)):null;
      let target=p.target?ep+sign*distance(p.target,p.targetUnit,ep,p.qty):null,stopName=trail!==null&&stop===trail&&best!==ep?'Trailing stop':'Stop loss';
      let hit=(price,threshold,dir)=>threshold!==null&&dir*(price-threshold)>=0;
      if(!(touched&&r===a[0])&&hit(r.o,stop,-sign)){reason=stopName+' at open';out=r.o;m=r.m;fillDay=r.d;break}
      if(!(touched&&r===a[0])&&hit(r.o,target,sign)){reason='Target at open';out=r.o;m=r.m;fillDay=r.d;break}
      if(r.d===exitDay&&r.m===p.exit)break;
      if(hit(sign>0?r.l:r.h,stop,-sign)){reason=stopName;out=stop;m=r.m;fillDay=r.d;break}
      if(touched&&r===a[0])continue;
      if(hit(sign>0?r.h:r.l,target,sign)){reason='Target';out=target;m=r.m;fillDay=r.d;break}
      best=sign>0?Math.max(best,r.h):Math.min(best,r.l);
    }
    if(incompleteTail&&reason==='Timed exit'){skipped.push(d);continue}
    let xp=out*(1-sign*slip),gross=sign*(xp-ep)*p.qty,charges=costs(p,ep,xp),net=gross-charges;
    if(overnight&&fillDay!==d)busyUntil=fillDay;cum+=net;peak=Math.max(peak,cum);dd=Math.min(dd,cum-peak);
    trades.push({d:fillDay,entryDay:d,entry:timeOf(a[0].m),exit:timeOf(m),ep,xp,entryRef:fill,slippageCost:sign*((out-fill)-(xp-ep))*p.qty,gross,charges,net,cum,dd:cum-peak,reason,tip:fillDay+' '+timeOf(m)+' IST\nTrade ₹'+fmt(net)+'\nCumulative ₹'+fmt(cum)+'\nDrawdown ₹'+fmt(cum-peak)});
  }return {trades,skipped,net:cum,dd,ret:trades.length?100*cum/trades.reduce((v,t)=>v+p.qty*t.ep,0):0,win:100*trades.filter(t=>t.net>0).length/(trades.length||1),p}
}
