#!/usr/bin/env node
/** 从已验签候选生成消费者投影；HAP/网页只消费生成文件，不反向充当目录事实源。 */
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyEnvelope,sha256} from './protocol.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),option=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};
const catalogDir=resolve(option('catalog-dir')||resolve(root,'catalog/v1'));
const keysBytes=await readFile(resolve(root,'catalog/trusted-keys.json'));
const keys=JSON.parse(keysBytes);
const stableRaw=await readFile(resolve(catalogDir,'stable.json'));
const stable=verifyEnvelope(stableRaw.toString(),keys,'stable');
if(option('app')){
  const out=resolve(option('app'),'entry/src/main/resources/rawfile/runtime-catalog');await mkdir(out,{recursive:true});
  await writeFile(resolve(out,'builtin.json'),JSON.stringify(stable,null,2)+'\n');
  await writeFile(resolve(out,'trusted-keys.json'),keysBytes);
  await writeFile(resolve(out,'origin.json'),JSON.stringify({schemaVersion:1,repository:'LZZLHY/mc-ohos-resources',catalogRevision:stable.catalogRevision,signedCatalogSha256:sha256(stableRaw),keysSha256:sha256(keysBytes)},null,2)+'\n');
}
if(option('web')){
  const out=resolve(option('web'),'web/src/runtime/generated');await mkdir(out,{recursive:true});
  for(const name of ['catalog-validation.mjs','browser-catalog.mjs'])await copyFile(resolve(root,'lib',name),resolve(out,name));
  await writeFile(resolve(out,'trusted-keys.json'),keysBytes);
  for(const channel of ['stable','preview']){
    const raw=await readFile(resolve(catalogDir,channel+'.json'));verifyEnvelope(raw.toString(),keys,channel);
    await writeFile(resolve(out,channel+'.json'),raw);
  }
}
console.log('Exported verified catalog projections (private key not read).');
