/** 发布闭包与真实文件替换负例；只用合成包和进程内测试键，不访问维护者密钥或网络。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {sha256,signCatalog} from '../tools/protocol.mjs';
import {projectCatalog} from '../tools/catalog.mjs';
import {deliveryClosure,validateDeliveryReceipt,githubAsset} from '../tools/delivery.mjs';
import {AUDIO_DUPLEX_PATCH} from '../tools/runtime-audio.mjs';
import {MIDI_PATCH} from '../tools/runtime-midi.mjs';
import {readSourceZip,verifySourceArchive,crc32} from '../tools/source-archive.mjs';
import {remoteIdentity,validateExistingAssets} from '../tools/publish.mjs';
import {activateCatalog,assertNoPendingActivation} from '../tools/activation.mjs';

const sourceTemplate=JSON.parse(readFileSync(new URL('../catalog/source.json',import.meta.url)));
const raw=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const pool='https://github.com/LZZLHY/mc-ohos-resources/releases/download/ohos-runtimes/';

/** 夹具使用最小 STORE ZIP，中央目录/本地头均真实；失败用例改动指定字段。 */
function zip(entries){
  const local=[],central=[];let offset=0;
  for(const [name,value] of entries){
    const bytes=Buffer.from(value),nameBytes=Buffer.from(name),crc=crc32(bytes);
    const l=Buffer.alloc(30);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt32LE(crc,14);
    l.writeUInt32LE(bytes.length,18);l.writeUInt32LE(bytes.length,22);l.writeUInt16LE(nameBytes.length,26);
    local.push(l,nameBytes,bytes);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,6);c.writeUInt32LE(crc,16);
    c.writeUInt32LE(bytes.length,20);c.writeUInt32LE(bytes.length,24);c.writeUInt16LE(nameBytes.length,28);
    c.writeUInt32LE((0o100644<<16)>>>0,38);c.writeUInt32LE(offset,42);central.push(c,nameBytes);
    offset+=l.length+nameBytes.length+bytes.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);
  end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}

/** 一项完整构建，运行包是 abc；所有摘要均从夹具实际字节推导，不写固定伪摘要。 */
function fixture(){
  const source=structuredClone(sourceTemplate),build=structuredClone(source.builds.find(b=>b.id==='17-runtime-audio-rc2'));
  build.id='17-delivery-test';build.archive={type:'zip',fileName:'runtime-test.zip',sizeBytes:3,sha256:sha256('abc')};
  build.downloads=[{sourceId:'github',transport:'single-file',url:pool+build.archive.fileName}];build.validationLevel='device-matrix-tested';
  const lock=Buffer.from('{}'),recipe=Buffer.from('fixture source'),series=Buffer.from('fixture.patch\n'),patch=Buffer.from('fixture patch');
  const receipt={file:'/output/'+build.archive.fileName,bytes:3,sha256:build.archive.sha256,
    build:{repository:build.provenance.sourceRepository,commit:build.provenance.sourceCommit,major:'17',inputsSha256:sha256(lock),
      patches:{series:sha256(series),'fixture.patch':sha256(patch)},recipes:{'fixture.sh':sha256(recipe)}}};
  const receiptRaw=raw(receipt);build.provenance.manifestSha256=sha256(receiptRaw);
  source.builds=[build];source.runtimes=source.runtimes.filter(r=>r.id===build.runtimeId);
  source.runtimes[0].recommendations={stable:{recommendedBuildId:build.id,recommendationRevision:1},preview:{recommendedBuildId:build.id,recommendationRevision:1}};
  source.catalogRevision=1;source.issuedAt=new Date(Date.now()-60000).toISOString().replace(/\.\d{3}Z$/,'Z');
  source.expiresAt=new Date(Date.now()+86400000).toISOString().replace(/\.\d{3}Z$/,'Z');
  const files=new Map([['prebuilt/jdk/build-inputs.json',lock],['docker/scripts/fixture.sh',recipe],
    ['prebuilt/jdk/17/patches/series',series],['prebuilt/jdk/17/patches/fixture.patch',patch],['build-receipt.json',receiptRaw]]);
  const inner={schemaVersion:1,files:Object.fromEntries([...files].map(([name,data])=>[name,sha256(data)]))};
  files.set('source-inputs.json',raw(inner));files.set('README.rebuild.md',Buffer.from('synthetic test only'));
  const bytes=zip([...files]);
  const index={schemaVersion:1,files:[{runtimeBuildId:build.id,fileName:'source-test.zip',sizeBytes:bytes.length,sha256:sha256(bytes),url:pool+'source-test.zip'}]};
  const raws=new Map([[build.id,receiptRaw]]);
  const closure=()=>deliveryClosure(raw(source),raw(index),raws);
  return{source,build,receipt,receiptRaw,files,bytes,index,raws,closure};
}

