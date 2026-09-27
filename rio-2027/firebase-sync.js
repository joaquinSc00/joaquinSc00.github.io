(function(){
  'use strict';
  const cfg=window.RIO_FIREBASE||{};
  const keys=['rio2027_v2','rioActivitiesIntegratedV1'];
  const stampKey='rio2027_rich_sync_timestamp';
  let timer=null,applying=false,lastRemote=Number(localStorage.getItem(stampKey)||0);

  function endpoint(){
    if(!cfg.databaseURL)return '';
    const root=String(cfg.root||'rio2027/shared').replace(/^\/+|\/+$/g,'');
    return `${String(cfg.databaseURL).replace(/\/$/,'')}/${root}/rich.json`;
  }
  function snapshot(){
    const storage={};
    keys.forEach(key=>{const raw=localStorage.getItem(key);if(raw!==null){try{storage[key]=JSON.parse(raw)}catch{storage[key]=raw}}});
    return {schema:2,updatedAt:Date.now(),updatedBy:storage.rio2027_v2?.currentUser||'visitante',storage};
  }
  function chip(){
    let node=document.getElementById('rioSyncChip');
    if(node)return node;
    node=document.createElement('span');node.id='rioSyncChip';node.className='rio-sync-chip';
    const bar=document.querySelector('.v2-topbar-inner');if(bar)bar.appendChild(node);
    return node;
  }
  function status(text,state='') {const node=chip();node.textContent=text;node.dataset.state=state;}
  async function request(method,body){
    const url=endpoint();if(!url)throw new Error('Firebase no configurado');
    const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store'});
    if(!response.ok)throw new Error(`Firebase ${response.status}`);
    return response.json();
  }
  async function push(){
    if(applying)return;
    const data=snapshot();status('☁️ Guardando…');
    try{await request('PUT',data);lastRemote=data.updatedAt;localStorage.setItem(stampKey,String(lastRemote));status('☁️ Compartido','ok')}
    catch(error){status('⚠️ Sólo este equipo','error');console.warn('Firebase sin acceso. Revisá las reglas rio2027:',error.message)}
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(push,650)}
  function applyRemote(remote){
    if(!remote?.storage)return false;
    applying=true;
    keys.forEach(key=>{if(Object.prototype.hasOwnProperty.call(remote.storage,key))localStorage.setItem(key,JSON.stringify(remote.storage[key]))});
    lastRemote=Number(remote.updatedAt)||Date.now();localStorage.setItem(stampKey,String(lastRemote));
    sessionStorage.setItem('rio2027_remote_applied',String(lastRemote));
    location.reload();
    return true;
  }
  async function pull(initial=false){
    try{
      const remote=await request('GET');
      if(!remote){if(initial)schedule();return}
      const remoteAt=Number(remote.updatedAt)||0;
      const applied=Number(sessionStorage.getItem('rio2027_remote_applied')||0);
      if(remoteAt>lastRemote&&remoteAt!==applied){applyRemote(remote);return}
      lastRemote=Math.max(lastRemote,remoteAt);localStorage.setItem(stampKey,String(lastRemote));status('☁️ Compartido','ok');
    }catch(error){status('⚠️ Sólo este equipo','error');if(initial)console.warn('Firebase todavía no habilitado para rio2027:',error.message)}
  }

  window.addEventListener('rio:state-changed',schedule);
  window.addEventListener('storage',event=>{if(keys.includes(event.key))schedule()});
  pull(true);
  setInterval(()=>pull(false),20000);
})();
