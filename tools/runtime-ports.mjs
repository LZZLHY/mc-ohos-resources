/** 0027 Ports独立发布门。事实必须来自调用者已界限检查的实际运行ELF和已核SHA的SDK ELF；
 * 本模块不读路径、不执行代码、不导入主工程Python，也不授予目标设备或可写系统音量资格。
 * ZIP全量摘要、内外收据、DSO归属/清单逐字核对仍由runtime-audio的调用层负责。 */
import {isDeepStrictEqual as same} from 'node:util';

const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const HASH=/^[a-f0-9]{64}$/;
export const PORTS_PATCH='0027-ohos-javasound-device-ports.patch';
export const PORTS_MARKER=Buffer.from('AMCL_PORTS_OHOS_API20_DEVICES_V1\0');
export const PORTS_SDK_PATH='sysroot/usr/lib/aarch64-linux-ohos/libohaudio.so';
export const PORTS_CAPABILITY='device-ports-requires-device-test';
export const REQUIRED_PORTS_SYMBOLS=Object.freeze([
  'OH_AudioManager_GetAudioRoutingManager','OH_AudioRoutingManager_GetDevices',
  'OH_AudioRoutingManager_ReleaseDevices','OH_AudioDeviceDescriptor_GetDeviceRole',
  'OH_AudioDeviceDescriptor_GetDeviceType','OH_AudioDeviceDescriptor_GetDeviceId',
  'OH_AudioDeviceDescriptor_GetDeviceName','OH_AudioDeviceDescriptor_GetDeviceAddress'
].sort());
export const REQUIRED_PORTS_JNI=Object.freeze([
  'Java_com_sun_media_sound_PortMixerProvider_nGetNumDevices',
  'Java_com_sun_media_sound_PortMixerProvider_nGetGeneration',
  'Java_com_sun_media_sound_PortMixerProvider_nNewPortMixerInfo',
  'Java_com_sun_media_sound_PortMixerProvider_nNewPortMixerInfoSnapshot',
  'Java_com_sun_media_sound_PortMixer_nOpen','Java_com_sun_media_sound_PortMixer_nOpenSnapshot',
  'Java_com_sun_media_sound_PortMixer_nClose','Java_com_sun_media_sound_PortMixer_nGetPortCount',
  'Java_com_sun_media_sound_PortMixer_nGetPortType','Java_com_sun_media_sound_PortMixer_nGetPortName',
  'Java_com_sun_media_sound_PortMixer_nGetControls','Java_com_sun_media_sound_PortMixer_nControlSetIntValue',
  'Java_com_sun_media_sound_PortMixer_nControlGetIntValue','Java_com_sun_media_sound_PortMixer_nControlSetFloatValue',
  'Java_com_sun_media_sound_PortMixer_nControlGetFloatValue'
].sort());
const SHARED_ROUTING=new Set(['OH_AudioManager_GetAudioRoutingManager','OH_AudioRoutingManager_ReleaseDevices']);
const EXCLUSIVE_SYMBOLS=REQUIRED_PORTS_SYMBOLS.filter(name=>!SHARED_ROUTING.has(name));
const SNAPSHOT_JNI=['Java_com_sun_media_sound_PortMixerProvider_nNewPortMixerInfoSnapshot',
  'Java_com_sun_media_sound_PortMixer_nOpenSnapshot'];

/** 按冻结patch名称识别新合同，不能由发行清单单独声称硬件支持。 */
export const requiresRuntimePorts=receipt=>Object.hasOwn(receipt?.build?.patches??{},PORTS_PATCH);

/** 冻结身份所允许的唯一Backend；仅构造合同，不替代实际ELF校验。 */
function portsBackendForReceipt(receipt){
  assert(requiresRuntimePorts(receipt)&&HASH.test(receipt.build.patches[PORTS_PATCH]),'Ports0027 patch identity is not a SHA256');
  const expectedHash=receipt.build.inputClosure?.nativeSdk?.files?.[PORTS_SDK_PATH];
  assert(HASH.test(expectedHash),'Ports SDK missing from frozen original input');
  return{backend:'ohos-device-ports-v1',minimumApi:20,qualification:'implemented-requires-device-test',
    systemControlWrites:'not-public-api',controlsExposed:false,provider:'libohaudio.so',providerSha256:expectedHash,
    requiredSymbols:[...REQUIRED_PORTS_SYMBOLS]};
}

/** 激活消费同ZIP完整读回所产生的Ports子记录。外层负责归档/manifest/source摘要绑定；
 * 此处只核精确合同和原SDK/patch身份，不制造ELF facts，也不把静态记录提升为设备资格。 */
export function validateRuntimePortsAudit(audit,receipt){
  if(!requiresRuntimePorts(receipt)){
    assert(audit===undefined,'old runtime must not carry a Ports audit claim');
    return audit;
  }
  const expected=portsBackendForReceipt(receipt);
  assert(same(audit,expected),'missing/invalid exact runtime Ports audit');
  return audit;
}

/** 检查一个实际libjsound的Ports部分并返回精确后端合同；旧库返回null。
 * sdkSha256是调用者从供应者真实字节计算的值，不能直接转抄declaredBackend字段；
 * sdkFacts也必须来自相同字节。提供者解析和哈希在上层复用，避免模块循环或重复读大ZIP。
 * PCM共享的routing入口以及非OHOS的nGetGeneration=0兼容符号不虚构Ports能力。
 */
export function verifyRuntimePortsFacts({facts,sdkFacts,sdkSha256,receipt,declaredBackend,capability}){
  assert(facts&&Array.isArray(facts.imports)&&Array.isArray(facts.strongImports)&&
    Array.isArray(facts.resolvableExports)&&Array.isArray(facts.needed),'Ports actual ELF facts required');
  const markers=facts.ohosPortsMarkers??[],required=requiresRuntimePorts(receipt);
  const actual=markers.length>0||EXCLUSIVE_SYMBOLS.some(name=>facts.imports.includes(name))||
    SNAPSHOT_JNI.some(name=>facts.resolvableExports.includes(name));
  if(!required){
    assert(!actual&&declaredBackend===undefined&&capability==='unavailable-safe',
      'Ports capability/implementation has no frozen0027 source identity');
    return null;
  }
  const backend=portsBackendForReceipt(receipt);
  const marker={type:1,flags:2,bytes:PORTS_MARKER.length,valueHex:PORTS_MARKER.toString('hex'),mappedReadonly:true};
  assert(same(markers,[marker])&&facts.needed.includes('libohaudio.so'),'Ports readonly marker/real dependency incomplete');
  assert(REQUIRED_PORTS_SYMBOLS.every(name=>facts.strongImports.includes(name)&&facts.imports.includes(name)),
    'Ports required strong SDK entry point missing');
  assert(REQUIRED_PORTS_JNI.every(name=>facts.resolvableExports.includes(name)),
    'Ports required JNI export is missing or non-resolvable');
  assert(sdkSha256===backend.providerSha256,'Ports SDK bytes do not match frozen original input');
  assert(sdkFacts?.soname==='libohaudio.so'&&Array.isArray(sdkFacts.resolvableExports),
    'Ports SDK provider SONAME/facts invalid');
  assert(facts.imports.filter(name=>name.startsWith('OH_Audio')).every(name=>sdkFacts.resolvableExports.includes(name)),
    'Ports SDK provider does not supply every actual audio import');
  assert(same(declaredBackend,backend),'Ports declared backend differs from actual ELF/SDK proof');
  assert(capability===PORTS_CAPABILITY,'Ports capability overclaims or omits precise device-port status');
  return backend;
}