function verification(closure){
  const now=new Date().toISOString();
  return{schemaVersion:2,sourceSha256:closure.sourceSha256,sourceInputsIndexSha256:closure.sourceInputsIndexSha256,
    closureSha256:closure.closureSha256,verificationStartedAt:now,finishedAt:now,
    assets:closure.targets.map(t=>({...t,verifiedAt:now,...(t.kind==='source-inputs'?{sourceInputs:{manifestSha256:t.manifestSha256,indexSha256:sha256('test'),fileCount:7}}:{})}))};
}

test('complete source/runtime/receipt closure and ZIP byte inventory',()=>{
  const f=fixture(),c=f.closure();assert.equal(c.targets.length,2);
  assert.equal(verifySourceArchive(f.bytes,c.targets.find(t=>t.kind==='source-inputs'),f.receipt).fileCount,7);
  validateDeliveryReceipt(verification(c),c);
});

/** 这里只验证来源到推荐准入的绑定；合成补丁收据不冒充实际运行ZIP/源码包音频资格。 */
function duplexFixture(){
  const f=fixture();
  f.receipt.build.patches[AUDIO_DUPLEX_PATCH]=sha256('fixed synthetic duplex patch');
  const receiptRaw=raw(f.receipt);f.raws.set(f.build.id,receiptRaw);f.build.provenance.manifestSha256=sha256(receiptRaw);
  return f;
}
for(const channel of ['stable','preview']) test('duplex recommendation rejects protocol 1 in '+channel,()=>{
  const f=duplexFixture(),runtime=f.source.runtimes[0];runtime.loaderProtocol=2;
  runtime.recommendations[channel].loaderProtocol=1;
  assert.throws(f.closure,new RegExp('signed host callback requires loader protocol 2: '+channel));
});
test('duplex channel overrides satisfy host requirement without raising old stable',()=>{
  const f=duplexFixture(),runtime=f.source.runtimes[0];runtime.loaderProtocol=1;
  const legacy=structuredClone(sourceTemplate.builds.find(b=>b.runtimeId===runtime.id&&b.provenance.kind==='legacy'));
  assert(legacy);f.source.builds.push(legacy);
  runtime.recommendations.stable.recommendedBuildId=legacy.id;
  runtime.recommendations.preview.loaderProtocol=2;
  assert.equal(f.closure().targets.length,2);
  assert.equal(projectCatalog(f.source,'stable').runtimes[0].loaderProtocol,1);
  assert.equal(projectCatalog(f.source,'preview').runtimes[0].loaderProtocol,2);
});
test('unrecommended duplex build does not change either legacy recommendation',()=>{
  const f=duplexFixture(),runtime=f.source.runtimes[0];runtime.loaderProtocol=1;
  const legacy=structuredClone(sourceTemplate.builds.find(b=>b.runtimeId===runtime.id&&b.provenance.kind==='legacy'));
  assert(legacy);f.source.builds.push(legacy);
  for(const channel of ['stable','preview'])runtime.recommendations[channel].recommendedBuildId=legacy.id;
  assert.equal(f.closure().targets.length,2);
});
test('native MIDI alone still requires the implemented host callback protocol',()=>{
  const f=fixture();f.receipt.build.patches[MIDI_PATCH]=sha256('synthetic MIDI source');
  const receiptRaw=raw(f.receipt);f.raws.set(f.build.id,receiptRaw);f.build.provenance.manifestSha256=sha256(receiptRaw);
  assert.throws(f.closure,/signed host callback requires loader protocol 2/);
  f.source.runtimes[0].loaderProtocol=2;assert.equal(f.closure().targets.length,2);
});

