'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/js/care-design.js'),'utf8').split('// Record foreground returns separately')[1];
async function scenario(embedded=false){
 let now=100000,reply=200;const sent=[],redirects=[],handlers={},pageHandlers={};
 const window={addEventListener:(n,f)=>pageHandlers[n]=f};window.self=window;window.top=embedded?{}:window;
 const document={hidden:false,addEventListener:(n,f)=>handlers[n]=f};
 vm.runInNewContext('// Record foreground returns separately'+source,{window,document,Date:{now:()=>now},location:{pathname:'/work',replace:p=>redirects.push(p)},fetch:async(p,o)=>{sent.push({p,...JSON.parse(o.body)});return{status:reply};}});
 if(embedded){assert.equal(handlers.visibilitychange,undefined);return;}
 assert.equal(sent.length,0,'server logs the initial page load, client must not duplicate it');
 document.hidden=true;handlers.visibilitychange();now+=10000;document.hidden=false;handlers.visibilitychange();await new Promise(setImmediate);
 assert.equal(sent.length,0,'short switches must not create activity noise');
 document.hidden=true;handlers.visibilitychange();now+=31000;document.hidden=false;handlers.visibilitychange();await new Promise(setImmediate);
 assert.equal(sent.length,1);assert.equal(sent[0].kind,'resume');assert.equal(sent[0].path,'/work');
 pageHandlers.pageshow({persisted:true});await new Promise(setImmediate);assert.equal(sent.length,1,'deduplicate quick foreground events');
 now+=31000;reply=401;pageHandlers.pageshow({persisted:true});await new Promise(setImmediate);
 assert.equal(redirects[0],'/access','a revoked session must return to access control');
}
(async()=>{await scenario();await scenario(true);console.log('Access activity: foreground, timing, iframe, duplicate and revocation behavior passed.');})().catch(e=>{console.error(e);process.exitCode=1});
