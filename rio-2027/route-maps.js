(function(){
  'use strict';
  let routeData=null,regionalData=null;
  const modes=[['walk','🚶','Caminar'],['bike','🚲','Bici'],['scooter','🛴','Monopatín']];
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  function modeButton(key,icon,label,data,index){
    const item=data.modes[key];
    if(!item)return '';
    return `<button class="rio-mode" type="button" data-mode="${key}" aria-pressed="${index===0?'true':'false'}"><b>${icon} ${label}</b><span>${item.distance.toFixed(2)} km · ~${item.minutes} min</span></button>`;
  }

  window.rioRealMap=function(activity){
    if(routeData===null){
      return `<div class="rio-map-loading" data-rio-map-pending="${esc(activity.id)}" data-name="${esc(activity.name)}"><b>🗺️ Cargando calles y recorridos…</b><span>El mapa se reemplaza automáticamente apenas termina de leer los archivos offline.</span></div>`;
    }
    const data=routeData?.activities?.[activity.id];
    if(!data&&regionalData?.[activity.id]){
      const regional=regionalData[activity.id];
      return `<div class="rio-map-layout rio-map-regional" data-activity="${esc(activity.id)}"><aside class="rio-map-controls"><h3>Recorrido regional</h3><p>Traslado largo calculado sobre carreteras reales y guardado en la página.</p><div class="rio-map-facts"><div class="rio-map-fact"><b>Inicio</b><span>Copacabana</span></div><div class="rio-map-fact"><b>Destino</b><span>${esc(regional.label)}</span></div><div class="rio-map-fact"><b>Modo</b><span>${esc(regional.kind)}</span></div><div class="rio-map-fact"><b>Distancia</b><span>${Number(regional.distance).toFixed(1)} km</span></div></div><div class="rio-map-note">Ruta generada una sola vez con la red vial OSM. Al abrirla no consulta ninguna API ni usa una cuota.</div></aside><div class="rio-map-canvas"><img src="${esc(regional.file)}" alt="Recorrido regional desde Copacabana hasta ${esc(regional.label)}" width="960" height="620"><div class="rio-map-legend"><span><i style="background:#23c7a8"></i>carretera</span><span><i style="background:#2f80ed"></i>tramo en barco</span><span>Datos OSM offline</span></div></div></div>`;
    }
    if(!data){
      return `<div class="rio-no-route"><h3>⚠️ No se pudo abrir el archivo del recorrido</h3><p>Recargá la página. Si este mensaje continúa, falta publicar alguno de los archivos de <b>assets/maps</b>.</p></div>`;
    }
    const available=modes.filter(([key])=>data.modes[key]);
    const first=available[0][0], initial=data.modes[first];
    return `<div class="rio-map-layout" data-activity="${esc(activity.id)}" data-mode="${first}">
      <aside class="rio-map-controls"><h3>Cómo querés ir</h3><p>Probá los tres recorridos calculados sobre calles reales.</p>
        ${available.map((mode,index)=>modeButton(...mode,data,index)).join('')}
        <div class="rio-map-facts"><div class="rio-map-fact"><b>Inicio</b><span>Copacabana</span></div><div class="rio-map-fact"><b>Destino</b><span>${esc(data.label)}</span></div><div class="rio-map-fact"><b>Red cargada</b><span>97.165 nodos</span></div><div class="rio-map-fact"><b>Ruta</b><span data-route-stat>${initial.nodes.toLocaleString('es-AR')} nodos</span></div></div>
        <div class="rio-map-note">Los caminos se calcularon offline con el archivo OSM de Descargas. No consumen una API ni una cuota al abrir la página.</div>
      </aside>
      <div class="rio-map-canvas"><img src="${esc(initial.file)}" alt="Recorrido desde Copacabana hasta ${esc(data.label)}" width="960" height="660"><div class="rio-map-legend"><span><i style="background:#23c7a8"></i>A pie</span><span><i style="background:#2f80ed"></i>Bici</span><span><i style="background:#7651b5"></i>Monopatín</span><span>Mapa: calles reales OSM</span></div></div>
    </div>`;
  };

  window.rioRealGlobalMap=function(){
    return '<img class="rio-general-img" src="assets/maps/general.svg" alt="Mapa general real de actividades en Río de Janeiro" width="1100" height="720">';
  };

  document.addEventListener('click',event=>{
    const button=event.target.closest('.rio-mode');
    if(!button)return;
    const root=button.closest('.rio-map-layout');
    const activity=routeData?.activities?.[root.dataset.activity];
    const item=activity?.modes?.[button.dataset.mode];
    if(!item)return;
    root.dataset.mode=button.dataset.mode;
    root.querySelectorAll('.rio-mode').forEach(node=>node.setAttribute('aria-pressed',String(node===button)));
    const image=root.querySelector('img');
    image.src=item.file;
    image.alt=`Recorrido ${button.textContent.trim()} desde Copacabana hasta ${activity.label}`;
    root.querySelector('[data-route-stat]').textContent=`${item.nodes.toLocaleString('es-AR')} nodos`;
  });

  function json(url){return fetch(url,{cache:'no-cache'}).then(response=>{if(!response.ok)throw new Error(`${url}: HTTP ${response.status}`);return response.json()})}
  Promise.all([
    json('assets/maps/routes.json?v=20260927-2').catch(error=>{console.warn('No se cargaron los mapas urbanos:',error);return {activities:{}}}),
    json('assets/maps/regional-routes.json?v=20260927-2').catch(error=>{console.warn('No se cargaron los mapas regionales:',error);return {}}),
  ]).then(([local,regional])=>{
    routeData=local;regionalData=regional;
    document.querySelectorAll('[data-rio-map-pending]').forEach(node=>{
      node.outerHTML=window.rioRealMap({id:node.dataset.rioMapPending,name:node.dataset.name||node.dataset.rioMapPending});
    });
    window.dispatchEvent(new CustomEvent('rio:maps-ready'));
  });
})();
