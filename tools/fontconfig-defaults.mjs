/** 新 Fontconfig 默认适配的独立字节重放；不执行配方、Git 或归档中的代码。 */
import {isDeepStrictEqual as same} from 'node:util';
import {sha256} from './protocol.mjs';

const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const HASH=/^[a-f0-9]{64}$/;
const lines=bytes=>{const text=bytes.toString('utf8');assert(Buffer.from(text).equals(bytes),'font patch is not UTF-8');return text.match(/[^\n]*\n|[^\n]+$/g)??[];};

export function replayFontDefaultPatch(originals,patch){
  const input=lines(patch),result=new Map();let at=0;
  while(at<input.length){
    const match=/^diff --git a\/(\S+) b\/\1\n$/.exec(input[at]);
    assert(match && originals.has(match[1]) && !result.has(match[1]),'font adaptation unexpected patch path/header');
    const name=match[1],before=lines(originals.get(name)),after=[];let cursor=0;
    assert(input[at+1]==='--- a/'+name+'\n' && input[at+2]==='+++ b/'+name+'\n','font adaptation unsupported patch form');at+=3;
    while(at<input.length && !input[at].startsWith('diff --git ')){
      const hunk=/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[^\n]*\n$/.exec(input[at]);
      assert(hunk,'font adaptation invalid hunk header');
      const [first,count,nextFirst,nextCount]=hunk.slice(1).map(value=>Number(value??1));
      const start=count?first-1:first;
      assert(start>=cursor && start<=before.length,'font adaptation hunk outside original');
      after.push(...before.slice(cursor,start));cursor=start;at++;
      assert((nextCount?nextFirst-1:nextFirst)===after.length,'font adaptation resulting position mismatch');
      let oldCount=0,newCount=0;
      while(at<input.length && !input[at].startsWith('@@ ') && !input[at].startsWith('diff --git ')){
        const line=input[at];assert(' +-'.includes(line[0]),'font adaptation unsupported hunk body');
        if(' -'.includes(line[0])){assert(before[cursor]===line.slice(1),'font adaptation context differs from archive');cursor++;oldCount++;}
        if(' +'.includes(line[0])){after.push(line.slice(1));newCount++;}at++;
      }
      assert(oldCount===count && newCount===nextCount,'font adaptation hunk counts mismatch');
    }
    result.set(name,Buffer.from([...after,...before.slice(cursor)].join('')));
  }
  assert(same([...result.keys()].sort(),[...originals.keys()].sort()),'font adaptation incomplete patch');return result;
}

/** 旧 provider 没有默认补丁时仍按旧来源链验收；一旦出现新字段就必须全链闭合。 */
export function verifyFontDefaultAdaptation(files,proof,source,readArchive){
  const key='prebuilt/fontconfig/ohos-defaults.json',record=source.sourceAdaptation;
  const originalRecord=proof.sources.fontconfig.adaptation;
  if(record===undefined && originalRecord===undefined && proof.recipes[key]===undefined)return;
  assert(record && same(record,originalRecord) && HASH.test(proof.recipes[key]),'font adaptation missing source/frozen binding');
  const frozen=name=>{
    const bytes=files.get('font-provider/frozen/'+name);
    assert(bytes && HASH.test(proof.recipes[name]) && sha256(bytes)===proof.recipes[name],'font adaptation frozen input mismatch');return bytes;
  };
  const declared=JSON.parse(frozen(key)),names=['src/fccfg.c','src/fcinit.c'];
  assert(same(Object.keys(declared.before).sort(),names) && same(Object.keys(declared.after).sort(),names) &&
    declared.commit===proof.sources.fontconfig.commit && Object.entries(declared).every(([key,value])=>same(record[key],value)) &&
    record.genericHeader==='prebuilt/fontconfig/ohos-generic-fonts.h' && record.compiledHeader==='src/amcl-generic-fonts.h',
    'font adaptation source/header identity mismatch');
  const patchName='prebuilt/fontconfig/patches/0001-ohos-default-fonts-and-context-cache.patch',patch=frozen(patchName);
  const series=frozen('prebuilt/fontconfig/patches/series').toString('utf8').split('\n').map(x=>x.trim()).filter(x=>x && !x.startsWith('#'));
  assert(sha256(patch)===declared.patchSha256 && same(series,[patchName.split('/').at(-1)]),'font adaptation patch/series mismatch');
  const original=new Map(names.map(name=>[name,readArchive(name)]));
  const hashes=values=>Object.fromEntries([...values].map(([name,bytes])=>[name,sha256(bytes)]));
  assert(same(hashes(original),declared.before) && same(hashes(replayFontDefaultPatch(original,patch)),declared.after),
    'font adaptation replay differs from claimed compiled source');
  const header=frozen(record.genericHeader);
  assert(sha256(header)===record.genericHeaderSha256,'font generic header identity mismatch');
  const macro=/^#define AMCL_FONTCONFIG_GENERIC_RULES (".*")$/m.exec(header.toString('utf8'));
  assert(macro,'font generic macro missing');
  const markers={genericXml:JSON.parse(macro[1]),contextApi:'OH_AbilityRuntime_ApplicationContextGetCacheDir',
    contextLibrary:'libability_runtime.so',outsideRuntimeCache:'.amcl-fontconfig-cache',
    classicLayout:'/jre/lib/aarch64/libfontconfig.so',modernLayout:'/lib/libfontconfig.so'};
  const actual=source.compiledOhosDefaults;
  assert(actual && actual.hardContextApiImport===false && same(Object.keys(actual.markers).sort(),Object.keys(markers).sort()),
    'font compiled default marker/dependency mismatch');
  for(const [name,value] of Object.entries(markers)){
    const bytes=Buffer.from(value),item=actual.markers[name];
    assert(item.sha256===sha256(bytes) && item.sizeBytes===bytes.length && Number.isSafeInteger(item.offset) && item.offset>=0 &&
      item.offset+bytes.length<=source.variants.modern.sizeBytes,'font compiled default marker identity mismatch');
  }
}
