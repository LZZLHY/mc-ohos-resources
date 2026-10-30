/**
 * 目录v2：宿主要求属于不可变build，推荐列表只表达顺序；签名与平台准入仍分别执行。
 * 复用v1字段验证器检查共同数据，规范化副本仅用于结构验证，不作为签名/发布原文。
 */
import {validateCatalog,validateTransition,buildIdentity,runtimeIdentity} from './catalog-validation.mjs';
const clone=value=>structuredClone(value);
const assert=(test,message)=>{if(!test)throw Error(message);};
const ids=r=>r.recommendedBuildIds;

export function validateCatalogV2(c,channel){
  assert(c?.schemaVersion===2,'unsupported v2 schema');
  assert(Array.isArray(c.runtimes)&&c.runtimes.length>0&&c.runtimes.length<=64,'invalid runtimes');
  assert(Array.isArray(c.builds)&&c.builds.length>0&&c.builds.length<=256,'invalid builds');
  const copy=clone(c);copy.schemaVersion=1;
  for(const build of copy.builds){
    assert(Number.isSafeInteger(build.requiredHostProtocol)&&build.requiredHostProtocol>=1&&build.requiredHostProtocol<=999,'invalid requiredHostProtocol');
    delete build.requiredHostProtocol;
  }
  for(const runtime of copy.runtimes){
    assert(runtime.loaderProtocol===undefined&&runtime.recommendedBuildId===undefined,'v1 runtime fields in v2');
    const selected=runtime.recommendedBuildIds;
    assert(Array.isArray(selected)&&selected.length<=8&&new Set(selected).size===selected.length,'invalid compatible recommendations');
    for(const id of selected)assert(c.builds.some(b=>b.id===id&&b.runtimeId===runtime.id&&b.status==='available'),'missing/withdrawn compatible recommendation');
    // 空推荐可以停止下载。共同验证器需要一个临时引用；此副本永远不返回给发布者。
    const check=copy.builds.find(b=>b.runtimeId===runtime.id);
    assert(check,'runtime lacks identity history');
    runtime.recommendedBuildId=selected[0]??check.id;runtime.loaderProtocol=1;
    delete runtime.recommendedBuildIds;
    if(!selected.length)check.status='available';
    if(runtime.rollback){
      assert(!selected.some(id=>runtime.rollback.fromBuildIds.includes(id)),'rollback target is source');
      if(!selected.length)delete runtime.rollback;
    }
  }
  validateCatalog(copy,channel);
  // 空列表也保留回退指令校验，不能借结构投影绕过已撤回/同槽要求。
  for(const r of c.runtimes)if(r.rollback){
    assert(Object.keys(r.rollback).every(k=>['fromBuildIds','reason'].includes(k)),'unknown rollback field');
    assert(Array.isArray(r.rollback.fromBuildIds)&&r.rollback.fromBuildIds.length>0&&r.rollback.fromBuildIds.length<=32&&new Set(r.rollback.fromBuildIds).size===r.rollback.fromBuildIds.length,'invalid rollback sources');
    assert(typeof r.rollback.reason==='string'&&r.rollback.reason.length>0&&r.rollback.reason.length<=1000,'invalid rollback reason');
    for(const id of r.rollback.fromBuildIds)assert(c.builds.some(b=>b.id===id&&b.runtimeId===r.id&&b.status==='withdrawn'),'rollback source must be withdrawn same runtime');
  }
  return c;
}

