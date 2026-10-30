/** 独立Ports门的逐字段/逐符号正负控；实际ELF解析仍在runtime-audio集成测试验证。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PORTS_PATCH,PORTS_MARKER,PORTS_SDK_PATH,PORTS_CAPABILITY,REQUIRED_PORTS_SYMBOLS,
  REQUIRED_PORTS_JNI,requiresRuntimePorts,verifyRuntimePortsFacts,validateRuntimePortsAudit} from '../tools/runtime-ports.mjs';

const sha='a'.repeat(64),patchSha='b'.repeat(64);
function fixture(){
  return {facts:{needed:['libc.so','libohaudio.so'],imports:[...REQUIRED_PORTS_SYMBOLS],
      strongImports:[...REQUIRED_PORTS_SYMBOLS],weakImports:[],exports:[...REQUIRED_PORTS_JNI],resolvableExports:[...REQUIRED_PORTS_JNI],
      ohosPortsMarkers:[{type:1,flags:2,bytes:PORTS_MARKER.length,valueHex:PORTS_MARKER.toString('hex'),mappedReadonly:true}]},
    sdkFacts:{soname:'libohaudio.so',resolvableExports:[...REQUIRED_PORTS_SYMBOLS]},sdkSha256:sha,
    receipt:{build:{patches:{[PORTS_PATCH]:patchSha},inputClosure:{nativeSdk:{files:{[PORTS_SDK_PATH]:sha}}}}},
    declaredBackend:{backend:'ohos-device-ports-v1',minimumApi:20,qualification:'implemented-requires-device-test',
      systemControlWrites:'not-public-api',controlsExposed:false,provider:'libohaudio.so',providerSha256:sha,requiredSymbols:[...REQUIRED_PORTS_SYMBOLS]},
    capability:PORTS_CAPABILITY};
}
test('Ports exact readonly/API/JNI/SDK/source contract succeeds without mutation',()=>{
  const value=fixture(),before=structuredClone(value);
  assert.equal(requiresRuntimePorts(value.receipt),true);
  assert.deepEqual(verifyRuntimePortsFacts(value),value.declaredBackend);assert.deepEqual(value,before);
  assert.equal(PORTS_MARKER.length,33);assert.equal(REQUIRED_PORTS_SYMBOLS.length,8);assert.equal(REQUIRED_PORTS_JNI.length,15);
});
test('PCM shared routing and non-OHOS generation alone preserve old unavailable-safe',()=>{
  const value={facts:{needed:['libohaudio.so'],imports:['OH_AudioManager_GetAudioRoutingManager','OH_AudioRoutingManager_ReleaseDevices'],
    strongImports:[],resolvableExports:['Java_com_sun_media_sound_PortMixerProvider_nGetGeneration']},receipt:{build:{patches:{}}},capability:'unavailable-safe'};
  assert.equal(requiresRuntimePorts(value.receipt),false);assert.equal(verifyRuntimePortsFacts(value),null);
});
const reject=(name,change,pattern)=>test('Ports rejects '+name,()=>{const value=fixture();change(value);assert.throws(()=>verifyRuntimePortsFacts(value),pattern);});
for(const symbol of REQUIRED_PORTS_SYMBOLS){
  reject('weak-only '+symbol,x=>{x.facts.strongImports=x.facts.strongImports.filter(n=>n!==symbol);x.facts.weakImports.push(symbol);},/strong/);
  reject('SDK missing '+symbol,x=>{x.sdkFacts.resolvableExports=x.sdkFacts.resolvableExports.filter(n=>n!==symbol);},/supply/);
}
for(const symbol of REQUIRED_PORTS_JNI)
  reject('hidden/undefined '+symbol,x=>{x.facts.resolvableExports=x.facts.resolvableExports.filter(n=>n!==symbol);},/JNI/);
for(const [key,value] of [['type',8],['flags',3],['flags',true],['bytes',32],['mappedReadonly',false],['valueHex','00']])
  reject('marker '+key+'='+value,x=>{x.facts.ohosPortsMarkers[0][key]=value;},/marker/);
reject('duplicate markers',x=>x.facts.ohosPortsMarkers.push({...x.facts.ohosPortsMarkers[0]}),/marker/);
reject('missing marker',x=>delete x.facts.ohosPortsMarkers,/marker/);
reject('missing dependency',x=>x.facts.needed=['libc.so'],/dependency/);
reject('missing source patch',x=>delete x.receipt.build.patches[PORTS_PATCH],/source identity/);
reject('bad patch SHA',x=>x.receipt.build.patches[PORTS_PATCH]='yes',/SHA256/);
reject('missing frozen SDK input',x=>delete x.receipt.build.inputClosure.nativeSdk.files[PORTS_SDK_PATH],/frozen/);
reject('different actual SDK SHA',x=>x.sdkSha256='c'.repeat(64),/frozen/);
reject('wrong SDK SONAME',x=>x.sdkFacts.soname='other.so',/SONAME/);
reject('missing SDK facts',x=>delete x.sdkFacts,/SONAME/);
reject('invented unknown audio import',x=>x.facts.imports.push('OH_AudioUnknownEntry'),/supply/);
for(const [key,value] of [['backend','other'],['minimumApi',21],['qualification','device-tested'],
  ['systemControlWrites','supported'],['controlsExposed',true],['provider','other.so'],['providerSha256','c'.repeat(64)]])
  reject('declared '+key,x=>{x.declaredBackend[key]=value;},/declared backend/);
reject('backend extra claim',x=>x.declaredBackend.writable=true,/declared backend/);
reject('backend missing symbol',x=>x.declaredBackend.requiredSymbols.pop(),/declared backend/);
reject('backend reordered symbols',x=>x.declaredBackend.requiredSymbols.reverse(),/declared backend/);
reject('missing backend declaration',x=>delete x.declaredBackend,/declared backend/);
for(const value of ['unavailable-safe','implemented','device-tested',undefined])
  reject('capability '+value,x=>{x.capability=value;},/capability/);
test('old source cannot declare only a Ports backend string',()=>{
  const value=fixture();value.receipt.build.patches={};value.facts={needed:[],imports:[],strongImports:[],resolvableExports:[]};
  assert.throws(()=>verifyRuntimePortsFacts(value),/source identity/);
});
test('additional real PCM imports can share the same verified provider',()=>{
  const value=fixture();value.facts.imports.push('OH_AudioRenderer_Start');value.sdkFacts.resolvableExports.push('OH_AudioRenderer_Start');
  assert.deepEqual(verifyRuntimePortsFacts(value).requiredSymbols,REQUIRED_PORTS_SYMBOLS);
});
test('Ports activation consumes only the exact verified backend',()=>{
  const value=fixture(),audit=verifyRuntimePortsFacts(value);
  assert.equal(validateRuntimePortsAudit(audit,value.receipt),audit);
});
for(const [key,value] of [['backend','other'],['minimumApi',21],['qualification','device-tested'],
  ['systemControlWrites','supported'],['controlsExposed',true],['provider','other.so'],['providerSha256','c'.repeat(64)]]){
  test('Ports activation rejects '+key,()=>{
    const x=fixture();x.declaredBackend[key]=value;assert.throws(()=>validateRuntimePortsAudit(x.declaredBackend,x.receipt),/Ports audit/);
  });
}
test('Ports activation rejects missing, null, extra, incomplete and reordered proof',()=>{
  const x=fixture();
  for(const value of [undefined,null,{}, {...x.declaredBackend,deviceTested:true},
    {...x.declaredBackend,requiredSymbols:REQUIRED_PORTS_SYMBOLS.slice(1)},
    {...x.declaredBackend,requiredSymbols:[...REQUIRED_PORTS_SYMBOLS].reverse()}])
    assert.throws(()=>validateRuntimePortsAudit(value,x.receipt),/Ports audit/);
});
test('Ports activation rejects patch/SDK identity mutations',()=>{
  const x=fixture();x.receipt.build.patches[PORTS_PATCH]='not-a-sha';
  assert.throws(()=>validateRuntimePortsAudit(x.declaredBackend,x.receipt),/patch identity/);
  x.receipt.build.patches[PORTS_PATCH]=patchSha;
  x.receipt.build.inputClosure.nativeSdk.files[PORTS_SDK_PATH]='c'.repeat(64);
  assert.throws(()=>validateRuntimePortsAudit(x.declaredBackend,x.receipt),/Ports audit/);
  delete x.receipt.build.inputClosure.nativeSdk.files[PORTS_SDK_PATH];
  assert.throws(()=>validateRuntimePortsAudit(x.declaredBackend,x.receipt),/frozen/);
});
test('old source requires absent activation Ports subrecord',()=>{
  const x=fixture();x.receipt.build.patches={};
  assert.equal(validateRuntimePortsAudit(undefined,x.receipt),undefined);
  assert.throws(()=>validateRuntimePortsAudit(x.declaredBackend,x.receipt),/old runtime/);
});
