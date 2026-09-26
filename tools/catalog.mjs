#!/usr/bin/env node
/**
 * 单一目录源的校验/签名工具。私钥由显式仓外路径读取，绝不写入输出目录或日志。
 * generate 只生成待发布文件；publish.mjs 在上传/回读资产后才允许提交成品目录。
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import { validateCatalog, validateTransition, signCatalog, verifyEnvelope } from './protocol.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf('--'+name); return i < 0 ? undefined : args[i+1]; };
const required = name => { const v = option(name); if (!v) throw new Error('--'+name+' required'); return v; };
const json = async path => JSON.parse(await readFile(path,'utf8'));
const output = async (path,value,exclusive=false) => { await mkdir(dirname(path),{recursive:true}); await writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:exclusive?'wx':'w'}); };

/** 源中每条 runtime 保存两个推荐，生成时投影为一个通道，包身份不复制维护。 */
export function projectCatalog(source,channel) {
  const c = { schemaVersion:1,catalogRevision:source.catalogRevision,channel,issuedAt:source.issuedAt,expiresAt:source.expiresAt,
    runtimes:source.runtimes.map(r => { const {recommendations,...identity}=r; return {...identity,...recommendations[channel]}; }), builds:source.builds };
  validateCatalog(c,channel);
  if (channel === 'stable') for (const r of c.runtimes) {
    const b = c.builds.find(b => b.id === r.recommendedBuildId);
    if (b.provenance.kind !== 'legacy' && b.validationLevel !== 'device-matrix-tested') throw new Error('stable promotion requires device matrix: '+b.id);
  }
  return c;
}

async function main() {
  const command = args[0] || 'check';
  if (command === 'keygen') {
    const privatePath = resolve(required('key'));
    if (privatePath.startsWith(root + '/') || privatePath.startsWith(root + '\\')) throw new Error('private key must be outside public repository');
    const pair = generateKeyPairSync('ec',{namedCurve:'prime256v1'});
    await mkdir(dirname(privatePath),{recursive:true});
    // wx 防止误覆盖正在使用的签名密钥；公钥轮换需显式协议/客户端支持。
    await writeFile(privatePath,pair.privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});
    await output(resolve(required('public')),{schemaVersion:1,keys:[{kid:required('kid'),algorithm:'ES256',spki:pair.publicKey.export({type:'spki',format:'der'}).toString('base64')}]},true);
    console.log('Created separate runtime signing key and public key set.'); return;
  }
  if (command === 'verify') {
    const c = verifyEnvelope(await readFile(required('input'),'utf8'),await json(option('keys') || resolve(root,'catalog/trusted-keys.json')),option('channel'));
    console.log(`${c.channel} revision ${c.catalogRevision}: verified`); return;
  }
  const source = await json(option('source') || resolve(root,'catalog/source.json'));
  const catalogs = ['stable','preview'].map(channel => projectCatalog(source,channel));
  if (command === 'check') { console.log('Catalog source: both channels valid'); return; }
  if (command !== 'generate') throw new Error('Unknown command');
  const key = await readFile(required('key'),'utf8');
  const keys = await json(option('keys') || resolve(root,'catalog/trusted-keys.json'));
  const out = resolve(required('out'));
  for (const c of catalogs) {
    const previous = option('previous');
    if (previous) {
      const path = resolve(previous,c.channel+'.json');
      await access(path);
      validateTransition(verifyEnvelope(await readFile(path,'utf8'),keys,c.channel,Date.now(),true),c);
    }
    const envelope = signCatalog(c,key,required('kid'));
    verifyEnvelope(JSON.stringify(envelope),keys,c.channel);
    // 不覆盖已有候选文件，避免把同代次不同字节误认为原发布结果。
    await output(resolve(out,c.channel+'.json'),envelope,true);
    await output(resolve(out,c.channel+'.payload.json'),c,true);
  }
  console.log('Generated and verified signed catalog candidates at '+out);
}
// 测试只导入投影函数时不运行 CLI，不依赖当前工作目录。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode=1; });
