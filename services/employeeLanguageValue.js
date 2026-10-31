'use strict';
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
function readEmployeeLanguage(page){
 const properties=page?.properties||{};
 const names=['idioma','language','app language','idioma de la app'];
 for(const name of names){
  const found=Object.entries(properties).find(([key])=>normalize(key)===name);
  if(!found)continue;
  const property=found[1];
  // Only a Notion Select is authoritative. Free text and other property types are not language settings.
  if(property?.type&&property.type!=='select')return 'es';
  const value=normalize(property?.select?.name);
  if(['ingles','english','en'].includes(value))return 'en';
  return 'es';
 }
 return 'es';
}
module.exports={readEmployeeLanguage};
