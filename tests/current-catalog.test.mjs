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
  }
  const closure=await readDeliveryClosure(root);
  assert.equal(closure.targets.length,2*source.builds.filter(b=>b.provenance.kind==='source-build').length);
});