for(const [name,change] of [
  ['missing source ZIP',f=>f.index.files=[]],
  ['orphan source ZIP',f=>f.index.files[0].runtimeBuildId='absent'],
  ['duplicate source ZIP',f=>f.index.files.push({...f.index.files[0]})],
  ['runtime/source same filename',f=>{f.index.files[0].fileName=f.build.archive.fileName;f.index.files[0].url=pool+f.build.archive.fileName;}],
  ['source wrong tag',f=>f.index.files[0].url=f.index.files[0].url.replace('ohos-runtimes/','ohos-runtimes-next/')],
  ['provenance drift',f=>f.raws.set(f.build.id,Buffer.from('{}'))],
  ['provenance runtime mismatch',f=>{f.receipt.bytes++;const bytes=raw(f.receipt);f.raws.set(f.build.id,bytes);f.build.provenance.manifestSha256=sha256(bytes);}]
])test('closure rejects '+name,()=>{const f=fixture();change(f);assert.throws(f.closure);});

for(const [name,change] of [
  ['missing source receipt',r=>r.assets=r.assets.filter(a=>a.kind==='runtime')],
  ['duplicate receipt',r=>r.assets[1]=r.assets[0]],
  ['inner index not checked',r=>delete r.assets.find(a=>a.kind==='source-inputs').sourceInputs],
  ['old receipt schema',r=>r.schemaVersion=1],
  ['changed index',r=>r.sourceInputsIndexSha256=sha256('changed')],
  ['short remote readback',r=>r.assets[0].sizeBytes--],
  ['future readback',r=>r.assets[0].verifiedAt='2999-01-01T00:00:00Z']
])test('activation receipt rejects '+name,()=>{const c=fixture().closure(),r=verification(c);change(r);assert.throws(()=>validateDeliveryReceipt(r,c));});

test('ZIP rejects path alias, duplicate, CRC corruption and unindexed source',()=>{
  assert.throws(()=>readSourceZip(zip([['../x','x']])));
  assert.throws(()=>readSourceZip(zip([['a','x'],['A','x']])));
  const damaged=zip([['a','x']]);damaged[31]^=1;assert.throws(()=>readSourceZip(damaged),/CRC/);
  const f=fixture();f.files.set('extra.sh',Buffer.from('untracked source'));const bytes=zip([...f.files]);
  const target={...f.closure().targets.find(t=>t.kind==='source-inputs'),sizeBytes:bytes.length,sha256:sha256(bytes)};
  assert.throws(()=>verifySourceArchive(bytes,target,f.receipt),/unindexed/);
});

test('source bundle cannot silently drop a receipt-bound recipe',()=>{
  const f=fixture();f.files.delete('docker/scripts/fixture.sh');
  const index=JSON.parse(f.files.get('source-inputs.json'));delete index.files['docker/scripts/fixture.sh'];f.files.set('source-inputs.json',raw(index));
  const bytes=zip([...f.files]),target={...f.closure().targets.find(t=>t.kind==='source-inputs'),sizeBytes:bytes.length,sha256:sha256(bytes)};
  assert.throws(()=>verifySourceArchive(bytes,target,f.receipt),/recipe\/patch/);
});

test('remote verification requires complete bytes and rejects short/long/same-size corruption',async()=>{
  const expected={sizeBytes:3,sha256:sha256('abc')};
  await remoteIdentity('https://example.com/file',expected,async()=>new Response('abc'));
  for(const bytes of ['ab','abcd','abd'])await assert.rejects(remoteIdentity('https://example.com/file',expected,async()=>new Response(bytes)));
});

