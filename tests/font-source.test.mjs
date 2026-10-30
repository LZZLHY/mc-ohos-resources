/** 字体来源链正反例：使用自造 TAR/收据，不下载、不执行字体库或修改 catalog。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {sha256} from '../tools/protocol.mjs';
import {verifyFontSourceChain} from '../tools/font-source.mjs';

const raw=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');

/** 真实 ustar/PAX 结构，正文只是测试许可；它不代表上游源码或实际编译产物。 */
function archive(commit,license,{duplicate=false,badChecksum=false,members={}}={}){
  function entry(name,type,data){
    const h=Buffer.alloc(512);h.write(name);h.write('0000644\0',100);h.write('0000000\0',108);h.write('0000000\0',116);
    h.write(data.length.toString(8).padStart(11,'0')+'\0',124);h.write('00000000000\0',136);h.fill(32,148,156);
    h[156]=type;h.write('ustar\0',257);h.write('00',263);
    const sum=h.reduce((a,b)=>a+b,0);h.write(sum.toString(8).padStart(6,'0')+'\0 ',148);
    return Buffer.concat([h,data,Buffer.alloc((512-data.length%512)%512)]);
  }
  const body='comment='+commit+'\n';let count=body.length+3;
  while(count!==String(count).length+1+body.length)count=String(count).length+1+body.length;
  const entries=[entry('pax_global_header',103,Buffer.from(count+' '+body)),entry('COPYING',48,license)];
  if(duplicate)entries.push(entry('COPYING',48,license));
  for(const [name,data] of Object.entries(members))entries.push(entry(name,48,data));
  const result=Buffer.concat([...entries,Buffer.alloc(1024)]);if(badChecksum)result[0]^=1;return result;
}

/**
 * 所有 SHA 均来自夹具真实字节。refresh 在负例改元数据后重算外层摘要，使测试
 * 真正命中来源关系和语义门禁，而不是只因最外层 hash 失配就结束。
 */
