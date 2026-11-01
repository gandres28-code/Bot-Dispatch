'use strict';
const {canManage}=require('./clientDirectory');
function fail(message,status=400){const e=new Error(message);e.status=status;throw e;}
const uuid=v=>{if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v||''))fail('Identificador inválido.');return v;};
function text(v,max=2000){if(v!=null&&typeof v!=='string')fail('Texto inválido.');const s=(v||'').trim();if(s.length>max)fail('Texto demasiado largo.');return s;}
function day(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)fail('Fecha inválida.');return value;}
const localDay=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
const manager=u=>canManage(u)||String(u?.role||'').toLowerCase().split(/\s*[/,;]\s*/).includes('dispatch');
function inspector(u){return manager(u)||String(u?.role||'').toLowerCase().split(/\s*[/,;]\s*/).includes('inspector');}
async function transaction(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
function distance(a,b){const rad=v=>v*Math.PI/180,lat=rad(b.lat-a.lat),lng=rad(b.lng-a.lng);return 6371000*2*Math.asin(Math.sqrt(Math.min(1,Math.sin(lat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(lng/2)**2)));}
function gps(b,now=Date.now()){
 if([b.lat,b.lng,b.accuracy].some(v=>v==null||v===''||typeof v!=='number'||!Number.isFinite(v)))fail('Activa ubicación y solicita una señal GPS nueva.');
 if(Math.abs(b.lat)>90||Math.abs(b.lng)>180||b.accuracy<0||b.accuracy>5000)fail('La señal GPS no es válida.');
 const captured=Date.parse(b.capturedAt);if(!Number.isFinite(captured)||captured<now-120000||captured>now+30000)fail('La ubicación venció. Solicita una señal nueva.');
 return{lat:b.lat,lng:b.lng,accuracy:b.accuracy,capturedAt:new Date(captured).toISOString()};
}
function inside(point,l){if(l.latitude==null||l.longitude==null||point.accuracy>Math.min(l.radius_m,100))return false;return distance(point,{lat:Number(l.latitude),lng:Number(l.longitude)})+point.accuracy<=l.radius_m;}
function middleware(resolveUser){const attempts=new Map();return async(req,res,next)=>{
 res.set('Cache-Control','no-store');const now=Date.now();for(const[k,v]of attempts)if(v.until<now)attempts.delete(k);
 if((attempts.get(req.ip)?.count||0)>=20)return res.status(429).json({ok:false,error:'Espera un minuto antes de intentar otra vez.'});
 try{const code=String(req.get('X-Care-Code')||'').trim();const u=code&&code.length<=120?await resolveUser(code):null;
 if(!u?.active||!u.id){const a=attempts.get(req.ip)||{count:0,until:now+60000};a.count++;attempts.set(req.ip,a);return res.status(401).json({ok:false,error:'Inicia sesión con tu código activo.'});}
 if(!String(u.name||'').trim())return res.status(400).json({ok:false,error:'El registro de empleado necesita un nombre.'});
 req.workUser=u;next();}catch{res.status(503).json({ok:false,error:'No se pudo verificar el acceso.'});}
};}
const route=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){if(!e.status)console.error('CARE WORK:',e.message);res.status(e.status||(e.code==='23505'?409:503)).json({ok:false,error:e.status?e.message:e.code==='23505'?'El registro ya existe. Actualiza antes de continuar.':'No se confirmó el guardado. Actualiza y reintenta con el mismo identificador.'});}};
const dateKey=v=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
function chicagoTime(date,time){
 day(date);if(!/^\d{2}:\d{2}$/.test(time||''))fail('Hora inválida.');
 const target=date+' '+time,naive=Date.parse(date+'T'+time+':00Z');
 const format=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const candidates=[300,360].map(offset=>new Date(naive+offset*60000)).filter(v=>Number.isFinite(v.getTime())&&format.format(v)===target);
 if(candidates.length!==1)fail('Esa hora coincide con un cambio de horario o no existe. Solicita revisión de la fecha y hora.');return candidates[0];
}
function payrollSnapshot(unitRead,hourly){
 const records=unitRead.records||[],warnings=[...(unitRead.warnings||[]),...(hourly.warnings||[])];
 if(hourly.incomplete)warnings.push('Historial de horas incompleto.');
 const invalid=records.some(r=>!r.cleaner||!Number.isFinite(Number(r.amount)))||hourly.some(r=>!r.employee||!Number.isFinite(Number(r.total))||r.hourlyRate<=0);
 if(invalid)warnings.push('Hay registros sin empleado o tarifa válida.');
 if(!records.length&&!hourly.length)warnings.push('No hay registros de nómina.');
 const names=new Set([...records.map(r=>r.cleaner),...hourly.map(r=>r.employee)]);
 return{valid:warnings.length===0,errors:warnings,summary:{records:records.length+hourly.length,employees:names.size,total:([...records.map(r=>Number(r.amount)),...hourly.map(r=>Number(r.total))].reduce((s,v)=>s+Math.round(v*100),0))/100},unitRecords:records,hourlyRecords:hourly};
}
module.exports={chicagoTime,payrollSnapshot,dateKey,fail,uuid,text,day,localDay,manager,inspector,transaction,distance,gps,inside,middleware,route};
