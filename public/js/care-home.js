'use strict';
(async()=>{
 const $=id=>document.getElementById(id);
 try{
 const r=await fetch('/api/work/bootstrap',{headers:{'X-Care-Code':localStorage.getItem('employeeCode')||''}});
 if(r.status===401){location.replace('/launch');return;}if(!r.ok)throw Error();
 const b=await r.json(),en=b.user.language==='en',t=(es,eng)=>en?eng:es;
 document.documentElement.lang=en?'en':'es';$('access').textContent=b.user.name;
 $('homeEyebrow').textContent=t('TU CENTRO DE OPERACIONES','YOUR OPERATIONS HUB');
 $('homeTitle').textContent=t('Todo listo para un gran día.','Ready for a great day.');
 $('homeSubtitle').textContent=b.canManage?t('Revisa el trabajo, acompaña al equipo y controla los pagos.','Review work, support your team and check payments.'):t('Consulta tus unidades, registra tu horario y revisa tus avisos.','Check your units, record your hours and review alerts.');
 const cards=b.canManage?[
 ['/work','Hoy','Today','Unidades, inspecciones y solicitudes del día.','Today’s units, inspections and requests.','work','blue'],
 ['/employee-center','Equipo','Team','Consulta empleados y sus datos.','View employees and their details.','team','purple'],
 ['/clients','Propiedades','Properties','Clientes, localidades y unidades.','Clients, locations and units.','home','amber'],
 ['/access','Personas y dispositivos','People and devices','Aperturas, autorizaciones y bloqueos. Solo el propietario.','App opens, approvals and blocks. Owner only.','team','blue'],
 ['/payroll','Pagos','Payments','Revisa servicios y horas antes de aprobar.','Review services and hours before approval.','pay','green']]:
 [['/work','Mi trabajo','My work','Tus unidades y el siguiente paso.','Your units and next step.','work','blue'],
 ['/time-clock','Mi horario','My hours','Registra entrada, salida y revisa tus horas.','Clock in, clock out and review hours.','clock','green'],
 ['/notifications','Avisos','Alerts','Consulta las notificaciones disponibles.','View available notifications.','bell','purple']];
 for(const [href,es,eng,desc,descEn,icon,color]of cards){const a=document.createElement('a');a.className='home-card tone-'+color;a.href=href;
 const badge=document.createElement('span');badge.className='home-icon';badge.innerHTML=CareIcons[icon];const h=document.createElement('h2');h.textContent=t(es,eng);const p=document.createElement('p');p.textContent=t(desc,descEn);const go=document.createElement('span');go.className='home-go';go.textContent=t('Abrir','Open')+' →';a.append(badge,h,p,go);$('homeCards').append(a);}
 $('homeMore').hidden=!b.canManage;$('moreTitle').textContent=t('Reportes y herramientas','Reports and tools');
 if(b.canManage)for(const [href,es,eng]of [['/dashboard','Resumen ejecutivo','Executive overview'],['/control-center','Control del día','Daily control'],['/work#requestsPanel','Solicitudes por localidad','Requests by location'],['/requests','Solicitudes del hotel','Hotel requests'],['/statistics','Estadísticas','Statistics'],['/time-clock','Mi horario','My hours'],['/rates','Tarifas en Notion','Rates in Notion']]){const a=document.createElement('a');a.href=href;a.textContent=t(es,eng);$('moreLinks').append(a);}
 }catch{$('access').textContent=document.documentElement.lang==='en'?'Could not load. Reload this page.':'No se pudo cargar. Actualiza la página.';}
})();