function fixture(major='8'){
  const files=new Map(),license={fontconfig:Buffer.from('fontconfig fixture permission\n'),expat:Buffer.from('expat fixture permission\n')};
  files.set('font-provider/README.rebuild.md',Buffer.from('fixture rebuild notes only\n'));
  const symbols=Array.from({length:23},(_,n)=>'FT_Fixture_'+String(n).padStart(2,'0'));
  const sources={},locked={};
  for(const [n,name] of ['fontconfig','expat','freetype'].entries()){
    const commit=String(n+1).repeat(40),file=name+'-'+commit+'.tar';
    const data=archive(commit,license[name]??Buffer.from('freetype fixture permission\n'));
    files.set('font-provider/sources/'+file,data);
    sources[name]={repository:'https://source.invalid/'+name,commit,version:'fixture',archive:file,archiveSha256:sha256(data)};
    locked[name]={repository:sources[name].repository,commit,version:'fixture'};
  }
  const meson=Buffer.from('wheel fixture'),gperf=Buffer.from('gperf fixture');
  files.set('font-provider/sources/meson.whl',meson);files.set('font-provider/sources/gperf-3.3.tar.gz',gperf);
  const spec={sources:locked,meson:{sha256:sha256(meson)},gperf:{version:'3.3',sha256:sha256(gperf)}};
  const specRaw=raw(spec),recipe=Buffer.from('# fixture recipe\n');
  files.set('font-provider/frozen/prebuilt/fontconfig/build-inputs.json',specRaw);
  files.set('font-provider/frozen/docker/build_fontconfig_ohos.sh',recipe);
  const recipes={'prebuilt/fontconfig/build-inputs.json':sha256(specRaw),'docker/build_fontconfig_ohos.sh':sha256(recipe)};
  const sdkFiles={'sysroot/usr/lib/aarch64-linux-ohos/libc.so':sha256('SDK libc fixture')};
  const outer={state:'completed',exitCode:0,component:'fontconfig',runId:'font-test',imageId:'sha256:'+sha256('image'),
    inputs:{digest:sha256('inputs'),files:structuredClone(recipes),sdk:{'libc.so':sha256('SDK sentinel')},nativeSdk:{resourceVersion:'15.0.4',files:sdkFiles}}};
  const variants={classic:{path:'classic/libfontconfig.so',sha256:sha256('classic library'),sizeBytes:15,needed:['libfreetype.so.6','libc.so'],soname:['libfontconfig.so']},
    modern:{path:'modern/libfontconfig.so',sha256:sha256('modern library'),sizeBytes:14,needed:['libfreetype.so','libc.so'],soname:['libfontconfig.so']}};
  const proof={schemaVersion:1,buildId:outer.runId,builderImageId:outer.imageId,buildInputDigest:outer.inputs.digest,
    recipes:structuredClone(recipes),sdk:{resourceVersion:'15.0.4',sentinels:outer.inputs.sdk,completeIndexSha256:sha256(JSON.stringify(sdkFiles))},
    specSha256:sha256(specRaw),sources:structuredClone(sources),variants:structuredClone(variants),requiredFreeTypeSymbols:[...symbols],licenses:{}};
  for(const name of ['fontconfig','expat']){
    proof.licenses[name]={sourceCommit:sources[name].commit,sourceFile:'COPYING',sha256:sha256(license[name])};
    files.set('font-provider/licenses/'+name+'/COPYING',license[name]);
  }
  const source={schemaVersion:1,specSha256:sha256(specRaw),spec,variants:structuredClone(variants),requiredFreeTypeSymbols:[...symbols]};
  files.set('font-provider/source-identities.json',raw(sources));
  const variant=major==='8'?'classic':'modern',native=major==='8'?'jre/lib/aarch64/':'lib/',ftName=major==='8'?'libfreetype.so.6':'libfreetype.so';
  const bundle={schemaVersion:1,provenance:{path:'explicit local receipt',sha256:''},producerRoot:'explicit local producer',additions:{}};
  for(const [kind,target] of Object.entries({classic:'jre/lib/aarch64/libfontconfig.so',modern:'lib/libfontconfig.so',
    'fontconfig-license':'legal/amcl-fontconfig/COPYING','expat-license':'legal/amcl-expat/COPYING'})){
    const value=variants[kind],body=license[kind.replace('-license','')];
    bundle.additions[kind]={path:'explicit source',target,mode:0o100644,sha256:value?.sha256??sha256(body),bytes:value?.sizeBytes??body.length};
  }
  const audit={variant,referenceFreeTypeDelivered:false,requiredFreeTypeSymbols:[...symbols],freeTypePath:native+ftName,freeTypeSha256:sha256('original JDK FT'),additions:{},
    linkAudit:{requiredSymbolCount:80,suppliers:{'libfontconfig.so':{kind:'bundled',path:native+'libfontconfig.so',sha256:variants[variant].sha256},
      [ftName]:{kind:'bundled',path:native+ftName,sha256:sha256('original JDK FT')},'libc.so':{kind:'sdk',sha256:sdkFiles['sysroot/usr/lib/aarch64-linux-ohos/libc.so']}}}};
  for(const kind of [variant,'fontconfig-license','expat-license']){
    const item=bundle.additions[kind];audit.additions[item.target]={sha256:item.sha256,bytes:item.bytes,mode:item.mode};
  }
  const receipt={build:{major,commit:'f'.repeat(40)},derivation:{kind:'compatible-cxx-font-provider-repack',providerSha256:sha256('C++ provider'),fontBundle:audit}};
  const index={schemaVersion:2,files:{},frozenFiles:{},fontProviderFiles:{}};
  if(major!=='8'){
    const patch='prebuilt/jdk/'+major+'/patches/0016.patch',copy='prebuilt/fontconfig/licenses/ft-fixture/FTL.TXT';
    files.set(patch,Buffer.from('version matched patch'));files.set(copy,Buffer.from('FT license'));
    const item={jdkCommit:receipt.build.commit,patch,patchSha256:sha256(files.get(patch)),licenses:{FTL:{path:copy,sha256:sha256(files.get(copy))}}};
    const path='prebuilt/fontconfig/freetype-completion.json';files.set(path,raw({runtimes:{[major]:item}}));
    for(const name of [patch,copy,path])index.frozenFiles[name]=sha256(files.get(name));
  }
  const refresh=()=>{
    const outerRaw=raw(outer),sourceRaw=raw(source);proof.buildManifestSha256=sha256(outerRaw);proof.providerProvenanceSha256=sha256(sourceRaw);
    audit.producerBuildManifestSha256=proof.buildManifestSha256;audit.providerSourceProvenanceSha256=proof.providerProvenanceSha256;
    files.set('font-provider/build-manifest.json',outerRaw);files.set('font-provider/source-provenance.json',sourceRaw);
    const proofRaw=raw(proof);audit.provenanceSha256=sha256(proofRaw);bundle.provenance.sha256=audit.provenanceSha256;
    files.set('font-provider/provenance.json',proofRaw);const bundleRaw=raw(bundle);audit.inputManifestSha256=sha256(bundleRaw);files.set('font-provider/input-bundle.json',bundleRaw);
    index.files=Object.fromEntries([...files].map(([name,data])=>[name,sha256(data)]));
    index.fontProviderFiles=Object.fromEntries(Object.entries(index.files).filter(([name])=>name.startsWith('font-provider/')));
  };
  const f={files,index,receipt,proof,outer,source,bundle,audit,refresh};refresh();return f;
}

