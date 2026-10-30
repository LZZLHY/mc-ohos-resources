/** 0026 MIDI独立发布门：只消费已界限检查的实际ELF和本次冻结SDK字节事实。
 * 不调用主工程Python，不执行目标代码，不把静态实现身份授予设备/外设收发资格。
 * 外层继续负责ZIP全量身份、收据/源码输入、实际SDK摘要/SONAME与所有DSO的归属。
 */
import {isDeepStrictEqual as same} from 'node:util';

const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const HASH=/^[a-f0-9]{64}$/;
export const MIDI_PATCH='0026-ohos-javasound-native-midi.patch';
export const MIDI_MARKER=Buffer.from('AMCL_MIDI_OHOS_API24_OPTIONAL_V1\0');
export const MIDI_SDK_PATH='sysroot/usr/lib/aarch64-linux-ohos/libohmidi.so';
export const MIDI_CAPABILITY='ohmidi-api24-optional-midi1';
export const REQUIRED_MIDI_SYMBOLS=Object.freeze([
  'OH_MIDIClient_Create','OH_MIDIClient_Destroy','OH_MIDIClient_GetDeviceCount',
  'OH_MIDIClient_GetDeviceInfos','OH_MIDIClient_GetPortCount','OH_MIDIClient_GetPortInfos',
  'OH_MIDIClient_OpenDevice','OH_MIDIClient_CloseDevice','OH_MIDIDevice_OpenInputPort',
  'OH_MIDIDevice_OpenOutputPort','OH_MIDIDevice_CloseInputPort','OH_MIDIDevice_CloseOutputPort',
  'OH_MIDIDevice_Send','OH_MIDIDevice_FlushOutputPort'
].sort());
export const REQUIRED_MIDI_JNI_EXPORTS=Object.freeze([
  'Java_com_sun_media_sound_MidiInDeviceProvider_nGetDeviceInfos',
  'Java_com_sun_media_sound_MidiOutDeviceProvider_nGetDeviceInfos',
  'Java_com_sun_media_sound_MidiInDevice_nOpen','Java_com_sun_media_sound_MidiInDevice_nClose',
  'Java_com_sun_media_sound_MidiInDevice_nStart','Java_com_sun_media_sound_MidiInDevice_nStop',
  'Java_com_sun_media_sound_MidiInDevice_nGetMessages','Java_com_sun_media_sound_MidiInDevice_nGetTimeStamp',
  'Java_com_sun_media_sound_MidiOutDevice_nOpen','Java_com_sun_media_sound_MidiOutDevice_nClose',
  'Java_com_sun_media_sound_MidiOutDevice_nSendShortMessage','Java_com_sun_media_sound_MidiOutDevice_nSendLongMessage',
  'Java_com_sun_media_sound_MidiOutDevice_nGetTimeStamp','JNI_OnUnload','AMCL_Midi_BackendIdentity'
].sort());
export const REQUIRED_MIDI_FUNCTION_EXPORTS=Object.freeze(REQUIRED_MIDI_JNI_EXPORTS.filter(name=>name!=='AMCL_Midi_BackendIdentity'));

/** patch身份由原始收据识别，不能由产品能力字符串自行宣布“已实现”。 */
export const requiresRuntimeMidi=receipt=>Object.hasOwn(receipt?.build?.patches??{},MIDI_PATCH);

/** 源/SDK冻结身份共同确定唯一静态合同；供实际ELF门和激活收据复核共用。
 * 这里只构造预期值，不能单独用它授予实现或设备资格。
 */
function midiContract(receipt){
  assert(requiresRuntimeMidi(receipt)&&HASH.test(receipt.build.patches[MIDI_PATCH]),'MIDI0026 patch identity is not a SHA256');
  const expectedHash=receipt.build.inputClosure?.nativeSdk?.files?.[MIDI_SDK_PATH];
  assert(HASH.test(expectedHash),'MIDI SDK frozen original input is absent or invalid');
  return {backend:'ohos-midi1-ump-v1',minimumApi:20,providerMinimumApi:24,binding:'optional-dlopen',
    qualification:'implemented-requires-device-test',embeddedCallbacks:'signed-host-midi-abi-v1-required',
    provider:'libohmidi.so',providerSha256:expectedHash,requiredSymbols:[...REQUIRED_MIDI_SYMBOLS]};
}

