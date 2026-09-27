(function(){
  'use strict';
  const currencies=['BRL','ARS','USD'];
  const token=/(R\$|ARS|USD|US\$|(?<!R)\$)\s*([0-9][0-9.,]*)(?:\s*[–—-]\s*([0-9][0-9.,]*))?(\+)?/g;
  const excluded='script,style,textarea,option,input,select,svg,audio,.rio-price-toggle,.v2-countdown';

  function number(raw,currency){
    const value=String(raw).trim();
    if(value.includes(',')&&value.includes('.'))return Number(value.replace(/\./g,'').replace(',','.'));
    if(value.includes(','))return Number(value.replace(',','.'));
    if(value.includes('.')&&/^\d{1,3}(?:\.\d{3})+$/.test(value))return Number(value.replace(/\./g,''));
    if(currency==='ARS'&&value.includes('.'))return Number(value.replace(/\./g,''));
    return Number(value);
  }
  function currencyFor(prefix){
    if(prefix==='R$')return 'BRL';
    if(prefix==='USD'||prefix==='US$')return 'USD';
    return 'ARS';
  }
  function rates(){
    try{const state=JSON.parse(localStorage.getItem('rio2027_v2')||'{}');return {...{BRLARS:294,USDARS:1523},...(state.rates||{})}}
    catch{return {BRLARS:294,USDARS:1523}}
  }
  function convert(value,from,to){
    const r=rates(); let ars=value;
    if(from==='BRL')ars=value*r.BRLARS; else if(from==='USD')ars=value*r.USDARS;
    if(to==='ARS')return ars;
    if(to==='BRL')return ars/r.BRLARS;
    return ars/r.USDARS;
  }
  function format(value,currency){
    const digits=currency==='ARS'?0:2;
    const locale=currency==='BRL'?'pt-BR':'es-AR';
    return new Intl.NumberFormat(locale,{style:'currency',currency,minimumFractionDigits:digits===0?0:2,maximumFractionDigits:digits}).format(value).replace('US$','US$ ');
  }
  function render(node,currency){
    const from=node.dataset.baseCurrency;
    const first=convert(Number(node.dataset.min),from,currency);
    const max=node.dataset.max?convert(Number(node.dataset.max),from,currency):null;
    let text=format(first,currency);
    if(max!==null){
      const second=format(max,currency).replace(/^(R\$|US\$|\$)\s*/,'');
      text+=`–${second}`;
    }
    if(node.dataset.plus==='true')text+='+';
    node.textContent=text;
    node.dataset.currentCurrency=currency;
    node.setAttribute('aria-label',`${text}. Click para mostrar en otra moneda`);
  }
  function make(match){
    const prefix=match[1],base=currencyFor(prefix),span=document.createElement('span');
    span.className='rio-price-toggle';span.tabIndex=0;span.setAttribute('role','button');
    span.dataset.baseCurrency=base;span.dataset.currentCurrency=base;
    span.dataset.min=String(number(match[2],base));
    if(match[3])span.dataset.max=String(number(match[3],base));
    span.dataset.plus=String(Boolean(match[4]));span.textContent=match[0];
    span.title='Cambiar moneda: reales → pesos → dólares';
    return span;
  }
  function enhance(root=document.body){
    if(!root||root.nodeType!==Node.ELEMENT_NODE)return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(node){
      if(!node.nodeValue||!/(R\$|ARS|USD|US\$|\$)\s*[0-9]/.test(node.nodeValue))return NodeFilter.FILTER_REJECT;
      const parent=node.parentElement;if(!parent||parent.closest(excluded))return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }});
    const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
    nodes.forEach(node=>{
      const text=node.nodeValue,fragment=document.createDocumentFragment();let end=0,match;token.lastIndex=0;
      while((match=token.exec(text))){fragment.append(text.slice(end,match.index),make(match));end=token.lastIndex}
      if(end){fragment.append(text.slice(end));node.replaceWith(fragment)}
    });
  }
  function cycle(node){
    const current=node.dataset.currentCurrency||node.dataset.baseCurrency;
    render(node,currencies[(currencies.indexOf(current)+1)%currencies.length]);
  }
  document.addEventListener('click',event=>{const node=event.target.closest('.rio-price-toggle');if(!node)return;event.preventDefault();event.stopPropagation();cycle(node)},true);
  document.addEventListener('keydown',event=>{const node=event.target.closest?.('.rio-price-toggle');if(!node||!['Enter',' '].includes(event.key))return;event.preventDefault();event.stopPropagation();cycle(node)},true);
  let pending=false;
  const observer=new MutationObserver(records=>{if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType===Node.ELEMENT_NODE)enhance(node)}))})});
  enhance();observer.observe(document.body,{subtree:true,childList:true});
})();
