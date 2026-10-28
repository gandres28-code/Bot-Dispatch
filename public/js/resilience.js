/* Care OS: bounded requests, durable per-action outbox and reconnect reconciliation. */
(() => {
  'use strict';
  const PREFIX='care:outbox:v2:', LEGACY='care:pending-actions:v1', CACHE='care:cache:';
  const ALLOWED=new Set(['/action','/inspector-action','/api/service-orders']);
  const reads=new Map(), sending=new Map();
  let flushing=false, socket=null, socketBound=false, connected=false, httpHealthy=false, lastNetworkError=false;
  let badge=null, panel=null;
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const parse=(value,fallback)=>{try{return JSON.parse(value);}catch{return fallback;}};
  const owner=()=>String(localStorage.getItem('employeeName')||localStorage.getItem('cleanerName')||'').trim().toLowerCase();
  const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const id=()=>window.crypto?.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
  function entries(all=false){
    const out=[];
    for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith(PREFIX)){const item=parse(localStorage.getItem(key),null);if(item?.id&&(all||item.owner===owner()))out.push(item);}}
    return out.sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));
  }
  function persist(item){
    // A storage failure is an error, never an offline success. No queue truncation.
    try{localStorage.setItem(PREFIX+item.id,JSON.stringify(item));if(!localStorage.getItem(PREFIX+item.id))throw Error();}
    catch{throw new Error('No se pudo guardar la acción en este dispositivo. Mantén la pantalla abierta y vuelve a intentar cuando haya conexión.');}
    changed();
  }
  function changed(){window.dispatchEvent(new CustomEvent('care:outbox-changed'));renderStatus();}
  function retryable(error){return !error.permanent && (!error.status||[408,425,429].includes(error.status)||error.status>=500);}
  async function request(url,options={},config={}){
    const method=(options.method||'GET').toUpperCase(),safeRead=['GET','HEAD'].includes(method);
    const retries=safeRead||config.idempotent?Number(config.retries??1):0;
    for(let attempt=0;;attempt++){
      const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),config.timeoutMs||10000);
      const cancel=()=>controller.abort();if(options.signal){if(options.signal.aborted)cancel();else options.signal.addEventListener('abort',cancel,{once:true});}
      try{
        const response=await fetch(url,{...options,signal:controller.signal,headers:{Accept:'application/json',...(options.headers||{})}});
        let data;try{data=await response.json();}catch{const e=new Error('El servidor no confirmó una respuesta válida.');e.status=response.status>=400?response.status:502;throw e;}
        if(!response.ok||data.ok===false||data.success===false){const e=new Error(data.message||data.error||`Error ${response.status}`);e.status=response.status>=400?response.status:422;e.permanent=data.retryable===false;throw e;}
        lastNetworkError=false;httpHealthy=true;renderStatus();return data;
      }catch(error){
        if(options.signal?.aborted)throw error;
        const e=error.name==='AbortError'?Object.assign(new Error('La conexión está tardando. No se confirmó el guardado.'),{timeout:true}):error;
        if(retryable(e)){lastNetworkError=true;httpHealthy=false;}renderStatus();
        if(attempt>=retries||!retryable(e))throw e;
        await sleep(250*(attempt+1)+Math.floor(Math.random()*150));
      }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);}
    }
  }
  function fetchJson(url,options={},config={}){
    const method=(options.method||'GET').toUpperCase();
    if(method!=='GET'||options.signal)return request(url,options,config);
    // Timestamp cache busters do not create duplicate concurrent reads for the same resource.
    const key=String(url).replace(/([?&])t=\d+(&|$)/,'$1').replace(/[?&]$/,'')+'|'+JSON.stringify(options.headers||{});
    if(reads.has(key))return reads.get(key);
    const pending=request(url,options,config).finally(()=>reads.delete(key));reads.set(key,pending);return pending;
  }
  function snapshotKey(key){return CACHE+owner()+':'+day()+':'+key;}
  function saveSnapshot(key,value){try{localStorage.setItem(snapshotKey(key),JSON.stringify({savedAt:Date.now(),value}));}catch{}}
  function loadSnapshot(key,maxAge=12*3600000){const item=parse(localStorage.getItem(snapshotKey(key)),null);return item&&Date.now()-item.savedAt<maxAge?item.value:null;}
  function resultQueued(item){return {success:false,ok:false,queuedOffline:true,pendingId:item.id,message:'Guardado en este dispositivo; pendiente de confirmación del servidor.'};}
  async function sendStored(item){
    if(sending.has(item.id))return sending.get(item.id);
    const send=async()=>{
      const current=parse(localStorage.getItem(PREFIX+item.id),null);
      if(!current)return {ok:true,success:true,duplicate:true};
      if(current.owner!==owner())return resultQueued(current);
      if(current.state==='blocked')return resultQueued(current);
      try{
        const data=await request(current.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(current.payload)},{timeoutMs:6500,retries:0,idempotent:true});
        localStorage.removeItem(PREFIX+item.id);changed();
        window.dispatchEvent(new CustomEvent('care:action-confirmed',{detail:{...current,response:data}}));return data;
      }catch(error){
        // Keep permanent failures visible for review. Never silently drop an action.
        const latest=parse(localStorage.getItem(PREFIX+item.id),current);
        latest.attempts=(latest.attempts||0)+1;latest.error=error.message;
        latest.state=retryable(error)?'pending':'blocked';persist(latest);
        if(!retryable(error))throw error;
        return resultQueued(latest);
      }
    };
    const pending=(navigator.locks?.request?navigator.locks.request('care-outbox:'+item.id,send):send()).finally(()=>sending.delete(item.id));
    sending.set(item.id,pending);return pending;
  }
  async function postAction(url,payload){
    if(!ALLOWED.has(url))throw new Error('Este tipo de guardado requiere conexión.');
    const currentOwner=owner();if(!currentOwner)throw new Error('Inicia sesión antes de guardar.');
    const body={...payload,requestId:payload.requestId||id(),workDate:payload.workDate||day(),occurredAt:payload.occurredAt||new Date().toISOString()};
    const existing=parse(localStorage.getItem(PREFIX+body.requestId),null);
    if(existing)return navigator.onLine===false?resultQueued(existing):sendStored(existing);
    if(entries(true).length>=500)throw new Error('Hay demasiados pendientes sin confirmar. Revisa la conexión con tu encargado.');
    const item={id:body.requestId,url,payload:body,owner:currentOwner,createdAt:Date.now(),state:'pending',attempts:0};
    const previous=entries().some(e=>e.payload?.unit===body.unit&&e.payload?.room===body.room);
    persist(item); // Persist before the first HTTP call; safe if the tab closes after sending.
    if(navigator.onLine===false||previous)return resultQueued(item);
    return sendStored(item);
  }
  async function flushQueue(){
    if(flushing||navigator.onLine===false||!owner())return;
    flushing=true;const stoppedUnits=new Set();
    try{
      for(const item of entries()){
        const unit=item.payload.unit||item.payload.room||item.id;
        if(stoppedUnits.has(unit))continue;
        if(item.state==='blocked'){stoppedUnits.add(unit);continue;}
        // A previous day's unconfirmed action is kept for the supervisor; never applied to today's room.
        if(item.payload.workDate!==day()){
          persist({...item,state:'blocked',error:'Pendiente de un turno anterior. Revisa con tu encargado.'});stoppedUnits.add(unit);continue;
        }
        try{const data=await sendStored(item);if(data.queuedOffline)break;}catch{stoppedUnits.add(unit);}
      }
    }finally{flushing=false;renderStatus();}
  }
  function retryPending(){for(const item of entries()){if(item.state==='blocked'&&item.payload.workDate===day())persist({...item,state:'pending'});}return flushQueue();}
  function migrate(){
    const old=parse(localStorage.getItem(LEGACY),[]);if(!Array.isArray(old)||!old.length)return;
    // Unscoped legacy actions cannot be attributed safely. Keep them for explicit review.
    for(const item of old){if(!item?.id||localStorage.getItem(PREFIX+item.id))continue;persist({...item,owner:String(item.payload?.name||item.payload?.requestedBy||'').toLowerCase(),state:'blocked',error:'Pendiente de la versión anterior. Revisa unidad y turno antes de reenviarlo.',payload:{...item.payload,workDate:item.payload?.workDate||'legacy-review'}});}
    localStorage.removeItem(LEGACY);
  }
  function latestLoader(fn){
    let running=null,rerun=false,lastArgs=[];
    return function(...args){lastArgs=args;if(running){rerun=true;return running;}
      running=(async()=>{let result;do{rerun=false;result=await fn(...lastArgs);}while(rerun);return result;})().finally(()=>running=null);return running;
    };
  }
  function watch(refresh,{interval=30000}={}){
    const run=()=>{if(!document.hidden&&navigator.onLine!==false)Promise.resolve().then(refresh).catch(()=>{});};
    const timer=setInterval(run,interval+Math.floor(Math.random()*1500));
    window.addEventListener('online',run);window.addEventListener('care:reconnected',run);window.addEventListener('care:action-confirmed',run);
    document.addEventListener('visibilitychange',run);return ()=>clearInterval(timer);
  }
  function attachSocket(candidate){
    if(socketBound||!candidate)return socket;socket=candidate;socketBound=true;connected=Boolean(socket.connected);
    socket.on('connect',()=>{connected=true;lastNetworkError=false;renderStatus();window.dispatchEvent(new CustomEvent('care:reconnected'));flushQueue();});
    socket.on('disconnect',()=>{connected=false;renderStatus();});socket.on('connect_error',()=>{connected=false;renderStatus();});return socket;
  }
  function getSocket(){if(socket)return socket;if(window.OS?.socket)return attachSocket(OS.socket);if(typeof window.io==='function')return attachSocket(io({transports:['polling','websocket'],reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:500,reconnectionDelayMax:8000,randomizationFactor:.5,timeout:10000}));return null;}
  function renderStatus(){
    if(!badge)return;const pending=entries(),blocked=pending.filter(e=>e.state==='blocked').length;
    badge.textContent=navigator.onLine===false?'Sin conexión':lastNetworkError?'Reintentando conexión':(connected||httpHealthy)?'En línea':'Reconectando';
    if(pending.length)badge.textContent+=` · ${pending.length} pendiente${pending.length===1?'':'s'}${blocked?' por revisar':''}`;
    badge.style.background=pending.length||(!connected&&!httpHealthy)||lastNetworkError?'#80551d':'#176b46';
    if(panel&&!panel.hidden){
      panel.replaceChildren();const title=document.createElement('strong');title.textContent='Estado de conexión y guardados';panel.append(title);
      const hint=document.createElement('p');hint.textContent='“Pendiente” no significa guardado en el servidor. Las fotos y los pagos requieren conexión.';panel.append(hint);
      for(const item of pending){const line=document.createElement('p');line.textContent=`${item.payload.unit||item.payload.room||'Unidad'} · ${item.payload.action||'Solicitud'} · ${item.state==='blocked'?'Revisar: '+item.error:'Pendiente de confirmar'}`;panel.append(line);if(item.state==='blocked'){const remove=document.createElement('button');remove.textContent='Descartar este pendiente';remove.onclick=()=>{if(window.confirm('¿Descartar este pendiente local? Esta acción no borra registros del servidor.')){localStorage.removeItem(PREFIX+item.id);changed();}};panel.append(remove);}}
      if(!pending.length){const line=document.createElement('p');line.textContent='Este usuario no tiene acciones pendientes en este navegador.';panel.append(line);}
      const retry=document.createElement('button');retry.textContent='Reintentar pendientes del turno';retry.onclick=retryPending;panel.append(retry);
    }
  }
  function mount(){
    // Embedded modules use the parent indicator, avoiding several overlays in one screen.
    if(window.top!==window.self){try{if(window.parent.OSResilience)return;}catch{}}
    const style=document.createElement('style');style.textContent='.care-network{position:fixed;right:12px;bottom:calc(88px + env(safe-area-inset-bottom));z-index:1800;max-width:calc(100vw - 24px);border:0;border-radius:20px;padding:8px 12px;color:#fff;font:600 11px system-ui;box-shadow:0 3px 12px #0002;cursor:pointer}.care-network-panel{position:fixed;right:12px;bottom:calc(132px + env(safe-area-inset-bottom));z-index:1801;width:min(355px,calc(100vw - 24px));max-height:55vh;overflow:auto;background:#fff;color:#172b42;border:1px solid #dce4eb;border-radius:12px;padding:18px;font:12px/1.5 system-ui;box-shadow:0 10px 40px #0003}.care-network-panel[hidden]{display:none}.care-network-panel button{padding:9px;border:1px solid #dce4eb;border-radius:8px;background:#f3f6f8;cursor:pointer}@media print{.care-network,.care-network-panel{display:none}}';document.head.append(style);
    badge=document.createElement('button');badge.type='button';badge.className='care-network';badge.setAttribute('aria-live','polite');badge.setAttribute('aria-label','Estado de conexión y acciones pendientes');panel=document.createElement('section');panel.className='care-network-panel';panel.hidden=true;
    badge.onclick=()=>{panel.hidden=!panel.hidden;badge.setAttribute('aria-expanded',String(!panel.hidden));renderStatus();};document.body.append(badge,panel);renderStatus();
  }
  window.OSResilience={fetchJson,postAction,flushQueue,pendingCount:()=>entries().length,saveSnapshot,loadSnapshot,getSocket,attachSocket,latestLoader,watch,requestId:id,pendingItems:()=>entries(),retryPending};
  window.addEventListener('online',()=>{renderStatus();flushQueue();});window.addEventListener('offline',renderStatus);
  window.addEventListener('storage',e=>{if(e.key?.startsWith(PREFIX))renderStatus();});
  window.addEventListener('os-ready',()=>{getSocket();flushQueue();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){renderStatus();flushQueue();}});
  setInterval(flushQueue,15000);
  const boot=()=>{mount();try{migrate();}catch(e){console.warn(e.message);}getSocket();fetchJson('/api/ping',{}, {timeoutMs:4000,retries:0}).catch(()=>{});flushQueue();};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
