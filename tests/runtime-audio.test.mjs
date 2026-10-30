/** 独立音频门的实际 ELF/ZIP 结构夹具；不执行目标指令，不读取本机私有 SDK。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {sha256} from '../tools/protocol.mjs';
import {crc32} from '../tools/source-archive.mjs';
import {preflightLocalAssets} from '../tools/publish.mjs';
import {validateDeliveryReceipt} from '../tools/delivery.mjs';
import {AUDIO_PATCH,AUDIO_MARKER,AUDIO_DUPLEX_PATCH,AUDIO_DUPLEX_MARKER,AUDIO_TIMELINE_PATCH,AUDIO_TIMELINE_MARKER,AUDIO_SDK_PATH,REQUIRED_AUDIO_SYMBOLS,REQUIRED_TIMELINE_AUDIO_SYMBOLS,REQUIRED_CAPTURE_SYMBOLS,audioElfFacts,
  verifyAudioRuntimeFiles,verifyRuntimeAudioFile,readAudioSdkProviders,verifySoundSymbolClosure} from '../tools/runtime-audio.mjs';
import {NATIVE_TEMP_PATCH,PERFDATA_UID_PATCH,NATIVE_TEMP_MARKER} from '../tools/runtime-native-temp.mjs';

const raw=value=>Buffer.from(JSON.stringify(value));
const mode=0o100644;

/** ELF64 LE AArch64：真实 section/dynsym/dynamic/LOAD 字段，可定点破坏边界。 */
function elf({imports=[],exports=[],needed=[],soname,marker=false,sectionFlags=2,segmentFlags=4,
  markerName='.amcl.daudio',markerBytes=AUDIO_MARKER,weak=[],hidden=[],zero=[]}={}){
  const names=['','.shstrtab','.dynstr','.dynsym','.dynamic',...(marker?[markerName]:[])];
  const strings=['',...imports,...exports,...needed,...(soname?[soname]:[])];
  const table=values=>{const offsets=new Map();let length=0;for(const s of values){offsets.set(s,length);length+=Buffer.byteLength(s)+1;}
    return{offsets,bytes:Buffer.from(values.join('\0')+'\0')};};
  const sectionNames=table(names),dynamicNames=table(strings);
  const symbols=Buffer.alloc(24*(1+imports.length+exports.length));
  [...imports,...exports].forEach((name,i)=>{
    const at=(i+1)*24,defined=i>=imports.length;symbols.writeUInt32LE(dynamicNames.offsets.get(name),at);
    symbols[at+4]=((weak.includes(name)?2:1)<<4)|2;symbols[at+5]=hidden.includes(name)?2:0;
    symbols.writeUInt16LE(defined?1:0,at+6);symbols.writeBigUInt64LE(defined&&!zero.includes(name)?4096n:0n,at+8);
  });
  const dynamic=Buffer.alloc(16*(needed.length+(soname?1:0)+1));
  [...needed.map(s=>[1,s]),...(soname?[[14,soname]]:[])].forEach(([tag,s],i)=>{
    dynamic.writeBigInt64LE(BigInt(tag),i*16);dynamic.writeBigUInt64LE(BigInt(dynamicNames.offsets.get(s)),i*16+8);
  });
  const payloads=[Buffer.alloc(0),sectionNames.bytes,dynamicNames.bytes,symbols,dynamic,...(marker?[markerBytes]:[])];
  const offsets=[];let at=128;for(const p of payloads){offsets.push(at);at+=p.length;at=(at+7)&~7;}
  const shoff=at,bytes=Buffer.alloc(shoff+names.length*64);
  Buffer.from([127,69,76,70,2,1,1]).copy(bytes);bytes.writeUInt16LE(3,16);bytes.writeUInt16LE(183,18);
  bytes.writeUInt32LE(1,20);bytes.writeBigUInt64LE(64n,32);bytes.writeBigUInt64LE(BigInt(shoff),40);
  bytes.writeUInt16LE(64,52);bytes.writeUInt16LE(56,54);bytes.writeUInt16LE(1,56);
  bytes.writeUInt16LE(64,58);bytes.writeUInt16LE(names.length,60);bytes.writeUInt16LE(1,62);
  bytes.writeUInt32LE(1,64);bytes.writeUInt32LE(segmentFlags,68);bytes.writeBigUInt64LE(BigInt(bytes.length),96);
  bytes.writeBigUInt64LE(BigInt(bytes.length),104);
  payloads.forEach((p,i)=>{p.copy(bytes,offsets[i]);if(!i)return;const start=shoff+i*64;
    bytes.writeUInt32LE(sectionNames.offsets.get(names[i]),start);bytes.writeUInt32LE([0,3,3,11,6,1][i],start+4);
    bytes.writeBigUInt64LE(BigInt(i===5?sectionFlags:0),start+8);bytes.writeBigUInt64LE(BigInt(offsets[i]),start+16);
    bytes.writeBigUInt64LE(BigInt(offsets[i]),start+24);bytes.writeBigUInt64LE(BigInt(p.length),start+32);
    bytes.writeUInt32LE(i===3||i===4?2:0,start+40);bytes.writeBigUInt64LE(BigInt(i===3?24:i===4?16:0),start+56);
  });
  return bytes;
}

