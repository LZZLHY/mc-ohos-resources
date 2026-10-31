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

/**
 * 公开宿主事实来自官网对真实HAP的审计及实际通道头。只接受完整原件定位和确定的能力，
 * 不能以管理员填入的“可回退”布尔、developer或尚未公开的候选替代这些事实。
 */
export function normalizePublishedHost(value,product=value?.product,channel=value?.channel){
  const protocols=value?.runtimeHostProtocols,devices=value?.deviceTypes;
  const version=value?.versionName;
  assert(value?.schema===1&&['sideload','desktop'].includes(product)&&['stable','preview'].includes(channel)&&
    value.product===product&&value.channel===channel&&value.source==='github','PUBLIC_HOST_IDENTITY_INVALID');
  assert(typeof version==='string'&&version.length<=80&&/^\d+\.\d+\.\d+(?:-(?:pre[1-9]\d*|(?:alpha|beta|rc|pre)\.\d+))?$/.test(version)&&
    version.match(/\d+/g).every(n=>Number.isSafeInteger(Number(n)))&&value.tag==='v'+version,'PUBLIC_HOST_VERSION_INVALID');
  const kind=version.includes('-')?'preview':'stable';
  assert(value.releaseKind===kind&&(channel!=='stable'||kind==='stable')&&
    Number.isSafeInteger(value.versionCode)&&value.versionCode>0&&value.versionCode<=2147483647,'PUBLIC_HOST_RELEASE_INVALID');
  assert(typeof value.sha256==='string'&&typeof value.publicationId==='string'&&typeof value.sourceRevision==='string'&&
    /^[0-9a-f]{64}$/.test(value.sha256)&&/^[0-9a-f]{64}$/.test(value.publicationId)&&
    /^[0-9a-f]{40}$/.test(value.sourceRevision)&&Number.isSafeInteger(value.sizeBytes)&&value.sizeBytes>0&&value.sizeBytes<=2147483648,'PUBLIC_HOST_ORIGINAL_INVALID');
  const name='amcl-'+value.tag+'-'+product+'-unsigned.hap';
  assert(value.name===name&&value.websiteUrl==='https://amcl.lovedhy.cn/api/packages/files/'+value.sha256+'/'+encodeURIComponent(name),'PUBLIC_HOST_URL_INVALID');
  assert(Array.isArray(protocols)&&protocols.length>0&&protocols.length<=8&&new Set(protocols).size===protocols.length&&
    protocols.every(p=>Number.isSafeInteger(p)&&p>=1&&p<=999)&&[0,1].includes(value.runtimePlanProtocol),'PUBLIC_HOST_PROTOCOL_INVALID');
  assert(Number.isSafeInteger(value.minApi)&&value.minApi>=1&&value.minApi<=999&&value.abi==='arm64-v8a'&&
    Array.isArray(devices)&&devices.length>0&&devices.length<=3&&new Set(devices).size===devices.length&&
    devices.every(d=>['phone','tablet','2in1'].includes(d)),'PUBLIC_HOST_PLATFORM_INVALID');
  return{schema:1,product,channel,source:'github',releaseKind:kind,tag:value.tag,versionName:version,versionCode:value.versionCode,
    name,sha256:value.sha256,sizeBytes:value.sizeBytes,publicationId:value.publicationId,sourceRevision:value.sourceRevision,
    websiteUrl:value.websiteUrl,minApi:value.minApi,abi:value.abi,deviceTypes:[...devices].sort(),
    runtimeHostProtocols:[...protocols].sort((a,b)=>a-b),runtimePlanProtocol:value.runtimePlanProtocol};
}

/**
 * 固定官网只读GET；正文有界，超时覆盖响应体，拒绝重定向。404只表示该产品/通道尚无头，
 * 不能借其它产品顶替。fetch参数只供隔离测试替换网络边界，生产CLI不接受任意事实文件。
 */
