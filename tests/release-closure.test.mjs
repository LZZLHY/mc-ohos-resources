/** 正向公开宿主与稳定返回闭包的生产纯函数回归；fixture资格只验证元数据门，不授予设备资格。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {projectCatalogV2,derivePublishedReleaseClosure as deriveContract,fetchPublishedRuntimeHosts,validateTransitionV2,projectLegacyCatalogFromV2,assertLegacyReturnCoverage} from '../lib/catalog-v2.mjs';
import {publishedHost,publishedHostFacts} from './fixtures/published-host.mjs';
import {assertIsolatedFixtureKey,signCatalog,verifyEnvelope} from '../tools/protocol.mjs';
import {validateTransition as validateV1Transition} from '../lib/catalog-validation.mjs';
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
    const stableFallback=make('stable-return-fixture',1,'device-matrix-tested');
    delete runtime.loaderProtocol;
    runtime.recommendations={stable:{recommendationRevision:20,recommendedBuildIds:[stableFallback.id]},
      preview:{recommendationRevision:20,recommendedBuildIds:[modern.id,fallback.id]}};
  }
  return source;
}
const catalogs=source=>['stable','preview'].map(channel=>projectCatalogV2(source,channel));
const hosts=()=>[publishedHost({runtimeHostProtocols:[1]}),publishedHost({channel:'preview'})];
// 旧小用例省略“过去不同的头”时，显式把隔离当前样本登记为从空库完整记录的发布账。
const derivePublishedReleaseClosure=(catalogs,heads,products,history)=>deriveContract(catalogs,Array.isArray(heads)?publishedHostFacts(heads):heads,products,history);

test('完整闭包绑定真实形状的去返HAP及每槽精确原件，而不是自报可返回布尔',()=>{
  const source=sourceFixture(),proof=derivePublishedReleaseClosure(catalogs(source),hosts());
  assert.equal(proof.returns.length,2);assert.equal(proof.returns[0].replacements.length,source.runtimes.length);
  for(const graph of proof.returns)for(const replacement of graph.replacements){
    const expected=source.builds.find(b=>b.id===replacement.buildId);
    assert.equal(replacement.sha256,expected.archive.sha256);assert.equal(replacement.sizeBytes,expected.archive.sizeBytes);
    assert.equal(replacement.manifestSha256,expected.provenance.manifestSha256);
  }
});

/** 推荐停止只改变可选项，历史身份仍保持；撤回也不代表设备上已装原件会被卸载。 */
function retireHost2(source,{withdrawn=false,qualified=true,channel='preview'}={}){
  const next=structuredClone(source);next.catalogRevision++;
  for(const runtime of next.runtimes){
    const recommendation=runtime.recommendations[channel];recommendation.recommendationRevision++;
    const fallback=next.builds.find(b=>b.id===recommendation.recommendedBuildIds.find(id=>next.builds.find(b=>b.id===id).requiredHostProtocol===1));
    const legacy=next.builds.find(b=>b.runtimeId===runtime.id&&b.provenance.kind==='legacy');
    recommendation.recommendedBuildIds=[qualified?fallback.id:legacy.id];
    if(withdrawn)for(const build of next.builds)if(build.runtimeId===runtime.id&&build.requiredHostProtocol===2)build.status='withdrawn';
  }
  return next;
}