function zip(files,{deflated=false}={}){
  const locals=[],central=[];let offset=0;
  for(const [name,bytes] of files){const n=Buffer.from(name),data=deflated?deflateRawSync(bytes):bytes,crc=crc32(bytes);
    const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(deflated?8:0,8);
    h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(bytes.length,22);h.writeUInt16LE(n.length,26);
    locals.push(h,n,data);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,6);
    c.writeUInt16LE(deflated?8:0,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(bytes.length,24);
    c.writeUInt16LE(n.length,28);c.writeUInt32LE((mode<<16)>>>0,38);c.writeUInt32LE(offset,42);central.push(c,n);
    offset+=30+n.length+data.length;
  }
  const c=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.size,8);
  end.writeUInt16LE(files.size,10);end.writeUInt32LE(c.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,c,end]);
}

function fixture({major='17',timeline=false,duplex=timeline,sound={},sdk={},other={},extraFiles=[],nativeTemp=false}={}){
  const used=[...(timeline?REQUIRED_TIMELINE_AUDIO_SYMBOLS:REQUIRED_AUDIO_SYMBOLS),...(duplex?REQUIRED_CAPTURE_SYMBOLS:[]),'OH_AudioStreamBuilder_Create'].sort();
  const provider=elf({exports:used,soname:'libohaudio.so',...sdk}),sdkHash=sha256(provider);
  const libc=elf({soname:'libc.so'}),libcHash=sha256(libc);
  const soundPath=(major==='8'?'jre/lib/aarch64/':'lib/')+'libjsound.so';
  const files=new Map([[soundPath,elf({imports:used,needed:['libc.so','libohaudio.so'],marker:true,markerBytes:timeline?AUDIO_TIMELINE_MARKER:duplex?AUDIO_DUPLEX_MARKER:AUDIO_MARKER,...sound})],
    ['lib/libother.so',elf(other)],['release',Buffer.from('synthetic fixture')],...extraFiles]);
  const receipt={buildId:'test-audio-'+major,bytes:0,sha256:'',build:{major,patches:{[AUDIO_PATCH]:sha256('patch'),...(duplex?{[AUDIO_DUPLEX_PATCH]:sha256('duplex-patch')}:{}),...(timeline?{[AUDIO_TIMELINE_PATCH]:sha256('timeline-patch')}:{})},
    inputClosure:{nativeSdk:{files:{[AUDIO_SDK_PATH]:sdkHash,'sysroot/usr/lib/aarch64-linux-ohos/libc.so':libcHash}}}}};
  if(nativeTemp){
    const jvm=(major==='8'?'jre/lib/aarch64/':'lib/')+'server/libjvm.so';
    files.set(jvm,elf({marker:true,markerName:'.amcl.nativetemp',markerBytes:NATIVE_TEMP_MARKER,sectionFlags:0x200002}));
    receipt.build.inputClosure.files={};
    for(const patch of [NATIVE_TEMP_PATCH,PERFDATA_UID_PATCH]){
      const hash=sha256(patch);receipt.build.patches[patch]=hash;
      receipt.build.inputClosure.files['prebuilt/jdk/'+major+'/patches/'+patch]=hash;
    }
  }
  const manifest={schema:1,buildId:receipt.buildId,build:receipt.build,files:{},nativeLibraries:{},
    capabilities:{'javaSound.nativePcm':duplex?'duplex-requires-permission-and-device-test':'playback-only-requires-device-test','javaSound.nativePlayback':'implemented-requires-device-test',
      'javaSound.nativeCapture':duplex?'implemented-requires-permission-and-device-test':'not-implemented','javaSound.nativeMidi':'unavailable-safe','javaSound.ports':'unavailable-safe'}};
  for(const [name,bytes] of files){manifest.files[name]={sha256:sha256(bytes),bytes:bytes.length,mode,type:'file'};
    if(name.includes('.so'))manifest.nativeLibraries[name]=audioElfFacts(bytes);}
  manifest.nativeLibraries[soundPath].javaSoundBackend={backend:timeline?'ohos-daudio-duplex-v3':duplex?'ohos-daudio-duplex-v2':'ohos-daudio-playback-v1',minimumApi:20,
    qualification:'implemented-requires-device-test',capture:duplex?'implemented-requires-permission-and-device-test':'not-implemented',
    ...(duplex?{embeddedCallbacks:timeline?'signed-host-data-abi-v2-required':'signed-host-data-abi-v1-required'}:{}),provider:'libohaudio.so',providerSha256:sdkHash,
    requiredSymbols:manifest.nativeLibraries[soundPath].imports.filter(n=>n.startsWith('OH_Audio'))};
  const providers=new Map([[sdkHash,provider],[libcHash,libc]]);
  const finish=(options={})=>{
    files.set('amcl-runtime.json',raw(manifest));const bytes=zip(files,options);receipt.bytes=bytes.length;receipt.sha256=sha256(bytes);
    return{bytes,target:{buildId:receipt.buildId,kind:'runtime',fileName:'runtime.zip',sizeBytes:bytes.length,sha256:receipt.sha256}};
  };
  const verify=()=>{finish();return verifyAudioRuntimeFiles(files,new Map([...files].map(([n,b])=>[n,{size:b.length,mode}])),receipt,providers);};
  return{files,receipt,manifest,providers,provider,sdkHash,libc,libcHash,soundPath,finish,verify};
}

