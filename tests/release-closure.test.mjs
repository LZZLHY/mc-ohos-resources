/** 正向公开宿主与稳定返回闭包的生产纯函数回归；fixture资格只验证元数据门，不授予设备资格。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {projectCatalogV2,derivePublishedReleaseClosure,fetchPublishedRuntimeHosts} from '../lib/catalog-v2.mjs';
import {publishedHost} from './fixtures/published-host.mjs';
import {assertIsolatedFixtureKey} from '../tools/protocol.mjs';
const original=JSON.parse(fs.readFileSync(new URL('../catalog/source.json',import.meta.url),'utf8'));

/** 每槽分别造不可变协议2预览与有来源/完整矩阵标记的协议1替代，绝不重标历史legacy原件。 */
function sourceFixture(){
  const source=structuredClone(original);source.schemaVersion=2;source.catalogRevision++;
  for(const build of source.builds)build.requiredHostProtocol=1;
  for(const runtime of source.runtimes){
    const old=source.builds.find(b=>b.id===runtime.recommendations.stable.recommendedBuildId);
    const make=(suffix,protocol,level)=>{
      const build=structuredClone(old),bytes=Buffer.from('isolated-qualification:'+runtime.id+suffix);
      build.id=old.id+'-'+suffix;build.legacyTags=[];build.requiredHostProtocol=protocol;build.validationLevel=level;
      build.archive={type:'zip',fileName:build.id+'.zip',sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
      build.downloads=[{sourceId:'github',transport:'single-file',url:'https://github.com/LZZLHY/mc-ohos-resources/releases/download/ohos-runtimes/'+build.archive.fileName}];
      build.provenance={kind:'source-build',sourceRepository:'https://github.com/openjdk/fixture.git',sourceCommit:'c'.repeat(40),manifestSha256:'d'.repeat(64),evidence:['隔离测试资格样本，不代表真实设备通过']};
      source.builds.push(build);return build;
    };
    const modern=make('host2-fixture',2,'artifact-audited'),fallback=make('return-fixture',1,'device-matrix-tested');
    delete runtime.loaderProtocol;
    runtime.recommendations={stable:{recommendationRevision:20,recommendedBuildIds:[old.id]},
      preview:{recommendationRevision:20,recommendedBuildIds:[modern.id,fallback.id]}};
  }
  return source;
}
const catalogs=source=>['stable','preview'].map(channel=>projectCatalogV2(source,channel));
const hosts=()=>[publishedHost({runtimeHostProtocols:[1]}),publishedHost({channel:'preview'})];

test('完整闭包绑定真实形状的去返HAP及每槽精确原件，而不是自报可返回布尔',()=>{
  const source=sourceFixture(),proof=derivePublishedReleaseClosure(catalogs(source),hosts());
  assert.equal(proof.returns.length,1);assert.equal(proof.returns[0].replacements.length,source.runtimes.length);
  for(const replacement of proof.returns[0].replacements){
    const expected=source.builds.find(b=>b.id===replacement.buildId);
    assert.equal(replacement.sha256,expected.archive.sha256);assert.equal(replacement.sizeBytes,expected.archive.sizeBytes);
    assert.equal(replacement.manifestSha256,expected.provenance.manifestSha256);
  }
});

test('旧stable plan0、有预览App且正向可跑2，仍必须禁止自动正式回退闭包',()=>{
  const current=hosts();current[0].runtimePlanProtocol=0;current[0].canReturn=true;
  assert.throws(()=>derivePublishedReleaseClosure(catalogs(sourceFixture()),current),/STABLE_RETURN_PLAN_REQUIRED/);
});

test('缺任意major合格替代、legacy凑数、撤回或协议不相交均不能放行',()=>{
  for(const change of [
    (source,b)=>{b.validationLevel='artifact-audited';},
    (source,b)=>{b.provenance.kind='legacy';},
    (source,b)=>{b.status='withdrawn';source.runtimes[0].recommendations.preview.recommendedBuildIds.pop();},
    (source,b)=>{b.requiredHostProtocol=2;},
  ]){
    const source=sourceFixture(),runtime=source.runtimes[0],id=runtime.recommendations.preview.recommendedBuildIds[1];
    change(source,source.builds.find(b=>b.id===id));
    assert.throws(()=>derivePublishedReleaseClosure(catalogs(source),hosts()),/STABLE_RETURN_JDK_NOT_QUALIFIED/);
  }
});

test('同code返回仍核HAP实际平台与双方恢复协议，拒绝安装code降低',()=>{
  for(const change of [
    h=>{h[0].versionCode--;},h=>{h[0].minApi=24;},h=>{h[0].deviceTypes=['phone'];},h=>{h[1].runtimePlanProtocol=0;},
  ]){
    const current=hosts();change(current);
    assert.throws(()=>derivePublishedReleaseClosure(catalogs(sourceFixture()),current),/STABLE_RETURN_/);
  }
});

test('普通同宿主维护不强迫旧App提供恢复协议；其它已公开产品不能借手机HAP顶替',()=>{
  const source=sourceFixture();
  for(const runtime of source.runtimes)runtime.recommendations.preview.recommendedBuildIds=[runtime.recommendations.stable.recommendedBuildIds[0]];
  const proof=derivePublishedReleaseClosure(catalogs(source),[publishedHost({runtimeHostProtocols:[1],runtimePlanProtocol:0})]);
  assert.equal(proof.returns.length,0);
  assert.throws(()=>derivePublishedReleaseClosure(catalogs(source),[...hosts(),publishedHost({product:'desktop',channel:'preview',deviceTypes:['2in1']})],['sideload','desktop']),/PUBLIC_STABLE_BASELINE_REQUIRED/);
  const desktop=publishedHost({product:'desktop',runtimeHostProtocols:[1],runtimePlanProtocol:0,deviceTypes:['2in1'],minApi:22});
  assert.equal(derivePublishedReleaseClosure(catalogs(source),[desktop],['desktop']).products.join(','),'desktop');
});

test('发布事实拒绝developer/假原件/重复头及有界固定官网网络协议',async()=>{
  for(const change of [h=>{h.source='website-upload';},h=>{h.publicationId='ready';},h=>{h.sha256=['a'.repeat(64)];},h=>{h.runtimePlanProtocol=null;}]){
    const current=hosts();change(current[0]);assert.throws(()=>derivePublishedReleaseClosure(catalogs(sourceFixture()),current),/PUBLIC_HOST_/);
  }
  assert.throws(()=>derivePublishedReleaseClosure(catalogs(sourceFixture()),[...hosts(),hosts()[0]]),/AMBIGUOUS/);
  const seen=[];
  const facts=await fetchPublishedRuntimeHosts(async(url,options)=>{
    seen.push(url);assert.equal(options.redirect,'error');assert(url.startsWith('https://amcl.lovedhy.cn/api/packages/runtime-host?'));
    const query=new URL(url).searchParams;
    return query.get('product')==='desktop'?new Response('',{status:404}):Response.json(publishedHost({channel:query.get('channel')}));
  },['sideload','desktop']);
  assert.equal(facts.length,2);assert.equal(seen.length,4);
  await assert.rejects(fetchPublishedRuntimeHosts(async()=>new Response('x'.repeat(65537))),/TOO_LARGE/);
});

test('fixture不能借改kid或自选keys文件使用生产SPKI',()=>{
  const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),other=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const pinned={keys:[{kid:'production-original',spki:pair.publicKey.export({type:'spki',format:'der'}).toString('base64')}]};
  assert.throws(()=>assertIsolatedFixtureKey(pair.privateKey,pinned),/FIXTURE_KEY_IS_PRODUCTION/);
  assert.doesNotThrow(()=>assertIsolatedFixtureKey(other.privateKey,pinned));
});
