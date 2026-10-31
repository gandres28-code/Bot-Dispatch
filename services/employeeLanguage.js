'use strict';
const express=require('express');
const MANAGERS=new Set(['admin','manager','owner','company owner','general manager','corporate','dispatch','operations','supervisor']);
const canManage=user=>String(user?.role||'').toLowerCase().split(/\s*[/,;]\s*/).some(r=>MANAGERS.has(r));
function createLanguageService({query,resolveUser,emit=()=>{}}){
 const cache=new Map(),attempts=new Map();
 async function languageFor(user){
  if(!user?.code)return 'es';
  const key=String(user.code),cached=cache.get(key);if(cached&&cached.expires>Date.now())return cached.language;
  const result=await query('SELECT app_language FROM employees WHERE code=$1 LIMIT 1',[key]);
  const language=result.rows[0]?.app_language==='en'?'en':'es';
  if(cache.size>2000)cache.clear();cache.set(key,{language,expires:Date.now()+60000});return language;
 }
 const router=express.Router();
 router.use((req,res,next)=>{
  if(req.path!=='/employee-preferences'&&!/^\/v2\/employees\/[^/]+\/language$/.test(req.path))return next('router');
  next();
 });
 router.use(async(req,res,next)=>{
  res.set('Cache-Control','no-store');const ip=req.ip,now=Date.now();
  for(const [key,v]of attempts)if(v.until<now)attempts.delete(key);
  if((attempts.get(ip)?.count||0)>=20)return res.status(429).json({ok:false,message:'Demasiados intentos. Espera un minuto.'});
  try{const code=String(req.get('X-Care-Code')||'').trim();const user=code&&code.length<=120?await resolveUser(code):null;
   if(!user?.active){const a=attempts.get(ip)||{count:0,until:now+60000};a.count++;attempts.set(ip,a);return res.status(401).json({ok:false,message:'Inicia sesión con tu código activo.'});}
   req.careUser=user;next();
  }catch{return res.status(503).json({ok:false,message:'No fue posible verificar tu acceso. Intenta nuevamente.'});}
 });
 router.get('/employee-preferences',async(req,res)=>{try{res.json({ok:true,language:await languageFor(req.careUser)});}catch{res.status(503).json({ok:false,message:'No se pudo cargar el idioma. Intenta nuevamente.'});}});
 router.patch('/v2/employees/:id/language',async(req,res)=>{
  if(!canManage(req.careUser))return res.status(403).json({ok:false,message:'Solo un encargado puede cambiar el idioma del empleado.'});
  const id=String(req.params.id||''),language=req.body?.language;
  if(!/^[1-9]\d*$/.test(id)||!['es','en'].includes(language))return res.status(400).json({ok:false,message:'Selecciona español o inglés.'});
  try{
   const r=await query('UPDATE employees SET app_language=$1, updated_at=NOW() WHERE id=$2 RETURNING id,code,app_language',[language,id]);
   if(!r.rows.length)return res.status(404).json({ok:false,message:'Empleado no encontrado'});
   cache.delete(String(r.rows[0].code));
   res.json({ok:true,employee:{id:r.rows[0].id,language:r.rows[0].app_language}});
   try{emit('employee-preferences-updated',{});}catch{}
  }catch{res.status(503).json({ok:false,message:'No se pudo guardar el idioma. Intenta nuevamente.'});}
 });
 return {router,languageFor};
}
module.exports={createLanguageService,canManage};