for(const major of ['8','17','21','25'])test('audio gate accepts exact '+major+' playback provider and keeps capture unqualified',()=>{
  const f=fixture({major}),result=f.verify();assert.equal(result.soundPath,f.soundPath);assert.equal(result.requiredSymbols.length,18);
  assert.equal(result.capture,'not-implemented');assert.equal(result.sdkProviderSha256,f.sdkHash);
});

for(const major of ['8','17','21','25'])test('combined ZIP audit binds '+major+' native temp to same manifest/source',()=>{
  const f=fixture({major,nativeTemp:true}),{closure,receipt}=delivery(f);
  assert.equal(receipt.assets[0].runtimeAudio.nativeTemp.qualification,'static-source-and-readonly-marker-only');
  validateDeliveryReceipt(receipt,closure);
  delete receipt.assets[0].runtimeAudio.nativeTemp;
  assert.throws(()=>validateDeliveryReceipt(receipt,closure),/audio audit|native temp/);
});

test('actual local/ZIP readback requires the native temp static record',async()=>{
  const f=fixture({nativeTemp:true}),{bytes,target}=f.finish(),root=await temp(),file=resolve(root,target.fileName);
  await writeFile(file,bytes);
  const actual=await verifyRuntimeAudioFile(file,target,f.receipt,f.providers);
  assert.equal(actual.nativeTemp.jvmSha256,sha256(f.files.get('lib/server/libjvm.so')));
});