for(const major of ['8','17','21','25'])test('font source accepts full bound closure for JDK '+major,()=>{
  const f=fixture(major);verifyFontSourceChain(f.files,f.index,f.receipt);
});

for(const [name,change] of [
  ['failed producer',f=>f.outer.exitCode=1],
  ['different SDK index',f=>f.proof.sdk.completeIndexSha256=sha256('different SDK')],
  ['missing FT import',f=>f.audit.requiredFreeTypeSymbols.pop()],
  ['FT reference delivered',f=>f.audit.referenceFreeTypeDelivered=true],
  ['FreeType overwrite target',f=>f.bundle.additions.modern.target='lib/libfreetype.so'],
  ['executable license mode',f=>f.bundle.additions['expat-license'].mode=0o100755],
  ['missing license declaration',f=>delete f.bundle.additions['expat-license']],
  ['wrong dependency name',f=>{f.proof.variants.classic.needed=['libfreetype.so','libc.so'];f.source.variants=structuredClone(f.proof.variants);}],
  ['wrong SONAME',f=>{f.proof.variants.classic.soname=['wrong.so'];f.source.variants=structuredClone(f.proof.variants);}],
  ['extra delivery entry',f=>f.audit.additions['extra.so']={mode:0o100644,bytes:1,sha256:sha256('x')}],
  ['missing libc supplier',f=>delete f.audit.linkAudit.suppliers['libc.so']],
  ['FT supplier changed',f=>f.audit.linkAudit.suppliers['libfreetype.so.6'].sha256=sha256('wrong FT')],
  ['SDK supplier changed',f=>f.audit.linkAudit.suppliers['libc.so'].sha256=sha256('other libc')],
  ['unexpected frozen recipe',f=>f.files.set('font-provider/frozen/docker/unrecorded.sh',Buffer.from('extra'))],
  ['unrelated indexed font payload',f=>f.files.set('font-provider/unrelated.so',Buffer.from('must not be exported'))],
  ['missing source archive',f=>f.files.delete('font-provider/sources/'+f.proof.sources.expat.archive)],
  ['license not upstream bytes',f=>f.files.set('font-provider/licenses/expat/COPYING',Buffer.from('rewritten license'))],
])test('font source rejects '+name+' with refreshed outer hashes',()=>{
  const f=fixture();change(f);f.refresh();assert.throws(()=>verifyFontSourceChain(f.files,f.index,f.receipt));
});

for(const [name,options,commit] of [['duplicate license',{duplicate:true},'2'.repeat(40)],
  ['TAR checksum',{badChecksum:true},'2'.repeat(40)],['TAR commit',{},'9'.repeat(40)]])
test('font source rejects '+name+' even when full archive SHA is updated',()=>{
  const f=fixture(),item=f.proof.sources.expat,bytes=archive(commit,Buffer.from('expat fixture permission\n'),options);
  item.archiveSha256=sha256(bytes);f.files.set('font-provider/sources/'+item.archive,bytes);
  f.files.set('font-provider/source-identities.json',raw(f.proof.sources));f.refresh();
  assert.throws(()=>verifyFontSourceChain(f.files,f.index,f.receipt));
});

for(const what of ['completion','version-matched license'])test('modern font source rejects missing '+what,()=>{
  const f=fixture('17');const path=what==='completion'?'prebuilt/fontconfig/freetype-completion.json':'prebuilt/fontconfig/licenses/ft-fixture/FTL.TXT';
  f.files.delete(path);delete f.index.frozenFiles[path];f.refresh();assert.throws(()=>verifyFontSourceChain(f.files,f.index,f.receipt));
});

test('modern font completion cannot be an unfrozen supplement',()=>{
  const f=fixture('17');delete f.index.frozenFiles['prebuilt/fontconfig/freetype-completion.json'];
  f.refresh();assert.throws(()=>verifyFontSourceChain(f.files,f.index,f.receipt),/not a recorded build input/);
});

