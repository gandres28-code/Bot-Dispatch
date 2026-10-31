(function(root){'use strict';
 const data=typeof module==='object'&&module.exports?require('./i18n-data'):root.CareI18nData;
 const normalize=s=>String(s??'').replace(/\s+/g,' ').trim();
 const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const singular=(text,lang)=>lang==='en'?text.replace(/^1 pieces$/,'1 piece').replace(/^1 different items$/,'1 different item').replace(/^1 units$/,'1 unit').replace(/^1 people$/,'1 person').replace(/^1 pending submissions$/,'1 pending submission'):text.replace(/^1 piezas$/,'1 pieza').replace(/^1 artículos diferentes$/,'1 artículo diferente').replace(/^1 unidades$/,'1 unidad').replace(/^1 personas$/,'1 persona');
 const patterns=[];
 for(const pair of data.templates){for(const direction of [0,1]){const source=pair[direction],keys=[];let last=0,regex='^';for(const m of source.matchAll(/\{(\w+)\}/g)){regex+=escape(source.slice(last,m.index));const numeric=['n','total','id'].includes(m[1]);regex+=numeric?'(\\d+)':'(.+?)';keys.push(m[1]);last=m.index+m[0].length;}regex+=escape(source.slice(last))+'$';patterns.push({regex:new RegExp(regex),keys,target:pair[1-direction],language:direction===0?'en':'es'});}}
 function translate(value,language,depth=0){
  const original=String(value??''),text=normalize(original);if(!text||depth>3)return original;
  const dict=language==='en'?data.en:data.es;
  if(Object.hasOwn(dict,text))return original.replace(text,dict[text])===original?dict[text]:original.replace(text,dict[text]);
  for(const pattern of patterns){if(pattern.language!==language)continue;const match=text.match(pattern.regex);if(!match)continue;const values=Object.fromEntries(pattern.keys.map((key,i)=>[key,key==='item'?translate(match[i+1],language,depth+1):match[i+1]]));return singular(pattern.target.replace(/\{(\w+)\}/g,(_,key)=>values[key]),language);}
  const numbered=text.match(/^(\d+\.\s+)(.+)$/);if(numbered)return numbered[1]+translate(numbered[2],language,depth+1);
  const decorated=text.match(/^([^\p{L}\p{N}]+\s*)([\p{L}\p{N}¿¡].*)$/u);if(decorated)return decorated[1]+translate(decorated[2],language,depth+1);
  if(text.startsWith('Error: '))return 'Error: '+translate(text.slice(7),language,depth+1);
  return singular(original,language);
 }
 const api={translate,product:(name,language)=>data.products[name]?.[language]||name,normalize};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.CareI18nCore=api;
})(typeof self==='object'?self:globalThis);