for(const [name,change] of [
  ['source says new but no marker',f=>delete f.manifest.nativeLibraries['lib/server/libjvm.so'].ohosNativeTempMarkers],
  ['only0030',f=>delete f.receipt.build.patches[PERFDATA_UID_PATCH]],
  ['frozen source mismatch',f=>f.receipt.build.inputClosure.files={}],
  ['copied marker to other DSO',f=>{const bytes=f.files.get('lib/server/libjvm.so');f.files.set('lib/libother.so',bytes);
    f.manifest.files['lib/libother.so']={sha256:sha256(bytes),bytes:bytes.length,mode,type:'file'};
    f.manifest.nativeLibraries['lib/libother.so']=audioElfFacts(bytes);}]
])test('combined native temp rejects '+name,()=>{const f=fixture({nativeTemp:true});change(f);assert.throws(()=>f.verify());});

for(const major of ['8','17','21','25'])test('audio gate accepts exact '+major+' duplex supplier with host ABI obligation',()=>{
  const f=fixture({major,duplex:true}),result=f.verify();assert.equal(result.backend,'ohos-daudio-duplex-v2');
  assert.equal(result.capture,'implemented-requires-permission-and-device-test');
  assert.equal(result.embeddedCallbacks,'signed-host-data-abi-v1-required');
  const {closure,receipt}=delivery(f);validateDeliveryReceipt(receipt,closure);
});

for(const major of ['8','17','21','25'])test('audio gate accepts exact '+major+' timeline V3 and ABI2 supplier',()=>{
  const f=fixture({major,timeline:true}),result=f.verify();
  assert.equal(result.backend,'ohos-daudio-duplex-v3');assert.equal(result.embeddedCallbacks,'signed-host-data-abi-v2-required');
  assert(result.requiredSymbols.includes('OH_AudioRenderer_GetAudioTimestampInfo'));
  assert(!result.requiredSymbols.includes('OH_AudioRenderer_GetFramesWritten'));
  assert(!result.requiredSymbols.includes('OH_AudioRenderer_GetTimestamp'));
  const {closure,receipt}=delivery(f);validateDeliveryReceipt(receipt,closure);
});
for(const [name,options] of [
  ['old V2 marker',{sound:{markerBytes:AUDIO_DUPLEX_MARKER}}],
  ['weak presentation timestamp',{sound:{weak:['OH_AudioRenderer_GetAudioTimestampInfo']}}],
  ['missing presentation timestamp',{sound:{imports:[...REQUIRED_AUDIO_SYMBOLS,...REQUIRED_CAPTURE_SYMBOLS]}}],
  ['SDK lacks presentation timestamp',{sdk:{exports:[...REQUIRED_AUDIO_SYMBOLS,...REQUIRED_CAPTURE_SYMBOLS]}}]
])test('timeline V3 rejects '+name,()=>assert.throws(()=>fixture({timeline:true,...options}).verify()));
for(const [name,change] of [
  ['missing0028',f=>delete f.receipt.build.patches[AUDIO_TIMELINE_PATCH]],
  ['missing0025 predecessor',f=>delete f.receipt.build.patches[AUDIO_DUPLEX_PATCH]],
  ['old host ABI',f=>f.manifest.nativeLibraries[f.soundPath].javaSoundBackend.embeddedCallbacks='signed-host-data-abi-v1-required']
])test('timeline V3 rejects '+name,()=>{const f=fixture({timeline:true});change(f);assert.throws(f.verify);});

for(const [name,options] of [
  ['old marker under0025',{sound:{markerBytes:AUDIO_MARKER}}],
  ['weak capture import',{sound:{weak:[REQUIRED_CAPTURE_SYMBOLS[0]]}}],
  ['missing capture imports',{sound:{imports:REQUIRED_AUDIO_SYMBOLS}}],
  ['SDK lacks capture supplier',{sdk:{exports:REQUIRED_AUDIO_SYMBOLS}}]
])test('duplex gate rejects '+name,()=>assert.throws(()=>fixture({duplex:true,...options}).verify()));

