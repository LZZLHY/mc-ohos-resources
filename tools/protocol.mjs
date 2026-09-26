/**
 * 目录 v1 的发行端契约。只使用 Node 标准库；签名覆盖原始 payload 字节。
 * 校验分为结构、固定身份、单调代次与可信公钥四层。未知 adapter 可以保留，
 * 是否可安装由客户端自己的能力表决定；目录不能携带路径、脚本或 JVM 参数。
 */
import { createHash, createPublicKey, sign, verify } from 'node:crypto';

export const MAX_CATALOG_BYTES = 1024 * 1024;
export const TYPE = 'amcl-runtime-catalog+jws';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
import { validateCatalog, validateTransition, buildIdentity, runtimeIdentity } from '../lib/catalog-validation.mjs';
export { validateCatalog, validateTransition, buildIdentity, runtimeIdentity };
function assert(test, message) { if (!test) throw new Error(message); }
function object(x, name, keys) {
  assert(x !== null && typeof x === 'object' && !Array.isArray(x),name+': expected object');
  assert(Object.keys(x).every(k=>keys.includes(k)),name+': unknown field');
}
function id(x,name) { assert(typeof x==='string' && /^[a-z0-9][a-z0-9._-]{0,95}$/.test(x),name+': invalid id'); }

/** 解码前检查长度与规范编码，拒绝宽松 base64 对无效字符/多余位的容忍。 */
export function decode64(text) {
  assert(typeof text === 'string' && /^[A-Za-z0-9_-]+$/.test(text), 'invalid base64url');
  const bytes = Buffer.from(text, 'base64url');
  assert(bytes.toString('base64url') === text, 'noncanonical base64url'); return bytes;
}
export function signCatalog(catalog, key, kid) {
  validateCatalog(catalog); id(kid,'kid');
  const protectedHeader = Buffer.from(JSON.stringify({ alg:'ES256', typ:TYPE, kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(catalog)).toString('base64url');
  const signature = sign('sha256', Buffer.from(protectedHeader + '.' + payload), { key, dsaEncoding:'ieee-p1363' }).toString('base64url');
  return { protected:protectedHeader, payload, signature };
}

/** 只信任调用者固定公钥集；不能从待验证目录接受 jwk/x5u 或替换算法。 */
export function verifyEnvelope(bytes, keys, channel, now = Date.now(), allowExpired = false) {
  assert(Buffer.byteLength(bytes) <= MAX_CATALOG_BYTES, 'catalog too large');
  const envelope = JSON.parse(bytes);
  object(envelope,'JWS',['protected','payload','signature']);
  const header = JSON.parse(decode64(envelope.protected));
  object(header,'header',['alg','typ','kid']);
  assert(header.alg === 'ES256' && header.typ === TYPE, 'untrusted algorithm/type');
  const trusted = keys.keys.find(k => k.kid === header.kid);
  assert(trusted && trusted.algorithm === 'ES256', 'untrusted key');
  const pub = createPublicKey({key:Buffer.from(trusted.spki,'base64'),format:'der',type:'spki'});
  assert(pub.asymmetricKeyType === 'ec' && pub.asymmetricKeyDetails.namedCurve === 'prime256v1','wrong key curve');
  const signature = decode64(envelope.signature);
  assert(signature.length === 64 && verify('sha256',Buffer.from(envelope.protected+'.'+envelope.payload),{key:pub,dsaEncoding:'ieee-p1363'},signature),'bad signature');
  const catalog = validateCatalog(JSON.parse(decode64(envelope.payload)),channel);
  assert(Date.parse(catalog.issuedAt) <= now + 300000,'catalog issued in future');
  assert(allowExpired || Date.parse(catalog.expiresAt) > now,'catalog expired');
  return catalog;
}