test('immutable pool supports explicit new batch and refuses filename drift/draft',()=>{
  assert.equal(githubAsset(pool.replace('ohos-runtimes/','ohos-runtimes-20261021/')+'x.zip','x.zip').tag,'ohos-runtimes-20261021');
  const targets=fixture().closure().targets;
  for(const change of [r=>r.assets[0].size++,r=>r.assets[0].digest='sha256:'+sha256('bad'),r=>r.draft=true,r=>{r.immutable=true;r.assets=[];}]){
    const release={tag_name:'ohos-runtimes',draft:false,immutable:false,assets:targets.map(t=>({name:t.fileName,size:t.sizeBytes,digest:'sha256:'+t.sha256}))};
    change(release);assert.throws(()=>validateExistingAssets([release],targets));
  }
});

/** 真实目录和签名被写入显式外部测试根；留下故障/恢复证据，不碰正式 catalog。 */
test('interruption after first channel is gated and idempotently resumes exact batch',async()=>{
  const base=resolve(process.env.AMCL_TEST_TMP??tmpdir());await mkdir(base,{recursive:true});
  const task=await mkdtemp(resolve(base,'delivery-activation-')),root=resolve(task,'repository'),candidate=resolve(task,'candidate'),transaction=resolve(task,'transaction');
  await mkdir(resolve(root,'catalog/v1'),{recursive:true});await mkdir(resolve(root,'provenance'));await mkdir(candidate);
  const f=fixture(),pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const keys={schemaVersion:1,keys:[{kid:'test',algorithm:'ES256',spki:pair.publicKey.export({type:'spki',format:'der'}).toString('base64')}]};
  await writeFile(resolve(root,'catalog/trusted-keys.json'),raw(keys));
  const oldPreview=raw(signCatalog(projectCatalog(f.source,'preview'),pair.privateKey,'test'));
  for(const channel of ['stable','preview'])await writeFile(resolve(root,'catalog/v1',channel+'.json'),raw(signCatalog(projectCatalog(f.source,channel),pair.privateKey,'test')));
  f.source.catalogRevision++;f.source.runtimes[0].recommendations.preview.loaderProtocol=2;f.source.runtimes[0].recommendations.preview.recommendationRevision++;
  await writeFile(resolve(root,'catalog/source.json'),raw(f.source));await writeFile(resolve(root,'provenance/build-inputs.json'),raw(f.index));
  await writeFile(resolve(root,'provenance',f.build.id+'.json'),f.receiptRaw);
  for(const channel of ['stable','preview'])await writeFile(resolve(candidate,channel+'.json'),raw(signCatalog(projectCatalog(f.source,channel),pair.privateKey,'test')));
  const receipt=resolve(task,'receipt.json');await writeFile(receipt,raw(verification(f.closure())));
  await assert.rejects(activateCatalog({root,candidateDir:candidate,receiptPath:receipt,transactionDir:transaction,
    afterReplace:channel=>{if(channel==='stable')throw Error('injected interruption');}}),/injected interruption/);
  await assert.rejects(assertNoPendingActivation(root),/pending/);
  // 当前 preview 仍是旧有效签名；不是被截断的文件。恢复使用同一已验新批次补齐。
  const oldPayload=JSON.parse((await readFile(resolve(root,'catalog/v1/preview.json'))).toString()).payload;
  assert.equal(oldPayload,JSON.parse(oldPreview).payload);
  await activateCatalog({root,candidateDir:candidate,receiptPath:receipt,transactionDir:transaction});
  await assertNoPendingActivation(root);
  for(const channel of ['stable','preview'])assert.deepEqual(await readFile(resolve(root,'catalog/v1',channel+'.json')),await readFile(resolve(candidate,channel+'.json')));
  assert.equal(JSON.parse(await readFile(resolve(transaction,'transaction.json'))).state,'complete');
});