for(const [name,change] of [
  ['missing0025',f=>delete f.receipt.build.patches[AUDIO_DUPLEX_PATCH]],
  ['missing0023 predecessor',f=>delete f.receipt.build.patches[AUDIO_PATCH]],
  ['missing signed host ABI',f=>delete f.manifest.nativeLibraries[f.soundPath].javaSoundBackend.embeddedCallbacks],
  ['wrong signed host ABI',f=>f.manifest.nativeLibraries[f.soundPath].javaSoundBackend.embeddedCallbacks='optional'],
  ['capture device overclaim',f=>f.manifest.capabilities['javaSound.nativeCapture']='device-tested'],
  ['PCM playback underclaim',f=>f.manifest.capabilities['javaSound.nativePcm']='playback-only-requires-device-test']
])test('duplex gate rejects '+name,()=>{const f=fixture({duplex:true});change(f);assert.throws(f.verify);});

for(const [name,options] of [
  ['missing marker',{sound:{marker:false}}],['plain string outside marker section',{sound:{markerName:'.rodata'}}],
  ['writable marker section',{sound:{sectionFlags:3}}],['writable marker load',{sound:{segmentFlags:6}}],
  ['bad marker byte',{sound:{markerBytes:Buffer.from('AMCL_DAUDIO_OHOS_API20_PLAYBACK_V2\0')}}],
  ['weak required import',{sound:{weak:[REQUIRED_AUDIO_SYMBOLS[0]]}}],['missing required import',{sound:{imports:REQUIRED_AUDIO_SYMBOLS.slice(1)}}],
  ['missing actual NEEDED',{sound:{needed:['libc.so']}}],['unknown dependency',{sound:{needed:['libohaudio.so','libunknown.so']}}],
  ['other DSO audio dependency',{other:{needed:['libohaudio.so']}}],['other DSO audio import',{other:{imports:['OH_AudioRenderer_Start']}}],
  ['other DSO marker',{other:{marker:true}}],['ALSA import',{other:{imports:['snd_pcm_open']}}],
  ['bundled SDK shadow',{extraFiles:[['lib/libohaudio.so',elf()]]}],['wrong SDK SONAME',{sdk:{soname:'libother.so'}}],
  ['missing SDK export',{sdk:{exports:REQUIRED_AUDIO_SYMBOLS.slice(1)}}],
  ['hidden SDK export',{sdk:{hidden:[REQUIRED_AUDIO_SYMBOLS[0]]}}],['zero SDK export',{sdk:{zero:[REQUIRED_AUDIO_SYMBOLS[0]]}}]
])test('audio gate rejects '+name,()=>assert.throws(()=>fixture(options).verify()));

for(const [name,change] of [
  ['SDK bytes absent',f=>f.providers.clear()],['SDK bytes SHA mismatch',f=>f.providers.set(f.sdkHash,elf())],
  ['SDK not in original index',f=>delete f.receipt.build.inputClosure.nativeSdk.files[AUDIO_SDK_PATH]],
  ['device-tested overclaim',f=>f.manifest.nativeLibraries[f.soundPath].javaSoundBackend.qualification='device-tested'],
  ['capture overclaim',f=>f.manifest.capabilities['javaSound.nativeCapture']='implemented'],
  ['legacy unavailable label',f=>f.manifest.capabilities['javaSound.nativePcm']='unavailable-safe'],
  ['minimum API underclaim',f=>f.manifest.nativeLibraries[f.soundPath].javaSoundBackend.minimumApi=12],
  ['import facts forged',f=>f.manifest.nativeLibraries[f.soundPath].imports=[]],
  ['supplier list forged',f=>f.manifest.nativeLibraries[f.soundPath].javaSoundBackend.requiredSymbols=[]],
  ['manifest hash differs',f=>f.manifest.files[f.soundPath].sha256=sha256('other')],
  ['file mode differs',f=>f.manifest.files[f.soundPath].mode=0o100755],
  ['unindexed member',f=>f.files.set('extra',Buffer.from('x'))],
  ['native set omits library',f=>delete f.manifest.nativeLibraries['lib/libother.so']]
])test('audio gate rejects '+name,()=>{const f=fixture();change(f);assert.throws(f.verify);});

