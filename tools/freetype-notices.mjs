/**
 * 独立重算派生 FreeType notice。只读原 JDK 冻结补丁和许可，不执行归档内脚本。
 * notice/生成器属于派生交付输入，绝不要求或允许把它们伪装进原 frozenFiles。
 */
import {isDeepStrictEqual} from 'node:util';
import {sha256} from './protocol.mjs';
const assert=(ok,message)=>{if(!ok)throw Error(message);};
const same=(a,b)=>isDeepStrictEqual(a,b),HASH=/^[0-9a-f]{64}$/;

/** 从完整新增 hunk 恢复锁定上游文件；修改既有配置的 hunk 不属于新增文件清单。 */
function importedSources(patch,item){
  assert(sha256(patch)===item.patchSha256,'notice completion patch identity mismatch');
  const targets=Object.fromEntries(Object.entries(item.importedFiles).map(([name,value])=>[value.target,name])),sources={};
  for(const section of patch.toString('utf8').replace(/\r\n/g,'\n').split(/(?=^diff --git )/m)){
    const hit=section.match(/^\+\+\+ b\/([^\n]+)$/m);
    if(hit && section.includes('--- /dev/null\n'))assert(Object.hasOwn(targets,hit[1]),'notice patch has undeclared added file');
    if(!hit || !Object.hasOwn(targets,hit[1]))continue;
    const name=targets[hit[1]],hunk=/^@@ -0,0 \+1,(\d+) @@\n/m.exec(section);
    assert(!Object.hasOwn(sources,name) && section.includes('--- /dev/null\n') && hunk,'notice source is not a complete unique addition');
    const payload=section.slice(hunk.index+hunk[0].length);
    assert(payload.endsWith('\n'),'notice source addition lacks final LF');
    const lines=payload.slice(0,-1).split('\n');
    assert(lines.length===Number(hunk[1]) && lines.every(line=>line.startsWith('+')),'notice source hunk is incomplete');
    const bytes=Buffer.from(lines.map(line=>line.slice(1)).join('\n')+'\n');
    assert(sha256(bytes)===item.importedFiles[name].sha256,'notice upstream source body mismatch');sources[name]=bytes;
  }
  assert(same(Object.keys(sources).sort(),Object.keys(item.importedFiles).sort()),'notice source file set mismatch');
  return sources;
}

