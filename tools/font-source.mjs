/**
 * Fontconfig 派生的独立来源链校验。只读源码 ZIP 已解码的字节，不取本机路径、
 * 不执行配方、不解压到磁盘。它核对“交付新增项→实际构建→冻结输入→上游/许可”，
 * 不把静态来源闭包授予 Java、CLI 执行、字体缓存或设备功能资格。
 */
import {isDeepStrictEqual} from 'node:util';
import {sha256} from './protocol.mjs';
import {verifyDerivedFreeTypeNotices} from './freetype-notices.mjs';

const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const HASH=/^[a-f0-9]{64}$/, COMMIT=/^[a-f0-9]{40}$/;
const same=(a,b)=>isDeepStrictEqual(a,b);
const plain=x=>x!==null && typeof x==='object' && !Array.isArray(x);
const relative=name=>typeof name==='string' && name.length>0 && !/[\\:\x00-\x1f\x7f]/.test(name) &&
  name.split('/').every(part=>part && part!=='.' && part!=='..');

/** PAX 记录用自身十进制字节长度分隔，必须完整落在该 header 声明的内容区。 */
function pax(bytes){
  const values={};let at=0;
  while(at<bytes.length){
    const space=bytes.indexOf(32,at),lengthText=bytes.subarray(at,space).toString('ascii');
    assert(space>at && /^\d+$/.test(lengthText),'font source TAR invalid PAX length');
    const length=Number(lengthText),end=at+length;
    assert(Number.isSafeInteger(length) && end<=bytes.length && end>space+2 && bytes[end-1]===10,'font source TAR truncated PAX record');
    const record=bytes.subarray(space+1,end-1).toString('utf8'),split=record.indexOf('=');
    assert(split>0,'font source TAR invalid PAX value');
    values[record.slice(0,split)]=record.slice(split+1);at=end;
  }
  return values;
}

/**
 * 从 git archive 的 TAR 验证全局 commit 注记并读取唯一原始许可正文。
 * 普通/目录/PAX 头均按真实边界和校验和遍历；未写磁盘，非许可成员的载荷不执行。
 * 每个上游归档的完整 SHA 已在外层校验，PAX comment 不是独立的可信签名。
 */
function gitArchiveLicense(bytes,commit,wanted){
  assert(Buffer.isBuffer(bytes) && bytes.length%512===0 && COMMIT.test(commit),'font source TAR identity/layout invalid');
  let at=0,global={},next={},license=null,ended=false,entries=0;
  const text=(header,first,count)=>header.subarray(first,first+count).toString('utf8').replace(/\0.*$/s,'');
  const octal=(header,first,count)=>{
    const value=text(header,first,count).trim();
    assert(/^[0-7]+$/.test(value),'font source TAR invalid numeric field');
    const number=parseInt(value,8);assert(Number.isSafeInteger(number),'font source TAR numeric overflow');return number;
  };
  while(at+512<=bytes.length){
    const header=bytes.subarray(at,at+512);
    if(header.every(value=>value===0)){assert(bytes.subarray(at).every(value=>value===0),'font source TAR nonzero trailing data');ended=true;break;}
    assert(++entries<=30000,'font source TAR too many headers');
    let checksum=0;for(let i=0;i<512;i++)checksum+=i>=148 && i<156?32:header[i];
    assert(checksum===octal(header,148,8),'font source TAR header checksum mismatch');
    const size=octal(header,124,12),start=at+512,end=start+size;
    assert(end<=bytes.length,'font source TAR member outside archive');
    const contents=bytes.subarray(start,end),type=header[156];
    if(type===103){global={...global,...pax(contents)};assert(!global.path,'font source TAR global path override forbidden');}
    else if(type===120)next=pax(contents);
    else{
      const prefix=text(header,345,155),name=next.path??(prefix?prefix+'/':'')+text(header,0,100);
      assert(next.size===undefined || String(size)===next.size,'font source TAR PAX size differs from header');
      if(name===wanted){assert((type===0 || type===48) && license===null,'font source license is not a unique regular file');license=contents;}
      next={};
    }
    at=start+Math.ceil(size/512)*512;
  }
  assert(ended && global.comment===commit && Object.keys(next).length===0,'font source TAR commit/end mismatch');
  if(wanted)assert(license!==null,'font source TAR missing original license');
  return license;
}