test('bounded ELF parser rejects corrupt headers, offsets and unterminated strings',()=>{
  for(const change of [b=>b.writeUInt16LE(62,18),b=>b.writeBigUInt64LE(2n**63n,40),b=>b.writeUInt16LE(65535,60),
    b=>b.fill(255,128,144)]){const b=elf({imports:['a'],marker:true});change(b);assert.throws(()=>audioElfFacts(b));}
});

function soundClosureFixture(){
  const sound='lib/libjsound.so',libc=elf({soname:'libc.so'}),hash=sha256(libc);
  const files=new Map([[sound,elf({imports:['JNU_ThrowByName','JVM_SoundProbe','JNI_SoundProbe','optional_probe'],
      weak:['optional_probe'],needed:['libc.so']})],
    ['lib/libjava.so',elf({exports:['JNU_ThrowByName'],needed:['libjvm.so']})],
    ['lib/server/libjvm.so',elf({exports:['JVM_SoundProbe','JNI_SoundProbe'],needed:['libc.so']})]]);
  const receipt={build:{inputClosure:{nativeSdk:{files:{'sysroot/usr/lib/aarch64-linux-ohos/libc.so':hash}}}}};
  const providers=new Map([[hash,libc]]);
  const verify=()=>verifySoundSymbolClosure(new Map([...files].map(([name,data])=>[name,audioElfFacts(data)])),files,sound,receipt,providers);
  const linked=()=>files.set(sound,elf({imports:['JNU_ThrowByName','JVM_SoundProbe','JNI_SoundProbe','optional_probe'],
      weak:['optional_probe'],needed:['libjava.so','libc.so']}));
  return{sound,files,receipt,providers,verify,linked,hash};
}
test('sound JNU/JVM/JNI imports cannot borrow a merely bundled unrelated provider',()=>{
  const f=soundClosureFixture();assert.throws(f.verify,/no DT_NEEDED supplier:.*JNU_ThrowByName/);
  f.linked();const proof=f.verify();assert.equal(proof.scope,'libjsound-dt-needed-closure');
  assert.deepEqual(proof.requiredSymbols,['JNI_SoundProbe','JNU_ThrowByName','JVM_SoundProbe']);
  assert.equal(proof.suppliers['libjava.so'].path,'lib/libjava.so');assert.equal(proof.suppliers['libjvm.so'].path,'lib/server/libjvm.so');
});
test('sound resolver rejects missing transitive JVM supplier and accepts dependency cycles',()=>{
  const f=soundClosureFixture();f.linked();f.files.set('lib/libjava.so',elf({exports:['JNU_ThrowByName']}));
  assert.throws(f.verify,/JVM_SoundProbe/);
  f.files.set('lib/libjava.so',elf({exports:['JNU_ThrowByName'],needed:['libjvm.so']}));
  f.files.set('lib/server/libjvm.so',elf({exports:['JVM_SoundProbe','JNI_SoundProbe'],needed:['libjava.so','libc.so']}));
  assert.equal(f.verify().requiredSymbols.length,3);
});
for(const key of ['hidden','zero'])test('sound resolver rejects '+key+' real dynamic JNU export',()=>{
  const f=soundClosureFixture();f.linked();f.files.set('lib/libjava.so',elf({exports:['JNU_ThrowByName'],[key]:['JNU_ThrowByName'],needed:['libjvm.so']}));
  assert.throws(f.verify,/JNU_ThrowByName/);
});
test('sound resolver preserves missing weak optional imports but never inherits JVM host exemption',()=>{
  const f=soundClosureFixture();f.linked();assert.equal(f.verify().requiredSymbols.length,3);
  f.files.set(f.sound,elf({imports:['__clear_cache'],needed:['libc.so']}));assert.throws(f.verify,/__clear_cache/);
});
test('sound resolver requires exact SDK bytes and unambiguous visited native dependency',()=>{
  const f=soundClosureFixture();f.linked();f.providers.clear();assert.throws(f.verify,/matching SDK dependency/);
  const g=soundClosureFixture();g.linked();g.files.set('elsewhere/libjava.so',g.files.get('lib/libjava.so'));
  assert.throws(g.verify,/ambiguous/);
});
test('sound activation refuses old audits without the new dependency proof',()=>{
  const f=fixture(),d=delivery(f);delete d.receipt.assets[0].runtimeAudio.symbolClosure;
  assert.throws(()=>validateDeliveryReceipt(d.receipt,d.closure),/runtime audio audit/);
});
for(const [name,change] of [
  ['missing mandatory symbol',p=>p.requiredSymbols.pop()],['wrong root SHA',p=>p.suppliers['libjsound.so'].sha256=sha256('other')],
  ['SDK source mismatch',p=>p.suppliers['libc.so'].sha256=sha256('other')],['unknown supplier kind',p=>p.suppliers['libc.so'].kind='host'],
  ['path escape',p=>p.suppliers['libjsound.so'].path='../libjsound.so'],['empty proof',p=>p.requiredSymbols=[]]
])test('sound activation rejects '+name,()=>{
  const f=fixture(),d=delivery(f);change(d.receipt.assets[0].runtimeAudio.symbolClosure);
  assert.throws(()=>validateDeliveryReceipt(d.receipt,d.closure));
});