test('合法停止推荐或撤回2仍保留逐major返回义务；同一签名后继不能退回仅legacy',()=>{
  const source=sourceFixture(),before=catalogs(source),pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const keys={keys:[{kid:'retirement-fixture',algorithm:'ES256',spki:pair.publicKey.export({type:'spki',format:'der'}).toString('base64')}]};
  for(const withdrawn of [false,true]){
    const next=retireHost2(source,{withdrawn}),after=catalogs(next);
    for(let i=0;i<before.length;i++){
      validateTransitionV2(before[i],after[i]);
      assert.deepEqual(verifyEnvelope(JSON.stringify(signCatalog(after[i],pair.privateKey,'retirement-fixture')),keys,after[i].channel,Date.parse(after[i].issuedAt)+1000),after[i]);
    }
    const proof=derivePublishedReleaseClosure(after,hosts());
    assert.equal(proof.returns.length,2);
    assert.equal(proof.forward.some(r=>r.requiredHostProtocol===2),false);
    for(const graph of proof.returns){
      assert.deepEqual(graph.droppedHostProtocols,[2]);assert.equal(graph.retainedBuilds.length,source.runtimes.length);
      assert(graph.retainedBuilds.every(b=>b.status===(withdrawn?'withdrawn':'available')));
      assert.equal(graph.replacements.length,source.runtimes.length);
    }
    const unsafe=retireHost2(source,{withdrawn,qualified:false});
    for(let i=0;i<before.length;i++)validateTransitionV2(before[i],catalogs(unsafe)[i]);
    assert.throws(()=>derivePublishedReleaseClosure(catalogs(unsafe),hosts()),/STABLE_RETURN_JDK_NOT_QUALIFIED:sideload\/preview/);
  }
});

test('装preview2后只切JDK stable也需其独立合格替代，不能借preview；真实v1投影必须合格',()=>{
  const source=retireHost2(sourceFixture());
  const unsafe=retireHost2(source,{channel:'stable',qualified:false});
  assert.throws(()=>derivePublishedReleaseClosure(catalogs(unsafe),hosts()),/STABLE_RETURN_JDK_NOT_QUALIFIED:sideload\/stable/);
  for(const channel of ['stable','preview']){
    const next=structuredClone(source);
    for(const runtime of next.runtimes){
      const legacy=next.builds.find(b=>b.runtimeId===runtime.id&&b.provenance.kind==='legacy');
      runtime.recommendations[channel].recommendedBuildIds.unshift(legacy.id);
    }
    assert.throws(()=>derivePublishedReleaseClosure(catalogs(next),hosts()),new RegExp('STABLE_RETURN_V1_NOT_QUALIFIED:sideload/'+channel));
  }
  const proof=derivePublishedReleaseClosure(catalogs(source),hosts());
  for(const catalog of catalogs(source)){
    const legacy=projectLegacyCatalogFromV2(catalog),graph=proof.returns.find(r=>r.channel===catalog.channel);
    assert.deepEqual(legacy.runtimes.map(r=>r.recommendedBuildId),graph.replacements.map(b=>b.buildId));
  }
});

test('只有真实stable宿主覆盖历史能力才解除义务；停止推荐仍核samecode/plan及独立产品',()=>{
  const source=retireHost2(sourceFixture(),{qualified:false,withdrawn:true});
  const caughtUp=hosts();caughtUp[0].runtimeHostProtocols=[1,2];caughtUp[0].runtimePlanProtocol=0;caughtUp[1].runtimePlanProtocol=0;
  assert.equal(derivePublishedReleaseClosure(catalogs(source),caughtUp).returns.length,0);
  const qualified=retireHost2(sourceFixture(),{withdrawn:true});
  for(const change of [h=>{h[0].versionCode--;},h=>{h[0].runtimePlanProtocol=0;}]){
    const current=hosts();change(current);
    assert.throws(()=>derivePublishedReleaseClosure(catalogs(qualified),current),/STABLE_RETURN_/);
  }
  const desktop=hosts().map(h=>publishedHost({product:'desktop',channel:h.channel,runtimeHostProtocols:h.runtimeHostProtocols,deviceTypes:['2in1']}));
  assert.equal(derivePublishedReleaseClosure(catalogs(qualified),desktop,['desktop']).returns.length,2);
  assert.throws(()=>derivePublishedReleaseClosure(catalogs(source),[...caughtUp,...desktop],['sideload','desktop']),/STABLE_RETURN_JDK_NOT_QUALIFIED:desktop/);
  // 显式phone发布范围不能屏蔽实际desktop消费者，但两头不存在不制造占位要求。
  desktop[0].runtimePlanProtocol=0;
  assert.throws(()=>derivePublishedReleaseClosure(catalogs(qualified),[...caughtUp,...desktop],['sideload']),/STABLE_RETURN_PLAN_REQUIRED:desktop/);
  desktop[0].runtimePlanProtocol=2;
  const scoped=derivePublishedReleaseClosure(catalogs(qualified),[...caughtUp,...desktop],['sideload']);
  assert.deepEqual(scoped.products,['sideload']);assert.deepEqual(scoped.returnProducts,['desktop']);
  assert(scoped.forward.every(r=>r.product==='sideload'));assert(scoped.returns.every(r=>r.product==='desktop'));
});

