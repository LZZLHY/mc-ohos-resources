#!/usr/bin/env node
/**
 * 不可变资产交付：完整本地闭包 → 上传缺失资产 → 全量远端读回 → 外置收据。
 * activate 复用同一闭包检查并以可恢复事务替换签名目录；本工具从不覆盖已有远端资产。
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname,basename,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {readDeliveryClosure,validateDeliveryReceipt,REPOSITORY} from './delivery.mjs';
import {verifySourceArchive} from './source-archive.mjs';
import {readAudioSdkProviders,requiresRuntimeAudio,verifyRuntimeAudioFile} from './runtime-audio.mjs';
import {activateCatalog,assertNoPendingActivation} from './activation.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const stamp=()=>new Date().toISOString();

/** 不经过 shell 拼接，GitHub 凭据只由现有 gh 登录环境读取。 */
function gh(...parameters){const r=spawnSync('gh',parameters,{encoding:'utf8',maxBuffer:32*1024*1024});if(r.status!==0)throw Error(r.stderr||'gh failed');return r.stdout;}
export async function fileIdentity(path){const hash=createHash('sha256');let size=0;for await(const chunk of createReadStream(path)){size+=chunk.length;hash.update(chunk);}return{sizeBytes:size,sha256:hash.digest('hex')};}

/** 接收过程中限制长度；成功要求读到 EOF 后完整 SHA 相同，HEAD/上传返回值不能替代。 */
export async function remoteIdentity(url,expected,fetcher=fetch){
  const response=await fetcher(url,{redirect:'follow',signal:AbortSignal.timeout(600000)});
  if(!response.ok||!response.body)throw Error('remote asset HTTP '+response.status+' '+url);
  const hash=createHash('sha256');let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>expected.sizeBytes)throw Error('remote asset too large');hash.update(chunk);}
  const actual=hash.digest('hex');if(size!==expected.sizeBytes||actual!==expected.sha256)throw Error('remote identity mismatch '+url);
  return{url,sizeBytes:size,sha256:actual,verifiedAt:stamp()};
}

/** 先检查所有现有资产冲突，避免前面上传成功后才发现本批后面的同名旧件不同。 */
export function validateExistingAssets(releases,targets){
  for(const target of targets){
    const release=releases.find(r=>r.tag_name===target.tag);
    if(!release)continue;
    if(release.draft)throw Error('release is draft: '+target.tag);
    const assets=release.assets.filter(a=>a.name===target.fileName);
    if(assets.length>1)throw Error('duplicate remote asset name: '+target.fileName);
    const asset=assets[0];
    if(asset && (asset.size!==target.sizeBytes ||
      (asset.digest && asset.digest!=='sha256:'+target.sha256)))throw Error('immutable remote asset identity conflict: '+target.fileName);
    if(!asset && release.immutable)throw Error('Release immutable; register a new batch tag and new URLs before uploading');
  }
}

/** 本地全量门独立可测；全部通过之后，调用者才可读取或修改远端 Release。 */
export async function preflightLocalAssets(closure,map,sdkProviderMap){
  const sources=new Map(),audio=new Map();
  const providers=await readAudioSdkProviders(sdkProviderMap);
  for(const target of closure.targets){
    const path=map[target.fileName];
    if(typeof path!=='string'||!isAbsolute(path)||basename(path)!==target.fileName)throw Error('local absolute filename mismatch: '+target.fileName);
    const buildReceipt=closure.receipts.get(target.buildId);
    if(target.kind==='runtime'&&requiresRuntimeAudio(buildReceipt)){
      // 音频门自行从同一文件句柄核完整 SHA、ZIP、ELF 和原 SDK 供应者。
      audio.set(target.fileName,await verifyRuntimeAudioFile(path,target,buildReceipt,providers));
    }else{
      const actual=await fileIdentity(path);
      if(actual.sizeBytes!==target.sizeBytes||actual.sha256!==target.sha256)throw Error('local identity mismatch '+target.fileName);
    }
    if(target.kind==='source-inputs')sources.set(target.fileName,
      verifySourceArchive(await readFile(path),target,buildReceipt));
  }
  return{sources,audio};
}