/** SDK facts/sha必须由外层从同一实物读取，sha还须命中本轮冻结SDK原输入。
 * 动态名字只接受只读PT_LOAD中的NUL字符串事实；新API保持dlopen可选，不产生
 * DT_NEEDED或直接OH_MIDI导入，不把API24 provider误当整个产品minimumApi24。
 */
export function verifyRuntimeMidiFacts({facts,sdkFacts,sdkSha256,receipt,declaredBackend,capability}){
  assert(facts&&Array.isArray(facts.needed)&&Array.isArray(facts.imports)&&Array.isArray(facts.resolvableExports),
    'MIDI actual ELF facts required');
  const markers=facts.ohosMidiMarkers??[],dynamic=facts.ohosMidiDynamicSymbols??[],required=requiresRuntimeMidi(receipt);
  const imports=facts.imports.filter(name=>name.startsWith('OH_MIDI'));
  const actual=markers.length>0||dynamic.length>0||imports.length>0||facts.needed.includes('libohmidi.so')||
    ['Java_com_sun_media_sound_MidiInDeviceProvider_nGetDeviceInfos','Java_com_sun_media_sound_MidiOutDeviceProvider_nGetDeviceInfos']
      .some(name=>facts.resolvableExports.includes(name));
  if(!required){
    assert(!actual&&declaredBackend===undefined&&capability==='unavailable-safe',
      'MIDI capability/implementation has no frozen0026 source identity');
    return null;
  }
  assert(HASH.test(receipt.build.patches[MIDI_PATCH]),'MIDI0026 patch identity is not a SHA256');
  const marker={type:1,flags:2,bytes:MIDI_MARKER.length,valueHex:MIDI_MARKER.toString('hex'),mappedReadonly:true};
  assert(same(markers,[marker]),'MIDI exact readonly marker missing or invalid');
  assert(!facts.needed.includes('libohmidi.so')&&imports.length===0,'MIDI optional binding has direct imports or DT_NEEDED');
  assert(Array.isArray(dynamic)&&REQUIRED_MIDI_SYMBOLS.every(name=>dynamic.includes(name)),
    'MIDI readonly dynamic symbol names are incomplete');
  assert(REQUIRED_MIDI_JNI_EXPORTS.every(name=>facts.resolvableExports.includes(name)),
    'MIDI JNI/lifecycle/identity export is not resolvable');
  assert(Array.isArray(facts.resolvableFunctionExports)&&REQUIRED_MIDI_FUNCTION_EXPORTS.every(name=>facts.resolvableFunctionExports.includes(name)),
    'MIDI JNI/lifecycle definition is not an executable function');
  const expectedHash=receipt.build.inputClosure?.nativeSdk?.files?.[MIDI_SDK_PATH];
  assert(HASH.test(expectedHash)&&sdkSha256===expectedHash,'MIDI SDK bytes do not match frozen original input');
  assert(sdkFacts?.soname==='libohmidi.so'&&Array.isArray(sdkFacts.resolvableExports)&&Array.isArray(sdkFacts.resolvableFunctionExports),
    'MIDI SDK provider SONAME/function facts invalid');
  assert(REQUIRED_MIDI_SYMBOLS.every(name=>sdkFacts.resolvableExports.includes(name)&&sdkFacts.resolvableFunctionExports.includes(name)),
    'MIDI SDK provider cannot resolve every required executable function');
  const backend=midiContract(receipt);
  assert(same(declaredBackend,backend),'MIDI declared backend differs from actual ELF/SDK proof');
  assert(capability===MIDI_CAPABILITY,'MIDI capability overclaims or omits optional-provider status');
  return backend;
}

/** 激活阶段只复核外层已绑定同一完整ZIP/manifest/source的审计结果。不能凭收据
 * 重建或伪造ELF facts，也不能把静态implemented状态升级成外设已测试。
 * 没有0026的旧包允许缺少/空midi字段，旧审核合同保持原样。
 */
export function validateRuntimeMidiAudit(audit,receipt){
  assert(audit&&typeof audit==='object','MIDI audit object required');
  if(!requiresRuntimeMidi(receipt)){
    assert(audit.midi===undefined||audit.midi===null,'MIDI audit has no frozen0026 source identity');
    return audit;
  }
  assert(same(audit.midi,midiContract(receipt)),'MIDI audit backend differs from frozen source/SDK contract');
  return audit;
}
