(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const slugProfile = name => name.toLowerCase();
  const uid = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
  const activities = window.ACTIVITIES || [];
  const activityById = Object.fromEntries(activities.map(a => [a.id, a]));
  const cfg = window.RIO_FIREBASE || {};
  const currencies = ['BRL','ARS','USD'];
  const categoryIcons = {Todas:'✦',Playa:'🏖️',Naturaleza:'🥾',Cultura:'🏛️',Tour:'⛵',Noche:'🌙'};
  const regionalIds = new Set(['arraial','pontal_diy','ilha_grande','acaia']);
  const priceBRL = {
    arpoador:0,leme:0,praia_vermelha:0,leblon:0,bondinho:[65,140],cristo:[97,130],jardim:40,parque_lage:0,lagoa:[0,45],telegrapho:[100,180],dois_irmaos:[60,120],museu:40,santa_teresa:[0,30],real_gabinete:0,colombo:[40,120],maracana:75,arraial:[180,350],pontal_diy:[120,220],ilha_grande:[190,380],acaia:[250,450],pedra:0,pagode_garagem:[30,70],bosque:[80,180],barzin:[60,160],substation:[50,120],mirante_rocinha:[40,100],arvrao:[50,150],visao_vidigal:[40,120],dedge:[70,180],canastra:[40,120],boa_praca:[45,130],brewteco:[45,130],fairmont:[80,220],hilton:[80,220],armazem_senado:[30,90],beco_rato:[30,90],via_onze:[40,100],salgueiro:[30,60],boma:[120,350],boat_party:[150,250],cinema_party:[80,180],vizta_mercure:[70,190]
  };
  const cityPositions = {
    arpoador:[88,75],leme:[91,69],praia_vermelha:[92,64],leblon:[84,76],bondinho:[92,63],cristo:[84,62],jardim:[81,70],parque_lage:[82,67],lagoa:[84,70],telegrapho:[70,83],dois_irmaos:[80,76],museu:[90,48],santa_teresa:[87,55],real_gabinete:[89,50],colombo:[89,50],maracana:[83,49],pedra:[88,52],pagode_garagem:[85,50],bosque:[84,68],barzin:[87,75],substation:[84,66],mirante_rocinha:[78,72],arvrao:[79,74],visao_vidigal:[79,74],dedge:[86,67],canastra:[87,74],boa_praca:[85,71],brewteco:[88,64],fairmont:[89,73],hilton:[92,68],armazem_senado:[87,51],beco_rato:[87,54],via_onze:[85,50],salgueiro:[81,47],boma:[90,47],boat_party:[90,55],cinema_party:[86,56],vizta_mercure:[89,70]
  };
  const regionalPositions = {arraial:[71,82],pontal_diy:[71,82],ilha_grande:[18,83],acaia:[18,84]};
  const baseCity = [89,72], baseRegional = [42,82];

  let profile = localStorage.getItem('rio.profile') || 'Joaco';
  let currency = localStorage.getItem('rio.currency') || 'BRL';
  let category = 'Todas';
  let mapCategory = 'Todas';
  let selected = new Set();
  let shared = {votes:{}, itinerary:{}, expenses:{}, rates:{ARS:210,USD:0.18}};
  let syncing = false;
  let connected = false;

  function apiUrl(path='') {
    const root = [cfg.root, path].filter(Boolean).join('/');
    return `${cfg.databaseURL}/${root}.json`;
  }
  function setSync(mode, label) {
    const pill = $('syncPill');
    pill.classList.toggle('online', mode === 'online');
    pill.classList.toggle('offline', mode === 'offline');
    pill.querySelector('span').textContent = label;
  }
  function mergeRemote(data) {
    if (!data || typeof data !== 'object') return;
    shared = {
      votes: data.votes || {}, itinerary: data.itinerary || {}, expenses: data.expenses || {},
      rates: {...shared.rates, ...(data.rates || {})}
    };
    localStorage.setItem('rio.shared.backup', JSON.stringify(shared));
  }
  async function pullRemote(quiet=false) {
    if (syncing || !cfg.databaseURL) return;
    syncing = true;
    if (!quiet) setSync('pending','Conectando');
    try {
      const res = await fetch(apiUrl(), {cache:'no-store'});
      if (!res.ok) throw new Error(`Firebase ${res.status}`);
      const data = await res.json();
      if (data && data.error) throw new Error(data.error);
      mergeRemote(data);
      connected = true;
      setSync('online','Compartido');
      renderAll();
    } catch (error) {
      connected = false;
      setSync('offline','Sólo este equipo');
      if (!quiet) console.warn('Firebase todavía no habilitado para rio2027:', error.message);
    } finally { syncing = false; }
  }
  async function writeRemote(path, value) {
    localStorage.setItem('rio.shared.backup', JSON.stringify(shared));
    if (!cfg.databaseURL) return;
    setSync('pending','Guardando');
    try {
      const res = await fetch(apiUrl(path), {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
      if (!res.ok) throw new Error(`Firebase ${res.status}`);
      connected = true; setSync('online','Compartido');
    } catch (error) {
      connected = false; setSync('offline','Guardado local');
      console.warn('Cambio guardado sólo en este equipo:', error.message);
    }
  }
  function restoreLocal() {
    try { mergeRemote(JSON.parse(localStorage.getItem('rio.shared.backup'))); } catch (_) {}
  }

  function rate(code) { return code === 'BRL' ? 1 : Number(shared.rates[code]) || 1; }
  function moneyFromBRL(value, code=currency) {
    const amount = value * rate(code);
    return new Intl.NumberFormat('es-AR',{style:'currency',currency:code,maximumFractionDigits:code==='USD'?2:0}).format(amount);
  }
  function activityPrice(a) {
    const value = priceBRL[a.id];
    if (value === 0) return 'Gratis';
    if (Array.isArray(value)) return `${moneyFromBRL(value[0])}–${moneyFromBRL(value[1])}`;
    if (typeof value === 'number') return moneyFromBRL(value);
    return a.price;
  }
  function convertExpenseToBRL(e) {
    const amount = Number(e.amount)||0;
    return e.currency === 'BRL' ? amount : amount / rate(e.currency);
  }
  function cycleCurrency() {
    currency = currencies[(currencies.indexOf(currency)+1)%currencies.length];
    localStorage.setItem('rio.currency',currency);
    $('currencyBtn').textContent = currency;
    renderAll();
  }
  function toast(message) {
    const el=$('toast'); el.textContent=message; el.classList.add('show');
    clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),1800);
  }

  function go(view) {
    document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${view}`));
    document.querySelectorAll('.bottom-nav [data-go]').forEach(b=>b.classList.toggle('active',b.dataset.go===view));
    window.scrollTo({top:0,behavior:'smooth'});
    if (view==='mapa') renderMaps();
  }
  function updateProfileUI() {
    $('profileLabel').textContent=profile; $('profileInitial').textContent=profile[0];
  }
  function categories(target, active, handler) {
    target.innerHTML=Object.keys(categoryIcons).map(c=>`<button class="${c===active?'active':''}" data-cat="${c}">${categoryIcons[c]} ${c}</button>`).join('');
    target.querySelectorAll('button').forEach(b=>b.onclick=()=>handler(b.dataset.cat));
  }
  function voteFor(id, who) { return !!shared.votes?.[id]?.[slugProfile(who)]; }
  function inPlan(id) { return Object.values(shared.itinerary||{}).some(i=>i.activityId===id); }
  function renderExplore() {
    categories($('categoryChips'),category,c=>{category=c;renderExplore()});
    const q=$('searchInput').value.trim().toLowerCase();
    const list=activities.filter(a=>(category==='Todas'||a.cat===category)&&(!q||JSON.stringify(a).toLowerCase().includes(q)));
    $('resultsTitle').textContent=category==='Todas'?'Todas las ideas':category;
    $('activityGrid').innerHTML=list.map(a=>`<button class="activity-card ${selected.has(a.id)?'selected':''}" data-activity="${a.id}"><span class="activity-icon">${a.icon}</span><span class="activity-copy"><b>${esc(a.name)}</b><small>${esc(a.cat)} · ${esc(a.duration)}${inPlan(a.id)?' · EN EL PLAN':''}</small></span><span class="activity-price" data-price-cycle>${esc(activityPrice(a))}<span class="vote-pips"><i class="${voteFor(a.id,'Joaco')?'yes':''}">J</i><i class="${voteFor(a.id,'Nico')?'yes':''}">N</i></span></span></button>`).join('');
    $('emptyActivities').classList.toggle('hidden',!!list.length);
    $('activityGrid').querySelectorAll('[data-activity]').forEach(card=>card.onclick=e=>{
      if(e.target.closest('[data-price-cycle]')){e.stopPropagation();cycleCurrency();return;} openActivity(card.dataset.activity);
    });
    $('compareCount').textContent=selected.size;
    $('compareBtn').classList.toggle('hidden',selected.size<2);
  }
  function renderStats() {
    $('statIdeas').textContent=activities.length;
    $('statVotes').textContent=Object.values(shared.votes||{}).filter(v=>v?.joaco||v?.nico).length;
    $('statPlan').textContent=Object.keys(shared.itinerary||{}).length;
  }
  function mapsSearch(a) { return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${a.name}, ${a.zone}, Rio de Janeiro`)}`; }
  function openActivity(id) {
    const a=activityById[id]; if(!a)return;
    const mine=voteFor(id,profile), other=voteFor(id,profile==='Joaco'?'Nico':'Joaco');
    $('activityDetail').innerHTML=`<div class="sheet-inner"><div class="sheet-hero"><button class="sheet-close" data-close="activityDialog">×</button><div class="sheet-icon">${a.icon}</div><h2>${esc(a.name)}</h2><div class="sheet-meta"><span>${esc(a.cat)}</span><span>${esc(a.duration)}</span><span>${esc(a.confidence)}</span><span class="sheet-price" data-cycle>${esc(activityPrice(a))} · ${currency}</span></div></div><section class="sheet-section"><h3>En pocas palabras</h3><p>${esc(a.info)}</p></section><div class="vote-row sheet-section"><button data-vote class="${mine?'active':''}">${mine?'♥ Me interesa':'♡ Me interesa'} · ${esc(profile)}</button><button disabled class="${other?'active':''}">${other?'♥':'♡'} ${profile==='Joaco'?'Nico':'Joaco'}</button></div><details class="disclosure"><summary>Cómo llegar</summary><p>${esc(a.how)}</p></details><details class="disclosure"><summary>Seguridad y vuelta</summary><p>${esc(a.safety)}</p></details><details class="disclosure"><summary>Recomendación</summary><p>${esc(a.tip)}</p></details><details class="disclosure"><summary>Precio original y fuente</summary><p>${esc(a.price)}. Valores convertidos con el cambio manual.<br><br><a href="${esc(a.source)}" target="_blank" rel="noopener">${esc(a.sourceLabel)} ↗</a></p></details><div class="sheet-actions"><button data-route>⌖ Ver recorrido</button><button class="accent" data-add>${inPlan(id)?'✓ Ya está en el plan':'+ Agregar al itinerario'}</button><a href="${mapsSearch(a)}" target="_blank" rel="noopener" class="small-btn" style="text-align:center;text-decoration:none;padding:12px">Abrir ubicación exacta ↗</a><button data-compare>${selected.has(id)?'✓ En comparación':'⇄ Comparar'}</button></div></div>`;
    const d=$('activityDialog'); if(!d.open)d.showModal();
    d.querySelector('[data-close]').onclick=()=>d.close();
    d.querySelector('[data-cycle]').onclick=()=>{cycleCurrency();openActivity(id)};
    d.querySelector('[data-vote]').onclick=()=>toggleVote(id);
    d.querySelector('[data-route]').onclick=()=>{d.close();openRoute(id)};
    d.querySelector('[data-add]').onclick=()=>addToPlan(id);
    d.querySelector('[data-compare]').onclick=()=>toggleCompare(id);
  }
  function toggleVote(id) {
    const who=slugProfile(profile), next=!voteFor(id,profile);
    shared.votes[id]=shared.votes[id]||{}; shared.votes[id][who]=next;
    renderAll(); openActivity(id); writeRemote(`votes/${id}/${who}`,next); toast(next?'Voto guardado':'Voto quitado');
  }
  function toggleCompare(id) {
    if(selected.has(id))selected.delete(id);else if(selected.size<4)selected.add(id);else return toast('Podés comparar hasta 4');
    $('activityDialog').close();renderExplore();toast(selected.has(id)?'Sumado a comparar':'Quitado de comparar');
  }
  function openComparison() {
    const list=[...selected].map(id=>activityById[id]).filter(Boolean);
    $('compareDetail').innerHTML=`<button class="dialog-close" data-close>×</button><p class="eyebrow">COMPARACIÓN</p><h2>${list.length} planes, lado a lado</h2><div class="compare-scroll">${list.map(a=>`<article class="compare-card"><div class="sheet-icon">${a.icon}</div><h3>${esc(a.name)}</h3><p>${esc(a.zone)}</p><b>${esc(activityPrice(a))}</b><p>${esc(a.duration)} · ${esc(a.transport)}</p><button class="small-btn" data-open="${a.id}">Ver ficha</button></article>`).join('')}</div>`;
    const d=$('compareDialog');d.showModal();d.querySelector('[data-close]').onclick=()=>d.close();d.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{d.close();openActivity(b.dataset.open)});
  }

  function addToPlan(id) {
    if(inPlan(id)) return toast('Ya está en el itinerario');
    const key=uid(); const order=Object.keys(shared.itinerary||{}).length;
    shared.itinerary[key]={activityId:id,day:'',slot:'',note:'',order,addedBy:profile};
    writeRemote(`itinerary/${key}`,shared.itinerary[key]); renderAll();
    if($('activityDialog').open)$('activityDialog').close(); toast('Agregado como borrador');
  }
  function orderedPlan() { return Object.entries(shared.itinerary||{}).sort((a,b)=>(a[1].order??99)-(b[1].order??99)); }
  function renderItinerary() {
    const list=orderedPlan(); $('emptyItinerary').classList.toggle('hidden',!!list.length);
    $('itineraryList').innerHTML=list.map(([key,item],i)=>{const a=activityById[item.activityId];if(!a)return'';return `<article class="plan-item"><span class="plan-number">${i+1}</span><div><h3>${a.icon} ${esc(a.name)}</h3><div class="plan-fields"><input data-field="day" data-key="${key}" value="${esc(item.day)}" placeholder="Día / fecha"><input data-field="slot" data-key="${key}" value="${esc(item.slot)}" placeholder="Hora"><input data-field="note" data-key="${key}" value="${esc(item.note)}" placeholder="Nota"></div></div><div class="plan-actions"><button data-move="up" data-key="${key}" title="Subir">↑</button><button data-move="down" data-key="${key}" title="Bajar">↓</button><button data-remove-plan="${key}" title="Quitar">×</button></div></article>`}).join('');
    $('itineraryList').querySelectorAll('[data-field]').forEach(input=>input.onchange=()=>{const item=shared.itinerary[input.dataset.key];item[input.dataset.field]=input.value;writeRemote(`itinerary/${input.dataset.key}/${input.dataset.field}`,input.value);toast('Itinerario actualizado')});
    $('itineraryList').querySelectorAll('[data-remove-plan]').forEach(b=>b.onclick=()=>{delete shared.itinerary[b.dataset.removePlan];writeRemote(`itinerary/${b.dataset.removePlan}`,null);normalizePlan();renderAll()});
    $('itineraryList').querySelectorAll('[data-move]').forEach(b=>b.onclick=()=>movePlan(b.dataset.key,b.dataset.move==='up'?-1:1));
  }
  function normalizePlan() { orderedPlan().forEach(([key,item],i)=>{item.order=i;writeRemote(`itinerary/${key}/order`,i)}); }
  function movePlan(key,delta) {
    const list=orderedPlan(),i=list.findIndex(([k])=>k===key),j=i+delta;if(i<0||j<0||j>=list.length)return;
    const a=list[i],b=list[j],old=a[1].order;a[1].order=b[1].order;b[1].order=old;writeRemote(`itinerary/${a[0]}/order`,a[1].order);writeRemote(`itinerary/${b[0]}/order`,b[1].order);renderAll();
  }

  function markerHtml(id,pos,base=false){const a=activityById[id];return `<button class="marker ${base?'base':''}" style="left:${pos[0]}%;top:${pos[1]}%" ${base?'disabled':`data-marker="${id}" title="${esc(a.name)}"`}><span>${base?'⌂':a.icon}</span></button>`}
  function renderMaps() {
    categories($('mapFilter'),mapCategory,c=>{mapCategory=c;renderMaps()});
    const city=activities.filter(a=>!regionalIds.has(a.id)&&(mapCategory==='Todas'||a.cat===mapCategory)&&cityPositions[a.id]);
    const regional=activities.filter(a=>regionalIds.has(a.id)&&(mapCategory==='Todas'||a.cat===mapCategory));
    $('generalMarkers').innerHTML=markerHtml('',baseCity,true)+city.map(a=>markerHtml(a.id,cityPositions[a.id])).join('');
    $('regionalMarkers').innerHTML=markerHtml('',baseRegional,true)+regional.map(a=>markerHtml(a.id,regionalPositions[a.id])).join('');
    $('regionalMapCard').classList.toggle('hidden',!regional.length);
    document.querySelectorAll('[data-marker]').forEach(b=>b.onclick=()=>openActivity(b.dataset.marker));
  }
  function openRoute(id) {
    const a=activityById[id], regional=regionalIds.has(id), end=regional?regionalPositions[id]:cityPositions[id]||[86,60], start=regional?baseRegional:baseCity;
    $('routeDetail').innerHTML=`<div class="route-wrap"><header class="route-head"><div><p class="eyebrow">DESDE LA BASE · COPACABANA</p><h2>${a.icon} ${esc(a.name)}</h2></div><button class="sheet-close" data-close>×</button></header><div class="route-map"><img src="assets/${regional?'rio-state-map':'rio-city-map'}.png" alt="Mapa del recorrido"><svg class="route-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="${start[0]}" y1="${start[1]}" x2="${end[0]}" y2="${end[1]}"></line><circle cx="${start[0]}" cy="${start[1]}" r="1.3"></circle><circle cx="${end[0]}" cy="${end[1]}" r="1.7"></circle></svg><button class="marker base" disabled style="left:${start[0]}%;top:${start[1]}%"><span>⌂</span></button><button class="marker active" disabled style="left:${end[0]}%;top:${end[1]}%"><span>${a.icon}</span></button></div><section class="route-panel"><div class="route-facts"><div><small>DISTANCIA</small><b>${esc(a.dist)}</b></div><div><small>TIEMPO</small><b>${esc(a.time)}</b></div><div><small>MEJOR OPCIÓN</small><b>${esc(a.transport)}</b></div></div><h3 style="margin:18px 0 5px">Recorrido sugerido</h3><ol class="route-steps">${(a.steps||[]).map(s=>`<li>${esc(s)}</li>`).join('')}</ol><p class="route-note"><b>Vuelta:</b> ${esc(a.ret)}. ${esc(a.safety)}</p><a class="primary-btn" style="display:block;text-align:center;text-decoration:none;margin-top:12px" href="${mapsSearch(a)}" target="_blank" rel="noopener">Abrir navegación exacta ↗</a></section><p class="map-credit">La línea muestra la relación espacial, no calles exactas. La navegación en vivo se abre aparte y no usa una API dentro de esta web.</p></div>`;
    const d=$('routeDialog');d.showModal();d.querySelector('[data-close]').onclick=()=>d.close();
  }

  function renderBudget() {
    $('rateARS').value=shared.rates.ARS; $('rateUSD').value=shared.rates.USD;
    const entries=Object.entries(shared.expenses||{}).sort((a,b)=>(b[1].createdAt||0)-(a[1].createdAt||0));
    const total=entries.reduce((sum,[,e])=>sum+convertExpenseToBRL(e),0);
    $('budgetTotal').textContent=moneyFromBRL(total); $('budgetSplit').textContent=`${moneyFromBRL(total/2)} por persona · ${currency}`;
    $('expenseList').innerHTML=entries.map(([key,e])=>`<article class="expense-row"><div><b>${esc(e.title)}</b><small>Pagó ${esc(e.payer)} · ${esc(e.createdBy||'')}</small></div><strong>${new Intl.NumberFormat('es-AR',{style:'currency',currency:e.currency,maximumFractionDigits:2}).format(Number(e.amount)||0)}</strong><button class="expense-delete" data-delete-expense="${key}">×</button></article>`).join('');
    $('emptyExpenses').classList.toggle('hidden',!!entries.length);
    $('expenseList').querySelectorAll('[data-delete-expense]').forEach(b=>b.onclick=()=>{delete shared.expenses[b.dataset.deleteExpense];writeRemote(`expenses/${b.dataset.deleteExpense}`,null);renderAll()});
  }
  function addExpense(event) {
    event.preventDefault();const key=uid();const e={title:$('expenseTitle').value.trim(),amount:Number($('expenseAmount').value),currency:$('expenseCurrency').value,payer:$('expensePayer').value,createdBy:profile,createdAt:Date.now()};
    shared.expenses[key]=e;writeRemote(`expenses/${key}`,e);event.target.reset();renderAll();toast('Gasto compartido');
  }
  function saveRates(){const rates={ARS:Number($('rateARS').value)||1,USD:Number($('rateUSD').value)||1};shared.rates=rates;writeRemote('rates',rates);renderAll();toast('Cambio actualizado')}
  function renderAll(){updateProfileUI();$('currencyBtn').textContent=currency;renderStats();renderExplore();renderItinerary();renderMaps();renderBudget()}

  document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
  $('searchInput').oninput=renderExplore;$('currencyBtn').onclick=cycleCurrency;$('compareBtn').onclick=openComparison;
  $('profileBtn').onclick=()=>$('profileDialog').showModal();
  document.querySelectorAll('[data-profile]').forEach(b=>b.onclick=()=>{profile=b.dataset.profile;localStorage.setItem('rio.profile',profile);$('profileDialog').close();renderAll();toast(`Perfil: ${profile}`)});
  document.querySelectorAll('[data-close="profileDialog"]').forEach(b=>b.onclick=()=>$('profileDialog').close());
  $('expenseForm').onsubmit=addExpense;$('saveRates').onclick=saveRates;$('syncPill').onclick=()=>pullRemote();
  [$('activityDialog'),$('profileDialog'),$('compareDialog')].forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close()}));
  restoreLocal();renderAll();pullRemote();setInterval(()=>pullRemote(true),20000);
})();
