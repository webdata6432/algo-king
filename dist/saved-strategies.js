let editingStrategyId=null;
async function storeStrategy(item){
 if(!database)throw Error('Browser storage is unavailable. Reopen the workspace to save changes.');
 await persist('runs',item);
 const i=saved.findIndex(s=>s.id===item.id);
 if(i<0)saved.push(item);else saved[i]=item;
}
function savedStrategySection(host){
 const section=document.createElement('section');section.className='panel';
 section.innerHTML='<h2>My saved strategies</h2>';
 if(!saved.length)section.insertAdjacentHTML('beforeend',note('Save a Backtester run to find it here.'));
 for(const item of saved){
  const row=document.createElement('div');row.className='row';
  row.innerHTML='<b>'+esc(item.name)+'</b><span>'+cash(item.net)+' · last run</span><button>Open result</button><button>Edit</button>';
  const [open,edit]=row.querySelectorAll('button');
  open.onclick=()=>{host.innerHTML='<button id="backSaved">← Historical Backtest</button><h1>'+esc(item.name)+'</h1>'+ (item.pending?note('Settings changed since this result. Run the strategy again to update it.'):'')+'<div id="results"></div>';lastRun={...item,savedId:item.id};lastMonth='';showResults();$('backSaved').onclick=historicalBacktest};
  edit.disabled=!item.sectorConfig&&!item.definition&&!item.p?.legs?.length;
  edit.title=edit.disabled?'This report has no Backtester configuration':'Edit saved strategy';
  edit.onclick=()=>{if(item.sectorConfig){sectorMomentumPage(item);return}editingStrategyId=item.id;location.hash='test'};
  section.append(row);
 }
 host.insertBefore(section,host.querySelector('section'));
}
function legacyDefinition(item){
 const p=item.p;
 return {mode:p.mode==='Options'?'Options':p.legs.length>1?'Basket':'Stock',common:{bp:'Custom',bf:p.from,bt:p.to,holding:p.holding==='Positional'?'Delivery':'Intraday',deliveryN:p.holdDays,deliveryTime:p.deliveryExit!=null?timeOf(p.deliveryExit):undefined,slip:p.slip,algoTarget:p.limits?.target,algoStop:p.limits?.stop,algoTU:p.limits?.tu,algoSU:p.limits?.su},legs:p.legs.map(l=>({kind:l.mode,fees:l.fees,trailX:l.trailX,trailY:l.trailY,fields:{symbol:l.s,et:timeOf(l.entry),xt:timeOf(l.exit),side:l.side,lots:l.lots??l.qty,units:l.mode==='Options'?'':1,sl:l.stop,su:l.stopUnit,tp:l.target,tu:l.targetUnit,rule:l.rule,value:l.ruleValue,cp:l.cp,expiry:l.optionExpiry,basis:l.strikeMode,money:l.money==='ATM'?'ATM':l.steps+' '+l.money,strike:l.strikePrice}}))};
}
