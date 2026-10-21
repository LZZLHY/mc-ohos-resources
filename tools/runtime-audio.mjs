/** Audio0023 的独立实物门：只读运行ZIP和显式SDK provider，不执行归档代码。
 * 未带该补丁的历史资产继续原规则；新音频不扩大其他DSO的系统依赖白名单。 */
import {open,readFile,stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';
import {sha256} from './protocol.mjs';
import {crc32} from './source-archive.mjs';

const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const HASH=/^[a-f0-9]{64}$/;
export const AUDIO_PATCH='0023-ohos-javasound-daudio-playback.patch';
export const AUDIO_MARKER=Buffer.from('AMCL_DAUDIO_OHOS_API20_PLAYBACK_V1\0');
export const AUDIO_DUPLEX_PATCH='0025-ohos-javasound-duplex-host-callbacks.patch';
export const AUDIO_DUPLEX_MARKER=Buffer.from('AMCL_DAUDIO_OHOS_API20_DUPLEX_V2\0');
export const AUDIO_SDK_PATH='sysroot/usr/lib/aarch64-linux-ohos/libohaudio.so';
export const AUDIO_AUDIT_SCOPE='static runtime/SDK/source binding only; no device playback or capture qualification';
export const REQUIRED_AUDIO_SYMBOLS=[
  'OH_AudioStreamBuilder_GenerateRenderer','OH_AudioStreamBuilder_SetRendererWriteDataCallbackAdvanced',
  'OH_AudioStreamBuilder_SetRendererErrorCallback','OH_AudioStreamBuilder_SetRendererInterruptCallback',
  'OH_AudioRenderer_Start','OH_AudioRenderer_Pause','OH_AudioRenderer_Flush','OH_AudioRenderer_Release',
  'OH_AudioRenderer_GetTimestamp','OH_AudioRenderer_GetFramesWritten','OH_AudioRenderer_SetVolume',
  'OH_AudioRenderer_GetSamplingRate','OH_AudioRenderer_GetChannelCount','OH_AudioRenderer_GetSampleFormat',
  'OH_AudioRenderer_GetEncodingType','OH_AudioManager_GetAudioRoutingManager','OH_AudioRoutingManager_GetPreferredOutputDevice'
].sort();
export const REQUIRED_CAPTURE_SYMBOLS=[
  'OH_AudioRoutingManager_GetPreferredInputDevice','OH_AudioStreamBuilder_SetCapturerInfo',
  'OH_AudioStreamBuilder_GenerateCapturer','OH_AudioStreamBuilder_SetCapturerReadDataCallback',
  'OH_AudioStreamBuilder_SetCapturerErrorCallback','OH_AudioStreamBuilder_SetCapturerInterruptCallback',
  'OH_AudioCapturer_Start','OH_AudioCapturer_Pause','OH_AudioCapturer_Flush','OH_AudioCapturer_Release',
  'OH_AudioCapturer_GetCurrentState','OH_AudioCapturer_GetSamplingRate','OH_AudioCapturer_GetChannelCount',
  'OH_AudioCapturer_GetSampleFormat','OH_AudioCapturer_GetEncodingType','OH_AudioCapturer_GetFrameSizeInCallback'
].sort();
const SYSTEM=new Set(['libc.so','libm.so','libdl.so','libpthread.so','librt.so','libz.so','ld-musl-aarch64.so.1']);
export const requiresRuntimeAudio=receipt=>[AUDIO_PATCH,AUDIO_DUPLEX_PATCH].some(name=>Object.hasOwn(receipt?.build?.patches??{},name));

/** 由真实冻结补丁身份选合同；V2不能缺失宿主ABI义务，也不能降级到V1标记蒙混通过。 */
function audioContract(receipt){
  const duplex=Object.hasOwn(receipt?.build?.patches??{},AUDIO_DUPLEX_PATCH);
  assert(Object.hasOwn(receipt?.build?.patches??{},AUDIO_PATCH),'audio audit requires recorded0023 predecessor');
  return{duplex,marker:duplex?AUDIO_DUPLEX_MARKER:AUDIO_MARKER,
    backend:duplex?'ohos-daudio-duplex-v2':'ohos-daudio-playback-v1',
    capture:duplex?'implemented-requires-permission-and-device-test':'not-implemented',
    pcm:duplex?'duplex-requires-permission-and-device-test':'playback-only-requires-device-test',
    embedded:duplex?{embeddedCallbacks:'signed-host-data-abi-v1-required'}:{},
    symbols:duplex?[...REQUIRED_AUDIO_SYMBOLS,...REQUIRED_CAPTURE_SYMBOLS].sort():REQUIRED_AUDIO_SYMBOLS};
}

/** 每个偏移/64位长度转Number前都限制；字符串和表项不能越过所属已验证区域。 */
export function audioElfFacts(bytes){
  const bounded=(offset,length)=>{
    assert(Number.isSafeInteger(offset)&&Number.isSafeInteger(length)&&offset>=0&&length>=0&&offset+length<=bytes.length,'audio ELF range outside file');
    return bytes.subarray(offset,offset+length);
  };
  const u16=at=>{bounded(at,2);return bytes.readUInt16LE(at);};
  const u32=at=>{bounded(at,4);return bytes.readUInt32LE(at);};
  const u64=at=>{bounded(at,8);const n=bytes.readBigUInt64LE(at);assert(n<=BigInt(Number.MAX_SAFE_INTEGER),'audio ELF integer overflow');return Number(n);};
  assert(Buffer.isBuffer(bytes)&&bytes.length>=64&&bytes.subarray(0,7).equals(Buffer.from([127,69,76,70,2,1,1]))&&u16(16)===3&&u16(18)===183,'audio ELF must be AArch64 ELF64 LE ET_DYN');
  const shoff=u64(40),count=u16(60);assert(u16(58)===64&&count>0,'audio ELF lacks section table');bounded(shoff,count*64);
  const sections=Array.from({length:count},(_,i)=>{const at=shoff+i*64;return{name:u32(at),type:u32(at+4),flags:u64(at+8),address:u64(at+16),offset:u64(at+24),size:u64(at+32),link:u32(at+40)};});
  const string=(table,offset)=>{
    assert(offset<table.length,'audio ELF string offset outside table');const end=table.indexOf(0,offset);assert(end>=0,'audio ELF unterminated string');
    const raw=table.subarray(offset,end),text=raw.toString('utf8');assert(Buffer.from(text).equals(raw),'audio ELF non-UTF8 name');return text;
  };
  const namesIndex=u16(62);assert(namesIndex<count,'audio ELF section names index outside table');
  const names=namesIndex?bounded(sections[namesIndex].offset,sections[namesIndex].size):Buffer.alloc(0);
  const needed=[],imports=[],exports=[],strong=[],weak=[],available=[],markers=[],sonames=[];
  for(const section of sections){
    if(names.length&&string(names,section.name)==='.amcl.daudio'){
      const phoff=u64(32),phcount=u16(56);assert(u16(54)===56&&phcount>0,'audio marker lacks program headers');bounded(phoff,phcount*56);
      let mappedReadonly=false;
      for(let i=0;i<phcount;i++){
        const at=phoff+i*56,type=u32(at),flags=u32(at+4),offset=u64(at+8),address=u64(at+16),filesize=u64(at+32);
        if(type===1&&(flags&4)&&!(flags&2)&&offset+filesize<=bytes.length&&section.offset>=offset&&
          section.offset+section.size<=offset+filesize&&section.address>=address&&section.address-address===section.offset-offset)mappedReadonly=true;
      }
      markers.push({type:section.type,flags:section.flags,bytes:section.size,valueHex:bounded(section.offset,section.size).toString('hex'),mappedReadonly});
    }
    if(![6,11].includes(section.type))continue;
    assert(section.link<count,'audio ELF string table link outside sections');const strings=sections[section.link];
    const table=bounded(strings.offset,strings.size),data=bounded(section.offset,section.size),stride=section.type===6?16:24;
    assert(data.length%stride===0,'audio ELF malformed table size');
    for(let offset=0;offset<data.length;offset+=stride){
      if(section.type===6){
        const tag=data.readBigInt64LE(offset),value=data.readBigUInt64LE(offset+8);
        if(tag===1n||tag===14n){assert(value<=BigInt(Number.MAX_SAFE_INTEGER),'audio ELF dynamic string integer overflow');
          (tag===1n?needed:sonames).push(string(table,Number(value)));}
      }
      else{
        const name=data.readUInt32LE(offset),binding=data[offset+4]>>>4,visibility=data[offset+5]&3,index=data.readUInt16LE(offset+6);
        if(!name||![1,2].includes(binding))continue;const symbol=string(table,name);
        if(index===0){imports.push(symbol);(binding===1?strong:weak).push(symbol);}
        else{exports.push(symbol);if([0,3].includes(visibility)&&data.readBigUInt64LE(offset+8)!==0n)available.push(symbol);}
      }
    }
  }
  const unique=values=>[...new Set(values)].sort();
  assert(sonames.length<=1,'audio ELF duplicate SONAME');
  return{needed:unique(needed),imports:unique(imports),exports:unique(exports),strongImports:unique(strong),weakImports:unique(weak),resolvableExports:unique(available),
    ...(sonames.length?{soname:sonames[0]}:{}),...(markers.length?{ohosDaudioMarkers:markers}:{})};
}

/** 只接受明确库名及摘要；相同SDK可用于数代，不依赖维护者当前SDK目录同名文件。 */
export async function readAudioSdkProviders(path){
  if(!path)return new Map();
  const data=JSON.parse(await readFile(path,'utf8'));
  assert(data.schemaVersion===1&&Array.isArray(data.providers)&&data.providers.length<=64&&
    Object.keys(data).every(k=>['schemaVersion','providers'].includes(k)),'invalid audio SDK provider map');
  const result=new Map();
  for(const item of data.providers){
    assert(item.name==='libohaudio.so'&&HASH.test(item.sha256)&&typeof item.path==='string'&&isAbsolute(item.path)&&
      Object.keys(item).every(k=>['name','sha256','path'].includes(k))&&!result.has(item.sha256),'invalid/duplicate audio SDK provider');
    const info=await stat(item.path);assert(info.isFile()&&info.size>0&&info.size<=64*1024*1024,'audio SDK provider size/type invalid');
    const bytes=await readFile(item.path);assert(sha256(bytes)===item.sha256,'audio SDK provider hash mismatch');result.set(item.sha256,bytes);
  }
  return result;
}

/** files只含经过CRC/清单核对的真实DSO与manifest；entry表覆盖运行ZIP全量名字/尺寸/模式。 */
export function verifyAudioRuntimeFiles(files,entries,receipt,providers){
  assert(requiresRuntimeAudio(receipt),'audio audit requires the recorded0023 source patch');
  const contract=audioContract(receipt);
  const raw=files.get('amcl-runtime.json');assert(raw,'runtime manifest absent');const manifest=JSON.parse(raw);
  assert(manifest.schema===1&&same(manifest.build,receipt.build)&&(!receipt.buildId||manifest.buildId===receipt.buildId)&&
    same(manifest.derivation??null,receipt.derivation??null),'audio runtime inner/outer identity mismatch');
  const names=[...entries.keys()].sort(),expected=[...Object.keys(manifest.files??{}),'amcl-runtime.json'].sort();
  assert(same(names,expected),'audio runtime ZIP/manifest member set mismatch');
  for(const [name,item] of entries){
    if(name==='amcl-runtime.json')continue;
    const record=manifest.files[name];assert(record&&HASH.test(record.sha256)&&record.bytes===item.size&&
      (record.mode===undefined||record.mode===item.mode)&&(record.type===undefined||record.type==='file'),'audio runtime manifest file metadata mismatch');
    if(files.has(name))assert(sha256(files.get(name))===record.sha256,'audio runtime selected file hash mismatch: '+name);
  }
  const major=String(receipt.build.major);assert(['8','17','21','25'].includes(major),'unknown audio runtime major');
  const soundPath=(major==='8'?'jre/lib/aarch64/':'lib/')+'libjsound.so';
  const nativeNames=[...files.keys()].filter(n=>n.split('/').at(-1).includes('.so'));
  assert(same(nativeNames.sort(),Object.keys(manifest.nativeLibraries??{}).sort()),'audio runtime native library set mismatch');
  const basenames=new Set(nativeNames.map(n=>n.split('/').at(-1)));assert(!basenames.has('libohaudio.so'),'system libohaudio must not be shadowed by bundled content');
  let sound;
  for(const name of nativeNames){
    const actual=audioElfFacts(files.get(name)),declared=manifest.nativeLibraries[name];
    for(const key of ['needed','imports','exports','strongImports','weakImports','resolvableExports'])
      assert(same(actual[key],declared[key]),'audio runtime ELF facts differ from manifest: '+name+' '+key);
    assert(same(actual.ohosDaudioMarkers??[],declared.ohosDaudioMarkers??[]),'audio runtime marker claim differs from ELF');
    assert(!actual.imports.some(n=>n.startsWith('snd_')),'runtime still imports unsupported ALSA');
    const isSound=name===soundPath;
    for(const dependency of actual.needed)assert(basenames.has(dependency)||SYSTEM.has(dependency)||(isSound&&dependency==='libohaudio.so'),
      'unknown/unscoped runtime dependency: '+name+' -> '+dependency);
    if(isSound)sound=actual;
    else assert(!actual.ohosDaudioMarkers?.length&&!actual.imports.some(n=>n.startsWith('OH_Audio'))&&!declared.javaSoundBackend,
      'audio capability/import outside libjsound');
  }
  assert(sound,'new audio build has no libjsound');
  const marker={type:1,flags:2,bytes:contract.marker.length,valueHex:contract.marker.toString('hex'),mappedReadonly:true};
  assert(same(sound.ohosDaudioMarkers,[marker])&&sound.needed.includes('libohaudio.so'),'missing real readonly audio marker/dependency');
  assert(contract.symbols.every(n=>sound.strongImports.includes(n)),'missing required strong audio entry point');
  const used=sound.imports.filter(n=>n.startsWith('OH_Audio')).sort(),sdkHash=receipt.build.inputClosure?.nativeSdk?.files?.[AUDIO_SDK_PATH];
  assert(HASH.test(sdkHash),'audio SDK provider missing from complete original build inputs');
  const sdk=providers.get(sdkHash);assert(sdk&&sha256(sdk)===sdkHash,'explicit matching SDK provider bytes required for audio audit');
  const sdkFacts=audioElfFacts(sdk);assert(sdkFacts.soname==='libohaudio.so','audio SDK provider SONAME mismatch');
  assert(used.every(n=>sdkFacts.resolvableExports.includes(n)),'SDK does not supply every audio import');
  const backend={backend:contract.backend,minimumApi:20,qualification:'implemented-requires-device-test',capture:contract.capture,...contract.embedded,
    provider:'libohaudio.so',providerSha256:sdkHash,requiredSymbols:used};
  assert(same(manifest.nativeLibraries[soundPath].javaSoundBackend,backend),'audio capability supplier proof differs from actual ELF/SDK');
  const caps=manifest.capabilities??{};
  assert(caps['javaSound.nativePcm']===contract.pcm&&caps['javaSound.nativePlayback']===backend.qualification&&
    caps['javaSound.nativeCapture']===contract.capture&&caps['javaSound.nativeMidi']==='unavailable-safe'&&caps['javaSound.ports']==='unavailable-safe',
    'audio capabilities overclaim or omit exact playback/capture status');
  return{schemaVersion:1,buildId:receipt.buildId,archiveSha256:receipt.sha256,archiveSizeBytes:receipt.bytes,
    soundPath,soundSha256:sha256(files.get(soundPath)),manifestSha256:sha256(raw),backend:backend.backend,
    minimumApi:20,qualification:backend.qualification,capture:backend.capture,...contract.embedded,sdkProviderSha256:sdkHash,
    requiredSymbols:used,nativeLibraryCount:nativeNames.length,fileCount:entries.size,scope:AUDIO_AUDIT_SCOPE};
}

/** 激活只消费已完整远端读回的同一 ZIP；新音频收据不能省略或跨包挪用静态验收。 */
export function validateRuntimeAudioAudit(audit,target,receipt){
  const contract=audioContract(receipt);
  const keys=['schemaVersion','buildId','archiveSha256','archiveSizeBytes','soundPath','soundSha256','manifestSha256',
    'backend','minimumApi','qualification','capture','sdkProviderSha256','requiredSymbols','nativeLibraryCount','fileCount','scope',
    ...(contract.duplex?['embeddedCallbacks']:[])];
  const expectedPath=(String(receipt.build.major)==='8'?'jre/lib/aarch64/':'lib/')+'libjsound.so';
  assert(requiresRuntimeAudio(receipt)&&audit&&same(Object.keys(audit).sort(),keys.sort())&&audit.schemaVersion===1&&
    audit.buildId===target.buildId&&audit.archiveSha256===target.sha256&&audit.archiveSizeBytes===target.sizeBytes&&
    audit.soundPath===expectedPath&&HASH.test(audit.soundSha256)&&HASH.test(audit.manifestSha256)&&
    audit.sdkProviderSha256===receipt.build.inputClosure?.nativeSdk?.files?.[AUDIO_SDK_PATH]&&HASH.test(audit.sdkProviderSha256)&&
    audit.backend===contract.backend&&audit.minimumApi===20&&audit.qualification==='implemented-requires-device-test'&&
    audit.capture===contract.capture&&(!contract.duplex||audit.embeddedCallbacks===contract.embedded.embeddedCallbacks)&&
    audit.scope===AUDIO_AUDIT_SCOPE,'missing/invalid exact runtime audio audit');
  assert(Array.isArray(audit.requiredSymbols)&&audit.requiredSymbols.length<=512&&
    audit.requiredSymbols.every(n=>typeof n==='string'&&/^OH_Audio[A-Za-z0-9_]{1,120}$/.test(n))&&
    same(audit.requiredSymbols,[...new Set(audit.requiredSymbols)].sort())&&
    contract.symbols.every(n=>audit.requiredSymbols.includes(n))&&
    Number.isSafeInteger(audit.nativeLibraryCount)&&audit.nativeLibraryCount>0&&audit.nativeLibraryCount<=50000&&
    Number.isSafeInteger(audit.fileCount)&&audit.fileCount>audit.nativeLibraryCount&&audit.fileCount<=50000,
    'incomplete runtime audio audit supplier/member proof');
  return audit;
}

/** 定位ZIP中央目录后只展开manifest/DSO；普通类/jmod依赖完整ZIP摘要，不累积其展开体。 */
export async function verifyRuntimeAudioFile(path,target,receipt,providers){
  assert(receipt.sha256===target.sha256&&receipt.bytes===target.sizeBytes&&
    (target.buildId===undefined||receipt.buildId===target.buildId),'runtime audio archive/receipt identity mismatch');
  const file=await open(path,'r');
  try{
    const before=await file.stat({bigint:true}),size=Number(before.size);
    assert(Number.isSafeInteger(size)&&size===target.sizeBytes&&size>=22&&size<=2147483647,'audio runtime ZIP size invalid');
    const read=async(offset,length)=>{
      assert(Number.isSafeInteger(offset)&&Number.isSafeInteger(length)&&offset>=0&&length>=0&&offset+length<=size,'runtime ZIP read outside file');
      const data=Buffer.alloc(length);let at=0;while(at<length){const {bytesRead}=await file.read(data,at,length-at,offset+at);assert(bytesRead>0,'runtime ZIP truncated');at+=bytesRead;}return data;
    };
    const hash=createHash('sha256');for(let at=0;at<size;at+=1024*1024)hash.update(await read(at,Math.min(1024*1024,size-at)));
    assert(hash.digest('hex')===target.sha256,'audio runtime full ZIP identity mismatch');
    const tailOffset=Math.max(0,size-65557),tail=await read(tailOffset,size-tailOffset);let end=-1;
    for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50&&i+22+tail.readUInt16LE(i+20)===tail.length){end=i;break;}
    assert(end>=0,'runtime ZIP end record absent');const count=tail.readUInt16LE(end+10),directorySize=tail.readUInt32LE(end+12),directoryOffset=tail.readUInt32LE(end+16);
    assert(tail.readUInt16LE(end+4)===0&&tail.readUInt16LE(end+6)===0&&tail.readUInt16LE(end+8)===count&&
      count>0&&count<=50000&&directorySize<=32*1024*1024&&directoryOffset+directorySize===tailOffset+end,'runtime ZIP central directory invalid');
    const central=await read(directoryOffset,directorySize),files=new Map(),entries=new Map(),folded=new Set(),ranges=[];let cursor=0,total=0;
    for(let i=0;i<count;i++){
      assert(cursor+46<=central.length&&central.readUInt32LE(cursor)===0x02014b50,'runtime ZIP central header invalid');
      const flags=central.readUInt16LE(cursor+8),method=central.readUInt16LE(cursor+10),crc=central.readUInt32LE(cursor+16),packed=central.readUInt32LE(cursor+20),rawSize=central.readUInt32LE(cursor+24);
      const nameSize=central.readUInt16LE(cursor+28),extraSize=central.readUInt16LE(cursor+30),commentSize=central.readUInt16LE(cursor+32),mode=central.readUInt32LE(cursor+38)>>>16,local=central.readUInt32LE(cursor+42);
      const next=cursor+46+nameSize+extraSize+commentSize;assert(next<=central.length&&[0,8].includes(method)&&(flags&~0x808)===0&&
        central.readUInt16LE(cursor+34)===0&&(mode&0xf000)===0x8000&&(total+=rawSize)<=4*1024**3,'unsupported runtime ZIP entry');
      const nameBytes=central.subarray(cursor+46,cursor+46+nameSize),name=nameBytes.toString('utf8');
      assert(Buffer.from(name).equals(nameBytes)&&name.length>0&&name.length<512&&!/[\\:\x00-\x1f\x7f]/.test(name)&&
        name.split('/').every(p=>p&&p!=='.'&&p!=='..')&&!folded.has(name.toLowerCase()),'runtime ZIP path invalid/duplicate');folded.add(name.toLowerCase());
      assert(local+30<=directoryOffset,'runtime ZIP local header outside payload');const header=await read(local,30);
      assert(header.readUInt32LE(0)===0x04034b50&&header.readUInt16LE(6)===flags&&header.readUInt16LE(8)===method&&header.readUInt16LE(26)===nameSize,'runtime ZIP local header mismatch');
      const dataStart=local+30+nameSize+header.readUInt16LE(28);assert(dataStart+packed<=directoryOffset&&
        (await read(local+30,nameSize)).equals(nameBytes),'runtime ZIP data/name bounds mismatch');
      for(const [at,value] of [[14,crc],[18,packed],[22,rawSize]])assert(header.readUInt32LE(at)===value||((flags&8)&&header.readUInt32LE(at)===0),'runtime ZIP local identity mismatch');
      ranges.push([local,dataStart+packed]);entries.set(name,{size:rawSize,mode});
      if(name==='amcl-runtime.json'||name.split('/').at(-1).includes('.so')){
        assert(rawSize<=256*1024*1024&&packed<=256*1024*1024,'runtime selected member exceeds bound');const compressed=await read(dataStart,packed);
        const data=method===0?compressed:inflateRawSync(compressed,{maxOutputLength:Math.max(1,rawSize)});
        assert(data.length===rawSize&&crc32(data)===crc,'runtime selected member CRC/size mismatch');files.set(name,data);
      }
      cursor=next;
    }
    assert(cursor===central.length,'runtime ZIP trailing central data');ranges.sort((a,b)=>a[0]-b[0]);
    for(let i=1;i<ranges.length;i++)assert(ranges[i-1][1]<=ranges[i][0],'runtime ZIP overlapping members');
    const result=verifyAudioRuntimeFiles(files,entries,receipt,providers),after=await file.stat({bigint:true});
    assert(before.size===after.size&&before.ino===after.ino&&before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs,'runtime ZIP changed during audit');
    return validateRuntimeAudioAudit(result,{...target,buildId:target.buildId??receipt.buildId},receipt);
  }finally{await file.close();}
}