/** 按格式v1复制全部原版权/明确许可注释，逐版本附原许可全文，不翻译或合并作者。 */
function reconstruct(major,completion,patch,licenses){
  const item=completion.runtimes[major],sources=importedSources(patch,item);
  const header='AMCL FreeType completion: original source notices\n'+
    'Derived distribution supplement; not an original compiler input.\n'+
    `JDK major: ${major}\nFreeType version: ${item.version}\n`+
    `Upstream repository: ${completion.repository}\nUpstream commit: ${item.commit}\n`+
    `Completion patch: ${item.patch}\n`+
    'The exact added-file list, original notice text and matching license text follow.\n';
  const pieces=[Buffer.from(header)],records={};
  for(const name of Object.keys(sources).sort()){
    const content=sources[name],blocks=[...content.toString('utf8').matchAll(/\/\*[\s\S]*?\*\//g)]
      .map(match=>Buffer.from(match[0])).filter(block=>/copyright|permission is hereby/i.test(block.toString()));
    assert(blocks.length>0,'notice upstream file has no original copyright block');
    pieces.push(Buffer.from(`\n[Added source file] ${name}\nSHA-256: ${sha256(content)}\n\n`));
    for(const block of blocks)pieces.push(block,Buffer.from('\n'));
    records[name]={sha256:sha256(content),target:item.importedFiles[name].target,noticeBlocksSha256:blocks.map(sha256)};
  }
  assert(same(Object.keys(licenses).sort(),Object.keys(item.licenses).sort()),'notice license set mismatch');
  for(const name of Object.keys(licenses).sort()){
    const data=licenses[name];assert(sha256(data)===item.licenses[name].sha256,'notice original license bytes mismatch');
    pieces.push(Buffer.from(`\n[Upstream license file] ${name}\nSHA-256: ${sha256(data)}\n\n`),data,Buffer.from('\n'));
  }
  return {bytes:Buffer.concat(pieces),records};
}

/**
 * schema1 的历史字体派生保持可审计；schema2 的现代派生必须带 notice。
 * 返回新增项的精确身份供父来源校验器并入 allowlist，JDK8 没有本轮新增驱动。
 */
export function verifyDerivedFreeTypeNotices(files,index,receipt,bundle){
  const audit=receipt.derivation.fontBundle.derivedNotices,major=String(receipt.build.major);
  if(major==='8' || bundle.schemaVersion===1){
    assert(!audit && Object.keys(index.derivedNoticeFiles??{}).length===0,'unexpected derived notice for legacy/classic input');
    return null;
  }
  assert(bundle.schemaVersion===2 && audit && audit.schemaVersion===1 && audit.major===major &&
    audit.scope==='derived-distribution-supplement' && audit.compiledInput===false,'modern v2 font bundle lacks derived notice');
  const expectedNames=['font-provider/derived-notices/manifest.json','font-provider/derived-notices/generator.py',
    'font-provider/derived-notices/NOTICE.txt','scripts/freetype-notices.py'].sort();
  assert(same(Object.keys(index.derivedNoticeFiles??{}).sort(),expectedNames),'derived notice input set mismatch');
  for(const name of expectedNames)assert(!Object.hasOwn(index.frozenFiles,name) &&
    index.files[name]===index.derivedNoticeFiles[name],'derived notice incorrectly claims original compilation');
  const bound=(name,hash)=>{
    const data=files.get(name);assert(HASH.test(hash) && data && sha256(data)===hash,'derived notice input identity mismatch: '+name);return data;
  };
  const manifestRaw=bound('font-provider/derived-notices/manifest.json',audit.manifestSha256),manifest=JSON.parse(manifestRaw);
  const actual=bound('font-provider/derived-notices/NOTICE.txt',audit.sha256);
  bound('font-provider/derived-notices/generator.py',audit.generatorSha256);
  bound('scripts/freetype-notices.py',audit.generatorSha256);
  assert(manifest.schemaVersion===1 && manifest.kind==='version-matched-freetype-notices' &&
    manifest.scope===audit.scope && manifest.compiledInput===false && manifest.generatorSha256===audit.generatorSha256 &&
    manifest.completionManifestSha256===audit.completionManifestSha256 && bundle.noticeManifest?.sha256===audit.manifestSha256,
    'derived notice provenance/classification mismatch');
  const declaration=bundle.notices?.[major],target='legal/amcl-freetype-completion/NOTICE.txt';
  assert(declaration && declaration.target===target && declaration.mode===0o100644 && declaration.bytes===actual.length &&
    declaration.sha256===audit.sha256 && audit.path===target && audit.mode===0o100644 && audit.bytes===actual.length,
    'derived notice destination/size/mode mismatch');
  const completionPath='prebuilt/fontconfig/freetype-completion.json';
  assert(index.frozenFiles[completionPath]===audit.completionManifestSha256,'notice does not bind original completion source');
  const completion=JSON.parse(bound(completionPath,audit.completionManifestSha256)),item=completion.runtimes?.[major];
  assert(item && item.jdkCommit===receipt.build.commit && index.frozenFiles[item.patch]===item.patchSha256,
    'derived notice belongs to another frozen JDK source');
  const patch=bound(item.patch,item.patchSha256),licenses={};
  for(const [name,value] of Object.entries(item.licenses)){
    assert(index.frozenFiles[value.path]===value.sha256,'notice license was not an original frozen source');
    licenses[name]=bound(value.path,value.sha256);
  }
  const rebuilt=reconstruct(major,completion,patch,licenses),record=manifest.runtimes?.[major];
  assert(record && record.jdkCommit===item.jdkCommit && record.commit===item.commit && record.version===item.version &&
    record.patch===item.patch && record.patchSha256===item.patchSha256 && same(record.sourceFiles,rebuilt.records) &&
    same(record.licenses,item.licenses) && record.sha256===audit.sha256 && record.bytes===actual.length && actual.equals(rebuilt.bytes),
    'derived notice does not preserve exact original source/license text');
  return {path:target,sha256:audit.sha256,bytes:actual.length,mode:0o100644};
}