export function validateTransitionV2(previous,next){
  validateCatalogV2(next);if(!previous)return;
  validateCatalogV2(previous);
  assert(next.channel===previous.channel&&next.catalogRevision>=previous.catalogRevision,'v2 catalog rollback');
  if(next.catalogRevision===previous.catalogRevision){assert(JSON.stringify(next)===JSON.stringify(previous),'same v2 revision changed');return;}
  for(const old of previous.builds){
    const fresh=next.builds.find(b=>b.id===old.id);
    assert(fresh&&buildIdentity(old)===buildIdentity(fresh)&&old.requiredHostProtocol===fresh.requiredHostProtocol,'immutable build/host identity changed');
    assert(old.status!=='withdrawn'||fresh.status==='withdrawn','withdrawn build revived');
  }
  for(const old of previous.runtimes){
    const fresh=next.runtimes.find(r=>r.id===old.id);if(!fresh)continue;
    assert(runtimeIdentity(old)===runtimeIdentity(fresh),'runtime identity changed');
    assert(fresh.recommendationRevision>=old.recommendationRevision,'recommendation rollback');
    if(JSON.stringify(ids(old))!==JSON.stringify(ids(fresh))||JSON.stringify(old.rollback)!==JSON.stringify(fresh.rollback))assert(fresh.recommendationRevision>old.recommendationRevision,'changed recommendation requires revision');
  }
}

/** 同一源生成两通道；稳定的列表每一项都必须满足正式资格，而不只检查第一项。 */
export function projectCatalogV2(source,channel){
  assert(source?.schemaVersion===2,'v2 source schema required');
  const c={schemaVersion:2,catalogRevision:source.catalogRevision,channel,issuedAt:source.issuedAt,expiresAt:source.expiresAt,
    runtimes:source.runtimes.map(r=>{const {recommendations,...identity}=r;return{...identity,...recommendations[channel]};}),builds:clone(source.builds)};
  validateCatalogV2(c,channel);
  if(channel==='stable')for(const r of c.runtimes)for(const id of ids(r)){
    const b=c.builds.find(b=>b.id===id);
    assert(b.provenance.kind==='legacy'||b.validationLevel==='device-matrix-tested','stable promotion requires device matrix: '+id);
  }
  return c;
}

/**
 * 旧端不能解析空推荐：没有安全协议1替代时明确阻断v1生成，不假标2、不复活撤回包。
 * 保留全部历史build与撤回状态，以继续满足旧客户端的身份防回退；不推荐的2包不可被旧端选中。
 */
export function projectLegacyCatalog(source,channel){
  return projectLegacyCatalogFromV2(projectCatalogV2(source,channel));
}
/** 部署者可核v1是否确实是同份已验签v2的兼容投影，避免只比相同代次而混用两个来源。 */
export function projectLegacyCatalogFromV2(c){
  validateCatalogV2(c);const result=clone(c);result.schemaVersion=1;
  for(const r of result.runtimes){
    const compatible=r.recommendedBuildIds.find(id=>c.builds.find(b=>b.id===id).requiredHostProtocol===1);
    assert(compatible,'V1_NO_SAFE_RECOMMENDATION:'+r.id);
    r.recommendedBuildId=compatible;r.loaderProtocol=1;r.minimumCatalogProtocol=1;delete r.recommendedBuildIds;
  }
  for(const b of result.builds)delete b.requiredHostProtocol;
  validateCatalog(result,c.channel);return result;
}

/** 已公开App收据必须来自真实头；developer、staged或仅自报版本都不能授权公共JDK推荐。 */
export function assertPublishedHostCoverage(catalog,hosts){
  validateCatalogV2(catalog);assert(Array.isArray(hosts),'published host receipts required');
  for(const r of catalog.runtimes)for(const id of ids(r)){
    const b=catalog.builds.find(b=>b.id===id);
    assert(hosts.some(h=>h.schema===1&&h.product==='sideload'&&['stable','preview'].includes(h.channel)&&
      (catalog.channel!=='stable'||h.channel==='stable')&&/^[0-9a-f]{64}$/.test(h.sha256)&&
      Array.isArray(h.runtimeHostProtocols)&&h.runtimeHostProtocols.includes(b.requiredHostProtocol)&&
      Number.isSafeInteger(h.versionCode)&&typeof h.tag==='string'&&h.tag.length>0),
    'PUBLIC_HOST_NOT_READY:'+id+':'+b.requiredHostProtocol);
  }
}
