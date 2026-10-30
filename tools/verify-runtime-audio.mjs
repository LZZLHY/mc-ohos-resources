#!/usr/bin/env node
/** 独立本地音频实物验收；不上传、不签名、不激活。SDK映射须显式给出匹配冻结输入。 */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {readAudioSdkProviders,verifyRuntimeAudioFile} from './runtime-audio.mjs';
const args=process.argv.slice(2),option=name=>{const at=args.indexOf('--'+name);if(at<0||!args[at+1])throw Error('--'+name+' required');return args[at+1];};
try{
  const receipt=JSON.parse(await readFile(resolve(option('receipt')),'utf8'));
  const report=await verifyRuntimeAudioFile(resolve(option('archive')),{sizeBytes:receipt.bytes,sha256:receipt.sha256},receipt,
    await readAudioSdkProviders(resolve(option('sdk-provider-map'))));
  const output=args.indexOf('--output');if(output>=0)await writeFile(resolve(args[output+1]),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report,null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