export async function fetchPublishedRuntimeHosts(fetchImpl=globalThis.fetch,products=['sideload']){
  validateReleaseProducts(products);
  const hosts=[];
  for(const product of products)for(const channel of ['stable','preview']){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetchImpl('https://amcl.lovedhy.cn/api/packages/runtime-host?product='+product+'&channel='+channel,
        {redirect:'error',signal:controller.signal,headers:{Accept:'application/json','Cache-Control':'no-cache'}});
      if(response.status===404){await response.body?.cancel();continue;}
      assert(response.ok,'PUBLIC_HOST_HTTP:'+response.status);
      let size=0;const chunks=[];
      if(!response.body)throw Error('PUBLIC_HOST_EMPTY_RESPONSE');
      for await(const chunk of response.body){size+=chunk.byteLength;assert(size<=65536,'PUBLIC_HOST_RESPONSE_TOO_LARGE');chunks.push(chunk);}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      hosts.push(normalizePublishedHost(JSON.parse(text),product,channel));
    }finally{clearTimeout(timer);controller.abort();}
  }
  return hosts;
}

/** 旧格式仅提升其真实单推荐/宿主语义用于门禁，不重签、不改原v1 payload或伪造协议1替代。 */
export function releaseCatalogV2(catalog){
  if(catalog.schemaVersion===2){validateCatalogV2(catalog);return clone(catalog);}
  validateCatalog(catalog);
  const result=clone(catalog);result.schemaVersion=2;
  for(const build of result.builds)build.requiredHostProtocol=catalog.runtimes.find(r=>r.id===build.runtimeId).loaderProtocol;
  for(const runtime of result.runtimes){runtime.recommendedBuildIds=[runtime.recommendedBuildId];delete runtime.recommendedBuildId;delete runtime.loaderProtocol;}
  validateCatalogV2(result);return result;
}

/** 产品集合是本次明确输入，既不填缺失desktop占位，也不从历史宿主头自动扩大本批范围。 */
export function validateReleaseProducts(products){
  assert(Array.isArray(products)&&products.length>0&&products.length<=2&&new Set(products).size===products.length&&
    products.every(product=>['sideload','desktop'].includes(product)),'RELEASE_PRODUCTS_INVALID');
  return[...products].sort();
}

/**
 * 派生发布闭包：正向每个推荐必须有真实公开App；预览使用stable不具备的宿主时，还必须
 * 具备可认领恢复的稳定HAP及逐major精确合格替代。替代来自用户当前JDK通道的可选推荐，
 * 同时被去/返两端宿主支持，拒绝legacy资格例外和已撤回内容。没有新能力差异的普通维护
 * 不强迫旧stable升级恢复协议。返回值仅是可重算索引，不接受“可回退”自报结论。
 */
