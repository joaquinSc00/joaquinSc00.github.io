(function(){
  'use strict';
  const cfg=window.RIO_FIREBASE||{};
  const plannerKey='rio2027_v2';
  const activitiesKey='rioActivitiesIntegratedV1';
  const legacyKey='rioLegacyMinimalV1';
  const migrationKey='rio2027_previous_app_migrated_v1';
  const keys=[plannerKey,activitiesKey,legacyKey];
  const stampKey='rio2027_rich_sync_timestamp';
  const dirtyKey='rio2027_rich_sync_dirty';
  const defaults={rates:{BRLARS:294,USDARS:1523,USDBRL:5.11},planSplit:{arraial:'personal',cristo:'personal',pao:'personal',museu:'personal',bonde:'personal',super:'shared'}};
  let timer=null,busy=false,applying=false,lastRemote=Number(localStorage.getItem(stampKey)||0);
  let dirtyKeys=new Set(readJson(dirtyKey,[]).filter(key=>keys.includes(key)));

  function readJson(key,fallback){
    try{const value=localStorage.getItem(key);return value===null?fallback:JSON.parse(value)}catch{return fallback}
  }
  function endpoint(){
    if(!cfg.databaseURL)return '';
    const root=String(cfg.root||'rio2027/shared').replace(/^\/+|\/+$/g,'');
    return `${String(cfg.databaseURL).replace(/\/$/,'')}/${root}/rich.json`;
  }
  function localStorageSnapshot(){return {[plannerKey]:readJson(plannerKey,{}),[activitiesKey]:readJson(activitiesKey,{}),[legacyKey]:readJson(legacyKey,{})}}
  function publicPlanner(value){const copy={...(value||{})};delete copy.currentUser;delete copy.displayCurrency;return copy}
  function identity(){return readJson(plannerKey,{}).currentUser||'visitante'}
  function payload(storage){return {schema:3,updatedAt:Date.now(),updatedBy:identity(),storage}}
  function rememberDirty(){localStorage.setItem(dirtyKey,JSON.stringify([...dirtyKeys]))}
  function meaningfulLocal(storage){
    if(Object.keys(storage[legacyKey]||{}).length)return true;
    if(Object.keys(storage[activitiesKey]||{}).length)return true;
    const plan=storage[plannerKey]||{};
    if(Array.isArray(plan.expenses)&&plan.expenses.length)return true;
    if(Object.values(plan.confirmed||{}).some(Boolean))return true;
    if(Object.keys(plan.rates||{}).some(key=>Number(plan.rates[key])!==Number(defaults.rates[key])))return true;
    if(Object.keys(plan.planSplit||{}).some(key=>plan.planSplit[key]!==defaults.planSplit[key]))return true;
    return false;
  }
  function mergeExpenses(remote=[],local=[]){
    const byId=new Map();[...remote,...local].forEach(item=>{if(item?.id)byId.set(item.id,item)});
    return [...byId.values()].sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
  }
  function mergeLegacy(remoteStorage={},localStorageData={}){
    const remotePlan=remoteStorage[plannerKey]||{},localPlan=localStorageData[plannerKey]||{};
    const localRatesChanged=Object.keys(localPlan.rates||{}).some(key=>Number(localPlan.rates[key])!==Number(defaults.rates[key]));
    return {
      ...remoteStorage,
      [plannerKey]:{
        ...remotePlan,...publicPlanner(localPlan),
        rates:localRatesChanged?{...(remotePlan.rates||{}),...(localPlan.rates||{})}:remotePlan.rates||localPlan.rates,
        confirmed:{...(remotePlan.confirmed||{}),...(localPlan.confirmed||{})},
        planSplit:{...(remotePlan.planSplit||{}),...(localPlan.planSplit||{})},
        expenses:mergeExpenses(remotePlan.expenses,localPlan.expenses),
      },
      [activitiesKey]:{...(remoteStorage[activitiesKey]||{}),...(localStorageData[activitiesKey]||{})},
      [legacyKey]:Object.keys(localStorageData[legacyKey]||{}).length?localStorageData[legacyKey]:(remoteStorage[legacyKey]||{}),
    };
  }
  function addRecoveredNote(current,text){
    const notes=String(current?.notes||'').trim();
    return notes.includes(text)?notes:[notes,text].filter(Boolean).join('\n');
  }
  function migratePreviousApp(){
    if(localStorage.getItem(migrationKey))return [];
    const old=readJson('rio.shared.backup',null);
    const oldProfile=localStorage.getItem('rio.profile');
    const oldCurrency=localStorage.getItem('rio.currency');
    const touched=new Set();
    const plan=readJson(plannerKey,{});
    const activities=readJson(activitiesKey,{});
    let planChanged=false;

    if(oldProfile&&!plan.currentUser){plan.currentUser=oldProfile==='Joaco'?'Joaquín':oldProfile;planChanged=true}
    if(['BRL','ARS','USD'].includes(oldCurrency)&&!lastRemote){plan.displayCurrency=oldCurrency;planChanged=true}
    if(old&&typeof old==='object'){
      localStorage.setItem(legacyKey,JSON.stringify({source:'rio.shared.backup',recoveredAt:new Date().toISOString(),data:old}));
      touched.add(legacyKey);

      const oldExpenses=Object.entries(old.expenses||{}).map(([id,item])=>({
        id:String(id),desc:String(item?.title||item?.desc||'Gasto recuperado'),amount:Number(item?.amount)||0,
        currency:['BRL','ARS','USD'].includes(item?.currency)?item.currency:'BRL',category:'Otro',split:'shared',
        paidBy:item?.payer==='Joaco'?'Joaquín':(item?.payer||'Joaquín'),createdAt:new Date(Number(item?.createdAt)||Date.now()).toISOString()
      })).filter(item=>item.amount>0);
      if(oldExpenses.length){plan.expenses=mergeExpenses(plan.expenses,oldExpenses);planChanged=true;touched.add(plannerKey)}

      if(old.rates&&Object.keys(plan.rates||{}).every(key=>Number(plan.rates[key])===Number(defaults.rates[key]))){
        const brlArs=Number(old.rates.ARS),usdPerBrl=Number(old.rates.USD);
        if(brlArs>0){
          const usdBrl=usdPerBrl>0?1/usdPerBrl:Number(plan.rates?.USDBRL)||defaults.rates.USDBRL;
          plan.rates={BRLARS:brlArs,USDBRL:Number(usdBrl.toFixed(4)),USDARS:Number((brlArs*usdBrl).toFixed(2))};
          planChanged=true;touched.add(plannerKey);
        }
      }

      Object.entries(old.votes||{}).forEach(([id,votes])=>{
        const voters=[];if(votes?.joaco)voters.push('Joaquín');if(votes?.nico)voters.push('Nico');if(!voters.length)return;
        const current=activities[id]||{state:'Pendiente',fav:false,notes:''};
        const label=`Votos recuperados: ${voters.join(' y ')}`;
        activities[id]={...current,state:current.state==='Pendiente'?(voters.length===2?'Finalista':'Me interesa'):current.state,fav:true,notes:addRecoveredNote(current,label),legacyVotes:{joaquin:!!votes.joaco,nico:!!votes.nico}};
        touched.add(activitiesKey);
      });
      Object.values(old.itinerary||{}).forEach(item=>{
        if(!item?.activityId)return;
        const current=activities[item.activityId]||{state:'Pendiente',fav:false,notes:''};
        const detail=[item.day,item.slot,item.note].filter(Boolean).join(' · ');
        const label=`Plan anterior recuperado${detail?`: ${detail}`:''}`;
        activities[item.activityId]={...current,state:'Finalista',fav:true,notes:addRecoveredNote(current,label)};
        touched.add(activitiesKey);
      });
    }
    if(planChanged)localStorage.setItem(plannerKey,JSON.stringify(plan));
    if(touched.has(activitiesKey))localStorage.setItem(activitiesKey,JSON.stringify(activities));
    localStorage.setItem(migrationKey,'1');
    return [...touched];
  }
  function chip(){
    let node=document.getElementById('rioSyncChip');if(node)return node;
    node=document.createElement('span');node.id='rioSyncChip';node.className='rio-sync-chip';node.tabIndex=0;node.title='Estado de sincronización de votos, notas y gastos';
    const bar=document.querySelector('.v2-topbar-inner');if(bar)bar.appendChild(node);return node;
  }
  function status(text,state=''){const node=chip();node.textContent=text;node.dataset.state=state}
  async function request(method,body){
    const url=endpoint();if(!url)throw new Error('Firebase no configurado');
    const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store'});
    if(!response.ok)throw new Error(`Firebase ${response.status}`);return response.json();
  }
  function writeLocal(storage){
    const current=localStorageSnapshot();
    keys.forEach(key=>{
      if(!Object.prototype.hasOwnProperty.call(storage,key))return;
      let value=storage[key];
      if(key===plannerKey)value={...value,currentUser:current[plannerKey]?.currentUser||null,displayCurrency:current[plannerKey]?.displayCurrency||'ARS'};
      localStorage.setItem(key,JSON.stringify(value));
    });
  }
  async function push(forceKeys){
    if(applying||busy)return;
    busy=true;
    const selected=new Set(forceKeys||dirtyKeys);
    if(!selected.size){busy=false;return}
    status('☁️ Guardando…');
    try{
      const remote=await request('GET');
      const local=localStorageSnapshot();
      const storage={...(remote?.storage||{})};
      if(selected.has(plannerKey))storage[plannerKey]=publicPlanner(local[plannerKey]);
      if(selected.has(activitiesKey))storage[activitiesKey]=local[activitiesKey];
      if(selected.has(legacyKey))storage[legacyKey]=local[legacyKey];
      const data=payload(storage);await request('PUT',data);
      selected.forEach(key=>dirtyKeys.delete(key));rememberDirty();
      lastRemote=data.updatedAt;localStorage.setItem(stampKey,String(lastRemote));sessionStorage.setItem('rio2027_remote_applied',String(lastRemote));
      status('☁️ Compartido','ok');
    }catch(error){status('⚠️ Pendiente de sincronizar','error');console.warn('Firebase no pudo guardar; se conserva la copia local:',error.message)}
    finally{busy=false}
  }
  function schedule(key){
    if(key&&keys.includes(key)){dirtyKeys.add(key);rememberDirty()}
    clearTimeout(timer);timer=setTimeout(()=>push(),700);
  }
  function applyRemote(remote){
    if(!remote?.storage)return false;
    applying=true;sessionStorage.setItem('rio2027_restore_scroll',String(Math.round(window.scrollY||0)));writeLocal(remote.storage);
    lastRemote=Number(remote.updatedAt)||Date.now();localStorage.setItem(stampKey,String(lastRemote));sessionStorage.setItem('rio2027_remote_applied',String(lastRemote));
    location.reload();return true;
  }
  async function migrate(remote,local){
    const storage=mergeLegacy(remote.storage||{},local);writeLocal(storage);
    const data=payload({...storage,[plannerKey]:publicPlanner(storage[plannerKey])});await request('PUT',data);
    dirtyKeys.clear();rememberDirty();lastRemote=data.updatedAt;localStorage.setItem(stampKey,String(lastRemote));sessionStorage.setItem('rio2027_remote_applied',String(lastRemote));
    status('☁️ Local recuperado y compartido','ok');
  }
  async function upgradeRemote(remote){
    const storage={...(remote?.storage||{})};
    storage[plannerKey]=publicPlanner(storage[plannerKey]||{});
    const data=payload(storage);await request('PUT',data);return data;
  }
  async function pull(initial=false){
    if(busy||applying)return;
    busy=true;
    try{
      let remote=await request('GET');const local=localStorageSnapshot();
      if(!remote){
        busy=false;keys.forEach(key=>dirtyKeys.add(key));rememberDirty();await push();return;
      }
      const remotePlan=remote.storage?.[plannerKey]||{};
      if(Number(remote.schema||0)<3||Object.prototype.hasOwnProperty.call(remotePlan,'currentUser')||Object.prototype.hasOwnProperty.call(remotePlan,'displayCurrency'))remote=await upgradeRemote(remote);
      if(initial&&!lastRemote&&meaningfulLocal(local)){await migrate(remote,local);return}
      if(dirtyKeys.size){busy=false;await push();return}
      const remoteAt=Number(remote.updatedAt)||0;const applied=Number(sessionStorage.getItem('rio2027_remote_applied')||0);
      if(remoteAt>lastRemote&&remoteAt!==applied){applyRemote(remote);return}
      lastRemote=Math.max(lastRemote,remoteAt);localStorage.setItem(stampKey,String(lastRemote));status('☁️ Compartido','ok');
    }catch(error){status(dirtyKeys.size?'⚠️ Pendiente de sincronizar':'⚠️ Sólo este equipo','error');if(initial)console.warn('Firebase todavía no está disponible; se usa la copia local:',error.message)}
    finally{busy=false}
  }

  const restoreY=Number(sessionStorage.getItem('rio2027_restore_scroll')||0);
  if(restoreY){sessionStorage.removeItem('rio2027_restore_scroll');requestAnimationFrame(()=>window.scrollTo({top:restoreY,behavior:'instant'}))}
  window.addEventListener('rio:state-changed',event=>schedule(event.detail?.key));
  window.addEventListener('storage',event=>{if(keys.includes(event.key))schedule(event.key)});
  window.addEventListener('online',()=>pull(false));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')pull(false)});
  migratePreviousApp().forEach(key=>dirtyKeys.add(key));rememberDirty();
  pull(true);setInterval(()=>pull(false),15000);
})();
