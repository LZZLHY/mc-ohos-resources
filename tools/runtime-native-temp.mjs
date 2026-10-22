/** 0030/0031的独立静态发布门：消费既有有界ELF读取器的事实，不执行目标指令。
 * 只证明来源、选中libjvm和只读合同相符；不会据此授予目标共享PerfData或Attach资格。 */
import {isDeepStrictEqual as same} from 'node:util';
import {sha256} from './protocol.mjs';
const assert=(ok,message)=>{if(!ok)throw Error(message);};
const HASH=/^[a-f0-9]{64}$/;
export const NATIVE_TEMP_PATCH='0030-ohos-native-temp-contract.patch';
export const PERFDATA_UID_PATCH='0031-ohos-perfdata-uid-identity.patch';
export const NATIVE_TEMP_MARKER=Buffer.from('AMCL_OHOS_NATIVE_TMPDIR_V1\0');
export const requiresRuntimeNativeTemp=receipt=>[NATIVE_TEMP_PATCH,PERFDATA_UID_PATCH]
  .some(name=>Object.hasOwn(receipt?.build?.patches??{},name));

/** 成对的冻结patch摘要绑定同一来源；旧来源无此合同，不对历史资格补写新能力。 */
function sourceContract(receipt){
  const patches=receipt?.build?.patches??{},major=String(receipt?.build?.major);
  assert(['8','17','21','25'].includes(major),'native temp unknown runtime major');
  assert([NATIVE_TEMP_PATCH,PERFDATA_UID_PATCH].every(name=>typeof patches[name]==='string'&&HASH.test(patches[name])),
    'native temp requires paired frozen0030/0031 source identities');
  assert([NATIVE_TEMP_PATCH,PERFDATA_UID_PATCH].every(name=>
    receipt.build.inputClosure?.files?.['prebuilt/jdk/'+major+'/patches/'+name]===patches[name]),
    'native temp patch identities differ from complete frozen source inputs');
  return{contract:'ohos-native-temp-uid-v1',jvmPath:(major==='8'?'jre/lib/aarch64/':'lib/')+'server/libjvm.so',
    sourcePatches:{[NATIVE_TEMP_PATCH]:patches[NATIVE_TEMP_PATCH],[PERFDATA_UID_PATCH]:patches[PERFDATA_UID_PATCH]},
    qualification:'static-source-and-readonly-marker-only'};
}

/** 输入libraries和files都由同一ZIP读取器产生；目录归属、正文SHA及marker同时核验。 */
export function verifyRuntimeNativeTempFacts({libraries,files,receipt}){
  const major=String(receipt?.build?.major),path=(major==='8'?'jre/lib/aarch64/':'lib/')+'server/libjvm.so';
  const seen=[...libraries].filter(([,facts])=>facts.ohosNativeTempMarkers?.length);
  const required=requiresRuntimeNativeTemp(receipt);
  if(!required&&!seen.length)return null;
  const contract=sourceContract(receipt);
  assert(seen.length===1&&seen[0][0]===path&&libraries.has(path),'native temp marker outside selected libjvm or absent');
  const markers=libraries.get(path).ohosNativeTempMarkers;
  assert(Array.isArray(markers)&&markers.length===1,'native temp requires one actual readonly marker');
  const marker=markers[0];
  assert(marker&&marker.type===1&&[2,0x200002].includes(marker.flags)&&marker.bytes===NATIVE_TEMP_MARKER.length&&
    marker.valueHex===NATIVE_TEMP_MARKER.toString('hex')&&marker.mappedReadonly===true,
    'native temp marker is not the exact readonly LOAD contract');
  const bytes=files.get(path);assert(Buffer.isBuffer(bytes),'native temp actual libjvm bytes absent');
  return{...contract,jvmSha256:sha256(bytes),markerSectionFlags:marker.flags};
}

/** 完整ZIP回验的聚合audit已经绑定归档/内层manifest摘要；激活再核精确来源和静态范围。 */
export function validateRuntimeNativeTempAudit(audit,receipt){
  if(!requiresRuntimeNativeTemp(receipt)){
    assert(audit===undefined,'historical runtime must not gain a native temp audit');return audit;
  }
  const expected=sourceContract(receipt);
  assert(audit&&HASH.test(audit.jvmSha256)&&[2,0x200002].includes(audit.markerSectionFlags)&&
    same(audit,{...expected,jvmSha256:audit.jvmSha256,markerSectionFlags:audit.markerSectionFlags}),
    'missing or invalid native temp static audit');
  return audit;
}
