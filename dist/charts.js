let sid=0;
function table(headers,rows){return '<div class="scroll"><table><thead><tr>'+headers.map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'}
function spark(r){let vs=r.map(x=>x.c),lo=Math.min(...vs),hi=Math.max(...vs);return '<svg viewBox="0 0 100 40" preserveAspectRatio="none"><polyline pathLength="1" fill="none" stroke="'+(r.at(-1)?.a<0?'#ff797e':'#48d3a0')+'" stroke-width="2" points="'+vs.map((v,i)=>(i*100/(vs.length-1||1))+','+(37-34*(v-lo)/(hi-lo||1))).join(' ')+'"/></svg>'}
function displayDates(value){return String(value).replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g,'$3-$2-$1')}
function plot(rows,key,color='#44c995',bars=false,overlay=null){
 if(!rows.length)return '<p>No sessions in this range.</p>';
 const id='chart'+(++sid),w=900,h=260,l=80,r=44,t=18,b=35,pw=w-l-r,ph=h-t-b;
 const candles=bars==='candles',values=rows.map(v=>v[key]);
 let low=candles?Infinity:0,high=candles?-Infinity:0;
 for(const row of rows){low=Math.min(low,candles?row.l:row[key],overlay?row[overlay]:Infinity);high=Math.max(high,candles?row.h:row[key],overlay?row[overlay]:-Infinity)}
 if(high===low){high+=1;low-=1}
 const x=i=>l+(i+.5)*pw/rows.length,y=v=>t+(high-v)*ph/(high-low);
 let grid='',marks='';
 for(let j=0;j<5;j++){const v=high-(high-low)*j/4;grid+='<path stroke="#44536a" opacity=".5" d="M'+l+' '+y(v)+'h'+pw+'"/><text x="'+(l-6)+'" y="'+(y(v)+4)+'" text-anchor="end">'+fmt(v,Math.abs(v)>=100?0:1)+'</text>'}
 for(const i of new Set([0,Math.floor((rows.length-1)/2),rows.length-1]))grid+='<text text-anchor="middle" x="'+x(i)+'" y="'+(h-8)+'">'+esc(displayDates(rows[i].d))+'</text>';
 const width=Math.max(.6,Math.min(16,.74*pw/rows.length));
 if(bars){
  for(const [i,row] of rows.entries()){
   const from=candles?row.o:0,to=row[key],tone=to>=from?'#42d6a0':'#f47783';
   if(candles)marks+='<path stroke="'+tone+'" d="M'+x(i)+' '+y(row.h)+'V'+y(row.l)+'"/>';
   marks+='<rect fill="'+tone+'" x="'+(x(i)-width/2)+'" y="'+Math.min(y(from),y(to))+'" width="'+width+'" height="'+Math.max(1,Math.abs(y(from)-y(to)))+'"/>';
  }
 }else{
  const points=rows.map((row,i)=>x(i)+','+y(row[key])).join(' ');
  marks='<polygon points="'+x(0)+','+y(0)+' '+points+' '+x(rows.length-1)+','+y(0)+'" fill="url(#g'+id+')"/><polyline fill="none" stroke="'+color+'" stroke-width="2" points="'+points+'"/>';
  if(overlay)marks+='<polyline fill="none" stroke="#82bfff" stroke-width="2" points="'+rows.map((row,i)=>x(i)+','+y(row[overlay])).join(' ')+'"/>';
 }
 queueMicrotask(()=>{
  const el=$(id);if(!el)return;
  const svg=el.querySelector('svg'),cross=el.querySelector('.cross'),dot=el.querySelector('circle'),tip=el.querySelector('.tip');let selected=0;
  function show(index){
   selected=Math.max(0,Math.min(rows.length-1,index));const row=rows[selected],xx=x(selected),yy=y(values[selected]),rect=svg.getBoundingClientRect();
   cross.setAttribute('d','M'+xx+' '+t+'V'+(h-b)+'M'+l+' '+yy+'H'+(w-r));
   dot.setAttribute('cx',xx);dot.setAttribute('cy',yy);dot.style.display='block';
   tip.textContent=displayDates(row.tip||row.d+' · '+signed(row[key])+'%');tip.style.display='block';
   const px=xx/w*rect.width,py=yy/h*rect.height;
   tip.style.left=Math.max(2,Math.min(rect.width-tip.offsetWidth-2,px+tip.offsetWidth+14<rect.width?px+12:px-tip.offsetWidth-12))+'px';
   tip.style.top=Math.max(2,Math.min(rect.height-tip.offsetHeight-2,py-tip.offsetHeight/2))+'px';
  }
  const track=e=>{const rect=svg.getBoundingClientRect();if(rect.width)show(Math.floor(((e.clientX-rect.left)/rect.width*w-l)*rows.length/pw))};
  const hide=()=>{tip.style.display=dot.style.display='none';cross.removeAttribute('d')};
  el.onpointermove=el.onpointerdown=track;el.onpointerleave=e=>{if(e.pointerType!=='touch')hide()};el.onblur=hide;
  el.onkeydown=e=>{if(e.key==='Escape')hide();if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();show(e.key==='Home'?0:e.key==='End'?rows.length-1:selected+(e.key==='ArrowLeft'?-1:1))}};
 });
 return '<div class="plot interactivePlot" tabindex="0" role="group" aria-label="Chart. Move, touch or use arrow keys to inspect." id="'+id+'"><svg class="chart" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" fill="#acb9cc" font-size="12"><defs><linearGradient id="g'+id+'" x1="0%" y1="0%" x2="0%" y2="100%"><stop stop-color="'+color+'" stop-opacity=".36"/><stop offset="100%" stop-color="'+color+'" stop-opacity=".03"/></linearGradient></defs>'+grid+marks+'<path class="cross" fill="none" stroke="#9caec1" stroke-dasharray="3 4"/><circle r="3.5" fill="'+color+'" style="display:none"/></svg><div class="tip"></div></div>';
}
function chartViews(title,area,candleView,candleLabel,series=[]){
 const id='views'+(++sid);
 queueMicrotask(()=>{
  const el=$(id);if(!el)return;
  const body=el.querySelector('.chartBody'),buttons=el.querySelectorAll('button'),picker=el.querySelector('select');let version=0;
  if(picker)picker.onchange=()=>buttons[1].click();
  for(const [i,btn] of [...buttons].entries())btn.onclick=async()=>{
   const v=++version;if(picker)picker.hidden=!i;buttons.forEach((item,j)=>item.setAttribute('aria-pressed',String(i===j)));
   if(!i){body.innerHTML=area();return}
   body.textContent='Loading candles…';
   try{const rows=await candleView(picker?Number(picker.value):0);if(v!==version||!el.isConnected)return;body.innerHTML=plot(rows,'c','#40cb94','candles')}
   catch(err){if(v===version)body.textContent=err.message}
  };
 });
 return '<section id="'+id+'"><div class="row"><h3>'+title+'</h3><div class="segmented"><button type="button" aria-pressed="true">Area</button><button type="button" aria-pressed="false">'+candleLabel+'</button></div>'+(series.length>1?'<select hidden aria-label="Candle instrument">'+series.map((name,i)=>'<option value="'+i+'">'+esc(name)+'</option>').join('')+'</select>':'')+'</div><div class="chartBody">'+area()+'</div></section>';
}
function dailyOHLC(rows){
 const days=new Map();
 for(const r of rows){const d=days.get(r.d);if(d){d.h=Math.max(d.h,r.h);d.l=Math.min(d.l,r.l);d.c=r.c}else days.set(r.d,{d:r.d,o:r.o,h:r.h,l:r.l,c:r.c})}
 return [...days.values()];
}
function pnlChart(trades,prices=[]){
 const daily=new Map();let prev=0;
 const rows=trades.map(t=>{
  let day=daily.get(t.d);if(!day){day={d:t.d,o:prev,h:prev,l:prev,c:prev};daily.set(t.d,day)}
  day.c=prev=t.cum;day.h=Math.max(day.h,prev);day.l=Math.min(day.l,prev);
  return {...t,tip:'PROFIT / LOSS\n₹'+fmt(t.cum)+'\n'+t.d+'   '+t.exit+' IST'};
 });
 if(prices.length)return chartViews('Run summary · Net P&L',()=>plot(rows,'cum','#24c980'),i=>prices[i].bars.map(d=>({...d,tip:prices[i].name+' · '+d.d+'\nO/P ₹'+fmt(d.o)+'   C/P ₹'+fmt(d.c)+'\nHigh ₹'+fmt(d.h)+'   Low ₹'+fmt(d.l)+'\nChng '+signed(d.c-d.o)+' pts   '+signed(100*(d.c-d.o)/d.o)+'%'})),'Price candles',prices.map(x=>x.name));
 return chartViews('Run summary · Net P&L',()=>plot(rows,'cum','#24c980'),()=>[...daily.values()].map(d=>({...d,tip:'Realised P&L · '+d.d+'\nOpen ₹'+fmt(d.o)+'   High ₹'+fmt(d.h)+'\nLow ₹'+fmt(d.l)+'   Close ₹'+fmt(d.c)})),'P&L candles');
}

