/** 独立JS发布门的逐字段/逐动态名/逐函数正负控；实际ELF解析另由集成输入检验。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {MIDI_PATCH,MIDI_MARKER,MIDI_SDK_PATH,MIDI_CAPABILITY,REQUIRED_MIDI_SYMBOLS,
  REQUIRED_MIDI_JNI_EXPORTS,REQUIRED_MIDI_FUNCTION_EXPORTS,requiresRuntimeMidi,verifyRuntimeMidiFacts,validateRuntimeMidiAudit} from '../tools/runtime-midi.mjs';
const hash='a'.repeat(64),patchHash='b'.repeat(64);
function fixture(){
  return {facts:{needed:['libc.so'],imports:['dlopen','dlsym'],strongImports:['dlopen','dlsym'],weakImports:[],
    resolvableExports:[...REQUIRED_MIDI_JNI_EXPORTS],resolvableFunctionExports:[...REQUIRED_MIDI_FUNCTION_EXPORTS],
    ohosMidiDynamicSymbols:[...REQUIRED_MIDI_SYMBOLS],
    ohosMidiMarkers:[{type:1,flags:2,bytes:MIDI_MARKER.length,valueHex:MIDI_MARKER.toString('hex'),mappedReadonly:true}]},
    sdkFacts:{soname:'libohmidi.so',resolvableExports:[...REQUIRED_MIDI_SYMBOLS],resolvableFunctionExports:[...REQUIRED_MIDI_SYMBOLS]},
    sdkSha256:hash,receipt:{build:{patches:{[MIDI_PATCH]:patchHash},inputClosure:{nativeSdk:{files:{[MIDI_SDK_PATH]:hash}}}}},
    declaredBackend:{backend:'ohos-midi1-ump-v1',minimumApi:20,providerMinimumApi:24,binding:'optional-dlopen',
      qualification:'implemented-requires-device-test',embeddedCallbacks:'signed-host-midi-abi-v1-required',
      provider:'libohmidi.so',providerSha256:hash,requiredSymbols:[...REQUIRED_MIDI_SYMBOLS]},capability:MIDI_CAPABILITY};
}
test('MIDI exact optional API20/API24 contract succeeds without mutation',()=>{
  const value=fixture(),before=structuredClone(value);
  assert(requiresRuntimeMidi(value.receipt));assert.deepEqual(verifyRuntimeMidiFacts(value),value.declaredBackend);assert.deepEqual(value,before);
  assert.equal(REQUIRED_MIDI_SYMBOLS.length,14);assert.equal(REQUIRED_MIDI_JNI_EXPORTS.length,15);assert.equal(REQUIRED_MIDI_FUNCTION_EXPORTS.length,14);
});
test('old JNI names and unrelated audio do not invent native MIDI',()=>{
  const value={facts:{needed:['libohaudio.so'],imports:['OH_AudioRenderer_Start'],resolvableExports:['Java_com_sun_media_sound_MidiInDevice_nOpen']},
    receipt:{build:{patches:{}}},capability:'unavailable-safe'};
  assert.equal(requiresRuntimeMidi(value.receipt),false);assert.equal(verifyRuntimeMidiFacts(value),null);
});
const reject=(name,change,pattern)=>test('MIDI rejects '+name,()=>{const value=fixture();change(value);assert.throws(()=>verifyRuntimeMidiFacts(value),pattern);});
for(const symbol of REQUIRED_MIDI_SYMBOLS){
  reject('missing readonly dynamic '+symbol,x=>x.facts.ohosMidiDynamicSymbols=x.facts.ohosMidiDynamicSymbols.filter(n=>n!==symbol),/dynamic symbol/);
  reject('missing SDK '+symbol,x=>x.sdkFacts.resolvableExports=x.sdkFacts.resolvableExports.filter(n=>n!==symbol),/required executable/);
  reject('non-executable SDK '+symbol,x=>x.sdkFacts.resolvableFunctionExports=x.sdkFacts.resolvableFunctionExports.filter(n=>n!==symbol),/required executable/);
}
for(const symbol of REQUIRED_MIDI_JNI_EXPORTS)
  reject('hidden/undefined export '+symbol,x=>x.facts.resolvableExports=x.facts.resolvableExports.filter(n=>n!==symbol),/export/);
for(const symbol of REQUIRED_MIDI_FUNCTION_EXPORTS)
  reject('non-function JNI '+symbol,x=>x.facts.resolvableFunctionExports=x.facts.resolvableFunctionExports.filter(n=>n!==symbol),/executable function/);
for(const [key,value] of [['type',8],['type',true],['flags',3],['bytes',0],['mappedReadonly',false],['valueHex','00']])
  reject('marker '+key+'='+value,x=>x.facts.ohosMidiMarkers[0][key]=value,/marker/);
reject('marker extra assertion',x=>x.facts.ohosMidiMarkers[0].deviceTested=true,/marker/);
reject('duplicate marker',x=>x.facts.ohosMidiMarkers.push({...x.facts.ohosMidiMarkers[0]}),/marker/);
reject('missing marker',x=>delete x.facts.ohosMidiMarkers,/marker/);
reject('hard dependency',x=>x.facts.needed.push('libohmidi.so'),/optional binding/);
for(const strength of ['strong','weak'])
  reject(strength+' new-API import',x=>{x.facts.imports.push('OH_MIDIClient_Create');x.facts[strength+'Imports'].push('OH_MIDIClient_Create');},/optional binding/);
reject('unrecorded0026',x=>delete x.receipt.build.patches[MIDI_PATCH],/source identity/);
reject('malformed patch SHA',x=>x.receipt.build.patches[MIDI_PATCH]='yes',/SHA256/);
reject('missing frozen SDK',x=>delete x.receipt.build.inputClosure.nativeSdk.files[MIDI_SDK_PATH],/frozen original/);
reject('different SDK actual bytes',x=>x.sdkSha256='c'.repeat(64),/frozen original/);
reject('wrong SDK SONAME',x=>x.sdkFacts.soname='other.so',/SONAME/);
reject('missing SDK actual facts',x=>delete x.sdkFacts,/SONAME/);
for(const [key,value] of [['backend','other'],['minimumApi',24],['providerMinimumApi',20],['binding','linked'],
  ['qualification','device-tested'],['embeddedCallbacks','anonymous-jdk'],['provider','other.so'],['providerSha256','c'.repeat(64)]])
  reject('declared '+key,x=>x.declaredBackend[key]=value,/declared backend/);
reject('backend extra claim',x=>x.declaredBackend.transportVerified=true,/declared backend/);
reject('backend missing symbol',x=>x.declaredBackend.requiredSymbols.pop(),/declared backend/);
reject('backend reordered symbols',x=>x.declaredBackend.requiredSymbols.reverse(),/declared backend/);
reject('backend declaration absent',x=>delete x.declaredBackend,/declared backend/);
for(const value of ['unavailable-safe','implemented','device-tested',undefined])
  reject('capability '+value,x=>x.capability=value,/capability/);
test('old source cannot claim MIDI by only adding a capability/backend string',()=>{
  const value=fixture();value.receipt.build.patches={};value.facts={needed:[],imports:[],resolvableExports:[]};
  assert.throws(()=>verifyRuntimeMidiFacts(value),/source identity/);
});
test('activation preserves exact audit without inventing ELF facts or mutating outer binding',()=>{
  const value=fixture(),audit={archiveSha256:'c'.repeat(64),midi:verifyRuntimeMidiFacts(value)},before=structuredClone(audit);
  assert.equal(validateRuntimeMidiAudit(audit,value.receipt),audit);assert.deepEqual(audit,before);
});
test('activation keeps an old absent/null MIDI field and rejects a new implementation claim',()=>{
  const receipt={build:{patches:{}}};
  assert.deepEqual(validateRuntimeMidiAudit({},receipt),{});
  assert.deepEqual(validateRuntimeMidiAudit({midi:null},receipt),{midi:null});
  assert.throws(()=>validateRuntimeMidiAudit({midi:fixture().declaredBackend},receipt),/source identity/);
});
const rejectAudit=(name,change,pattern)=>test('MIDI activation rejects '+name,()=>{
  const value=fixture(),audit={midi:structuredClone(value.declaredBackend)};change(audit,value.receipt);
  assert.throws(()=>validateRuntimeMidiAudit(audit,value.receipt),pattern);
});
rejectAudit('invalid patch SHA',(a,r)=>r.build.patches[MIDI_PATCH]='0',/SHA256/);
rejectAudit('missing frozen SDK',(a,r)=>delete r.build.inputClosure.nativeSdk.files[MIDI_SDK_PATH],/frozen/);
rejectAudit('changed original SDK',(a,r)=>r.build.inputClosure.nativeSdk.files[MIDI_SDK_PATH]='c'.repeat(64),/audit backend/);
rejectAudit('missing MIDI audit',a=>delete a.midi,/audit backend/);
for(const [key,value] of [['backend','other'],['minimumApi',24],['providerMinimumApi',20],['binding','linked'],
  ['qualification','device-tested'],['embeddedCallbacks','anonymous-jdk'],['provider','other.so'],['providerSha256','c'.repeat(64)]])
  rejectAudit('backend '+key,a=>a.midi[key]=value,/audit backend/);
rejectAudit('extra transport claim',a=>a.midi.transportVerified=true,/audit backend/);
rejectAudit('missing required function',a=>a.midi.requiredSymbols.pop(),/audit backend/);
rejectAudit('reordered required functions',a=>a.midi.requiredSymbols.reverse(),/audit backend/);
