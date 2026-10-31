'use strict';
const express=require('express');
const {readEmployeeLanguage}=require('./employeeLanguageValue');
const MANAGERS=new Set(['admin','manager','owner','company owner','general manager','corporate','dispatch','operations','supervisor']);
const canManage=user=>String(user?.role||'').toLowerCase().split(/\s*[/,;]\s*/).some(r=>MANAGERS.has(r));
function createLanguageService({readPage,resolveUser,clock=()=>Date.now()}){
 const cache=new Map(),attempts=new Map();
 async function languageFor(user){
  if(!user?.id)return user?.language==='en'?'en':'es';
  const key=String(user.id),cached=cache.get(key);if(cached&&cached.expires>clock())return cached.language;
  const page=await readPage(user.id);
  const language=readEmployeeLanguage(page);
  if(cache.size>2000)cache.clear();cache.set(key,{language,expires:clock()+60000});return language;
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
  res.status(409).json({ok:false,retryable:false,message:'El idioma se administra en Notion Employees, campo Idioma.'});
 });
 return {router,languageFor};
}
module.exports={createLanguageService,canManage};
