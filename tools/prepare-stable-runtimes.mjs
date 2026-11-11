#!/usr/bin/env node
/**
 * 从四套已有精确原件准备稳定发行候选。只读运行ZIP/来源ZIP/SDK，输出新外置目录；
 * 不上传、不签名、不改当前source/推荐，不把静态或单机证据伪标为完整设备矩阵。
 */
import {readFile,mkdir,writeFile,copyFile,readdir,stat} from 'node:fs/promises';
import {resolve,basename,dirname,isAbsolute,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fileIdentity} from './publish.mjs';
import {sha256,verifyRuntimeHostHistory} from './protocol.mjs';
import {runtimeHostBindings,projectCatalogCandidate,projectLegacyCatalogFromV2} from '../lib/catalog-v2.mjs';
import {validateBuildReceipt} from './delivery.mjs';
import {verifySourceArchive} from './source-archive.mjs';
import {readAudioSdkProviders,verifyRuntimeAudioFile} from './runtime-audio.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2);
const option=name=>{const index=args.indexOf('--'+name);if(index<0||!args[index+1])throw Error('--'+name+' required');return args[index+1];};
const assert=(value,message)=>{if(!value)throw Error(message);};

export async function prepareStableRuntimes(input,out){
  assert(isAbsolute(out)&&relative(root,out).startsWith('..'),'Candidate output must be explicitly outside source repository');
  assert(input?.schemaVersion===1&&Array.isArray(input.runtimes)&&input.runtimes.length===4&&
    JSON.stringify(input.runtimes.map(item=>item.javaMajor).sort((a,b)=>a-b))==='[8,17,21,25]','Exact four-major candidate input required');
  const sourceRaw=await readFile(resolve(root,'catalog/source.json')),source=JSON.parse(sourceRaw),keys=JSON.parse(await readFile(resolve(root,'catalog/trusted-keys.json')));
  const bindings=runtimeHostBindings(verifyRuntimeHostHistory(await readFile(resolve(root,'catalog/host-history.json'),'utf8'),keys));
  const next=structuredClone(source);next.schemaVersion=2;next.catalogRevision++;
  next.issuedAt=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');next.expiresAt=new Date(Date.now()+180*86400000).toISOString().replace(/\.\d{3}Z$/,'Z');
  for(const build of next.builds){
    const bound=bindings.get(build.runtimeId+'/'+build.id);assert(bound,'Historical host identity missing: '+build.id);build.requiredHostProtocol=bound.protocol;
    // 已公开R12也可能确实含修复；依据原始收据补能力事实，不能仅因它不是本批code候选就误判。
    if(build.provenance.kind==='source-build'){
      const raw=await readFile(resolve(root,'provenance',build.id+'.json')),receipt=validateBuildReceipt(raw,build);
      if(/^[0-9a-f]{64}$/.test(receipt.build?.patches?.['0019-zipfs-permission-copy-transaction.patch'])&&!build.capabilities.includes('zipfs-transaction-v1'))build.capabilities.push('zipfs-transaction-v1');
    }
  }
  const index=JSON.parse(await readFile(resolve(root,'provenance/build-inputs.json'))),audits=[],assets={},receipts=new Map();
  for(const item of input.runtimes){
    for(const key of ['runtime','manifest','sourceInputs','sdkProviders'])assert(typeof item[key]==='string'&&isAbsolute(item[key]),'Absolute candidate input required: '+key);
    const raw=await readFile(item.manifest),receipt=JSON.parse(raw),archive=await fileIdentity(item.runtime),sourceIdentity=await fileIdentity(item.sourceInputs);
    assert(receipt.build?.major===String(item.javaMajor)&&receipt.buildId&&basename(item.runtime)===receipt.file.split(/[\\/]/).at(-1),'Candidate major/name mismatch');
    assert(receipt.sha256===archive.sha256&&receipt.bytes===archive.sizeBytes,'Candidate bytes drift');
    assert(/^[0-9a-f]{64}$/.test(receipt.build.patches?.['0019-zipfs-permission-copy-transaction.patch'])&&
      /^[0-9a-f]{64}$/.test(receipt.build.patches?.['0025-ohos-javasound-duplex-host-callbacks.patch']),'Required ZIPFS/host2 build inputs missing');
    const runtime=next.runtimes.find(r=>r.javaMajor===item.javaMajor),prior=source.runtimes.find(r=>r.javaMajor===item.javaMajor);
    const baseline=source.builds.find(build=>build.id===prior.recommendations.preview.recommendedBuildId);
    const version=receipt.build.release.match(/(?:^|\n)JAVA_VERSION="([^"]+)"/);assert(version,'Actual Java version missing');
    const build={...structuredClone(baseline),id:receipt.buildId,javaVersion:version[1],legacyTags:[],requiredHostProtocol:2,
      archive:{type:'zip',fileName:basename(item.runtime),...archive},downloads:[{sourceId:'github',transport:'single-file',url:'https://github.com/LZZLHY/mc-ohos-resources/releases/download/ohos-runtimes/'+basename(item.runtime)},
        {sourceId:'web',transport:'single-file',url:'https://amcl.lovedhy.cn/runtimes/packages/'+basename(item.runtime)}],
      capabilities:[...new Set([...baseline.capabilities,'zipfs-transaction-v1'])],validationLevel:'artifact-audited',
      notes:['修复ZIP/JAR事务写回与原件保留，包含匹配新宿主的运行时及工具。','待发行候选；设备矩阵与公开原件交付尚未完成，不因本次准备自动晋级。'],
      provenance:{kind:'source-build',sourceRepository:receipt.build.repository,sourceCommit:receipt.build.commit,manifestSha256:sha256(raw),evidence:['精确运行包、来源输入和SDK/原生闭包由prepare-stable-runtimes重新验证；设备资格单独记录。']},status:'available'};
    assert(!next.builds.some(b=>b.id===build.id||b.archive.fileName===build.archive.fileName),'Candidate identity already exists');
    validateBuildReceipt(raw,build);
    const sourceTarget={fileName:basename(item.sourceInputs),...sourceIdentity,manifestSha256:sha256(raw)};
    const sourceAudit=verifySourceArchive(await readFile(item.sourceInputs),sourceTarget,receipt);
    const providers=await readAudioSdkProviders(item.sdkProviders);
    const runtimeAudit=await verifyRuntimeAudioFile(item.runtime,{...archive,buildId:build.id},receipt,providers);
    next.builds.push(build);delete runtime.loaderProtocol;
    runtime.recommendations={stable:{recommendationRevision:prior.recommendations.stable.recommendationRevision+1,recommendedBuildIds:[build.id]},
      preview:{recommendationRevision:prior.recommendations.preview.recommendationRevision+1,recommendedBuildIds:[build.id]}};
    index.files.push({runtimeBuildId:build.id,fileName:sourceTarget.fileName,sizeBytes:sourceTarget.sizeBytes,sha256:sourceTarget.sha256,
      url:'https://github.com/LZZLHY/mc-ohos-resources/releases/download/ohos-runtimes/'+sourceTarget.fileName});
    receipts.set(build.id,raw);assets[build.archive.fileName]=item.runtime;assets[sourceTarget.fileName]=item.sourceInputs;
    audits.push({javaMajor:item.javaMajor,buildId:build.id,archive:build.archive,manifestSha256:sha256(raw),sourceAudit,runtimeAudit});
    console.log('Verified candidate JDK '+item.javaMajor+' '+build.id);
  }
  for(const channel of ['stable','preview'])projectLegacyCatalogFromV2(projectCatalogCandidate(next,channel));
  assert(sha256(await readFile(resolve(root,'catalog/source.json')))===sha256(sourceRaw),'Source changed during preparation');
  await mkdir(out);await mkdir(resolve(out,'catalog'));await mkdir(resolve(out,'provenance'));
  for(const name of await readdir(resolve(root,'provenance')))if(name.endsWith('.json')&&name!=='build-inputs.json')await copyFile(resolve(root,'provenance',name),resolve(out,'provenance',name));
  for(const [id,raw]of receipts)await writeFile(resolve(out,'provenance',id+'.json'),raw,{flag:'wx'});
  await writeFile(resolve(out,'provenance/build-inputs.json'),JSON.stringify(index,null,2)+'\n',{flag:'wx'});
  await writeFile(resolve(out,'catalog/source.json'),JSON.stringify(next,null,2)+'\n',{flag:'wx'});
  await writeFile(resolve(out,'assets-map.json'),JSON.stringify(assets,null,2)+'\n',{flag:'wx'});
  const result={schemaVersion:1,state:'prepared-awaiting-device-matrix',releaseQualified:false,publication:false,sourceSha256:sha256(sourceRaw),
    candidateSourceSha256:sha256(JSON.stringify(next,null,2)+'\n'),preparedAt:new Date().toISOString(),runtimes:audits};
  await writeFile(resolve(out,'preparation.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  prepareStableRuntimes(JSON.parse(await readFile(option('input'),'utf8')),resolve(option('out'))).then(result=>console.log(JSON.stringify({state:result.state,publication:false})))
    .catch(error=>{console.error(error.message);process.exitCode=1;});
}