/** 这些是新适配关系的合成输入，未宣称执行了真实字体库。 */
function enableDefaults(f){
  const before={'src/fccfg.c':Buffer.from('original\nkeep\n'),'src/fcinit.c':Buffer.from('original\nkeep\n')};
  const after=Object.fromEntries(Object.keys(before).map(name=>[name,Buffer.from('changed\nkeep\n')]));
  const patch=Buffer.from(Object.keys(before).map(name=>'diff --git a/'+name+' b/'+name+'\n--- a/'+name+'\n+++ b/'+name+
    '\n@@ -1,2 +1,2 @@\n-original\n+changed\n keep\n').join(''));
  const metadata={commit:f.proof.sources.fontconfig.commit,patchSha256:sha256(patch),
    before:Object.fromEntries(Object.entries(before).map(([name,data])=>[name,sha256(data)])),
    after:Object.fromEntries(Object.entries(after).map(([name,data])=>[name,sha256(data)]))};
  const header=Buffer.from('#define AMCL_FONTCONFIG_GENERIC_RULES "<alias/>"\n');
  const adaptation={...metadata,genericHeader:'prebuilt/fontconfig/ohos-generic-fonts.h',genericHeaderSha256:sha256(header),compiledHeader:'src/amcl-generic-fonts.h'};
  const freeze=(name,data)=>{
    f.files.set('font-provider/frozen/'+name,data);f.proof.recipes[name]=sha256(data);f.outer.inputs.files[name]=sha256(data);
  };
  freeze('prebuilt/fontconfig/ohos-defaults.json',raw(metadata));
  freeze('prebuilt/fontconfig/ohos-generic-fonts.h',header);
  freeze('prebuilt/fontconfig/patches/0001-ohos-default-fonts-and-context-cache.patch',patch);
  freeze('prebuilt/fontconfig/patches/series',Buffer.from('0001-ohos-default-fonts-and-context-cache.patch\n'));
  const item=f.proof.sources.fontconfig,data=archive(item.commit,Buffer.from('fontconfig fixture permission\n'),{members:before});
  item.archiveSha256=sha256(data);item.adaptation=structuredClone(adaptation);
  f.files.set('font-provider/sources/'+item.archive,data);
  f.files.set('font-provider/source-identities.json',raw(f.proof.sources));
  f.source.sourceAdaptation=adaptation;
  const markers={genericXml:'<alias/>',contextApi:'OH_AbilityRuntime_ApplicationContextGetCacheDir',contextLibrary:'libability_runtime.so',
    outsideRuntimeCache:'.amcl-fontconfig-cache',classicLayout:'/jre/lib/aarch64/libfontconfig.so',modernLayout:'/lib/libfontconfig.so'};
  f.source.compiledOhosDefaults={hardContextApiImport:false,markers:Object.fromEntries(Object.entries(markers).map(([name,value])=>[
    name,{offset:0,sha256:sha256(value),sizeBytes:Buffer.byteLength(value)}]))};
  for(const name of ['classic','modern']){
    f.proof.variants[name].sizeBytes=4096;f.source.variants[name].sizeBytes=4096;f.bundle.additions[name].bytes=4096;
  }
  f.audit.additions['jre/lib/aarch64/libfontconfig.so'].bytes=4096;
  f.refresh();return {metadata,adaptation,freeze};
}

test('font defaults replay both files from the original bound TAR',()=>{
  const f=fixture();enableDefaults(f);verifyFontSourceChain(f.files,f.index,f.receipt);
});

for(const [name,change] of [
  ['missing source adaptation',(f)=>delete f.source.sourceAdaptation],
  ['unfrozen generic header',(f)=>{delete f.proof.recipes['prebuilt/fontconfig/ohos-generic-fonts.h'];delete f.outer.inputs.files['prebuilt/fontconfig/ohos-generic-fonts.h'];}],
  ['wrong marker',(f)=>f.source.compiledOhosDefaults.markers.genericXml.sha256=sha256('wrong')],
  ['hard context import',(f)=>f.source.compiledOhosDefaults.hardContextApiImport=true],
  ['extra series',(f,{freeze})=>freeze('prebuilt/fontconfig/patches/series',Buffer.from('0001-ohos-default-fonts-and-context-cache.patch\nextra.patch\n'))],
  ['invented after source',(f,{metadata,adaptation,freeze})=>{
    metadata.after['src/fccfg.c']=sha256('invented result');adaptation.after=metadata.after;
    f.proof.sources.fontconfig.adaptation=structuredClone(adaptation);
    f.files.set('font-provider/source-identities.json',raw(f.proof.sources));freeze('prebuilt/fontconfig/ohos-defaults.json',raw(metadata));
  }],
])test('font defaults rejects '+name+' after outer hashes are refreshed',()=>{
  const f=fixture(),defaults=enableDefaults(f);change(f,defaults);f.refresh();
  assert.throws(()=>verifyFontSourceChain(f.files,f.index,f.receipt));
});
