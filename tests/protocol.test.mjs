/** 发行端真实协议负例与签名互操作；测试密钥只在进程内生成，不读维护者私钥。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { validateCatalog,validateTransition,signCatalog,verifyEnvelope } from '../tools/protocol.mjs';
import { projectCatalog } from '../tools/catalog.mjs';
const source=JSON.parse(readFileSync(new URL('../catalog/source.json',import.meta.url)));
const fresh=()=>projectCatalog(structuredClone(source),'stable');
const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const keys={schemaVersion:1,keys:[{kid:'test',algorithm:'ES256',spki:pair.publicKey.export({type:'spki',format:'der'}).toString('base64')}]};
const signed=c=>JSON.stringify(signCatalog(c,pair.privateKey,'test'));
test('two channels, valid signature and unchanged revision',()=>{
  const c=fresh(); assert.deepEqual(verifyEnvelope(signed(c),keys,'stable'),c); validateTransition(c,c);
  assert.equal(projectCatalog(source,'preview').channel,'preview');
});
const invalid=[
  ['schema',c=>c.schemaVersion=2],['duplicate major',c=>c.runtimes[1].javaMajor=8],
  ['missing hash',c=>delete c.builds[0].archive.sha256],['part total',c=>c.builds[0].downloads[1].parts[0].sizeBytes++],
  ['http',c=>c.builds[0].downloads[0].url='http://github.com/a'],['traversal filename',c=>c.builds[0].archive.fileName='../x.zip'],
  ['fraction',c=>c.catalogRevision=1.5],['unsafe integer',c=>c.catalogRevision=Number.MAX_SAFE_INTEGER+1],
  ['script',c=>c.runtimes[0].installScript='echo x'],['withdrawn recommended',c=>c.builds[0].status='withdrawn'],
  ['wrong list',c=>c.runtimes=null],['unknown source',c=>c.builds[0].downloads[0].sourceId='ftp']
  ,['web mislabeled as github',c=>c.builds[0].downloads[0].url='https://amcl.lovedhy.cn/runtimes/test.zip']
];
for(const [name,change] of invalid) test('reject '+name,()=>{const c=fresh();change(c);assert.throws(()=>validateCatalog(c));});
test('future adapter is structurally valid, not falsely assumed installable',()=>{const c=fresh();c.runtimes[0].adapter='future-layout';validateCatalog(c);});
test('reject key, algorithm, payload and channel substitution',()=>{
  const raw=signed(fresh()); const e=JSON.parse(raw);
  assert.throws(()=>verifyEnvelope(raw,{keys:[]},'stable'));
  assert.throws(()=>verifyEnvelope(raw,keys,'preview'));
  assert.throws(()=>verifyEnvelope(JSON.stringify({...e,payload:e.payload.slice(0,-1)+'A'}),keys,'stable'));
  assert.throws(()=>verifyEnvelope(JSON.stringify({...e,protected:Buffer.from('{"alg":"none","typ":"amcl-runtime-catalog+jws","kid":"test"}').toString('base64url')}),keys,'stable'));
});
test('expiry and rollback cannot erase previous identity',()=>{
  const c=fresh(); assert.throws(()=>verifyEnvelope(signed(c),keys,'stable',Date.parse(c.expiresAt)+1));
  const next=structuredClone(c);next.catalogRevision++;validateTransition(c,next);
  assert.throws(()=>validateTransition(next,c)); next.builds[0].archive.sha256='a'.repeat(64);assert.throws(()=>validateTransition(c,next));
});
test('mirror metadata can change, recommendation needs independent revision',()=>{
  const c=fresh(),next=structuredClone(c);next.catalogRevision++;
  next.builds[0].downloads[0].url+='?cache=2';validateTransition(c,next);
  next.runtimes[1].recommendedBuildId='17-runtime-audio-rc2';assert.throws(()=>validateTransition(c,next));
  next.runtimes[1].recommendationRevision++;validateTransition(c,next);
});
test('unverified build cannot be promoted to stable by signing tool',()=>{
  const changed=structuredClone(source);changed.runtimes[1].recommendations.stable=changed.runtimes[1].recommendations.preview;
  assert.throws(()=>projectCatalog(changed,'stable'),/device matrix/);
});
