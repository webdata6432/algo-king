// Keep native selection and form events as the single source of truth.
const segmentedIds = new Set(['action','optionSide','contractMode','period','universeCap','series','asset','bp','cut','targetUnit','stopUnit']);
function enhanceSelectors() {
  document.querySelectorAll('select').forEach(select => {
    if (!segmentedIds.has(select.id) || select.dataset.enhanced) return;
    select.dataset.enhanced = 'true';
    const group = document.createElement('span');
    group.className = 'segmented';
    group.setAttribute('role','group');
    group.setAttribute('aria-label',select.getAttribute('aria-label') || select.parentElement.firstChild.textContent.trim());
    select.after(group);
    select.hidden = true;
    const buttons = Array.from(select.options, option => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = option.text;
      button.dataset.tone = ['CE','Buy'].includes(option.text) ? 'up' : ['PE','Sell'].includes(option.text) ? 'down' : 'neutral';
      group.append(button);
      button.onclick = event => {
        event.preventDefault();
        if (select.value === option.value && select.id !== 'universeCap') return;
        select.value = option.value;
        select.dispatchEvent(new Event('change',{bubbles:true}));
        sync();
      };
      return button;
    });
    function sync(){buttons.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===select.selectedIndex)))}
    group.onkeydown=e=>{
      if(!['ArrowLeft','ArrowRight'].includes(e.key))return;
      e.preventDefault();
      const target=buttons[(buttons.indexOf(document.activeElement)+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length];
      target.click();target.focus();
    };
    select.addEventListener('change',sync);sync();
  });
}
new MutationObserver(enhanceSelectors).observe(document.body,{childList:true,subtree:true});
