'use strict';
const crypto=require('node:crypto'), path=require('node:path');
const COOKIE='__Host-care_access';
const digest=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
function clientInfo(req){
 const ua=String(req.headers['user-agent']||'').slice(0,500);
 const os=/iPhone|iPad|iPod/.test(ua)?'iOS / iPadOS':/Android/.test(ua)?'Android':/Windows/.test(ua)?'Windows':/Macintosh|Mac OS/.test(ua)?'macOS':/Linux/.test(ua)?'Linux':'No identificado';
 const browser=/Edg\//.test(ua)?'Edge':/OPR\//.test(ua)?'Opera':/Firefox\/|FxiOS\//.test(ua)?'Firefox':/Chrome\/|CriOS\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':'Navegador no identificado';
 return{os,browser,kind:/iPad|Tablet/.test(ua)?'Tablet':/Mobile|iPhone|Android/.test(ua)?'Teléfono':'Computadora u otro',userAgent:ua};
}
const equal=(a,b)=>crypto.timingSafeEqual(Buffer.from(digest(a)),Buffer.from(digest(b)));
function createAccessGuard({query,resolveEmployee,listEmployees=async()=>[],env=process.env,now=()=>Date.now()}){
 const origin=env.CARE_PUBLIC_ORIGIN,secret=env.CARE_OWNER_SECRET;
 const configured=()=>/^https:\/\//.test(origin||'')&&secret?.length>=32;
 let init;
 function ready(){return init||(init=query(`CREATE TABLE IF NOT EXISTS care_access_devices (
 id uuid PRIMARY KEY, token_hash text UNIQUE NOT NULL, employee_id text, employee_name text NOT NULL,
 label text NOT NULL, access_level text NOT NULL DEFAULT 'staff', status text NOT NULL DEFAULT 'pending',
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, last_seen_at timestamptz,
 reviewed_at timestamptz, reviewer_id uuid
 );
 ALTER TABLE care_access_devices ADD COLUMN IF NOT EXISTS first_open_at timestamptz;
 ALTER TABLE care_access_devices ADD COLUMN IF NOT EXISTS last_open_at timestamptz;
 ALTER TABLE care_access_devices ADD COLUMN IF NOT EXISTS client_info jsonb NOT NULL DEFAULT '{}';
 CREATE TABLE IF NOT EXISTS care_access_events (
 id uuid PRIMARY KEY, device_id uuid NOT NULL REFERENCES care_access_devices(id),
 event_type text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
 path text NOT NULL DEFAULT '', client_info jsonb NOT NULL DEFAULT '{}',
 actor_id uuid REFERENCES care_access_devices(id)
 );
 CREATE INDEX IF NOT EXISTS care_access_events_recent ON care_access_events(occurred_at DESC,id DESC);
 CREATE INDEX IF NOT EXISTS care_access_events_device ON care_access_events(device_id,occurred_at DESC);
 `).catch(e=>{init=null;throw e;}));}
 const visitAttempts=new Map();
 function allowVisit(id){const t=now();for(const[k,v]of visitAttempts)if(v.until<t)visitAttempts.delete(k);const v=visitAttempts.get(id)||{n:0,until:t+60000};v.n++;visitAttempts.set(id,v);return v.n<=30;}
 async function event(req,d,type,pathname='',actor=null){
  if(!d)return;
  const info=JSON.stringify(clientInfo(req));
  // The timestamp comes from PostgreSQL, never the visitor's clock.
  await query('INSERT INTO care_access_events(id,device_id,event_type,path,client_info,actor_id) VALUES($1,$2,$3,$4,$5::jsonb,$6)',[crypto.randomUUID(),d.id,type,String(pathname).split('?')[0].slice(0,160),info,actor]);
  if(['app_open','app_resume','access_request','owner_login','blocked_open'].includes(type))
   await query(`UPDATE care_access_devices SET last_seen_at=now(),client_info=$2::jsonb,
    first_open_at=CASE WHEN $3 IN ('app_open','app_resume') THEN COALESCE(first_open_at,now()) ELSE first_open_at END,
    last_open_at=CASE WHEN $3 IN ('app_open','app_resume') THEN now() ELSE last_open_at END WHERE id=$1`,[d.id,info,type]);
 }
 const documentVisit=req=>req.method==='GET'&&req.get('Sec-Fetch-Dest')==='document'&&!req.path.startsWith('/api/')&&!req.path.startsWith('/access/')&&(!/\.[a-z0-9]+$/i.test(req.path)||req.path.endsWith('.html'));
 const attempts=new Map();
 function limited(key){const t=now();for(const [k,v]of attempts)if(v.until<t)attempts.delete(k);const v=attempts.get(key)||{n:0,until:t+900000};v.n++;attempts.set(key,v);return v.n>10;}
 const token=req=>{const match=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='));return match?.slice(COOKIE.length+1)||'';};
 const cookie=(res,t,age)=>res.setHeader('Set-Cookie',`${COOKIE}=${t}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`);
 async function record(req,includeExpired=false){const t=token(req);if(!/^[a-f0-9]{64}$/.test(t))return null;await ready();return(await query('SELECT * FROM care_access_devices WHERE token_hash=$1'+(includeExpired?'':' AND expires_at>now()'),[digest(t)])).rows[0]||null;}
 async function active(req){const d=await record(req);if(!d||d.status!=='approved')return null;if(d.employee_id){const u=await resolveEmployee({id:d.employee_id});if(!u?.active||u.id!==d.employee_id)return null;d.user=u;}return d;}
 function sameOrigin(req){return req.headers.origin===origin;}
 async function create(req,res,user,level,status,hours){await ready();const t=crypto.randomBytes(32).toString('hex'),id=crypto.randomUUID();await query('INSERT INTO care_access_devices(id,token_hash,employee_id,employee_name,label,access_level,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,digest(t),user?.id||null,user?.name||'Propietario',String(req.body.label||'Mi dispositivo').trim().slice(0,80),level,status,new Date(now()+hours*3600000)]);cookie(res,t,hours*3600);await event(req,{id},level==='owner'?'owner_login':'access_request','/access');return id;}
 async function middleware(req,res,next){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','SAMEORIGIN');
  try{
   if(req.path==='/health/access')return res.status(configured()?200:503).json({ok:configured()});
   if(req.path==='/access'&&req.method==='GET'){
    if(configured()&&documentVisit(req)){const d=await record(req,true);if(d&&allowVisit(d.id))await event(req,d,await active(req)?'app_open':'blocked_open','/access');}
    return res.sendFile(path.resolve(__dirname,'../private/access.html'));
   }
   if(!configured())return res.status(503).json({ok:false,error:'Acceso cerrado. Falta configurar la protección con el propietario.'});
   if(req.path.startsWith('/access/')){
    if(req.method!=='GET'&&!sameOrigin(req))return res.status(403).json({ok:false,error:'Solicitud no permitida.'});
    if(req.path==='/access/request'&&req.method==='POST'){
     if(limited('request:'+(req.ip||req.socket.remoteAddress)))return res.status(429).json({ok:false,error:'Demasiados intentos. Espera 15 minutos.'});
     const code=String(req.body.code||'').trim(),user=code.length<=120?await resolveEmployee({code}):null;
     if(!user?.active||!code||!equal(code,user.code))return res.status(401).json({ok:false,error:'No se pudo verificar el acceso.'});
     const existing=await record(req,true);
     if(existing?.status==='revoked')return res.status(403).json({ok:false,error:'Este acceso está bloqueado. Contacta al propietario.'});
     if(existing?.employee_id===user.id&&existing.status==='pending'&&new Date(existing.expires_at)>now())
      return res.status(202).json({ok:true,id:existing.id,status:'pending'});
     const id=await create(req,res,user,'staff','pending',24*7);return res.status(202).json({ok:true,id,status:'pending'});
    }
    if(req.path==='/access/owner'&&req.method==='POST'){
     if(limited('owner:'+(req.ip||req.socket.remoteAddress)))return res.status(429).json({ok:false,error:'Demasiados intentos. Espera 15 minutos.'});
     if(!equal(req.body.secret||'',secret))return res.status(401).json({ok:false,error:'No se pudo verificar el acceso.'});
     await create(req,res,null,'owner','approved',8);return res.json({ok:true});
    }
    if(req.path==='/access/status'&&req.method==='GET'){const d=await record(req),valid=d?.status==='approved'?await active(req):null;return res.json({ok:true,status:d?.status==='approved'&&!valid?'inactive':d?.status||'unknown',level:valid?d.access_level:null,id:d?.id||null});}
    if(req.path==='/access/visit'&&req.method==='POST'){
     const d=await record(req,true);
     if(!d)return res.status(401).json({ok:false,error:'No hay un acceso registrado.'});
     if(!allowVisit(d.id))return res.status(429).json({ok:false,error:'Demasiadas actualizaciones.'});
     if(req.body.kind!=='resume'||!/^\/[a-z0-9/_-]*(?:\.html)?$/i.test(String(req.body.path||'')))return res.status(400).json({ok:false,error:'Actividad inválida.'});
     const valid=await active(req);
     await event(req,d,valid?'app_resume':'blocked_open',req.body.path);
     return res.status(valid?200:401).json({ok:!!valid});
    }
    if(req.path==='/access/logout'&&req.method==='POST'){const d=await record(req);if(d){await query("UPDATE care_access_devices SET status='revoked',reviewed_at=now() WHERE id=$1",[d.id]);await event(req,d,'logout','/access',d.id);}cookie(res,'',0);return res.json({ok:true});}
    const owner=await active(req);if(owner?.access_level!=='owner')return res.status(403).json({ok:false,error:'Solo el propietario puede administrar accesos.'});
    if(req.path==='/access/block'&&req.method==='POST'){
     const id=String(req.body.id||'');
     if(!/^[a-f0-9-]{36}$/i.test(id)||id===owner.id)return res.status(400).json({ok:false,error:'Para cerrar este acceso usa Cerrar y retirar este acceso.'});
     const result=await query("UPDATE care_access_devices SET status='revoked',reviewed_at=now(),reviewer_id=$2 WHERE id=$1 RETURNING id",[id,owner.id]);
     if(!result.rows.length)return res.status(404).json({ok:false,error:'Dispositivo no encontrado.'});
     await event(req,{id},'revoked','/access',owner.id);return res.json({ok:true});
    }
    if(req.path==='/access/people'&&req.method==='GET'){
     const roster=(await listEmployees()).map(u=>({id:u.id,name:u.name,active:u.active,role:u.role}));
     const summary=(await query(`SELECT employee_id,MAX(employee_name) AS employee_name,COUNT(*)::int AS device_count,
      COUNT(*) FILTER(WHERE status='approved' AND expires_at>now())::int AS approved_count,
      COUNT(*) FILTER(WHERE status='pending' AND expires_at>now())::int AS pending_count,
      MAX(last_open_at) AS last_open_at FROM care_access_devices WHERE employee_id IS NOT NULL GROUP BY employee_id`)).rows;
     const summaries=new Map(summary.map(d=>[d.employee_id,d]));
     const people=roster.map(u=>({...u,...summaries.get(u.id)}));
     for(const d of summary)if(!roster.some(u=>u.id===d.employee_id))people.push({...d,id:d.employee_id,name:d.employee_name,active:false,role:'Fuera de Employees'});
     return res.json({ok:true,people});
    }
    if(req.path==='/access/devices'&&req.method==='GET'){
     const offset=Number(req.query.offset||0);
     if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)return res.status(400).json({ok:false,error:'Página inválida.'});
     const employee=String(req.query.employee||'').slice(0,120);
     const rows=(await query(`SELECT id,employee_id,employee_name,label,access_level,status,created_at,expires_at,last_seen_at,first_open_at,last_open_at,client_info
      FROM care_access_devices WHERE ($1='' OR employee_id=$1) ORDER BY created_at DESC,id DESC LIMIT 101 OFFSET $2`,[employee,offset])).rows;
     return res.json({ok:true,devices:rows.slice(0,100),nextOffset:rows.length>100?offset+100:null});
    }
    if(req.path==='/access/events'&&req.method==='GET'){
     const offset=Number(req.query.offset||0),device=String(req.query.device||'');
     if(!Number.isSafeInteger(offset)||offset<0||offset>1000000||(device&&!/^[a-f0-9-]{36}$/i.test(device)))return res.status(400).json({ok:false,error:'Filtro inválido.'});
     const rows=(await query(`SELECT e.id,e.device_id,e.event_type,e.occurred_at,e.path,e.client_info,
      d.employee_name,d.label,a.employee_name AS actor_name
      FROM care_access_events e JOIN care_access_devices d ON d.id=e.device_id
      LEFT JOIN care_access_devices a ON a.id=e.actor_id
      WHERE ($1='' OR e.device_id::text=$1) ORDER BY e.occurred_at DESC,e.id DESC LIMIT 101 OFFSET $2`,[device,offset])).rows;
     return res.json({ok:true,events:rows.slice(0,100),nextOffset:rows.length>100?offset+100:null,timeZone:'America/Chicago'});
    }
    if(req.path==='/access/review'&&req.method==='POST'){
     const {id,status,level}=req.body;if(!/^[a-f0-9-]{36}$/i.test(id||'')||!['approved','revoked'].includes(status)||!['staff','manager'].includes(level))return res.status(400).json({ok:false,error:'Solicitud inválida.'});
     const result=await query("UPDATE care_access_devices SET status=$2,access_level=$3,reviewed_at=now(),reviewer_id=$4 WHERE id=$1 AND access_level<>'owner' AND expires_at>now() RETURNING id",[id,status,level,owner.id]);if(!result.rows.length)return res.status(404).json({ok:false,error:'Solicitud no disponible.'});await event(req,{id},status==='approved'?'approved':'revoked','/access',owner.id);return res.json({ok:true});
    }
    return res.status(404).json({ok:false,error:'Ruta no disponible.'});
   }
   const d=await active(req);
   if(!d){if(documentVisit(req)){const denied=await record(req,true);if(denied&&allowVisit(denied.id))await event(req,denied,'blocked_open',req.path);}if(req.method==='GET'&&req.accepts('html')&&!req.path.startsWith('/api/'))return res.redirect('/access');return res.status(401).json({ok:false,error:'Este navegador necesita autorización.',accessUrl:'/access'});}
   req.careAccess=d;
   if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!sameOrigin(req))return res.status(403).json({ok:false,error:'Solicitud no permitida.'});
   const supplied=String(req.get('X-Care-Code')||req.query.code||req.body?.code||'').trim();
   if(d.user&&supplied&&!equal(supplied,d.user.code))return res.status(403).json({ok:false,error:'Usa únicamente tu código personal.'});
   if(d.user&&req.path==='/login-role')return res.json({ok:true,...d.user});
   if(d.access_level==='staff'){
    const safe=/^\/(?:api\/(?:work|clock)(?:\/|$)|(?:work|time-clock|launch)(?:\.html)?$|js\/|css\/|icons\/|images\/|fonts\/|manifest\.webmanifest$|favicon\.ico$|firebase-messaging-sw\.js$)/.test(req.path);
    if(!safe){if(req.method==='GET'&&['/','/app','/APP','/app.html'].includes(req.path))return res.redirect('/work');return res.status(403).json({ok:false,error:'Esta sección requiere autorización de administración.'});}
   }
   if(documentVisit(req)&&allowVisit(d.id))await event(req,d,'app_open',req.path);
   return next();
  }catch(e){console.error('CARE ACCESS unavailable:',e.code||'verification_failed');return res.status(503).json({ok:false,error:'No se pudo verificar el acceso. Intenta nuevamente.'});}
 }
 async function allowSocket(req){if(!configured())return false;const d=await active(req);return !!d&&['manager','owner'].includes(d.access_level)&&req.headers.origin===origin;}
 return{middleware,allowSocket,record,active};
}
module.exports={createAccessGuard,digest,equal,clientInfo};
