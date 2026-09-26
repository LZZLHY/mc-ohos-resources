/** Node WebCrypto 与真实浏览器共用同一验证器；不用自造的“验签成功”替身。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync} from 'node:crypto';
import {verifyBrowserCatalog,fetchBrowserCatalog} from '../lib/browser-catalog.mjs';
import {signCatalog} from '../tools/protocol.mjs';
import {projectCatalog} from '../tools/catalog.mjs';
const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const keys={keys:[{kid:'browser-test',algorithm:'ES256',spki:pair.publicKey.export({type:'spki',format:'der'}).toString('base64')}]};
const catalog=projectCatalog(JSON.parse(readFileSync(new URL('../catalog/source.json',import.meta.url))),'preview');
const raw=JSON.stringify(signCatalog(catalog,pair.privateKey,'browser-test'));
test('Node signing interoperates with WebCrypto P1363',async()=>assert.deepEqual(await verifyBrowserCatalog(raw,keys,'preview'),catalog));
test('browser rejects forged payload, unknown key, channel and expiry',async()=>{
  const altered=JSON.parse(raw);altered.payload=Buffer.from('{}').toString('base64url');
  await assert.rejects(verifyBrowserCatalog(JSON.stringify(altered),keys,'preview'));
  await assert.rejects(verifyBrowserCatalog(raw,{keys:[]},'preview'));
  await assert.rejects(verifyBrowserCatalog(raw,keys,'stable'));
  await assert.rejects(verifyBrowserCatalog(raw,keys,'preview',Date.parse(catalog.expiresAt)+1));
});
test('stream rejects oversized response before decoding JSON',async()=>{
  const old=globalThis.fetch;let cancelled=false;
  globalThis.fetch=async()=>({ok:true,status:200,body:new ReadableStream({pull(c){c.enqueue(new Uint8Array(400000));},cancel(){cancelled=true;}})});
  try{await assert.rejects(fetchBrowserCatalog('https://example.com',keys,'preview'),/过大/);assert.equal(cancelled,true);}
  finally{globalThis.fetch=old;}
});
