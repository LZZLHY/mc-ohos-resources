/** 旧协议夹具独立后，仍直接审核当前正式源、真实签名批次和完整来源闭包。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {projectCatalogV2,projectLegacyCatalogFromV2} from '../lib/catalog-v2.mjs';
import {verifyEnvelope,validateTransition} from '../tools/protocol.mjs';
import {projectCatalog} from '../tools/catalog.mjs';
import {readDeliveryClosure} from '../tools/delivery.mjs';
import {legacySource} from './legacy-source.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
test('current canonical v2 source, signed channels and source archives form one exact batch',async()=>{
  const source=JSON.parse(await readFile(new URL('../catalog/source.json',import.meta.url),'utf8'));
  const keys=JSON.parse(await readFile(new URL('../catalog/trusted-keys.json',import.meta.url),'utf8'));
  assert.equal(source.schemaVersion,2);
  for(const channel of ['stable','preview']){
    const modern=projectCatalogV2(source,channel),legacy=projectLegacyCatalogFromV2(modern);
    assert.deepEqual(verifyEnvelope(await readFile(new URL(`../catalog/v2/${channel}.json`,import.meta.url),'utf8'),keys,channel),modern);
    assert.deepEqual(verifyEnvelope(await readFile(new URL(`../catalog/v1/${channel}.json`,import.meta.url),'utf8'),keys,channel),legacy);
    validateTransition(projectCatalog(legacySource(),channel),legacy);
    // 现役1.0.6只读v1。拒绝host2本身不能证明旧用户仍可下载；当前两通道必须保留
    // 可达的host1历史正式包，而v2首项继续指向已验收的新包，不能靠让旧用户切通道解决。
    assert.deepEqual(legacy.runtimes.map(r=>r.javaMajor),[8,17,21,25]);
    for(const runtime of legacy.runtimes){
      assert.equal(runtime.loaderProtocol,1);
      assert.equal(legacy.builds.find(b=>b.id===runtime.recommendedBuildId).provenance.kind,'legacy');
      const modernRuntime=modern.runtimes.find(r=>r.id===runtime.id);
      const first=modern.builds.find(b=>b.id===modernRuntime.recommendedBuildIds[0]);
      assert.equal(first.requiredHostProtocol,2);assert(first.capabilities.includes('zipfs-transaction-v1'));
    }
  }
  const closure=await readDeliveryClosure(root);
  assert.equal(closure.targets.length,2*source.builds.filter(b=>b.provenance.kind==='source-build').length);
});
