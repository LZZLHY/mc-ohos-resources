#!/usr/bin/env node
/**
 * 不可变资产池发布器：核对本地 → 上传缺失资产 → 远端完整回读 → 生成发布收据。
 * 已存在资产永不 clobber。JSON 由独立签名工具生成，只有收据完整的目录才允许激活。
 * assets-map 是调用者仓外的 filename→绝对本地路径 JSON；不把维护者盘符提交进公开仓。
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {validateCatalog,validateTransition,verifyEnvelope,sha256} from './protocol.mjs';
import {projectCatalog} from './catalog.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),option=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};
const required=name=>{const v=option(name);if(!v)throw Error('--'+name+' required');return v;};
const repo='LZZLHY/mc-ohos-resources',tag='ohos-runtimes';
const stamp=()=>new Date().toISOString();
/** 参数数组传递给 gh/ssh；不把 JSON 或外部字符串拼接为 shell。 */
function gh(...parameters){const r=spawnSync('gh',parameters,{encoding:'utf8',maxBuffer:8*1024*1024});if(r.status!==0)throw Error(r.stderr||'gh failed');return r.stdout;}
async function fileIdentity(path){const hash=createHash('sha256');let size=0;for await(const chunk of createReadStream(path)){size+=chunk.length;hash.update(chunk);}return{sizeBytes:size,sha256:hash.digest('hex')};}
/** 远端完整读回而不是只信任上传返回值；接收上限为已签名大小，多一个字节也失败。 */
async function remoteIdentity(url,expected){
  const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(600000)});
  if(!response.ok||!response.body)throw Error('remote asset HTTP '+response.status+' '+url);
  const hash=createHash('sha256');let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>expected.sizeBytes)throw Error('remote asset too large');hash.update(chunk);}
  const actual=hash.digest('hex');if(size!==expected.sizeBytes||actual!==expected.sha256)throw Error('remote identity mismatch '+url);
  return{url,sizeBytes:size,sha256:actual,verifiedAt:stamp()};
}
async function main(){
  const source=JSON.parse(await readFile(resolve(root,'catalog/source.json'),'utf8'));
  const catalog=projectCatalog(source,'preview');validateCatalog(catalog);
  if(args[0]==='assets'){
    const map=JSON.parse(await readFile(required('assets-map'),'utf8'));
    const sourceInputs=JSON.parse(await readFile(resolve(root,'provenance/build-inputs.json')));
    const targets=sourceInputs.files.map(s=>({id:s.runtimeBuildId+'-source',archive:s,downloads:[{sourceId:'github',url:s.url}]}))
      .concat(catalog.builds.filter(b=>b.provenance.kind==='source-build'));
    for(const b of targets){
      if(basename(map[b.archive.fileName])!==b.archive.fileName)throw Error('local filename mismatch');
      const actual=await fileIdentity(map[b.archive.fileName]);if(actual.sizeBytes!==b.archive.sizeBytes||actual.sha256!==b.archive.sha256)throw Error('local identity mismatch '+b.id);
    }
    // 标签存在且被锁为 immutable 时不能追加，明确失败后改用新批次统一 Release。
    let release;
    const list=JSON.parse(gh('api','repos/'+repo+'/releases?per_page=100'));
    release=list.find(r=>r.tag_name===tag);
    if(!release){
      gh('release','create',tag,'--repo',repo,'--prerelease','--title','OHOS runtimes · 统一资产池','--notes-file',resolve(root,'docs/unified-release-notes.md'));
      release=JSON.parse(gh('api','repos/'+repo+'/releases/tags/'+tag));
    }
    for(const b of targets){
      const asset=release.assets.find(a=>a.name===b.archive.fileName);
      if(!asset){if(release.immutable)throw Error('Release immutable; use a new batch tag');console.log('Uploading '+b.archive.fileName);gh('release','upload',tag,map[b.archive.fileName],'--repo',repo);}
    }
    const receipt={schemaVersion:1,verificationStartedAt:stamp(),sourceSha256:sha256(await readFile(resolve(root,'catalog/source.json'))),assets:[]};
    for(const b of targets){const d=b.downloads.find(d=>d.sourceId==='github');receipt.assets.push(await remoteIdentity(d.url,b.archive));console.log('Verified '+b.archive.fileName);}
    receipt.finishedAt=stamp();const out=resolve(required('receipt'));await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return;
  }
  if(args[0]==='activate'){
    const keys=JSON.parse(await readFile(resolve(root,'catalog/trusted-keys.json')));
    const candidate=resolve(required('catalog-dir'));
    const receipt=JSON.parse(await readFile(required('receipt')));
    if(receipt.sourceSha256!==sha256(await readFile(resolve(root,'catalog/source.json'))))throw Error('source changed since asset verification');
    for(const b of catalog.builds.filter(b=>b.provenance.kind==='source-build')){
      if(!receipt.assets.some(a=>a.sha256===b.archive.sha256&&a.sizeBytes===b.archive.sizeBytes&&a.url===b.downloads.find(d=>d.sourceId==='github').url))throw Error('missing asset receipt '+b.id);
    }
    const raws=[];
    for(const channel of ['stable','preview']){
      const raw=await readFile(resolve(candidate,channel+'.json'));
      const decoded=verifyEnvelope(raw.toString(),keys,channel);
      if(JSON.stringify(decoded)!==JSON.stringify(projectCatalog(source,channel)))throw Error('signed candidate differs from source');raws.push([channel,raw]);
      const oldPath=resolve(root,'catalog/v1',channel+'.json');
      try{const old=await readFile(oldPath,'utf8');validateTransition(verifyEnvelope(old,keys,channel,Date.now(),true),decoded);}
      catch(error){if(error.code!=='ENOENT')throw error;}
    }
    await mkdir(resolve(root,'catalog/v1'),{recursive:true});
    for(const [channel,raw] of raws)await writeFile(resolve(root,'catalog/v1',channel+'.json'),raw);
    console.log('Activated verified local catalog files. Commit and push these exact bytes; mirror the same files.');return;
  }
  if(args[0]==='verify-web'){
    const receipt={schemaVersion:1,verificationStartedAt:stamp(),sourceSha256:sha256(await readFile(resolve(root,'catalog/source.json'))),assets:[]};
    for(const b of catalog.builds){const d=b.downloads.find(d=>d.sourceId==='web');if(d){receipt.assets.push(await remoteIdentity(d.url,b.archive));console.log('Verified web '+b.archive.fileName);}}
    receipt.finishedAt=stamp();await writeFile(resolve(required('receipt')),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return;
  }
  throw Error('Use assets, activate or verify-web');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