async function temp(){const base=resolve(process.env.AMCL_TEST_TMP??tmpdir());await mkdir(base,{recursive:true});return mkdtemp(resolve(base,'runtime-audio-'));}

test('actual STORE/DEFLATE ZIP preflight needs frozen SDK bytes and exact inner identity',async()=>{
  const dir=await temp(),f=fixture(),providerPath=resolve(dir,'libohaudio.so'),libcPath=resolve(dir,'libc.so'),mapPath=resolve(dir,'sdk.json');
  await writeFile(providerPath,f.provider);await writeFile(libcPath,f.libc);
  await writeFile(mapPath,raw({schemaVersion:1,providers:[{name:'libohaudio.so',sha256:f.sdkHash,path:providerPath},
    {name:'libc.so',sha256:f.libcHash,path:libcPath}]}));
  const providers=await readAudioSdkProviders(mapPath);assert.equal(providers.size,2);
  for(const deflated of [false,true]){
    const {bytes,target}=f.finish({deflated}),path=resolve(dir,'runtime.zip');await writeFile(path,bytes);
    const closure={targets:[target],receipts:new Map([[target.buildId,f.receipt]])};
    await assert.rejects(preflightLocalAssets(closure,{'runtime.zip':path}),/matching SDK/);
    const result=await preflightLocalAssets(closure,{'runtime.zip':path},mapPath);
    assert.equal(result.audio.get('runtime.zip').archiveSha256,sha256(bytes));assert.equal(result.sources.size,0);
    await assert.rejects(verifyRuntimeAudioFile(path,{...target,sha256:sha256('bad')},f.receipt,providers),/identity mismatch/);
    const corrupt=Buffer.from(bytes);corrupt[40]^=1;await writeFile(path,corrupt);
    await assert.rejects(verifyRuntimeAudioFile(path,target,f.receipt,providers),/ZIP identity mismatch/);
  }
  await writeFile(mapPath,raw({schemaVersion:1,providers:[{name:'libohaudio.so',sha256:sha256('bad'),path:providerPath}]}));
  await assert.rejects(readAudioSdkProviders(mapPath),/hash mismatch/);
});

test('ZIP rejects CRC, path traversal and duplicate alias even when whole-archive hash is updated',async()=>{
  const dir=await temp();for(const kind of ['crc','traversal','alias','overlap']){
    const f=fixture();if(kind==='traversal')f.files.set('../escape',Buffer.from('x'));
    if(kind==='alias')f.files.set('Release',Buffer.from('x'));
    let {bytes,target}=f.finish();
    if(kind==='crc')bytes[30+Buffer.byteLength(f.soundPath)+200]^=1;
    if(kind==='overlap'){
      const central=bytes.readUInt32LE(bytes.length-6),second=central+46+Buffer.byteLength(f.soundPath);bytes.writeUInt32LE(0,second+42);
    }
    f.receipt.sha256=sha256(bytes);target.sha256=f.receipt.sha256;const path=resolve(dir,kind+'.zip');await writeFile(path,bytes);
    await assert.rejects(verifyRuntimeAudioFile(path,target,f.receipt,f.providers));
  }
});

