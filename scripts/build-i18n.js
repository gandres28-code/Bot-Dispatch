'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.resolve(__dirname,'..'),en={},es={};
function add(a,b){en[a]=b;es[b]=a;}
for(const line of fs.readFileSync(path.join(base,'translations/ui.es-en.txt'),'utf8').trim().split('\n')){
 const parts=line.split('|');if(parts.length===2)add(parts[0],parts[1]);
}
Object.assign(en,JSON.parse(fs.readFileSync(path.join(base,'translations/checklists.en.json'),'utf8')));
for(const [a,b]of Object.entries(en))if(!es[b])es[b]=a;
const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(base,'public/js/supply-catalog-data.js'),'utf8'),context);
const source=context.window.CareSupplyCatalog,products={};
for(const item of [...Object.values(source.catalog).flat(),...source.hideBedItems]){
 let english=item.name.replace(/^(Linen|Dishware|Silverware|Cookware|Cleaning Tool) - /,'').replace(/ - /g,' · ');
 const towels={'Towel - Bath':'Bath towel','Towel - Hand':'Hand towel','Towel - Bath Wash':'Washcloth','Towel - Bath Mat':'Bath mat','Towel - Pool':'Pool towel','Towel - Face Wash (Black)':'Black face cloth','Towel - Makeup Towel (Black)':'Black makeup towel','Towel - Kitchen Hand':'Kitchen hand towel','Towel - Kitchen Wash':'Kitchen cleaning cloth','Towel - Pot Holder':'Pot holder','Towel - Rubber Bath Mat':'Rubber bath mat'};
 english=towels[item.name]||english.replace(/^Fitted · /,'Fitted sheet · ').replace(/^Flat · /,'Flat sheet · ');

 if(!en[item.detail])add(item.detail,english);en[item.detail+' · sofá cama']=english+' · sofa bed';
 products[item.name]={es:item.detail,en:english};
}
for(const [name,detail]of [['Toilet paper','Papel higiénico'],['Paper towel','Toallas de papel'],['Trash bag','Bolsa de basura'],['Soap','Jabón'],['Shampoo','Shampoo'],['Conditioner','Acondicionador'],['Coffee','Café']])products[name]={en:name,es:detail};
for(const [name,labels]of Object.entries(products)){en[name]=labels.en;es[name]=labels.es;}
// Explicit aliases for English text already present in legacy screens.
Object.assign(es,{'Dashboard':'Tablero','Employee Center':'Centro de empleados','Employee Profile':'Perfil del empleado','Cleaner':'Limpiador','Cleaners':'Limpiadores','Cleaner / Inspector':'Limpiador / inspector','Dispatch / Inspector':'Despacho / inspector','Laundry / Activities / Runner':'Lavandería / actividades / runner','Manager':'Encargado','Guest Out':'Huésped fuera','Guest out':'Huésped fuera','Pre-Inspected':'Preinspeccionada','Finished':'Terminada','Ready':'Lista','Ready for Guest':'Lista para huésped','In Progress':'En progreso','In progress':'En progreso','Not Started':'Sin iniciar','Tap to Start':'Toca para comenzar','Tap to Finish':'Toca para terminar','Started cleaning':'Limpieza iniciada','Cleaning complete':'Limpieza terminada','Arrival':'Llegada','Arrivals':'Llegadas','Stayover':'Estancia','Assigned room':'Unidad asignada','Arrival room':'Unidad con llegada','Guest out • Pre-inspection complete':'Huésped fuera • Preinspección completa','Settings':'Ajustes','Clock':'Reloj','CLOCK IN':'REGISTRAR ENTRADA','CLOCK OUT':'REGISTRAR SALIDA','Clock In/Out':'Entrada/salida','Payroll':'Nómina','Rooms':'Habitaciones','Runner Orders':'Órdenes del runner','Inspection':'Inspección','Light':'Claro','Linen':'Ropa de cama','Towels':'Toallas','Dishware':'Vajilla','Silverware':'Cubiertos','Cookware':'Cocina','Maintenance':'Mantenimiento','Other':'Otro','Setup':'Paquete','Cleaning Supplies':'Suministros de limpieza','Cleaning Tools / Maintenance':'Herramientas / mantenimiento','Amenities':'Amenidades','Activity':'Actividad','Documents':'Documentos','Performance':'Rendimiento','Executive':'Dirección','Hotel Map':'Mapa del hotel','Hotel Map View':'Vista del mapa del hotel','Master Operations':'Operaciones maestras','Operations Intelligence':'Inteligencia operativa','AI Operations Director':'Dirección operativa con IA','Executive Operations Wall':'Panel ejecutivo de operaciones','Stats':'Estadísticas','Overall':'General','First pass':'Primera inspección aprobada','Top Cleaners':'Mejores limpiadores','Unassigned':'Sin asignar','Urgent':'Urgente','High':'Alta','OPEN':'ABIERTA','LIVE':'EN VIVO','hourly':'Por hora','unit':'Por unidad'});
for(const [a,b]of [['Care OS | Inspecciones','Care OS | Inspections'],['Care OS | Limpieza','Care OS | Cleaning'],['Reportes y actividad | Care','Reports and activity | Care']])add(a,b);
const data={en,es,products,templates:JSON.parse(fs.readFileSync(path.join(base,'translations/templates.json'),'utf8'))};
fs.writeFileSync(path.join(base,'public/js/i18n-data.js'),"(function(root){'use strict';const data="+JSON.stringify(data)+";if(typeof module==='object'&&module.exports)module.exports=data;else root.CareI18nData=data;})(typeof self==='object'?self:globalThis);\n");
console.log('Built translations:',Object.keys(en).length,'English,',Object.keys(es).length,'Spanish,',Object.keys(products).length,'products.');
fs.writeFileSync(path.join(base,'public/js/care-i18n.js'),['i18n-data.js','i18n-core.js','i18n.js'].map(file=>fs.readFileSync(path.join(base,'public/js',file),'utf8')).join('\n'));
