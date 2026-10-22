/** 实际共享ELF读取器→独立来源/marker门；不执行AArch64或赋予目标工具资格。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {sha256} from '../tools/protocol.mjs';
import {audioElfFacts} from '../tools/runtime-audio.mjs';
import {NATIVE_TEMP_PATCH,PERFDATA_UID_PATCH,NATIVE_TEMP_MARKER,requiresRuntimeNativeTemp,
  verifyRuntimeNativeTempFacts,validateRuntimeNativeTempAudit} from '../tools/runtime-native-temp.mjs';

function elf({flags=0x200002,load=4,marker=NATIVE_TEMP_MARKER,addressDelta=0}={}){
  const names=Buffer.from('\0.shstrtab\0.amcl.nativetemp\0'),at=128+names.length,table=at+marker.length;
  const data=Buffer.alloc(table+192);Buffer.from([127,69,76,70,2,1,1]).copy(data);
  data.writeUInt16LE(3,16);data.writeUInt16LE(183,18);data.writeBigUInt64LE(64n,32);data.writeBigUInt64LE(BigInt(table),40);
  data.writeUInt16LE(56,54);data.writeUInt16LE(1,56);data.writeUInt16LE(64,58);data.writeUInt16LE(3,60);data.writeUInt16LE(1,62);
  data.writeUInt32LE(1,64);data.writeUInt32LE(load,68);data.writeBigUInt64LE(BigInt(data.length),96);data.writeBigUInt64LE(BigInt(data.length),104);
  names.copy(data,128);marker.copy(data,at);
  for(const [index,name,type,sectionFlags,address,offset,size] of [[1,1,3,0,0,128,names.length],[2,11,1,flags,at+addressDelta,at,marker.length]]){
    const p=table+index*64;data.writeUInt32LE(name,p);data.writeUInt32LE(type,p+4);data.writeBigUInt64LE(BigInt(sectionFlags),p+8);
    data.writeBigUInt64LE(BigInt(address),p+16);data.writeBigUInt64LE(BigInt(offset),p+24);data.writeBigUInt64LE(BigInt(size),p+32);
  }
  return data;
}
function fixture(major='17',options={}){
  const path=(major==='8'?'jre/lib/aarch64/':'lib/')+'server/libjvm.so',bytes=elf(options);
  const patches={[NATIVE_TEMP_PATCH]:sha256('0030'),[PERFDATA_UID_PATCH]:sha256('0031')};
  const receipt={build:{major,patches,inputClosure:{files:Object.fromEntries(Object.entries(patches).map(([name,hash])=>[
    'prebuilt/jdk/'+major+'/patches/'+name,hash]))}}};
  return{path,bytes,receipt,libraries:new Map([[path,audioElfFacts(bytes)]]),files:new Map([[path,bytes]])};
}
for(const major of ['8','17','21','25'])for(const flags of [2,0x200002])test('native temp exact '+major+' readonly '+flags,()=>{
  const f=fixture(major,{flags}),proof=verifyRuntimeNativeTempFacts(f);
  assert.equal(proof.jvmSha256,sha256(f.bytes));assert.equal(proof.jvmPath,f.path);
  assert.equal(proof.qualification,'static-source-and-readonly-marker-only');
  assert.deepEqual(validateRuntimeNativeTempAudit(proof,f.receipt),proof);
});
test('historical absence retains old audit and refuses marker without source',()=>{
  const f=fixture();f.receipt.build.patches={};assert.equal(requiresRuntimeNativeTemp(f.receipt),false);
  assert.throws(()=>verifyRuntimeNativeTempFacts(f),/paired/);
  f.libraries.get(f.path).ohosNativeTempMarkers=[];
  assert.equal(verifyRuntimeNativeTempFacts(f),null);assert.equal(validateRuntimeNativeTempAudit(undefined,f.receipt),undefined);
});
for(const [name,options] of [['wrong-version',{marker:Buffer.from('AMCL_OHOS_NATIVE_TMPDIR_V2\0')}],
  ['writable-section',{flags:3}],['executable-section',{flags:6}],['writable-load',{load:6}],['wrong-mapping',{addressDelta:64}]])
test('native temp rejects '+name,()=>assert.throws(()=>verifyRuntimeNativeTempFacts(fixture('17',options)),/readonly/));
for(const [name,change] of [
  ['missing0030',f=>delete f.receipt.build.patches[NATIVE_TEMP_PATCH]],
  ['missing0031',f=>delete f.receipt.build.patches[PERFDATA_UID_PATCH]],
  ['wrong-source-sha',f=>f.receipt.build.patches[PERFDATA_UID_PATCH]='invalid'],
  ['missing-frozen-source',f=>f.receipt.build.inputClosure.files={}],
  ['missing-marker',f=>f.libraries.get(f.path).ohosNativeTempMarkers=[]],
  ['duplicate-marker',f=>f.libraries.get(f.path).ohosNativeTempMarkers.push(f.libraries.get(f.path).ohosNativeTempMarkers[0])],
  ['foreign-library',f=>f.libraries.set('lib/other.so',f.libraries.get(f.path))]
])test('native temp rejects '+name,()=>{const f=fixture();change(f);assert.throws(()=>verifyRuntimeNativeTempFacts(f));});
for(const [name,change] of [['missing proof',()=>undefined],['wrong path',p=>({...p,jvmPath:'lib/other.so'})],
  ['device claim',p=>({...p,qualification:'device-tested'})],['new arbitrary claim',p=>({...p,attachQualified:true})],
  ['missing JVM hash',p=>({...p,jvmSha256:undefined})],['writable proof',p=>({...p,markerSectionFlags:3})]])
test('native temp activation rejects '+name,()=>{const f=fixture();assert.throws(()=>validateRuntimeNativeTempAudit(change(verifyRuntimeNativeTempFacts(f)),f.receipt));});
