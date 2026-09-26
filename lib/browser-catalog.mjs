/** 浏览器端消费同一 JWS 字节。WebCrypto 的 ES256 使用 P1363，不能套用 ArkTS 的 DER 适配。 */
import { validateCatalog } from './catalog-validation.mjs';
export const CATALOG_LIMIT=1024*1024;
function decode(value) {
  if(typeof value!=='string'||!value.length||value.length>CATALOG_LIMIT||!/^[A-Za-z0-9_-]+$/.test(value)||value.length%4===1)throw Error('目录编码无效');
  const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4));
  const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  if(btoa(raw).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')!==value)throw Error('非规范编码');
  return bytes;
}
function utf8(bytes){return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
/** 公钥集由构建工具从发布仓复制，不接受响应中自带的信任根。 */
export async function verifyBrowserCatalog(raw,keys,channel,now=Date.now()) {
  if(typeof raw!=='string'||new TextEncoder().encode(raw).length>CATALOG_LIMIT)throw Error('目录超过大小上限');
  const e=JSON.parse(raw); if(!e||Object.keys(e).sort().join(',')!=='payload,protected,signature')throw Error('JWS 结构无效');
  const h=JSON.parse(utf8(decode(e.protected)));
  if(!h||Object.keys(h).sort().join(',')!=='alg,kid,typ'||h.alg!=='ES256'||h.typ!=='amcl-runtime-catalog+jws')throw Error('目录签名类型无效');
  const trusted=keys.keys.find(k=>k.kid===h.kid&&k.algorithm==='ES256');if(!trusted)throw Error('目录签名密钥不受信任');
  const key=await crypto.subtle.importKey('spki',Uint8Array.from(atob(trusted.spki),x=>x.charCodeAt(0)),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  const signature=decode(e.signature);
  if(signature.length!==64||!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,signature,new TextEncoder().encode(e.protected+'.'+e.payload)))throw Error('目录签名不匹配');
  const c=validateCatalog(JSON.parse(utf8(decode(e.payload))),channel);
  if(Date.parse(c.issuedAt)>now+300000||Date.parse(c.expiresAt)<=now)throw Error('目录有效期异常');
  return c;
}
/** 在流接收过程中限制字节数，避免先分配整个恶意响应再检查长度。 */
export async function fetchBrowserCatalog(url,keys,channel,signal) {
  const response=await fetch(url,{cache:'no-cache',signal});
  if(!response.ok||!response.body)throw Error('目录暂时不可用（HTTP '+response.status+'）');
  const reader=response.body.getReader(),chunks=[];let total=0;
  try {
    while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>CATALOG_LIMIT)throw Error('目录响应过大');chunks.push(value);}
  } finally { await reader.cancel().catch(()=>{});reader.releaseLock(); }
  const bytes=new Uint8Array(total);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
  return verifyBrowserCatalog(utf8(bytes),keys,channel);
}
