'use strict';
const {spawnSync}=require('node:child_process');const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const base=path.resolve(__dirname,'..');process.chdir(base);
function run(args){const result=spawnSync(process.execPath,args,{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
const scripts=['server.js','services/operationalActions.js','services/requestReliability.js','services/eventEngine.js','services/roomSyncService.js','services/payrollSyncService.js','public/js/resilience.js','public/js/maid-core.js','public/js/control-center.js'];
for(const file of scripts)run(['--check',file]);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'care-syntax-'));
try{
 for(const name of ['index.html','inspector.html','app.html','operations.html','service-orders.html','runner-orders.html']){
  const html=fs.readFileSync(path.join('public',name),'utf8');let index=0;
  for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)){if(!match[1].trim())continue;const file=path.join(dir,name+'.'+index+++'.js');fs.writeFileSync(file,match[1]);run(['--check',file]);}
 }
}finally{fs.rmSync(dir,{recursive:true,force:true});}
for(const test of ['roomEngine','payroll','payrollExcel','unitCatalog','controlCenter','reliability','eventReliability','payrollReliability'])run(['test/'+test+'.test.js']);
console.log('Care OS verification passed. Live PostgreSQL/Notion/device smoke checks are still required before rollout.');