test('未推荐且无公开preview支持的未来协议3仅为候选，不凭登记扩张宿主或返回义务',()=>{
  const source=retireHost2(sourceFixture());
  for(const runtime of source.runtimes){
    const future=structuredClone(source.builds.find(b=>b.runtimeId===runtime.id&&b.requiredHostProtocol===2));
    future.id+='-future3';future.requiredHostProtocol=3;
    future.archive={...future.archive,fileName:future.id+'.zip'};
    future.downloads=[{sourceId:'github',transport:'single-file',url:'https://github.com/LZZLHY/mc-ohos-resources/releases/download/ohos-runtimes/'+future.archive.fileName}];
    source.builds.push(future);
  }
  const proof=derivePublishedReleaseClosure(catalogs(source),hosts());
  assert(proof.returns.every(r=>r.droppedHostProtocols.join(',')==='2'&&r.retainedBuilds.every(b=>b.requiredHostProtocol===2)));
  assert.equal(proof.forward.some(r=>r.requiredHostProtocol===3),false);
});

test('新v2激活核实际部署v1的逐槽返回资格，安全旧代次可用，候选安全不代表入口已更新',()=>{
  const source=retireHost2(sourceFixture()),proof=derivePublishedReleaseClosure(catalogs(source),hosts());
  const legacy=catalogs(source).map(projectLegacyCatalogFromV2);
  for(const catalog of legacy)catalog.catalogRevision--;
  const actual=assertLegacyReturnCoverage(legacy,proof);
  assert.equal(actual.length,2);assert(actual.every(r=>r.catalogRevision<source.catalogRevision));
  assert.deepEqual(actual[0].replacements,proof.returns[0].replacements);
  assert.throws(()=>assertLegacyReturnCoverage([],proof),/DEPLOYED_V1_REQUIRED/);
  for(const channel of ['stable','preview']){
    const stale=structuredClone(legacy),catalog=stale.find(c=>c.channel===channel);
    for(const runtime of catalog.runtimes)runtime.recommendedBuildId=catalog.builds.find(b=>b.runtimeId===runtime.id&&b.provenance.kind==='legacy').id;
    assert.throws(()=>assertLegacyReturnCoverage(stale,proof),new RegExp('DEPLOYED_V1_NOT_QUALIFIED:sideload/'+channel));
  }
});

test('同runtime历史API/目录准入不能提高后隐藏旧槽恢复；独立未来结构候选仍可检查',()=>{
  const source=sourceFixture();for(const runtime of source.runtimes)runtime.minimumApi=26;
  const before=catalogs(source),legacy=before.map(projectLegacyCatalogFromV2);
  for(const [field,value] of [['minimumApi',27],['minimumCatalogProtocol',3]]){
    const next=structuredClone(source);next.catalogRevision++;
    for(const runtime of next.runtimes){runtime[field]=value;runtime.recommendations.stable.recommendationRevision++;runtime.recommendations.preview.recommendationRevision++;}
    const after=catalogs(next); // 格式可表达未来候选，不以结构验证冒充当前客户端可安装。
    for(let i=0;i<before.length;i++){
      assert.throws(()=>validateTransitionV2(before[i],after[i]),/runtime admission .* tightened/);
      const futureV1=structuredClone(legacy[i]);futureV1.catalogRevision++;futureV1.runtimes[0][field]=value;futureV1.runtimes[0].recommendationRevision++;
      assert.throws(()=>validateV1Transition(legacy[i],futureV1),/runtime admission .* tightened/);
    }
    if(field==='minimumCatalogProtocol')assert.throws(()=>derivePublishedReleaseClosure(after,hosts()),/RUNTIME_CLIENT_ADMISSION_UNSUPPORTED/);
    else assert.throws(()=>derivePublishedReleaseClosure(after,hosts(),['sideload'],before),/runtime admission minimumApi tightened/);
  }
  const proof=derivePublishedReleaseClosure(before,hosts()),narrowed=structuredClone(legacy);
  narrowed[0].runtimes[0].minimumApi=27;
  assert.throws(()=>assertLegacyReturnCoverage(narrowed,proof),/RUNTIME_CLIENT_ADMISSION_UNSUPPORTED/);
  assert(proof.returns.every(graph=>graph.replacements.every(b=>b.admission.minimumApi===26)));
});

