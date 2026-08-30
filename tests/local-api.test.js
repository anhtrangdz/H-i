'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const { webcrypto } = require('crypto');
if (!global.crypto) global.crypto = webcrypto;

const native = {
  configured: false,
  unlocked: false,
  json: null,
  media: new Map(),
  failNextSave: false,
  biometricAvailable: true,
  biometricEnabled: false,
};

global.NativeBridge = {
  async call(method, params = {}) {
    switch (method) {
      case 'status': return { configured:native.configured, unlocked:native.unlocked, biometricAvailable:native.biometricAvailable, biometricEnabled:native.biometricEnabled };
      case 'setup': native.configured=true; native.unlocked=true; native.json=params.json; return {ok:true};
      case 'unlock': if (!native.configured) throw new Error('not configured'); native.unlocked=true; return {ok:true};
      case 'lock': native.unlocked=false; return {ok:true};
      case 'loadState': return native.json ? {json:native.json} : {};
      case 'saveState': if (native.failNextSave) { native.failNextSave=false; throw new Error('disk full'); } native.json=params.json; return {ok:true};
      case 'changePassword': return {ok:true};
      case 'saveMedia': native.media.set(params.id,{mime:params.mime,base64:params.base64}); return {ok:true};
      case 'deleteMedia': native.media.delete(params.id); return {ok:true};
      case 'setBiometric': native.biometricEnabled=!!params.enabled; return {configured:native.configured,unlocked:native.unlocked,biometricAvailable:true,biometricEnabled:native.biometricEnabled};
      case 'unlockBiometric': native.unlocked=true; return {ok:true};
      case 'exportBackup': return {ok:true};
      case 'restoreBackupPicker': return {ok:true};
      default: throw new Error(`unknown native method ${method}`);
    }
  }
};

vm.runInThisContext(fs.readFileSync('SoreRelax/Web/local-api.js','utf8'), {filename:'local-api.js'});

async function req(path, method='GET', json) {
  const init={method,headers:{}};
  if (json !== undefined) { init.headers['content-type']='application/json'; init.body=JSON.stringify(json); }
  const r=await fetch(path,init); const b=r.status===204?null:await r.json(); return {r,b};
}

(async()=>{
  let x=await req('/api/status'); assert.equal(x.b.setupRequired,true);
  x=await req('/api/setup','POST',{name:'Prix',password:'1234567890'}); assert.equal(x.r.status,200); assert.equal(JSON.parse(native.json).settings.displayName,'Prix');
  x=await req('/api/data'); assert.equal(x.b.data.settings.displayName,'Prix'); assert.equal(x.b.data.accounts.length,3);

  const acc=x.b.data.accounts[0].id;
  x=await req('/api/month-plan','PUT',{month:'2026-08',total:10000000}); assert.equal(x.r.status,200);
  x=await req('/api/transactions','POST',{type:'expense',amount:125000,category:'Ăn uống',accountId:acc,toAccountId:'',date:'2026-08-30',note:'test',addToMonth:false});
  assert.equal(x.r.status,201); const txid=x.b.data.id;
  x=await req('/api/data'); assert.equal(x.b.data.transactions.length,1); assert.equal(x.b.data.accounts[0].balance,-125000);
  x=await req(`/api/transactions/${txid}`,'PUT',{type:'expense',amount:150000,category:'Ăn uống',accountId:acc,toAccountId:'',date:'2026-08-30',note:'edit',addToMonth:false}); assert.equal(x.b.data.amount,150000);

  x=await req('/api/budgets','POST',{month:'2026-08',category:'Ăn uống',limit:3000000}); assert.equal(x.r.status,201); const bid=x.b.data.id;
  x=await req('/api/budgets','POST',{month:'2026-08',category:'ăn uống',limit:4000000}); assert.equal(x.r.status,409);
  await req(`/api/budgets/${bid}`,'DELETE');


  // Media transaction: native bytes are written before state metadata; rollback deletes bytes if state persistence fails.
  const imgBytes=new Uint8Array(64); imgBytes.fill(7);
  let mediaRes=await fetch('/api/media',{method:'POST',headers:{'content-type':'image/png','x-file-name':encodeURIComponent('ảnh test.png')},body:new Blob([imgBytes],{type:'image/png'})});
  assert.equal(mediaRes.status,201); const mediaBody=await mediaRes.json(); const mid=mediaBody.data.id; assert(native.media.has(mid));
  x=await req('/api/daily','PUT',{date:'2026-08-30',title:'Ngày test',body:'hello',mood:'Vui',mediaIds:[mid]}); assert.equal(x.r.status,200);
  x=await req(`/api/media/${mid}`,'DELETE'); assert.equal(x.r.status,409);
  x=await req('/api/daily','PUT',{date:'2026-08-30',title:'Ngày test',body:'hello',mood:'Vui',mediaIds:[]}); assert.equal(x.r.status,200);
  x=await req(`/api/media/${mid}`,'DELETE'); assert.equal(x.r.status,204); assert(!native.media.has(mid));
  x=await req('/api/private','POST',{title:'Private',body:'secret'}); assert.equal(x.r.status,201); const pid=x.b.data.id;
  x=await req(`/api/private/${pid}`,'PUT',{title:'Private 2',body:'secret2'}); assert.equal(x.b.data.title,'Private 2');
  x=await req('/api/goals','POST',{name:'Laptop',target:1000000,current:100000,deadline:'2026-12-31',note:''}); assert.equal(x.r.status,201);

  // Failure-path/rollback: state must not retain a mutation when native persistence fails.
  const before=JSON.parse(native.json).transactions.length;
  native.failNextSave=true;
  x=await req('/api/transactions','POST',{type:'expense',amount:1,category:'Khác',accountId:acc,toAccountId:'',date:'2026-08-30',note:'should rollback',addToMonth:false});
  assert.equal(x.r.status,500);
  x=await req('/api/data'); assert.equal(x.b.data.transactions.length,before);
  // Queue must recover after a failed write.
  x=await req('/api/transactions','POST',{type:'expense',amount:2,category:'Khác',accountId:acc,toAccountId:'',date:'2026-08-30',note:'recovery save',addToMonth:false});
  assert.equal(x.r.status,201);
  x=await req('/api/data'); assert.equal(x.b.data.transactions.length,before+1);

  await req('/api/logout','POST',{});
  x=await req('/api/data'); assert.equal(x.r.status,401);
  console.log('LOCAL_API_TESTS=PASS');
})().catch(err=>{console.error(err);process.exit(1)});
