#!/usr/bin/env node
/**
 * v2候选生成器。不会激活catalog/v1或catalog/v2，不读取默认私钥，也不改现有source/线上原件。
 * 单一显式source生成v2与兼容v1；两格式独立前代验证，全部通过后以wx写入全新候选目录。
 */
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {projectCatalogV2,projectLegacyCatalog,assertPublishedHostCoverage} from '../lib/catalog-v2.mjs';
import {signCatalog,verifyEnvelope,validateTransition,sha256} from './protocol.mjs';
export {projectCatalogV2,projectLegacyCatalog,assertPublishedHostCoverage};
const args=process.argv.slice(2),option=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};
const required=name=>{const value=option(name);if(!value)throw Error('--'+name+' required');return value;};
async function main(){
  const command=args[0]??'check';const source=JSON.parse(await readFile(required('source'),'utf8'));
  const candidates=[];
  for(const channel of ['stable','preview']){
    const modern=projectCatalogV2(source,channel);const legacy=projectLegacyCatalog(source,channel);
    candidates.push([2,channel,modern],[1,channel,legacy]);
  }
  if(command==='check'){console.log('v2 and compatible v1 projections valid');return;}
  if(command!=='generate')throw Error('Use check or generate');
  // 真正发行直接读取官网已发布头的产物审计，不能拿developer/staged收据充当“App先发”。
  // 离线签名测试必须显式fixture，回执标记不可用于公开激活；本工具没有上传/激活副作用。
  let hosts=[];const fixture=args.includes('--fixture');
  if(fixture)hosts=JSON.parse(await readFile(required('hosts'),'utf8'));
  else{
    if(option('hosts'))throw Error('--hosts is fixture-only; public generation verifies live published hosts');
    for(const channel of ['stable','preview']){
      const response=await fetch('https://amcl.lovedhy.cn/api/packages/runtime-host?product=sideload&channel='+channel,{redirect:'error',signal:AbortSignal.timeout(15000)});
      if(response.status===404)continue;if(!response.ok)throw Error('published host query failed: '+response.status);
      const text=await response.text();if(Buffer.byteLength(text)>65536)throw Error('published host receipt too large');hosts.push(JSON.parse(text));
    }
    const assets=JSON.parse(await readFile(required('asset-receipt'),'utf8'));
    if(assets.sourceSha256!==sha256(await readFile(required('source'))))throw Error('source changed since immutable asset readback');
    for(const b of source.builds.filter(b=>b.provenance.kind==='source-build')){
      const github=b.downloads.find(d=>d.sourceId==='github');
      if(!github||!assets.assets.some(a=>a.url===github.url&&a.sha256===b.archive.sha256&&a.sizeBytes===b.archive.sizeBytes))throw Error('missing immutable asset readback: '+b.id);
    }
  }
  for(const [version,,catalog]of candidates)if(version===2)assertPublishedHostCoverage(catalog,hosts);
  const key=await readFile(required('key'),'utf8');const keys=JSON.parse(await readFile(required('keys'),'utf8'));
  const out=resolve(required('out'));try{await access(out);throw Error('candidate output already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
  const signed=[];
  for(const [version,channel,catalog]of candidates){
    if(option('previous')){
      const previous=resolve(option('previous'),'v'+version,channel+'.json');
      validateTransition(verifyEnvelope(await readFile(previous,'utf8'),keys,channel,Date.now(),true),catalog);
    }
    const envelope=signCatalog(catalog,key,required('kid'));
    verifyEnvelope(JSON.stringify(envelope),keys,channel);
    signed.push([version,channel,envelope]);
  }
  const receipt={schemaVersion:1,fixtureOnly:fixture,hostVerification:fixture?'isolated-fixture':'published-head-api',sourceSha256:sha256(await readFile(required('source'))),catalogRevision:source.catalogRevision,files:{}};
  for(const [version,channel,envelope]of signed){const name='v'+version+'/'+channel+'.json',path=resolve(out,name),bytes=JSON.stringify(envelope,null,2)+'\n';await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes,{flag:'wx'});receipt.files[name]={sha256:sha256(bytes),sizeBytes:Buffer.byteLength(bytes)};}
  await writeFile(resolve(out,'projection-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  console.log('Generated isolated v1/v2 candidates; publication and asset readback remain separate');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