function delivery(f){
  const audit=f.verify(),{target}=f.finish(),now=new Date().toISOString();
  const closure={closureSha256:sha256('closure'),sourceSha256:sha256('source'),sourceInputsIndexSha256:sha256('index'),
    targets:[target],receipts:new Map([[target.buildId,f.receipt]])};
  const receipt={schemaVersion:2,closureSha256:closure.closureSha256,sourceSha256:closure.sourceSha256,
    sourceInputsIndexSha256:closure.sourceInputsIndexSha256,verificationStartedAt:now,finishedAt:now,
    assets:[{...target,verifiedAt:now,runtimeAudio:audit}]};
  return{closure,receipt};
}

test('activation accepts exact static audio proof and historical no-audio receipt',()=>{
  const f=fixture(),{closure,receipt}=delivery(f);validateDeliveryReceipt(receipt,closure);
  delete f.receipt.build.patches[AUDIO_PATCH];delete receipt.assets[0].runtimeAudio;validateDeliveryReceipt(receipt,closure);
});
for(const [name,change] of [
  ['absent audit',a=>delete a.runtimeAudio],['copied other archive',a=>a.runtimeAudio.archiveSha256=sha256('other')],
  ['copied other build',a=>a.runtimeAudio.buildId='other'],['wrong SDK',a=>a.runtimeAudio.sdkProviderSha256=sha256('other')],
  ['wrong layout',a=>a.runtimeAudio.soundPath='jre/lib/aarch64/libjsound.so'],['device claim',a=>a.runtimeAudio.qualification='device-tested'],
  ['capture claim',a=>a.runtimeAudio.capture='implemented'],['incomplete imports',a=>a.runtimeAudio.requiredSymbols.pop()],
  ['duplicate imports',a=>a.runtimeAudio.requiredSymbols.push(a.runtimeAudio.requiredSymbols[0])],
  ['new arbitrary claim',a=>a.runtimeAudio.devicePlaybackQualified=true],['invalid count',a=>a.runtimeAudio.fileCount=0]
])test('activation rejects audio receipt '+name,()=>{const {closure,receipt}=delivery(fixture());change(receipt.assets[0]);assert.throws(()=>validateDeliveryReceipt(receipt,closure));});

for(const [name,change] of [
  ['absent host ABI',a=>delete a.embeddedCallbacks],['wrong host ABI',a=>a.embeddedCallbacks='signed-host-data-abi-v2-required'],
  ['old playback marker claim',a=>a.backend='ohos-daudio-playback-v1'],['capture declared absent',a=>a.capture='not-implemented'],
  ['missing mandatory capturer',a=>a.requiredSymbols=a.requiredSymbols.filter(n=>n!==REQUIRED_CAPTURE_SYMBOLS[0])],
  ['unqualified host claimed verified',a=>a.hostCallbacksQualified=true]
])test('activation rejects duplex receipt '+name,()=>{
  const {closure,receipt}=delivery(fixture({duplex:true}));change(receipt.assets[0].runtimeAudio);
  assert.throws(()=>validateDeliveryReceipt(receipt,closure));
});

for(const [name,change] of [
  ['old host ABI',a=>a.embeddedCallbacks='signed-host-data-abi-v1-required'],
  ['old backend claim',a=>a.backend='ohos-daudio-duplex-v2'],
  ['missing presentation timestamp',a=>a.requiredSymbols=a.requiredSymbols.filter(n=>n!=='OH_AudioRenderer_GetAudioTimestampInfo')]
])test('activation rejects timeline V3 receipt '+name,()=>{
  const {closure,receipt}=delivery(fixture({timeline:true}));change(receipt.assets[0].runtimeAudio);
  assert.throws(()=>validateDeliveryReceipt(receipt,closure));
});