/** 把字体命名空间逐项绑定到内表；缺失字段不得被空对象或可选链悄悄跳过。 */
export function verifyFontSourceChain(files,index,receipt){
  const derivation=receipt.derivation,audit=derivation?.fontBundle;
  assert(derivation?.kind==='compatible-cxx-font-provider-repack' && plain(audit),'missing font derivation source audit');
  assert(plain(index.fontProviderFiles) && Object.keys(index.fontProviderFiles).length>0,'source ZIP missing font input closure');
  const namespace=[...files.keys()].filter(name=>name.startsWith('font-provider/')).sort();
  assert(same(namespace,Object.keys(index.fontProviderFiles).sort()),'font source namespace/index set mismatch');
  for(const [name,hash] of Object.entries(index.fontProviderFiles))assert(index.files[name]===hash,'font source index identity mismatch');
  const bound=(name,expected)=>{
    const data=files.get(name);assert(HASH.test(expected) && data && sha256(data)===expected,'font source missing/mismatched '+name);return data;
  };
  const proof=JSON.parse(bound('font-provider/provenance.json',audit.provenanceSha256));
  const bundle=JSON.parse(bound('font-provider/input-bundle.json',audit.inputManifestSha256));
  const outer=JSON.parse(bound('font-provider/build-manifest.json',audit.producerBuildManifestSha256));
  const source=JSON.parse(bound('font-provider/source-provenance.json',audit.providerSourceProvenanceSha256));
  assert(proof.schemaVersion===1 && [1,2].includes(bundle.schemaVersion) && source.schemaVersion===1 &&
    bundle.provenance?.sha256===audit.provenanceSha256 && outer.state==='completed' && outer.exitCode===0 &&
    outer.component==='fontconfig' && outer.runId===proof.buildId && outer.imageId===proof.builderImageId &&
    outer.inputs?.digest===proof.buildInputDigest && same(outer.inputs.files,proof.recipes) &&
    proof.buildManifestSha256===audit.producerBuildManifestSha256 &&
    proof.providerProvenanceSha256===audit.providerSourceProvenanceSha256,'font producer build/provenance mismatch');
  const sdk=outer.inputs.nativeSdk,ordered=Object.fromEntries(Object.entries(sdk.files).sort(([a],[b])=>a<b?-1:a>b?1:0));
  assert(proof.sdk.resourceVersion===sdk.resourceVersion && same(proof.sdk.sentinels,outer.inputs.sdk) &&
    proof.sdk.completeIndexSha256===sha256(JSON.stringify(ordered)),'font complete SDK input index mismatch');
  const frozenNames=Object.keys(proof.recipes).map(name=>'font-provider/frozen/'+name).sort();
  assert(same(namespace.filter(name=>name.startsWith('font-provider/frozen/')),frozenNames),'font frozen recipe set mismatch');
  for(const [name,hash] of Object.entries(proof.recipes)){
    assert(relative(name) && (name==='deps.lock' || /^(docker|prebuilt)\//.test(name)),'font frozen recipe path invalid');
    bound('font-provider/frozen/'+name,hash);
  }
  const spec=JSON.parse(bound('font-provider/frozen/prebuilt/fontconfig/build-inputs.json',proof.specSha256));
  assert(source.specSha256===proof.specSha256 && same(source.spec,spec) && same(source.variants,proof.variants),
    'font frozen spec/variant mismatch');
  assert(same(Object.keys(proof.variants).sort(),['classic','modern']) &&
    same(Object.keys(spec.sources).sort(),['expat','fontconfig','freetype']),'font source contains unreviewed variant/upstream');
  const sourceIndex=JSON.parse(files.get('font-provider/source-identities.json')??'null');
  assert(same(sourceIndex,proof.sources) && same(Object.keys(proof.sources).sort(),['expat','fontconfig','freetype']),
    'font upstream source index mismatch');
  const sourceNames=[],licenses={};
  for(const [name,item] of Object.entries(proof.sources)){
    const locked=spec.sources[name],file=name+'-'+item.commit+'.tar';
    assert(COMMIT.test(item.commit) && item.commit===locked.commit && item.repository===locked.repository && item.archive===file,
      'font locked upstream source mismatch');
    const path='font-provider/sources/'+file,bytes=bound(path,item.archiveSha256);sourceNames.push(path);
    const license=gitArchiveLicense(bytes,item.commit,name==='freetype'?null:'COPYING');
    if(license){
      const record=proof.licenses[name];
      assert(record.sourceCommit===item.commit && record.sourceFile==='COPYING' && sha256(license)===record.sha256,
        'font upstream license provenance mismatch');
      assert(bound('font-provider/licenses/'+name+'/COPYING',record.sha256).equals(license),'font license differs from upstream archive');
      licenses[name]=license;
    }
  }
  for(const [name,item] of [['meson.whl',spec.meson],['gperf-'+spec.gperf.version+'.tar.gz',spec.gperf]]){
    const path='font-provider/sources/'+name;bound(path,item.sha256);sourceNames.push(path);
  }
  assert(same(namespace.filter(name=>name.startsWith('font-provider/sources/')),sourceNames.sort()),'font source/tool archive set mismatch');
  const permitted=new Set([...frozenNames,...sourceNames,'font-provider/provenance.json','font-provider/input-bundle.json',
    'font-provider/build-manifest.json','font-provider/source-provenance.json','font-provider/source-identities.json',
    'font-provider/licenses/fontconfig/COPYING','font-provider/licenses/expat/COPYING','font-provider/README.rebuild.md']);
  if(audit.derivedNotices)for(const name of ['manifest.json','generator.py','NOTICE.txt'])permitted.add('font-provider/derived-notices/'+name);
  assert(namespace.length===permitted.size && namespace.every(name=>permitted.has(name)),'font namespace contains missing/undeclared source material');
  const required=proof.requiredFreeTypeSymbols;
  assert(Array.isArray(required) && required.length===23 && new Set(required).size===23 &&
    required.every(name=>/^FT_[A-Za-z0-9_]+$/.test(name)) && same(required,[...required].sort()) &&
    same(source.requiredFreeTypeSymbols,required) && same(audit.requiredFreeTypeSymbols,required),
    'font provider FreeType import closure mismatch');
  const variant=String(receipt.build.major)==='8'?'classic':'modern',native=variant==='classic'?'jre/lib/aarch64/':'lib/';
  const ftName=variant==='classic'?'libfreetype.so.6':'libfreetype.so';
  const targets={classic:'jre/lib/aarch64/libfontconfig.so',modern:'lib/libfontconfig.so',
    'fontconfig-license':'legal/amcl-fontconfig/COPYING','expat-license':'legal/amcl-expat/COPYING'};
  assert(plain(bundle.additions) && same(Object.keys(bundle.additions).sort(),Object.keys(targets).sort()),'font input declaration set mismatch');
  for(const [kind,target] of Object.entries(targets)){
    const item=bundle.additions[kind],value=proof.variants[kind];
    const bytes=value?.sizeBytes??licenses[kind.replace('-license','')]?.length;
    const hash=value?.sha256??sha256(licenses[kind.replace('-license','')]);
    assert(item.target===target && item.mode===0o100644 && item.bytes===bytes && item.sha256===hash,'font declared addition identity mismatch');
  }
  const expected={[native+'libfontconfig.so']:{sha256:proof.variants[variant].sha256,bytes:proof.variants[variant].sizeBytes,mode:0o100644},
    'legal/amcl-fontconfig/COPYING':{sha256:sha256(licenses.fontconfig),bytes:licenses.fontconfig.length,mode:0o100644},
    'legal/amcl-expat/COPYING':{sha256:sha256(licenses.expat),bytes:licenses.expat.length,mode:0o100644}};
  const notice=verifyDerivedFreeTypeNotices(files,index,receipt,bundle);
  if(notice)expected[notice.path]={sha256:notice.sha256,bytes:notice.bytes,mode:notice.mode};
  assert(audit.variant===variant && audit.referenceFreeTypeDelivered===false && same(audit.additions,expected) &&
    audit.freeTypePath===native+ftName && HASH.test(audit.freeTypeSha256),'font delivered addition/FreeType identity mismatch');
  assert(same(proof.variants[variant].needed,['libc.so',ftName].sort()) ||
    same([...proof.variants[variant].needed].sort(),['libc.so',ftName].sort()),'font provider DT_NEEDED mismatch');
  assert(same(proof.variants[variant].soname,['libfontconfig.so']),'font provider SONAME mismatch');
  const suppliers=audit.linkAudit?.suppliers;
  assert(plain(suppliers) && Number.isSafeInteger(audit.linkAudit.requiredSymbolCount) && audit.linkAudit.requiredSymbolCount>=23,
    'font provider lacks complete static dependency audit');
  for(const [name,item] of Object.entries(suppliers))assert(/^[A-Za-z0-9_+.\-]+$/.test(name) && HASH.test(item.sha256) &&
    (item.kind==='sdk' || (item.kind==='bundled' && relative(item.path))),'font dependency supplier identity invalid');
  assert(suppliers['libfontconfig.so']?.path===native+'libfontconfig.so' && suppliers['libfontconfig.so'].sha256===proof.variants[variant].sha256 &&
    suppliers[ftName]?.path===audit.freeTypePath && suppliers[ftName].sha256===audit.freeTypeSha256,'font/FreeType dependency supplier mismatch');
  assert(suppliers['libc.so']?.kind==='sdk','font static dependency audit omits required system libc');
  for(const [name,item] of Object.entries(suppliers))if(item.kind==='sdk')
    assert(sdk.files['sysroot/usr/lib/aarch64-linux-ohos/'+name]===item.sha256,'font SDK supplier differs from recorded build SDK');
  if(suppliers['libc++_shared.so'])assert(suppliers['libc++_shared.so'].sha256===derivation.providerSha256,'font C++ supplier differs from replacement');
  // 现代包必须交付其本代完整构建中的 FT 补全来源与许可，不能把参考 FT 混入。
  if(variant==='modern'){
    const completionPath='prebuilt/fontconfig/freetype-completion.json';
    assert(index.frozenFiles[completionPath]===index.files[completionPath] && HASH.test(index.frozenFiles[completionPath]),
      'modern FreeType completion is not a recorded build input');
    const completion=JSON.parse(files.get(completionPath)??'null');
    const item=completion?.runtimes?.[String(receipt.build.major)];
    assert(item && item.jdkCommit===receipt.build.commit && relative(item.patch) &&
      index.frozenFiles[item.patch]===item.patchSha256,'modern JDK lacks matching frozen FreeType completion');
    for(const license of Object.values(item.licenses??{}))assert(relative(license.path) &&
      index.frozenFiles[license.path]===license.sha256,'modern JDK omits version-matched FreeType license');
    assert(Object.keys(item.licenses??{}).length>0,'modern JDK lacks FreeType licenses');
  }
}