export async function main(args=process.argv.slice(2)){
  const option=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};
  const required=name=>{const value=option(name);if(!value)throw Error('--'+name+' required');return value;};
  // 未发布候选可把source/provenance放在明确仓外容器；默认仍读取本仓已发布事实源。
  const deliveryRoot=option('delivery-root')?resolve(option('delivery-root')):root;
  if(args[0]==='activate'){
    if(deliveryRoot!==root)throw Error('isolated delivery root cannot activate the repository catalog');
    // v2须使用四份命名空间成品及投影收据；旧两文件事务不能覆盖这些身份。
    if(option('source') && JSON.parse(await readFile(resolve(option('source')),'utf8')).schemaVersion===2)
      throw Error('v2 requires namespace candidates and verified projection receipt; legacy activate cannot overwrite them');
    const journal=await activateCatalog({root,candidateDir:resolve(required('catalog-dir')),products:(option('products')??'sideload').split(','),
      receiptPath:resolve(required('receipt')),transactionDir:resolve(required('transaction-dir'))});
    console.log('Activated and read back both local channels. Transaction: '+journal.closureSha256+'. Commit/push these exact files, then verify remote channels.');return;
  }
  await assertNoPendingActivation(root);
  const sourcePath=option('source');
  const closure=await readDeliveryClosure(deliveryRoot,sourcePath);
  if(args[0]==='check'){
    console.log(`Delivery closure valid: ${closure.targets.length} runtime/source assets, ${closure.closureSha256}`);return;
  }
  if(args[0]==='assets'){
    const out=resolve(required('receipt')),map=JSON.parse(await readFile(required('assets-map'),'utf8'));
    // 任何本地缺项、来源正文不符或旧 receipt 路径均在第一次网络修改前发现。
    try{await readFile(out);throw Error('receipt already exists; use a new output path');}catch(error){if(error.code!=='ENOENT')throw error;}
    const contents=await preflightLocalAssets(closure,map,option('sdk-provider-map'));
    const releases=JSON.parse(gh('api','--paginate','--slurp','repos/'+REPOSITORY+'/releases?per_page=100')).flat();
    validateExistingAssets(releases,closure.targets);
    for(const tag of new Set(closure.targets.map(t=>t.tag))){
      if(!releases.some(r=>r.tag_name===tag)){
        gh('release','create',tag,'--repo',REPOSITORY,'--prerelease','--title','OHOS runtimes · '+tag,
          '--notes-file',resolve(root,'docs/unified-release-notes.md'));
        releases.push(JSON.parse(gh('api','repos/'+REPOSITORY+'/releases/tags/'+tag)));
      }
    }
    for(const target of closure.targets){
      const release=releases.find(r=>r.tag_name===target.tag);
      if(!release.assets.some(a=>a.name===target.fileName)){
        console.log('Uploading '+target.fileName);
        gh('release','upload',target.tag,map[target.fileName],'--repo',REPOSITORY);
      }
    }
    const receipt={schemaVersion:2,verificationStartedAt:stamp(),sourceSha256:closure.sourceSha256,
      sourceInputsIndexSha256:closure.sourceInputsIndexSha256,closureSha256:closure.closureSha256,assets:[]};
    for(const target of closure.targets){
      const verified=await remoteIdentity(target.url,target);
      receipt.assets.push({...verified,fileName:target.fileName,buildId:target.buildId,kind:target.kind,
        ...(target.kind==='source-inputs'?{sourceInputs:contents.sources.get(target.fileName)}:{}),
        ...(contents.audio.has(target.fileName)?{runtimeAudio:contents.audio.get(target.fileName)}:{})});
      console.log('Verified '+target.fileName);
    }
    if((await readDeliveryClosure(deliveryRoot,sourcePath)).closureSha256!==closure.closureSha256)throw Error('delivery inputs changed during asset publication');
    receipt.finishedAt=stamp();validateDeliveryReceipt(receipt,closure);
    await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return;
  }
  if(args[0]==='verify-web'){
    const receipt={schemaVersion:1,verificationStartedAt:stamp(),sourceSha256:closure.sourceSha256,assets:[]};
    for(const build of closure.source.builds){const download=build.downloads.find(d=>d.sourceId==='web');
      if(download){if(download.transport!=='single-file')throw Error('web verification requires full-file transport');
        receipt.assets.push(await remoteIdentity(download.url,build.archive));console.log('Verified web '+build.archive.fileName);}}
    receipt.finishedAt=stamp();const out=resolve(required('receipt'));await mkdir(dirname(out),{recursive:true});
    await writeFile(out,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return;
  }
  throw Error('Use check, assets, activate or verify-web');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
