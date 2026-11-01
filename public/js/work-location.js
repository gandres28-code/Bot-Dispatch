'use strict';
(()=>{
 let watch=null,timer=null,lastSent=0,sessionId=null;
 const tx=(es,en)=>document.documentElement.lang==='en'?en:es;
 const code=()=>document.getElementById('code')?.value.trim()||localStorage.getItem('employeeCode')||'';
 const say=s=>{const el=document.getElementById('sharingStatus');if(el)el.textContent=s;};
 function stop(){if(watch!==null)navigator.geolocation?.clearWatch(watch);watch=null;clearInterval(timer);timer=null;sessionId=null;}
 async function disable(){stop();try{await fetch('/api/clock/presence',{method:'DELETE',headers:{'X-Care-Code':code()}});}catch{}say(tx('Ubicación compartida desactivada.','Location sharing is off.'));}
 async function enable(){
  if(!window.isSecureContext){say(tx('Abre la app por HTTPS para usar ubicación.','Open the app over HTTPS to use location.'));return false;}
  if(!navigator.geolocation){say(tx('Este dispositivo no ofrece ubicación.','This device does not support location.'));return false;}
  try{
   const r=await fetch('/api/clock/status',{headers:{'X-Care-Code':code()}}),body=await r.json();if(!r.ok||!body.active){say(tx('Primero registra Clock In para compartir ubicación.','Clock in before sharing location.'));return false;}
   stop();sessionId=body.active.id;say(tx('Solicitando permiso de ubicación…','Requesting location permission…'));
   watch=navigator.geolocation.watchPosition(async p=>{
    if(document.hidden||Date.now()-lastSent<30000)return;lastSent=Date.now();
    try{const res=await fetch('/api/clock/presence',{method:'POST',headers:{'Content-Type':'application/json','X-Care-Code':code()},body:JSON.stringify({sharing:true,lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,capturedAt:new Date(p.timestamp).toISOString()})}),data=await res.json();
     if(!res.ok){say(data.error||tx('No se confirmó la ubicación.','Location update was not confirmed.'));if(res.status===409||res.status===401){stop();const el=document.getElementById('shareLocation');if(el)el.checked=false;}return;}
     say((data.detectedLocation?tx('Propiedad aproximada: ','Approximate property: ')+data.detectedLocation:tx('Propiedad sin confirmar','Property not confirmed'))+' · ±'+Math.round(p.coords.accuracy)+' m · '+new Date().toLocaleTimeString()+tx('. No identifica habitación.','. Does not identify a room.'));
    }catch{say(tx('Sin conexión: no se está actualizando tu ubicación.','Offline: your location is not updating.'));}
   },e=>{if(e.code===1){stop();const el=document.getElementById('shareLocation');if(el)el.checked=false;}say(e.code===1?tx('Permiso denegado. Activa ubicación para este sitio en ajustes del teléfono.','Permission denied. Allow this site in your phone location settings.'):e.code===3?tx('GPS tardó demasiado. Intenta al aire libre.','GPS timed out. Try outdoors.'):tx('No hay señal GPS disponible.','GPS signal unavailable.'));},{enableHighAccuracy:true,timeout:20000,maximumAge:10000});
   timer=setInterval(async()=>{try{const r=await fetch('/api/clock/status',{headers:{'X-Care-Code':code()}}),b=await r.json();if(!r.ok||b.active?.id!==sessionId){await disable();const el=document.getElementById('shareLocation');if(el)el.checked=false;}}catch{say(tx('No se pudo verificar el turno.','Could not verify your shift.'));}},60000);
   return true;
  }catch{say(tx('No se pudo verificar el turno.','Could not verify your shift.'));return false;}
 }
 window.CareLocationTracker={enable,disable,stop};window.addEventListener('pagehide',stop);
 document.getElementById('shareLocation')?.addEventListener('change',async e=>{if(e.target.checked){if(!await enable())e.target.checked=false;}else await disable();});
})();