test('v1新激活保留验签v2宿主历史，不能用全局host1投影解除返回义务',()=>{
  const modern=catalogs(sourceFixture()),legacy=modern.map(projectLegacyCatalogFromV2);
  for(const catalog of legacy){catalog.catalogRevision++;for(const runtime of catalog.runtimes)runtime.recommendationRevision++;}
  const proof=derivePublishedReleaseClosure(legacy,hosts(),['sideload'],modern);
  assert.equal(proof.returns.length,2);assert.equal(proof.historyCatalogs.length,2);
  assert.equal(assertLegacyReturnCoverage(legacy,proof).length,2);
  for(const catalog of legacy)for(const runtime of catalog.runtimes)runtime.recommendedBuildId=catalog.builds.find(b=>b.runtimeId===runtime.id&&b.provenance.kind==='legacy').id;
  assert.throws(()=>derivePublishedReleaseClosure(legacy,hosts(),['sideload'],modern),/STABLE_RETURN_JDK_NOT_QUALIFIED/);
});

test('新formal把preview头降回1不能抹历史公开2；两namespace仍需返回，真stable覆盖才结束',()=>{
  const original=sourceFixture(),retired=retireHost2(original,{withdrawn:true});
  const old=hosts(),current=['stable','preview'].map(channel=>publishedHost({channel,versionName:'2.1.0',versionCode:2000001,runtimeHostProtocols:[1]}));
  const facts=publishedHostFacts(current,[...old,...current]),proof=deriveContract(catalogs(retired),facts);
  assert.equal(proof.returns.length,2);assert(proof.returns.every(r=>r.fromHost.endsWith(old[1].publicationId)));
  assert.equal(assertLegacyReturnCoverage(catalogs(retired).map(projectLegacyCatalogFromV2),proof).length,2);
  const unsafe=retireHost2(retired,{channel:'stable',qualified:false});
  for(const runtime of unsafe.runtimes)runtime.recommendations.preview.recommendedBuildIds=[unsafe.builds.find(b=>b.runtimeId===runtime.id&&b.provenance.kind==='legacy').id];
  assert.throws(()=>deriveContract(catalogs(unsafe),facts),/STABLE_RETURN_JDK_NOT_QUALIFIED/);
  assert.throws(()=>deriveContract(catalogs(unsafe).map(projectLegacyCatalogFromV2),facts,['sideload'],catalogs(original)),/STABLE_RETURN_JDK_NOT_QUALIFIED/);
  const covered=structuredClone(current);covered[0].runtimeHostProtocols=[1,2];
  assert.equal(deriveContract(catalogs(unsafe),publishedHostFacts(covered,[...old,...covered])).returns.length,0);
});

test('历史HAP的API/设备和code cohort不随最新头升门槛消失；仅登记未来3没有公开事实不生义务',()=>{
  const source=retireHost2(sourceFixture(),{withdrawn:true}),old=hosts();
  for(const mutation of [h=>{h.minApi=27;},h=>{h.deviceTypes=['2in1'];}]){
    const current=['stable','preview'].map(channel=>publishedHost({channel,versionName:'2.1.0',versionCode:2000001}));
    for(const head of current)mutation(head);
    assert.throws(()=>deriveContract(catalogs(source),publishedHostFacts(current,[...old,...current])),/STABLE_RETURN_HAP_INCOMPATIBLE/);
  }
  const noPublic3=structuredClone(source);for(const build of noPublic3.builds)if(build.requiredHostProtocol===2)build.requiredHostProtocol=3;
  const only1=['stable','preview'].map(channel=>publishedHost({channel,versionName:'2.1.0',versionCode:2000001,runtimeHostProtocols:[1]}));
  assert.equal(deriveContract(catalogs(noPublic3),publishedHostFacts(only1)).returns.length,0);
});

