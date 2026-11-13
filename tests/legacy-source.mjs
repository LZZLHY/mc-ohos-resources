/** 旧 v1 测试保留真实历史结构；只刷新测试时钟，不改变原件、协议或历史推荐身份。 */
import {readFileSync} from 'node:fs';
const snapshot=JSON.parse(readFileSync(new URL('./fixtures/source-v1.json',import.meta.url),'utf8'));
// 协议仅接受秒精度 UTC；测试时钟同样遵守生产格式，不放宽验证器来容纳毫秒。
const now=Date.now(),utc=value=>new Date(value).toISOString().replace(/\.\d{3}Z$/,'Z');
snapshot.issuedAt=utc(now-3600000);snapshot.expiresAt=utc(now+86400000);
/** 各用例取得独立副本，故意篡改的负控不能污染同进程后续场景。 */
export function legacySource(){return structuredClone(snapshot);}
