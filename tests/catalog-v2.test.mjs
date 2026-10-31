/** v2/v1同源投影、不可变宿主要求、撤回和公开App依赖的真实工具回归；只用内存签名私钥。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {projectCatalogV2,projectLegacyCatalog,validateCatalogV2,validateTransitionV2,assertPublishedHostCoverage} from '../lib/catalog-v2.mjs';
import {signCatalog,verifyEnvelope} from '../tools/protocol.mjs';
import {publishedHost,publishedHostFacts} from './fixtures/published-host.mjs';
const original=JSON.parse(fs.readFileSync(new URL('../catalog/source.json',import.meta.url),'utf8'));
export function sourceFixture(){
 const source=structuredClone(original);source.schemaVersion=2;source.catalogRevision++;
 for(const b of source.builds)b.requiredHostProtocol=1;
 for(const r of source.runtimes){
   const old=r.recommendations.stable.recommendedBuildId;
   const copy=structuredClone(source.builds.find(b=>b.id===old));copy.id=old+'-host2';copy.requiredHostProtocol=2;copy.legacyTags=[];
   // 新身份必须有自己的归档名及字节；R12闭包已禁止以另一个buildId复用旧文件名。
   const bytes=Buffer.from('isolated-host2-fixture:'+r.id);
   copy.archive={type:'zip',fileName:copy.id+'.zip',sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
   copy.downloads=[{sourceId:'github',transport:'single-file',url:'https://github.com/LZZLHY/mc-ohos-resources/releases/download/ohos-runtimes/'+copy.archive.fileName}];source.builds.push(copy);
   delete r.loaderProtocol;r.minimumCatalogProtocol=2;
   r.recommendations={stable:{recommendationRevision:2,recommendedBuildIds:[old]},preview:{recommendationRevision:3,recommendedBuildIds:[copy.id,old]}};
 }
 return source;
}
test('two formats preserve exact byte identities and v1 only recommends host1',()=>{
 const source=sourceFixture(),v2=projectCatalogV2(source,'preview'),v1=projectLegacyCatalog(source,'preview');
 assert.equal(v2.schemaVersion,2);assert.equal(v1.schemaVersion,1);
 for(const r of v1.runtimes){assert.equal(r.loaderProtocol,1);assert.equal(r.minimumCatalogProtocol,1);assert.equal(source.builds.find(b=>b.id===r.recommendedBuildId).requiredHostProtocol,1);}
 assert.deepEqual(v1.builds.map(b=>b.archive),v2.builds.map(b=>b.archive));
});
test('strict per-build requirements reject unknown/missing fields and runtime legacy mixture',()=>{
 const c=projectCatalogV2(sourceFixture(),'preview');
 for(const mutation of [x=>delete x.builds[0].requiredHostProtocol,x=>x.builds[0].requiredHostProtocol='2',x=>x.runtimes[0].loaderProtocol=1,x=>x.builds[0].runScript='x',x=>x.runtimes[0].recommendedBuildIds.push(x.runtimes[0].recommendedBuildIds[0])]){
   const bad=structuredClone(c);mutation(bad);assert.throws(()=>validateCatalogV2(bad));
 }
});
test('empty v2 recommendations stop downloads; v1 cannot invent safe alternative',()=>{
 const source=sourceFixture();source.runtimes[0].recommendations.preview.recommendedBuildIds=[];
 validateCatalogV2(projectCatalogV2(source,'preview'));assert.throws(()=>projectLegacyCatalog(source,'preview'),/V1_NO_SAFE/);
});
test('host requirement immutable, no withdrawn resurrection, recommendation revision independent',()=>{
 const old=projectCatalogV2(sourceFixture(),'preview');
 for(const mutation of [x=>x.builds[0].requiredHostProtocol=2,x=>x.runtimes[0].recommendedBuildIds.reverse()]){
   const next=structuredClone(old);next.catalogRevision++;mutation(next);assert.throws(()=>validateTransitionV2(old,next));
 }
 const withdrawn=structuredClone(old);withdrawn.catalogRevision++;const id=withdrawn.runtimes[0].recommendedBuildIds.shift();withdrawn.runtimes[0].recommendationRevision++;withdrawn.builds.find(b=>b.id===id).status='withdrawn';validateTransitionV2(old,withdrawn);
 const revived=structuredClone(withdrawn);revived.catalogRevision++;revived.builds.find(b=>b.id===id).status='available';assert.throws(()=>validateTransitionV2(withdrawn,revived));
});
test('App preview must be publicly ready before requiring host2; stable requires App stable',()=>{
 const source=sourceFixture(),preview=projectCatalogV2(source,'preview');
 const host={schema:1,product:'sideload',channel:'preview',sha256:'a'.repeat(64),tag:'v1.0.7-pre1',versionCode:1000910,runtimeHostProtocols:[1,2]};
 assert.throws(()=>assertPublishedHostCoverage(preview,[]));assert.throws(()=>assertPublishedHostCoverage(preview,[{...host,channel:'developer'}]));assertPublishedHostCoverage(preview,[host]);
 assert.throws(()=>assertPublishedHostCoverage(projectCatalogV2(source,'stable'),[host]));assertPublishedHostCoverage(projectCatalogV2(source,'stable'),[{...host,channel:'stable'}]);
});
test('same ES256 trusted envelope interoperates with schema2 and rejects tampering',()=>{
 const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});const keys={keys:[{kid:'fixture',algorithm:'ES256',spki:pair.publicKey.export({format:'der',type:'spki'}).toString('base64')}]};
 const c=projectCatalogV2(sourceFixture(),'preview'),signed=signCatalog(c,pair.privateKey,'fixture');assert.deepEqual(verifyEnvelope(JSON.stringify(signed),keys,'preview'),c);
 signed.payload=signed.payload.slice(0,-1)+'A';assert.throws(()=>verifyEnvelope(JSON.stringify(signed),keys,'preview'));
});
test('isolated CLI generates four verified namespace candidates and refuses overwrite/host gap',()=>{
 const out=process.env.AMCL_RUN_DIR;if(!out||!path.isAbsolute(out))throw Error('Set explicit external AMCL_RUN_DIR for signing fixture');
 fs.mkdirSync(out,{recursive:true});const area=fs.mkdtempSync(path.join(out,'catalog-v2-'));
 try{
   const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),keys={keys:[{kid:'fixture',algorithm:'ES256',spki:pair.publicKey.export({format:'der',type:'spki'}).toString('base64')}]};
   fs.writeFileSync(area+'/key.pem',pair.privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});fs.writeFileSync(area+'/keys.json',JSON.stringify(keys));fs.writeFileSync(area+'/source.json',JSON.stringify(sourceFixture()));
   const host=publishedHost();fs.writeFileSync(area+'/hosts.json',JSON.stringify(publishedHostFacts([host])));
   const command=['tools/catalog-v2.mjs','generate','--fixture','--source',area+'/source.json','--hosts',area+'/hosts.json','--key',area+'/key.pem','--keys',area+'/keys.json','--kid','fixture','--out',area+'/candidate'];
   const success=spawnSync(process.execPath,command,{encoding:'utf8'});assert.equal(success.status,0,success.stderr);
   for(const version of[1,2])for(const channel of['stable','preview'])assert.equal(verifyEnvelope(fs.readFileSync(area+'/candidate/v'+version+'/'+channel+'.json','utf8'),keys,channel).schemaVersion,version);
   assert.notEqual(spawnSync(process.execPath,command,{encoding:'utf8'}).status,0);
   // 第一代v2发布只有v1历史；仍验证两份v1，不能要求尚不存在的v2前代文件。
   fs.mkdirSync(area+'/previous/v1',{recursive:true});
   for(const channel of ['stable','preview'])fs.copyFileSync(area+'/candidate/v1/'+channel+'.json',area+'/previous/v1/'+channel+'.json');
   const bootstrap=[...command.map(v=>v===area+'/candidate'?area+'/bootstrap':v),'--previous',area+'/previous'];
   const migrated=spawnSync(process.execPath,bootstrap,{encoding:'utf8'});assert.equal(migrated.status,0,migrated.stderr);
   fs.mkdirSync(area+'/previous/v2');fs.copyFileSync(area+'/candidate/v2/stable.json',area+'/previous/v2/stable.json');
   const incomplete=spawnSync(process.execPath,bootstrap.map(v=>v===area+'/bootstrap'?area+'/partial':v),{encoding:'utf8'});
   assert.notEqual(incomplete.status,0);assert.match(incomplete.stderr,/namespace is incomplete/);

   fs.writeFileSync(area+'/hosts.json',JSON.stringify(publishedHostFacts([])));const blocked=spawnSync(process.execPath,command.map(v=>v===area+'/candidate'?area+'/blocked':v),{encoding:'utf8'});assert.notEqual(blocked.status,0);assert.match(blocked.stderr,/PUBLIC_STABLE_BASELINE_REQUIRED/);assert(!fs.existsSync(area+'/blocked'));
   fs.rmSync(area,{recursive:true});
 }catch(error){console.error('Failed isolated signing fixture retained at '+area);throw error;}
});