test('只有latest数组、历史覆盖未知、当前头无历史绑定、404或截断均不构成完整生产事实',async()=>{
  assert.throws(()=>deriveContract(catalogs(sourceFixture()),hosts()),/PUBLIC_HOST_HISTORY_REQUIRED/);
  const incomplete=publishedHostFacts(hosts());incomplete.products[1].coverage='legacy-unknown';
  assert.throws(()=>deriveContract(catalogs(sourceFixture()),incomplete),/PUBLIC_HOST_HISTORY_INCOMPLETE:desktop/);
  const unbound=publishedHostFacts(hosts(),[]);
  assert.throws(()=>deriveContract(catalogs(sourceFixture()),unbound),/HEAD_HISTORY_MISMATCH/);
  const mixed=publishedHostFacts(hosts());mixed.products[1].historyRevision++;
  assert.throws(()=>deriveContract(catalogs(sourceFixture()),mixed),/SNAPSHOT_CHANGED_RETRY/);
  await assert.rejects(fetchPublishedRuntimeHosts(async()=>new Response('',{status:404})),/PUBLIC_HOST_HTTP:404/);
  const tooMany=publishedHostFacts(hosts());tooMany.products[0].publications=Array.from({length:257},()=>hosts()[0]);
  assert.throws(()=>deriveContract(catalogs(sourceFixture()),tooMany),/PUBLIC_HOST_HISTORY_LIMIT/);
});

test('旧stable plan0、有预览App且正向可跑2，仍必须禁止自动正式回退闭包',()=>{
  const current=hosts();current[0].runtimePlanProtocol=0;current[0].canReturn=true;
  assert.throws(()=>derivePublishedReleaseClosure(catalogs(sourceFixture()),current),/STABLE_RETURN_PLAN_REQUIRED/);
});

test('旧plan1可识别但不授予新的跨宿主恢复资格；reader2两端真实声明才合格，未知3拒绝',()=>{
  for(const index of [0,1]){
    const current=hosts();current[index].runtimePlanProtocol=1;
    assert.throws(()=>derivePublishedReleaseClosure(catalogs(sourceFixture()),current),/STABLE_RETURN_PLAN_REQUIRED/);
  }
  const ordinary=hosts();ordinary[0].runtimeHostProtocols=[1,2];ordinary[0].runtimePlanProtocol=1;ordinary[1].runtimePlanProtocol=0;
  assert.equal(derivePublishedReleaseClosure(catalogs(sourceFixture()),ordinary).returns.length,0);
  const unknown=hosts();unknown[1].runtimePlanProtocol=3;
  assert.throws(()=>derivePublishedReleaseClosure(catalogs(sourceFixture()),unknown),/PUBLIC_HOST_PROTOCOL_INVALID/);
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
  assert.throws(()=>derivePublishedReleaseClosure(catalogs(sourceFixture()),[...hosts(),hosts()[0]]),/AMBIGUOUS|HISTORY_LIMIT/);
  const seen=[];
  const facts=await fetchPublishedRuntimeHosts(async(url,options)=>{
    seen.push(url);assert.equal(options.redirect,'error');assert(url.startsWith('https://amcl.lovedhy.cn/api/packages/runtime-host-facts?'));
    const query=new URL(url).searchParams;
    return Response.json(publishedHostFacts(hosts()).products.find(p=>p.product===query.get('product')));
  },['sideload','desktop']);
  assert.equal(facts.products[1].heads.length,2);assert.equal(seen.length,2);
  await assert.rejects(fetchPublishedRuntimeHosts(async()=>new Response('x'.repeat(524289))),/TOO_LARGE/);
});

test('fixture不能借改kid或自选keys文件使用生产SPKI',()=>{
  const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),other=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const pinned={keys:[{kid:'production-original',spki:pair.publicKey.export({type:'spki',format:'der'}).toString('base64')}]};
  assert.throws(()=>assertIsolatedFixtureKey(pair.privateKey,pinned),/FIXTURE_KEY_IS_PRODUCTION/);
  assert.doesNotThrow(()=>assertIsolatedFixtureKey(other.privateKey,pinned));
});