export function derivePublishedReleaseClosure(inputCatalogs,inputHosts,targetProducts=['sideload']){
  assert(Array.isArray(inputCatalogs)&&inputCatalogs.length===2,'RELEASE_CATALOG_PAIR_REQUIRED');
  const catalogs=inputCatalogs.map(releaseCatalogV2).sort((a,b)=>a.channel.localeCompare(b.channel));
  assert(catalogs[0].channel==='preview'&&catalogs[1].channel==='stable'&&
    catalogs[0].catalogRevision===catalogs[1].catalogRevision&&catalogs[0].issuedAt===catalogs[1].issuedAt&&
    catalogs[0].expiresAt===catalogs[1].expiresAt,'RELEASE_CATALOG_SOURCE_MISMATCH');
  assert(Array.isArray(inputHosts),'PUBLIC_HOST_RECEIPTS_REQUIRED');
  const facts=inputHosts.map(h=>normalizePublishedHost(h)),keys=facts.map(h=>h.product+'/'+h.channel);
  assert(new Set(keys).size===keys.length,'PUBLIC_HOST_AMBIGUOUS');
  const products=validateReleaseProducts(targetProducts);
  assert(facts.every(host=>products.includes(host.product)),'PUBLIC_HOST_OUTSIDE_PRODUCT_SCOPE');
  const used=new Map(),forward=[],returns=[];
  const hostKey=h=>h.product+'/'+h.channel;
  const use=h=>{used.set(hostKey(h),h);return hostKey(h);};
  for(const product of products){
    const stable=facts.find(h=>h.product===product&&h.channel==='stable');
    assert(stable,'PUBLIC_STABLE_BASELINE_REQUIRED:'+product);
    for(const catalog of catalogs){
      for(const runtime of catalog.runtimes)for(const id of runtime.recommendedBuildIds){
        const build=catalog.builds.find(b=>b.id===id),required=build.requiredHostProtocol;
        const eligible=facts.filter(h=>h.product===product&&(catalog.channel==='preview'||h.channel==='stable')&&h.runtimeHostProtocols.includes(required));
        const current=eligible.find(h=>h.channel==='stable')??eligible.find(h=>h.channel==='preview');
        assert(current,'PUBLIC_HOST_NOT_READY:'+product+'/'+catalog.channel+'/'+id+':'+required);
        forward.push({product,channel:catalog.channel,runtimeId:runtime.id,javaMajor:runtime.javaMajor,buildId:id,
          sha256:build.archive.sha256,sizeBytes:build.archive.sizeBytes,requiredHostProtocol:required,host:use(current)});
        const dropped=current.runtimeHostProtocols.filter(p=>!stable.runtimeHostProtocols.includes(p));
        if(!dropped.length||returns.some(r=>r.product===product&&r.channel===catalog.channel))continue;
        assert(current.runtimePlanProtocol===1&&stable.runtimePlanProtocol===1,'STABLE_RETURN_PLAN_REQUIRED:'+product);
        assert(stable.versionCode>=current.versionCode&&stable.minApi<=current.minApi&&stable.abi===current.abi&&
          current.deviceTypes.every(d=>stable.deviceTypes.includes(d)),'STABLE_RETURN_HAP_INCOMPATIBLE:'+product);
        const replacements=[];
        for(const slot of catalog.runtimes){
          const replacement=slot.recommendedBuildIds.map(id=>catalog.builds.find(b=>b.id===id)).find(b=>
            b.status==='available'&&b.provenance.kind==='source-build'&&b.validationLevel==='device-matrix-tested'&&/^[0-9a-f]{64}$/.test(b.provenance.manifestSha256)&&
            stable.runtimeHostProtocols.includes(b.requiredHostProtocol)&&current.runtimeHostProtocols.includes(b.requiredHostProtocol));
          assert(replacement,'STABLE_RETURN_JDK_NOT_QUALIFIED:'+product+'/'+slot.javaMajor);
          const download=replacement.downloads.find(d=>d.sourceId==='github'&&d.transport==='single-file');
          const url=download?new URL(download.url):null;
          assert(url&&url.origin==='https://github.com'&&url.pathname.startsWith('/LZZLHY/mc-ohos-resources/releases/download/')&&
            url.pathname.endsWith('/'+replacement.archive.fileName)&&!url.search&&!url.hash,'STABLE_RETURN_JDK_ORIGINAL_INVALID:'+replacement.id);
          replacements.push({runtimeId:slot.id,javaMajor:slot.javaMajor,buildId:replacement.id,fileName:replacement.archive.fileName,
            sha256:replacement.archive.sha256,sizeBytes:replacement.archive.sizeBytes,requiredHostProtocol:replacement.requiredHostProtocol,
            sourceCommit:replacement.provenance.sourceCommit,manifestSha256:replacement.provenance.manifestSha256});
        }
        returns.push({product,channel:catalog.channel,fromHost:use(current),stableHost:use(stable),droppedHostProtocols:dropped,replacements});
      }
    }
  }
  const result={schemaVersion:1,products,catalogs:catalogs.map(c=>({schemaVersion:2,channel:c.channel,catalogRevision:c.catalogRevision,
    issuedAt:c.issuedAt,expiresAt:c.expiresAt})),hosts:[...used.values()].sort((a,b)=>hostKey(a).localeCompare(hostKey(b))),forward,returns};
  assert(new TextEncoder().encode(JSON.stringify(result)).byteLength<=262144,'RELEASE_CLOSURE_TOO_LARGE');
  return result;
}
