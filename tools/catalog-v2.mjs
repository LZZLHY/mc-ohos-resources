#!/usr/bin/env node
/**
 * v2候选生成器。不会激活catalog/v1或catalog/v2，不读取默认私钥，也不改现有source/线上原件。
 * 单一显式source生成v2与兼容v1；两格式独立前代验证，全部通过后以wx写入全新候选目录。
 */
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {projectCatalogV2,projectLegacyCatalog,assertPublishedHostCoverage,fetchPublishedRuntimeHosts,derivePublishedReleaseClosure,validateReleaseProducts} from '../lib/catalog-v2.mjs';
import {signCatalog,verifyEnvelope,validateTransition,sha256,assertIsolatedFixtureKey,verifyRuntimeHostHistory} from './protocol.mjs';
import {readDeliveryClosure,validateDeliveryReceipt} from './delivery.mjs';
export {projectCatalogV2,projectLegacyCatalog,assertPublishedHostCoverage};
const args=process.argv.slice(2),option=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};
const required=name=>{const value=option(name);if(!value)throw Error('--'+name+' required');return value;};
async function main(){
  const command=args[0]??'check',sourceRaw=await readFile(required('source')),source=JSON.parse(sourceRaw),sourceSha256=sha256(sourceRaw);
  const candidates=[];
  for(const channel of ['stable','preview']){
    const modern=projectCatalogV2(source,channel);const legacy=projectLegacyCatalog(source,channel);
    candidates.push([2,channel,modern],[1,channel,legacy]);
  }
  if(command==='check'){console.log('v2 and compatible v1 structural candidates valid; public release closure not checked');return;}
  if(command!=='generate')throw Error('Use check or generate');
  // 真正发行直接读取官网已发布头的产物审计，不能拿developer/staged收据充当“App先发”。
  // 离线签名测试必须显式fixture，回执标记不可用于公开激活；本工具没有上传/激活副作用。
  let hosts=[],deliveryClosure=null,assetReceiptSha256=null;const fixture=args.includes('--fixture'),products=validateReleaseProducts((option('products')??'sideload').split(','));
  if(fixture)hosts=JSON.parse(await readFile(required('hosts'),'utf8'));
  else{
    if(option('hosts'))throw Error('--hosts is fixture-only; public generation verifies live published hosts');
    hosts=await fetchPublishedRuntimeHosts(globalThis.fetch,products);
    const assetRaw=await readFile(required('asset-receipt')),assets=JSON.parse(assetRaw);assetReceiptSha256=sha256(assetRaw);
    // 与R12上传/激活共用完整闭包，包含源码ZIP、原始收据、SDK和实际音频审计。
    // 只有runtime的SHA列表不能证明新格式已经具备同等发行资格。
    const root=option('delivery-root')?resolve(option('delivery-root')):resolve(dirname(fileURLToPath(import.meta.url)),'..');
    deliveryClosure=await readDeliveryClosure(root,required('source'));
    if(deliveryClosure.sourceSha256!==sourceSha256)throw Error('source changed between candidate projection and delivery verification');
    validateDeliveryReceipt(assets,deliveryClosure);
  }
  const key=await readFile(required('key'),'utf8');const keys=JSON.parse(await readFile(required('keys'),'utf8'));
  const bindingCatalogs=fixture?[]:verifyRuntimeHostHistory(await readFile(resolve(dirname(fileURLToPath(import.meta.url)),'../catalog/host-history.json'),'utf8'),keys);
  const releaseClosure=derivePublishedReleaseClosure(candidates.filter(([version])=>version===2).map(([, ,catalog])=>catalog),hosts,products,[],bindingCatalogs);
  if(fixture)assertIsolatedFixtureKey(key,JSON.parse(await readFile(resolve(dirname(fileURLToPath(import.meta.url)),'../catalog/trusted-keys.json'),'utf8')));
  const out=resolve(required('out'));try{await access(out);throw Error('candidate output already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
  const signed=[];
  let previousHasV2=false;
  if(option('previous')){
    const present=[];
    for(const channel of ['stable','preview']){
      try{await access(resolve(option('previous'),'v2',channel+'.json'));present.push(true);}
      catch(error){if(error.code!=='ENOENT')throw error;present.push(false);}
    }
    if(present[0]!==present[1])throw Error('previous v2 namespace is incomplete');
    previousHasV2=present[0];
  }
  for(const [version,channel,catalog]of candidates){
    // 首次v2从真实v1历史迁移：v1两通道仍执行完整防回退，首次v2尚无前代文件。
    // 已存在的v2必须成对且各自验证，不能用删除一份文件重置某个通道的历史。
    if(option('previous')&&(version===1||previousHasV2)){
      const previous=resolve(option('previous'),'v'+version,channel+'.json');
      validateTransition(verifyEnvelope(await readFile(previous,'utf8'),keys,channel,Date.now(),true),catalog);
    }
    const envelope=signCatalog(catalog,key,required('kid'));
    verifyEnvelope(JSON.stringify(envelope),keys,channel);
    signed.push([version,channel,envelope]);
  }
  // 精确源与资产闭包不能在异步宿主/前代检查期间漂移，再次读取后才开始输出候选。
  if(sha256(await readFile(required('source')))!==sourceSha256)throw Error('source changed during candidate generation');
  if(deliveryClosure){
    const root=option('delivery-root')?resolve(option('delivery-root')):resolve(dirname(fileURLToPath(import.meta.url)),'..');
    if((await readDeliveryClosure(root,required('source'))).closureSha256!==deliveryClosure.closureSha256)throw Error('delivery inputs changed during candidate generation');
  }
  const receipt={schemaVersion:2,fixtureOnly:fixture,hostVerification:fixture?'isolated-fixture':'published-head-api',
    sourceSha256,catalogRevision:source.catalogRevision,products,assetReceiptSha256,deliveryClosureSha256:deliveryClosure?.closureSha256??null,
    releaseClosure,releaseClosureSha256:sha256(JSON.stringify(releaseClosure)),files:{}};
  for(const [version,channel,envelope]of signed){const name='v'+version+'/'+channel+'.json',path=resolve(out,name),bytes=JSON.stringify(envelope,null,2)+'\n';await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes,{flag:'wx'});receipt.files[name]={sha256:sha256(bytes),sizeBytes:Buffer.byteLength(bytes)};}
  await writeFile(resolve(out,'projection-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  console.log('Generated isolated v1/v2 candidates; publication and asset readback remain separate');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
