/**
 * 源码输入 ZIP 的只读校验器。只使用标准库，不解压到文件系统，也不执行包内脚本。
 * ZIP 总长度、条目数、单项和总展开长度先有界，再检查中央目录/本地头/CRC/清单摘要。
 * 范围限于导出器生成的普通文件 ZIP；加密、ZIP64、符号链接和目录歧义全部拒绝。
 */
import {inflateRawSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import {sha256} from './protocol.mjs';

const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const HASH=/^[a-f0-9]{64}$/;
const MAX_BYTES=128*1024*1024, MAX_EXPANDED=256*1024*1024, MAX_FILES=30000;

/** CRC32 是 ZIP 结构完整性检查；可信身份仍由发行索引中的完整 SHA-256 提供。 */
export function crc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}

/** 规范相对名禁止绝对路径、反斜线、控制字符、空组件和大小写折叠冲突。 */
function safeName(name) {
  return name.length>0 && name.length<512 && !/[\\\x00-\x1f\x7f:]/.test(name) &&
    name.split('/').every(part=>part && part!=='.' && part!=='..');
}

export function readSourceZip(bytes) {
  assert(Buffer.isBuffer(bytes) && bytes.length>=22 && bytes.length<=MAX_BYTES,'source ZIP size out of bounds');
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)
    if(bytes.readUInt32LE(i)===0x06054b50 && i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break;}
  assert(end>=0,'source ZIP missing end record');
  const count=bytes.readUInt16LE(end+10), directorySize=bytes.readUInt32LE(end+12), directoryOffset=bytes.readUInt32LE(end+16);
  assert(bytes.readUInt16LE(end+4)===0 && bytes.readUInt16LE(end+6)===0 &&
    bytes.readUInt16LE(end+8)===count && count>0 && count<=MAX_FILES &&
    directoryOffset+directorySize===end,'unsupported source ZIP directory');
  const files=new Map(),folded=new Set(),ranges=[];
  let cursor=directoryOffset,total=0;
  for(let n=0;n<count;n++){
    assert(cursor+46<=end && bytes.readUInt32LE(cursor)===0x02014b50,'invalid ZIP central header');
    const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),crc=bytes.readUInt32LE(cursor+16);
    const packed=bytes.readUInt32LE(cursor+20),size=bytes.readUInt32LE(cursor+24),nameSize=bytes.readUInt16LE(cursor+28);
    const extraSize=bytes.readUInt16LE(cursor+30),commentSize=bytes.readUInt16LE(cursor+32),local=bytes.readUInt32LE(cursor+42);
    const next=cursor+46+nameSize+extraSize+commentSize,mode=bytes.readUInt32LE(cursor+38)>>>16;
    assert(next<=end && (flags&~0x808)===0 && [0,8].includes(method) &&
      bytes.readUInt16LE(cursor+34)===0 && [0,0x8000].includes(mode&0xf000),'unsupported ZIP entry');
    assert(size<=MAX_EXPANDED && (total+=size)<=MAX_EXPANDED,'source ZIP expanded size out of bounds');
    const nameBytes=bytes.subarray(cursor+46,cursor+46+nameSize),name=nameBytes.toString('utf8');
    assert(Buffer.from(name).equals(nameBytes) && safeName(name) && !folded.has(name.toLowerCase()),'unsafe/duplicate source ZIP path');
    folded.add(name.toLowerCase());
    assert(local+30<=directoryOffset && bytes.readUInt32LE(local)===0x04034b50,'invalid ZIP local header');
    const localNameSize=bytes.readUInt16LE(local+26),localExtra=bytes.readUInt16LE(local+28),dataStart=local+30+localNameSize+localExtra;
    assert(bytes.readUInt16LE(local+6)===flags && bytes.readUInt16LE(local+8)===method &&
      localNameSize===nameSize && dataStart+packed<=directoryOffset &&
      bytes.subarray(local+30,local+30+localNameSize).equals(nameBytes),'ZIP local/central mismatch');
    for(const [offset,value] of [[14,crc],[18,packed],[22,size]])
      assert(bytes.readUInt32LE(local+offset)===value || ((flags&8)!==0 && bytes.readUInt32LE(local+offset)===0),'ZIP local identity mismatch');
    ranges.push([local,dataStart+packed]);
    const compressed=bytes.subarray(dataStart,dataStart+packed);
    const contents=method===0?compressed:inflateRawSync(compressed,{maxOutputLength:Math.max(1,size)});
    assert(contents.length===size && crc32(contents)===crc,'source ZIP size/CRC mismatch');
    files.set(name,contents);cursor=next;
  }
  assert(cursor===end,'source ZIP central directory trailing data');
  ranges.sort((a,b)=>a[0]-b[0]);
  for(let i=1;i<ranges.length;i++)assert(ranges[i-1][1]<=ranges[i][0],'overlapping source ZIP entries');
  return files;
}

/**
 * 内层清单覆盖每个实际源码文件；构建收据必须与发布仓已核实的收据相同。
 * schema1 的旧导出器只在摘要表写完后追加 README，保留这一已发布格式的明确例外；
 * 新 schema2 包连 README 也必须列入，不能将缺文件或多文件归类为历史兼容。
 */
