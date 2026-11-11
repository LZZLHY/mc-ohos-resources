/** 真实发布纯函数回归；隔离原件/资格标记只用于验证门禁，不作为设备验收证明。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {projectCatalogV2,projectLegacyCatalogFromV2,assertAppRuntimeCoverage,derivePublishedReleaseClosure,
  normalizeRuntimeRequirements,runtimeHostBindings,releaseCatalogV2} from '../lib/catalog-v2.mjs';
import {verifyRuntimeHostHistory} from '../tools/protocol.mjs';
import {publishedHost,publishedHostFacts} from './fixtures/published-host.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const capability='zipfs-transaction-v1';
function fixture(){
  const source={schemaVersion:2,catalogRevision:20,issuedAt:'2026-11-01T00:00:00Z',expiresAt:'2027-11-01T00:00:00Z',runtimes:[],builds:[]};
  for(const major of [8,17,21,25]){
    const id='java'+major+'-ohos-aarch64',old='legacy-'+major,newId='fixed-'+major;
    source.runtimes.push({id,javaMajor:major,displayName:'Java '+major,os:'ohos',arch:'aarch64',libc:'musl',adapter:major===8?'classic-jre-v1':'modular-jdk-v1',minimumCatalogProtocol:1,minimumApi:20,
      recommendations:{stable:{recommendationRevision:2,recommendedBuildIds:[newId]},preview:{recommendationRevision:2,recommendedBuildIds:[newId]}}});
    for(const [buildId,protocol] of [[old,1],[newId,2]])source.builds.push({id:buildId,runtimeId:id,javaVersion:String(major),legacyTags:[],requiredHostProtocol:protocol,
      archive:{type:'zip',fileName:buildId+'.zip',sha256:hash(buildId),sizeBytes:100},downloads:[{sourceId:'github',transport:'single-file',url:'https://github.com/LZZLHY/mc-ohos-resources/releases/download/ohos-runtimes/'+buildId+'.zip'}],
      capabilities:protocol===2?[capability]:[],notes:[],status:'available',validationLevel:protocol===2?'device-matrix-tested':'legacy-compatible',
      provenance:{kind:protocol===2?'source-build':'legacy',sourceRepository:'https://github.com/openjdk/fixture',sourceCommit:'a'.repeat(40),manifestSha256:protocol===2?'b'.repeat(64):'',evidence:['isolated test fixture only']}});
  }
  return source;
}
const pair=source=>['stable','preview'].map(channel=>projectCatalogV2(source,channel));
const stablePair=source=>{const modern=projectCatalogV2(source,'stable');return[projectLegacyCatalogFromV2(modern),modern];};
const target=()=>({...publishedHost(),runtimeRequiredCapabilities:[capability],runtimeRequiredMajors:[8,17,21,25]});

test('真实host2投影允许JDK先就绪而旧App不能匹配，收据不伪造公开宿主',()=>{
  const catalogs=pair(fixture()),legacy=projectLegacyCatalogFromV2(catalogs[0]);
  assert(legacy.runtimes.every(r=>r.loaderProtocol===2));
  const prior=publishedHost({versionName:'1.0.6',versionCode:1000910,runtimeHostProtocols:[1],runtimePlanProtocol:0});
  const proof=derivePublishedReleaseClosure(catalogs,publishedHostFacts([prior]));
  assert.equal(proof.forward.length,8);assert(proof.forward.every(item=>item.state==='waiting-host'&&item.host===null));
  assert.equal(proof.hosts.length,0);assert.equal(proof.returns.length,0);
});
test('新App必须有实际stable双投影四槽，未知/过期/错误宿主/缺修复都阻断',()=>{
  const source=fixture(),host=target();assert.equal(assertAppRuntimeCoverage(stablePair(source),host).selections.length,8);
  assert.throws(()=>assertAppRuntimeCoverage([stablePair(source)[1]],host),/PAIR_REQUIRED/);
  assert.throws(()=>assertAppRuntimeCoverage(stablePair(source),{...host,runtimeHostProtocols:[1]}),/INCOMPATIBLE/);
  assert.throws(()=>assertAppRuntimeCoverage(stablePair(source),host,Date.parse('2028-01-01')),/EXPIRED/);
  for(const change of [s=>s.builds.find(b=>b.id==='fixed-21').capabilities=[],s=>s.builds.find(b=>b.id==='fixed-21').provenance.kind='legacy',
    s=>s.runtimes.find(r=>r.javaMajor===21).minimumApi=21]){
    const bad=fixture();change(bad);assert.throws(()=>assertAppRuntimeCoverage(stablePair(bad),host),/INCOMPATIBLE|NOT_QUALIFIED|PLATFORM/);
  }
  const badPair=stablePair(source);badPair[0].catalogRevision--;assert.throws(()=>assertAppRuntimeCoverage(badPair,host),/PROJECTION_MISMATCH/);
});
test('有序首项的资格不合格时不能用后面的好包掩盖，v1旧fallback也必须满足新App',()=>{
  const source=fixture(),original=source.builds.find(b=>b.id==='fixed-17');
  const bad={...structuredClone(original),id:'unqualified-17',archive:{...original.archive,fileName:'unqualified-17.zip',sha256:hash('unqualified')}};
  source.builds.push(bad);source.runtimes.find(r=>r.javaMajor===17).recommendations.stable.recommendedBuildIds.unshift(bad.id);
  // 结构投影后模拟已验签但资格过期的首项；不能让源生成器的更早拦截替代App消费门的测试。
  const catalogs=stablePair(source);for(const catalog of catalogs)catalog.builds.find(b=>b.id===bad.id).validationLevel='artifact-audited';
  assert.throws(()=>assertAppRuntimeCoverage(catalogs,target()),/NOT_QUALIFIED/);
  const fallback=fixture();fallback.runtimes[1].recommendations.stable.recommendedBuildIds.push('legacy-17');
  assert.throws(()=>assertAppRuntimeCoverage(stablePair(fallback),target()),/INCOMPATIBLE:v1\/17/);
});
test('已公开新App的稳定供给不能被后续JDK目录抽走',()=>{
  const source=fixture(),host=target();derivePublishedReleaseClosure(pair(source),publishedHostFacts([host]));
  source.builds.find(b=>b.id==='fixed-25').capabilities=[];
  assert.throws(()=>derivePublishedReleaseClosure(pair(source),publishedHostFacts([host])),/APP_STABLE_RUNTIME_INCOMPATIBLE/);
});
test('v1单推荐不改变其它历史build的协议；没有真实绑定或存在冲突必须拒绝',()=>{
  const modern=projectCatalogV2(fixture(),'stable'),legacy=projectLegacyCatalogFromV2(modern);
  assert.throws(()=>releaseCatalogV2(legacy),/BUILD_HOST_BINDING_REQUIRED:legacy/);
  const lifted=releaseCatalogV2(legacy,runtimeHostBindings([legacy,modern]));
  assert(lifted.builds.filter(b=>b.id.startsWith('legacy-')).every(b=>b.requiredHostProtocol===1));
  const wrong=structuredClone(legacy);wrong.runtimes[0].loaderProtocol=1;
  assert.throws(()=>runtimeHostBindings([wrong,modern]),/REQUIREMENT_CONFLICT/);
  const drift=structuredClone(modern);drift.builds[0].archive.sha256=hash('drift');
  assert.throws(()=>runtimeHostBindings([modern,drift]),/IDENTITY_CHANGED/);
});
test('固定公钥历史JWS补齐全部真实旧身份，不把历史目录恢复为当前头',()=>{
  const raw=fs.readFileSync(new URL('../catalog/host-history.json',import.meta.url),'utf8');
  const keys=JSON.parse(fs.readFileSync(new URL('../catalog/trusted-keys.json',import.meta.url),'utf8'));
  const bindings=runtimeHostBindings(verifyRuntimeHostHistory(raw,keys));assert.equal(bindings.size,13);
  assert.equal([...bindings.values()].filter(v=>v.protocol===2).length,4);
  const changed=JSON.parse(raw);changed.entries[0].raw=changed.entries[0].raw.replace('signature','not-signature');changed.entries[0].sha256=hash(changed.entries[0].raw);
  assert.throws(()=>verifyRuntimeHostHistory(JSON.stringify(changed),keys));
  for(const bad of [{runtimeRequiredCapabilities:null},{runtimeRequiredCapabilities:['x']},{runtimeRequiredMajors:['17']}])assert.throws(()=>normalizeRuntimeRequirements(bad));
});
