#!/usr/bin/env node
/** 从已验签候选生成消费者投影；HAP/网页只消费生成文件，不反向充当目录事实源。 */
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),option=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};
const contractNames=['tools/protocol.mjs','lib/catalog-validation.mjs','lib/catalog-v2.mjs'];
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
/** 只允许Git约定的CRLF→LF变换，不trim、不重排、不改写模块正文或签名目录。 */
function canonicalLF(bytes){return Buffer.from(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes).replace(/\r\n/g,'\n'),'utf8');}
function git(...parameters){return execFileSync('git',['-C',root,...parameters],{maxBuffer:1024*1024});}
/**
 * 先冻结实际提交对象，后写消费者。工作树/暂存区漂移拒绝；即使assume-unchanged隐藏状态，
 * 规范化工作字节也必须与固定commit的blob逐字相同。导出身份只覆盖这三份模块，不借HEAD
 * 冒充未提交的验证器；输出始终来自不可变blob，不能受后续checkout换行影响。
 */
async function freezeContract(){
  const sourceCommit=git('rev-parse','--verify','HEAD^{commit}').toString('utf8').trim();
  if(!/^[0-9a-f]{40}$/.test(sourceCommit))throw Error('Cannot identify committed runtime contract source');
  const files=new Map(),normalizedFiles=[];
  for(const name of contractNames){
    const blob=git('cat-file','blob',sourceCommit+':'+name);
    if(!blob.equals(canonicalLF(blob)))throw Error('Committed runtime contract is not a canonical LF Git blob: '+name);
    if(!git('cat-file','blob',':'+name).equals(blob))throw Error('Runtime contract has uncommitted drift in index: '+name);
    const working=await readFile(resolve(root,name));
    if(!canonicalLF(working).equals(blob))throw Error('Runtime contract has uncommitted drift: worktree bytes differ from frozen commit: '+name);
    if(!working.equals(blob))normalizedFiles.push(name);
    files.set(name,blob);
  }
  // Windows的Git stat缓存可能在字节相同后仍报告 M；不以状态代替已验证的两份blob和正文。
  // 只接受已证明字节等价的普通M并原样登记；类型/重命名、暂存区和正文变化均拒绝。
  const assertFrozenState=async()=>{
    const status=git('status','--porcelain=v1','--untracked-files=all','--',...contractNames).toString('utf8');
    for(const line of status.split(/\r?\n/).filter(Boolean)){
      if(line.slice(0,2)!==' M'||!contractNames.includes(line.slice(3)))throw Error('Runtime contract has uncommitted drift; commit or restore verifier modules before export');
    }
    if(git('rev-parse','--verify','HEAD^{commit}').toString('utf8').trim()!==sourceCommit)throw Error('Runtime contract HEAD changed during export');
    for(const [name,blob]of files){
      if(!git('cat-file','blob',':'+name).equals(blob))throw Error('Runtime contract index changed during export: '+name);
      if(!canonicalLF(await readFile(resolve(root,name))).equals(blob))throw Error('Runtime contract changed during export: '+name);
    }
    if(git('rev-parse','--verify','HEAD^{commit}').toString('utf8').trim()!==sourceCommit)throw Error('Runtime contract HEAD changed during final byte verification');
    return status;
  };
  const status=await assertFrozenState();
  return {files,manifest:{
    note:'Versioned validator copies; trust anchors remain the reviewed website public keys. No signed catalog activation.',
    schemaVersion:1,sourceRepository:'https://github.com/LZZLHY/mc-ohos-resources',sourceCommit,hashBasis:'git-blob-lf',
    files:Object.fromEntries([...files].map(([name,blob])=>[name,sha256(blob)])),
    normalizationEvidence:{normalizedFiles,gitStatus:status,canonicalBytesMatchCommit:true},
  }};
}
// 验证器本身也必须先通过冻结检查，不能先执行一份未提交模块再声称拒绝其漂移。
const frozenContract=await freezeContract();
const {verifyEnvelope}=await import('./protocol.mjs');
// activation间接依赖同一验证器；同样必须在Git字节冻结之后加载，防止静态import提前执行脏模块。
const {assertNoPendingActivation}=await import('./activation.mjs');
const catalogDir=resolve(option('catalog-dir')||resolve(root,'catalog/v1'));
await assertNoPendingActivation(root);
const keysBytes=await readFile(resolve(root,'catalog/trusted-keys.json'));
const keys=JSON.parse(keysBytes);
const stableRaw=await readFile(resolve(catalogDir,'stable.json'));
const stable=verifyEnvelope(stableRaw.toString(),keys,'stable');
// 在任何消费者写入前验证另一个通道，避免随后发现 preview 损坏而留下半批副本。
const previewRaw=await readFile(resolve(catalogDir,'preview.json'));
verifyEnvelope(previewRaw.toString(),keys,'preview');
if(option('app')){
  const out=resolve(option('app'),'entry/src/main/resources/rawfile/runtime-catalog');await mkdir(out,{recursive:true});
  await writeFile(resolve(out,'builtin.json'),JSON.stringify(stable,null,2)+'\n');
  await writeFile(resolve(out,'trusted-keys.json'),keysBytes);
  await writeFile(resolve(out,'origin.json'),JSON.stringify({schemaVersion:1,repository:'LZZLHY/mc-ohos-resources',catalogRevision:stable.catalogRevision,signedCatalogSha256:sha256(stableRaw),keysSha256:sha256(keysBytes)},null,2)+'\n');
}
if(option('web')){
  const out=resolve(option('web'),'web/src/runtime/generated');await mkdir(out,{recursive:true});
  for(const name of ['catalog-validation.mjs','browser-catalog.mjs']){
    const frozen=frozenContract.files.get('lib/'+name);
    if(frozen)await writeFile(resolve(out,name),frozen);
    else await copyFile(resolve(root,'lib',name),resolve(out,name));
  }
  // 官网部署校验器必须在clean clone自足，不能运行时穿越到维护者的兄弟资源仓。
  const contract=resolve(option('web'),'scripts/runtime-catalog-contract');
  for(const [name,bytes]of frozenContract.files){
    const target=resolve(contract,name);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);
  }
  await writeFile(resolve(contract,'source.json'),JSON.stringify(frozenContract.manifest,null,2)+'\n');
  await writeFile(resolve(out,'trusted-keys.json'),keysBytes);
  for(const channel of ['stable','preview']){
    const raw=channel==='stable'?stableRaw:previewRaw;
    await writeFile(resolve(out,channel+'.json'),raw);
  }
}
console.log('Exported verified catalog projections (private key not read).');