function istStamp(time){
 const d=new Date(time);if(!Number.isFinite(d.getTime()))return 'Time unavailable';
 return d.toLocaleDateString('en-GB',{timeZone:'Asia/Kolkata'}).replaceAll('/','-')+' '+d.toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata'});
}
// Format rendered text while preserving API dates and native date-picker values.
function decorateDates(root){
 if(root.nodeType===3){
  const parent=root.parentElement;if(!parent||parent.closest('script,style,textarea,svg'))return;
  const value=displayDates(root.data);if(value!==root.data){
   if(parent.tagName==='OPTION'&&!parent.hasAttribute('value'))parent.value=parent.textContent;
   root.data=value;
  }
  return;
 }
 if(root.nodeType!==1||root.matches('script,style,textarea,svg'))return;
 if(root.hasAttribute('title')){const title=displayDates(root.title);if(title!==root.title)root.title=title}
 if(root.matches('input[type=date]')&&!root.closest('.dateDisplay')){
  const wrap=document.createElement('span'),out=document.createElement('span');wrap.className='dateDisplay';out.setAttribute('aria-hidden','true');root.before(wrap);wrap.append(root,out);
  const update=()=>{out.textContent=displayDates(root.value)||'dd-mm-yyyy'};
  root.addEventListener('input',update);root.addEventListener('change',update);update();
 }
 for(const node of [...root.childNodes])decorateDates(node);
}
new MutationObserver(records=>{
 for(const record of records){
  if(record.type==='characterData')decorateDates(record.target);
  else for(const el of record.addedNodes)decorateDates(el);
 }
 document.querySelectorAll('.dateDisplay input').forEach(el=>{const out=el.nextElementSibling,v=displayDates(el.value)||'dd-mm-yyyy';if(out&&out.textContent!==v)out.textContent=v});
}).observe(document.body,{subtree:true,childList:true,characterData:true});