export function verifySourceArchive(bytes,target,receipt) {
  assert(bytes.length===target.sizeBytes && sha256(bytes)===target.sha256,'source ZIP identity mismatch');
  const files=readSourceZip(bytes),indexRaw=files.get('source-inputs.json'),receiptRaw=files.get('build-receipt.json');
  assert(indexRaw && receiptRaw && sha256(receiptRaw)===target.manifestSha256,'source ZIP missing/mismatched build receipt');
  const index=JSON.parse(indexRaw);
  assert([1,2].includes(index.schemaVersion) && index.files && typeof index.files==='object' && !Array.isArray(index.files),'invalid inner source-input index');
  for(const [name,expected] of Object.entries(index.files))
    assert(safeName(name) && HASH.test(expected) && files.has(name) && sha256(files.get(name))===expected,'source-input file mismatch: '+name);
  for(const name of files.keys())assert(name==='source-inputs.json' ||
    (index.schemaVersion===1 && name==='README.rebuild.md') || Object.hasOwn(index.files,name),'unindexed source-input file: '+name);
  assert(Object.hasOwn(index.files,'build-receipt.json'),'source-input index omits build receipt');
  const build=receipt.build;
  assert(!build.inputClosure || index.schemaVersion===2,'full build requires frozen source-input schema2');
  const required={'prebuilt/jdk/build-inputs.json':build.inputsSha256};
  for(const [name,hash] of Object.entries(build.patches ?? {}))required[`prebuilt/jdk/${build.major}/patches/${name}`]=hash;
  for(const [name,hash] of Object.entries(build.recipes ?? {})){
    let path=name.startsWith('../')?'docker/'+name.slice(3):'docker/'+name;
    if(!files.has(path))path='docker/scripts/'+name;
    required[path]=hash;
  }
  for(const [name,hash] of Object.entries(required))assert(HASH.test(hash) &&
    index.files[name]===hash,'source ZIP omits recorded recipe/patch: '+name);
  if(index.schemaVersion===2){
    assert(HASH.test(index.buildManifestSha256) &&
      sha256(files.get('build-manifest.json')??Buffer.alloc(0))===index.buildManifestSha256,
      'source ZIP missing outer build manifest');
    const outer=JSON.parse(files.get('build-manifest.json'));
    // v2 的 frozenFiles 是 outer manifest 所记录的本轮输入，而不是发布时扫描 HEAD。
    assert(index.frozenFiles && typeof index.frozenFiles==='object' && Object.keys(index.frozenFiles).length>0,'source ZIP missing frozen input closure');
    for(const [name,hash] of Object.entries(index.frozenFiles))assert(index.files[name]===hash,'source ZIP missing frozen input: '+name);
    assert(outer.state==='completed' && outer.exitCode===0 && outer.inputs &&
      isDeepStrictEqual(outer.inputs,receipt.build.inputClosure), 'source ZIP outer/inner input closure mismatch');
    assert(isDeepStrictEqual(index.frozenFiles,outer.inputs.files),'source ZIP frozen input set differs from build');
    if(receipt.derivation){
      const d=receipt.derivation,originalRaw=files.get('original-build-receipt.json'),providerRaw=files.get('provider-provenance.json');
      assert(d.kind==='compatible-cxx-provider-repack' && originalRaw && providerRaw &&
        sha256(originalRaw)===d.originalReceiptSha256 && sha256(providerRaw)===d.providerProvenanceSha256,
        'source ZIP lacks original/provider derivation receipts');
      const provider=JSON.parse(providerRaw),original=JSON.parse(originalRaw);
      assert(original.sha256===d.originalArchive.sha256 && original.bytes===d.originalArchive.bytes &&
        provider.artifactSha256===d.providerSha256 && provider.sdk.originalSharedSha256===d.originalProviderSha256,
        'source ZIP provider derivation artifact mismatch');
      const restored=structuredClone(build);restored.cxxAbi.providerSha256=d.originalProviderSha256;
      assert(isDeepStrictEqual(restored,original.build),'source ZIP derivative changed unrelated build identity');
      for(const [name,hash] of Object.entries(provider.source.files))
        assert(index.files['provider-source/'+name]===hash,'source ZIP missing provider source: '+name);
      for(const [name,hash] of Object.entries(provider.recipes))
        assert(index.files[name]===hash,'source ZIP missing provider recipe: '+name);
      assert(index.files['scripts/repack-runtime-provider.py']===d.recipeSha256 &&
        index.files['provider-sdk-inputs.json']===provider.sdk.inputManifestSha256,'source ZIP missing repack/SDK identity');
      const providerOuter=JSON.parse(files.get('provider-build-manifest.json')??'null');
      assert(providerOuter?.state==='completed' && providerOuter.exitCode===0 && providerOuter.imageId===provider.builderImageId &&
        isDeepStrictEqual(providerOuter.unwindInputs,provider.source),'source ZIP provider build receipt mismatch');
    }
  }
  return {manifestSha256:target.manifestSha256,indexSha256:sha256(indexRaw),fileCount:files.size};
}
