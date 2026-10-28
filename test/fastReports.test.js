'use strict';
const assert=require('node:assert/strict');const {createFastReportHandler}=require('../services/fastReports');
const records=new Map();let logs=0,commits=0,released=0;
const query=async(sql,p=[])=>{
 if(sql.includes('SELECT payload FROM sync_queue'))return {rows:records.has(p[0])?[{payload:records.get(p[0])}]:[]};
 if(sql.includes('INSERT INTO sync_queue'))records.set(p[0],JSON.parse(p[1]));
 if(sql.includes('INSERT INTO operations_logs'))logs++;
 if(sql==='COMMIT')commits++;
 return {rows:[]};
};
const res=()=>({headersSent:false,statusCode:200,status(n){this.statusCode=n;return this;},json(data){this.body=data;this.headersSent=true;assert(commits>0||!data.ok,'a success response requires a commit');return this;}});
(async()=>{
 let uploads=0,emits=0;
 const handler=createFastReportHandler({today:()=> '2026-10-28',pool:()=>({connect:async()=>({query,release(){released++;}})}),uploadPhoto:async()=>{uploads++;return 'https://example.test/photo.jpg';},emit:()=>emits++});
 const body={unit:'101 A',employee:'Cleaner',role:'Cleaner',message:'Falta jabón',requestId:'same-report-id-123',workDate:'2026-10-28'};
 const first=res();await handler({body,files:[]},first);assert.equal(first.body.success,true);assert.equal(first.body.externalSync,'queued');assert.equal(logs,1);assert.equal(records.size,1);assert.equal(uploads,0);assert.equal(emits,1);assert.equal(released,1);
 const retry=res();await handler({body,files:[]},retry);assert.equal(retry.body.duplicate,true);assert.equal(records.size,1);assert.equal(logs,1);
 const bad=res();await handler({body:{...body,message:''},files:[]},bad);assert.equal(bad.statusCode,400);
 const old=res();await handler({body:{...body,workDate:'2026-10-27'},files:[]},old);assert.equal(old.statusCode,409);
 const failed=createFastReportHandler({today:()=> '2026-10-28',pool:()=>({connect:async()=>{throw Error('unavailable')}}),uploadPhoto:async()=>''});
 const fail=res();await failed({body,files:[]},fail);assert.equal(fail.statusCode,503);assert.equal(fail.body.success,false);
 console.log('Fast reports: durable commit-before-success, no AI/Notion wait, stable retries, one operation log, input validation and database failure passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
