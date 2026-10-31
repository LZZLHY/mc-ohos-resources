/**
 * 两通道本地激活事务。文件系统没有跨两个文件的 rename 事务，因此明确保留外置日志：
 * 每次替换为原子单文件 rename；中断后阻止其它导出/签名，原参数重跑只补齐同一批字节。
 * 此处不声称两个静态 URL 同时切换，远端发布仍须提交同一 Git 批次并逐通道回读。
 */
import {readFile,mkdir,open,rename,unlink} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {readDeliveryClosure,validateDeliveryReceipt} from './delivery.mjs';
import {sha256,verifyEnvelope,validateTransition} from './protocol.mjs';
import {projectCatalog} from './catalog.mjs';
import {fetchPublishedRuntimeHosts,derivePublishedReleaseClosure,validateReleaseProducts} from '../lib/catalog-v2.mjs';

const markerPath=root=>resolve(root,'catalog/.activation-pending.json');
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
async function optionalRead(path){try{return await readFile(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}

/** 中断状态必须显式恢复，不能把混合的两个本地通道导出为正常成品。 */
export async function assertNoPendingActivation(root) {
  assert(!await optionalRead(markerPath(root)),'catalog activation pending; rerun activate with its recorded transaction directory');
}

/** 先完整写入、同步并关闭文件；权限、磁盘满和关闭失败均向上传播。 */
async function durableWrite(path,bytes,flags='wx') {
  const file=await open(path,flags);
  try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
}

/** 同目录临时文件 + rename；复跑只接受先前已写完的同一内容，不覆盖未知暂存文件。 */
async function replaceFile(path,bytes,identity) {
  const temporary=path+'.'+identity+'.pending';
  const existing=await optionalRead(temporary);
  if(existing)assert(existing.equals(bytes),'activation temporary bytes changed');
  else await durableWrite(temporary,bytes);
  await rename(temporary,path);
}

export async function activateCatalog({root,candidateDir,receiptPath,transactionDir,afterReplace=()=>{},fetchImpl=globalThis.fetch,products=['sideload']}) {
  root=resolve(root);transactionDir=resolve(transactionDir);
  products=validateReleaseProducts(products);
  const rel=relative(root,transactionDir);
  assert(rel.startsWith('..') || isAbsolute(rel),'activation transaction directory must be outside repository');
  const closure=await readDeliveryClosure(root),keys=JSON.parse(await readFile(resolve(root,'catalog/trusted-keys.json')));
  const receiptRaw=await readFile(receiptPath);validateDeliveryReceipt(JSON.parse(receiptRaw),closure);
  const markerRaw=await optionalRead(markerPath(root));
  const journalPath=resolve(transactionDir,'transaction.json');
  let journal=JSON.parse((await optionalRead(journalPath))??'null');
  if(markerRaw){const marker=JSON.parse(markerRaw);assert(marker.transactionDir===transactionDir && marker.root===root,'another activation is pending');}
  if(journal)assert(journal.schemaVersion===1 && journal.root===root && journal.closureSha256===closure.closureSha256 &&
    journal.receiptSha256===sha256(receiptRaw),'activation transaction identity changed');
  const prepared=[];
  for(const channel of ['stable','preview']){
    const bytes=await readFile(resolve(candidateDir,channel+'.json'));
    const catalog=verifyEnvelope(bytes.toString(),keys,channel);
    assert(JSON.stringify(catalog)===JSON.stringify(projectCatalog(closure.source,channel)),'signed candidate differs from source');
    const path=resolve(root,'catalog/v1',channel+'.json'),current=await optionalRead(path);
    const row=journal?.channels?.find(c=>c.channel===channel);
    const previous=journal ? await optionalRead(resolve(transactionDir,channel+'.previous.json')) : current;
    if(journal)assert(row && row.nextSha256===sha256(bytes) && row.previousSha256===(previous?sha256(previous):null) &&
      (current===null ? row.previousSha256===null : [row.previousSha256,row.nextSha256].includes(sha256(current))),
      'activation previous/candidate/current bytes changed: '+channel);
    if(previous)validateTransition(verifyEnvelope(previous.toString(),keys,channel,Date.now(),true),catalog);
    prepared.push({channel,bytes,previous,path,catalog});
  }
  // 签名/旧资产收据不代表依赖永远有效：真正激活前从固定官网重读实际公开HAP并派生返回图。
  const releaseClosure=derivePublishedReleaseClosure(prepared.map(item=>item.catalog),await fetchPublishedRuntimeHosts(fetchImpl,products),products);
  const releaseCheck={schemaVersion:1,checkedAt:new Date().toISOString(),sourceSha256:closure.sourceSha256,
    catalogFiles:Object.fromEntries(prepared.map(item=>[item.channel,sha256(item.bytes)])),releaseClosure};
  const releaseBytes=Buffer.from(JSON.stringify(releaseCheck,null,2)+'\n'),releaseHash=sha256(releaseBytes);
  // 所有签名、资产、来源和代次验证先完成，再建立日志和写者标记。
  if(!journal){
    await mkdir(transactionDir,{recursive:true});
    for(const item of prepared){
      await durableWrite(resolve(transactionDir,item.channel+'.next.json'),item.bytes);
      if(item.previous)await durableWrite(resolve(transactionDir,item.channel+'.previous.json'),item.previous);
    }
    journal={schemaVersion:1,root,createdAt:new Date().toISOString(),state:'prepared',closureSha256:closure.closureSha256,
      receiptSha256:sha256(receiptRaw),channels:prepared.map(i=>({channel:i.channel,nextSha256:sha256(i.bytes),previousSha256:i.previous?sha256(i.previous):null}))};
    await durableWrite(journalPath,JSON.stringify(journal,null,2)+'\n');
  }
  // HAP头变化但新图仍合格时允许按原候选恢复；新验证另存精确证据，不改写先前事实。
  const releaseFile=resolve(transactionDir,'release-closure-'+releaseHash+'.json');
  const priorCheck=await optionalRead(releaseFile);
  if(priorCheck)assert(priorCheck.equals(releaseBytes),'release closure evidence changed');
  else await durableWrite(releaseFile,releaseBytes);
  journal.releaseClosureChecks=journal.releaseClosureChecks??[];
  journal.releaseClosureChecks.push({file:'release-closure-'+releaseHash+'.json',sha256:releaseHash,checkedAt:releaseCheck.checkedAt});
  const checkedJournal=Buffer.from(JSON.stringify(journal,null,2)+'\n');
  await replaceFile(journalPath,checkedJournal,sha256(checkedJournal));
  assert((await readDeliveryClosure(root)).closureSha256===closure.closureSha256,'delivery inputs changed during activation preflight');
  if(!markerRaw)await durableWrite(markerPath(root),JSON.stringify({schemaVersion:1,root,transactionDir,closureSha256:closure.closureSha256})+'\n');
  await mkdir(resolve(root,'catalog/v1'),{recursive:true});
  for(const item of prepared){
    const current=await optionalRead(item.path);
    if(!current?.equals(item.bytes))await replaceFile(item.path,item.bytes,closure.closureSha256);
    await afterReplace(item.channel); // 默认无副作用；测试在真实第一文件替换后模拟进程中断。
  }
  for(const item of prepared)assert((await readFile(item.path)).equals(item.bytes),'activated catalog readback mismatch');
  assert((await readDeliveryClosure(root)).closureSha256===closure.closureSha256,'delivery inputs changed during activation; transaction remains pending');
  journal.state='complete';journal.completedAt=new Date().toISOString();
  const completeJournal=Buffer.from(JSON.stringify(journal,null,2)+'\n');
  await replaceFile(journalPath,completeJournal,sha256(completeJournal));
  await unlink(markerPath(root));
  return journal;
}
