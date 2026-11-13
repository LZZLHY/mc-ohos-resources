#!/usr/bin/env node
/**
 * 执行指定 Git 提交中的真实旧客户端验证器和 Repository，验证新 loader 协议在下载入口被拒绝。
 * SDK 的网络/文件边界用内存夹具，JWS 仍走真实 Node OpenSSL 验签；不改客户端源码或能力表。
 * 测试键只存在内存。本证明限于指定源码的协议准入，不代替相应已安装 HAP 的设备验收。
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,verify,createPublicKey} from 'node:crypto';
import assert from 'node:assert/strict';
import {sha256,signCatalog,verifyRuntimeHostHistory} from './protocol.mjs';
import {projectCatalog} from './catalog.mjs';
import {projectLegacyCatalog} from '../lib/catalog-v2.mjs';

async function main(){
  const args=process.argv.slice(2),option=name=>{const i=args.indexOf('--'+name);if(i<0||!args[i+1])throw Error('--'+name+' required');return args[i+1];};
  const app=resolve(option('app')),ref=option('client-ref'),out=resolve(option('receipt'));
  const protocol=Number(option('required-loader-protocol'));assert(Number.isSafeInteger(protocol)&&protocol>1);
  const commit=execFileSync('git',['-C',app,'rev-parse',ref+'^{commit}'],{encoding:'utf8'}).trim();
  const paths=['launch/src/main/ets/RuntimeCatalogValidation.ets','launch/src/main/ets/RuntimeCatalogRepository.ets','launch/src/main/ets/RuntimeCatalogTypes.ets'];
  const overrides={},identities={};
  for(const path of paths){const bytes=execFileSync('git',['-C',app,'show',commit+':'+path]);overrides[path]=bytes.toString();identities[path]=sha256(bytes);}
  const {makePureEtsLoader}=await import(pathToFileURL(resolve(app,'scripts/lib/load-pure-ets.mjs')));
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const source=JSON.parse(await readFile(resolve(root,'catalog/source.json')));
  let stable,preview,baseline;
  if(source.schemaVersion===2){
    // 当前目录已迁移 v2；旧端的起点必须来自真实已验签历史，不能把新的 host2 推荐伪称旧基线。
    const pinned=JSON.parse(await readFile(resolve(root,'catalog/trusted-keys.json'),'utf8'));
    const historyRaw=await readFile(resolve(root,'catalog/host-history.json'),'utf8');
    const history=verifyRuntimeHostHistory(historyRaw,pinned).filter(c=>c.schemaVersion===1&&c.channel==='stable'&&c.runtimes.every(r=>r.loaderProtocol===1));
    assert(history.length,'verified protocol1 stable history required for old-client baseline');
    stable=structuredClone(history.sort((a,b)=>b.catalogRevision-a.catalogRevision)[0]);
    preview=projectLegacyCatalog(source,'preview');
    baseline={kind:'verified-signed-host-history',catalogRevision:stable.catalogRevision,historySha256:sha256(historyRaw)};
    // 隔离签名仍覆盖当前 v1 兼容投影的完整结构；只把受测宿主要求提升到明确指定的值。
    preview.catalogRevision++;
    for(const runtime of preview.runtimes){runtime.loaderProtocol=protocol;runtime.recommendationRevision++;}
  }else{
    stable=projectCatalog(source,'stable');const proposal=structuredClone(source);proposal.catalogRevision++;
    for(const runtime of proposal.runtimes){runtime.recommendations.preview.loaderProtocol=protocol;runtime.recommendations.preview.recommendationRevision++;}
    preview=projectCatalog(proposal,'preview');baseline={kind:'current-v1-source',catalogRevision:stable.catalogRevision};
  }
  const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const keys={schemaVersion:1,keys:[{kid:'admission-test',algorithm:'ES256',spki:pair.publicKey.export({format:'der',type:'spki'}).toString('base64')}]};
  const envelope=JSON.stringify(signCatalog(preview,pair.privateKey,'admission-test'));
  const results=[];
  for(const apiVersion of [20,26]){
    const files=new Map();let requests=0;
    const dependencies={
      '@kit.ArkTS':{util:{TextDecoder:{create:()=>({decodeToString:b=>new TextDecoder('utf-8',{fatal:true}).decode(b)})},
        TextEncoder:class{encodeInto(t){return new Uint8Array(Buffer.from(t));}},
        Base64Helper:class{decodeSync(t){return new Uint8Array(Buffer.from(t,'base64'));}encodeToStringSync(b){return Buffer.from(b).toString('base64');}}}},
      '@kit.CryptoArchitectureKit':{cryptoFramework:{createAsyKeyGenerator:()=>({convertKey:async b=>({pubKey:createPublicKey({key:Buffer.from(b.data),type:'spki',format:'der'})})}),
        createVerify:algorithm=>{assert.equal(algorithm,'ECC256|SHA256');let key;return{init:async k=>{key=k;},verify:async(d,s)=>verify('sha256',d.data,key,s.data)};}}},
      '@kit.NetworkKit':{http:{RequestMethod:{GET:'GET'},HttpDataType:{STRING:'string'},createHttp:()=>({request:async()=>{requests++;return{responseCode:200,result:envelope};},destroy:()=>{}})}},
      '@kit.BasicServicesKit':{deviceInfo:{sdkApiVersion:apiVersion}},
      '@kit.CoreFileKit':{fileIo:{OpenMode:{CREATE:1,WRITE_ONLY:2,TRUNC:4},
        statSync:path=>{if(!files.has(path))throw Error('ENOENT');return{size:Buffer.byteLength(files.get(path))};},
        readTextSync:path=>{if(!files.has(path))throw Error('ENOENT');return files.get(path);},
        openSync:path=>({fd:path}),writeSync:(fd,bytes)=>files.set(fd,bytes),closeSync:()=>{},fsyncSync:()=>{},
        renameSync:(a,b)=>{files.set(b,files.get(a));files.delete(a);}}},
      commons:{ensureDirSync:()=>{},AppLogger:{info:()=>{},warn:()=>{}}}
    };
    const load=makePureEtsLoader(dependencies,overrides),api=load(paths[1]),validation=load(paths[0]);
    const context={filesDir:'/fixture',resourceManager:{getRawFileContentSync:name=>new Uint8Array(Buffer.from(JSON.stringify(name.endsWith('builtin.json')?stable:keys)))}};
    const repository=api.RuntimeCatalogRepository.instance(context);
    const supported=stable.runtimes.filter(r=>validation.supportsRuntime(r,apiVersion));assert(supported.length>0,'old protocol baseline must be accepted');
    for(const runtime of supported)assert(repository.buildFor(String(runtime.javaMajor)),'old supported runtime must provide its real recommendation');
    await repository.configure('preview','github',false);
    assert.equal((await repository.refresh()).ok,true,'signed future protocol remains structurally readable');
    assert.equal(requests,1,'actual Repository must request the signed catalog');
    assert.equal(repository.snapshot().channel,'preview');
    for(const runtime of preview.runtimes){assert.equal(validation.supportsRuntime(runtime,apiVersion),false);assert.equal(repository.buildFor(String(runtime.javaMajor)),undefined);}
    results.push({apiVersion,oldSupportedMajors:supported.map(r=>r.javaMajor),futureProtocol:protocol,downloadRecommendationsRejected:true});
  }
  const receipt={schemaVersion:1,verifiedAt:new Date().toISOString(),clientCommit:commit,sourceSha256:identities,sourceSchemaVersion:source.schemaVersion,baseline,
    test:'real old Repository + signed catalog + production supportsRuntime/buildFor',results,
    scope:'host protocol rejection only; no installed HAP/device runtime qualification'};
  await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(receipt,null,2));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
