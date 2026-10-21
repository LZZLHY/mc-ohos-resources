/**
 * 发行闭包的唯一计算入口。运行 ZIP、来源收据和源码输入 ZIP 三者必须一一对应；
 * assets 与 activate 读取相同规则，不能在上传时检查全部输入、激活时只检查运行包。
 * 本模块不上传、不签名、不写通道，纯验证部分可用小型夹具覆盖失败边界。
 */
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha256} from './protocol.mjs';
import {projectCatalog} from './catalog.mjs';
import {requiresRuntimeAudio,validateRuntimeAudioAudit} from './runtime-audio.mjs';

export const REPOSITORY = 'LZZLHY/mc-ohos-resources';
const HASH = /^[a-f0-9]{64}$/;
const ZIP_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}\.zip$/;
const assert = (ok, message) => { if (!ok) throw new Error(message); };

/** 下载地址同时决定实际上传仓库/批次，拒绝上传固定旧池却核验另一个地址的分叉。 */
export function githubAsset(url, fileName) {
  const parsed = new URL(url);
  const prefix = `/${REPOSITORY}/releases/download/`;
  assert(parsed.origin === 'https://github.com' && !parsed.search && !parsed.hash &&
    !parsed.username && !parsed.password && parsed.pathname.startsWith(prefix), 'invalid release asset URL');
  const parts = parsed.pathname.slice(prefix.length).split('/');
  assert(parts.length === 2 && /^ohos-runtimes(?:-[a-z0-9][a-z0-9._-]{0,80})?$/.test(parts[0]) &&
    parts[1] === fileName && ZIP_NAME.test(fileName), 'release tag/filename mismatch');
  return {repo:REPOSITORY, tag:parts[0]};
}

/** 对每条公开来源收据核对原始摘要及归档/上游身份，不以可编辑 evidence 文案代替。 */
export function validateBuildReceipt(raw, build) {
  assert(HASH.test(build.provenance.manifestSha256) && sha256(raw) === build.provenance.manifestSha256,
    'provenance receipt hash mismatch: '+build.id);
  const receipt = JSON.parse(raw);
  assert(receipt.buildId===undefined || receipt.buildId===build.id, 'provenance buildId mismatch: '+build.id);
  assert(receipt.bytes === build.archive.sizeBytes && receipt.sha256 === build.archive.sha256 &&
    typeof receipt.file === 'string' && receipt.file.split(/[\\/]/).at(-1) === build.archive.fileName,
    'provenance archive identity mismatch: '+build.id);
  assert(receipt.build?.repository === build.provenance.sourceRepository &&
    receipt.build?.commit === build.provenance.sourceCommit, 'provenance upstream identity mismatch: '+build.id);
  return receipt;
}

/**
 * 从已读取的精确字节建立不可变闭包。索引必须覆盖所有 source-build，包括历史构建，
 * 不能用删索引来省略源码交付，也不接受重复/孤立条目。legacy 身份仍按旧协议保留。
 */
export function deliveryClosure(sourceRaw, indexRaw, provenanceRaws) {
  const source = JSON.parse(sourceRaw), index = JSON.parse(indexRaw);
  const preview = projectCatalog(source,'preview'); projectCatalog(source,'stable');
  assert(index.schemaVersion === 1 && Array.isArray(index.files) && index.files.length <= 256,
    'invalid source-input index');
  assert(Object.keys(index).every(k => ['schemaVersion','files'].includes(k)), 'unknown source-input index field');
  const builds = preview.builds.filter(b => b.provenance.kind === 'source-build');
  assert(index.files.length === builds.length, 'source-input index must cover every source-build');
  const seen = new Set(), names = new Map(), targets = [], provenance = [], receipts = new Map();
  for (const input of index.files) {
    assert(input && Object.keys(input).every(k => ['runtimeBuildId','fileName','sizeBytes','sha256','url'].includes(k)),
      'invalid source-input index entry');
    assert(!seen.has(input.runtimeBuildId), 'duplicate source-input build: '+input.runtimeBuildId);
    seen.add(input.runtimeBuildId);
    const build = builds.find(b => b.id === input.runtimeBuildId);
    assert(build, 'orphan source-input build: '+input.runtimeBuildId);
    assert(ZIP_NAME.test(input.fileName) && Number.isSafeInteger(input.sizeBytes) && input.sizeBytes > 0 &&
      input.sizeBytes <= 2147483647 && HASH.test(input.sha256), 'invalid source-input archive identity');
    const raw = provenanceRaws.get(build.id);
    assert(raw, 'missing provenance receipt: '+build.id);
    receipts.set(build.id, validateBuildReceipt(raw,build));
    provenance.push({buildId:build.id,sha256:sha256(raw)});
    const runtimeDownload = build.downloads.find(d => d.sourceId === 'github');
    assert(runtimeDownload?.transport === 'single-file', 'source-build needs full GitHub asset: '+build.id);
    const runtimePool = githubAsset(runtimeDownload.url,build.archive.fileName);
    const sourcePool = githubAsset(input.url,input.fileName);
    assert(runtimePool.tag === sourcePool.tag, 'runtime/source inputs release batch mismatch: '+build.id);
    for (const target of [
      {buildId:build.id,kind:'runtime',fileName:build.archive.fileName,sizeBytes:build.archive.sizeBytes,
        sha256:build.archive.sha256,url:runtimeDownload.url,...runtimePool},
      {buildId:build.id,kind:'source-inputs',fileName:input.fileName,sizeBytes:input.sizeBytes,
        sha256:input.sha256,url:input.url,...sourcePool,manifestSha256:build.provenance.manifestSha256}
    ]) {
      // 文件名是 assets-map 的键，也是公开下载的身份；不同 build 不能复用同名资产。
      assert(!names.has(target.fileName), 'duplicate delivery filename: '+target.fileName);
      names.set(target.fileName,target); targets.push(target);
    }
  }
  targets.sort((a,b) => a.fileName.localeCompare(b.fileName));
  provenance.sort((a,b) => a.buildId.localeCompare(b.buildId));
  const identity = {schemaVersion:2,sourceSha256:sha256(sourceRaw),sourceInputsIndexSha256:sha256(indexRaw),provenance,targets};
  return {...identity,closureSha256:sha256(JSON.stringify(identity)),source,receipts};
}

/** 每次命令重新读取实际 source/index/收据；调用者在写入通道前再读取一次比较闭包。 */
export async function readDeliveryClosure(root,sourcePath) {
  const sourceRaw = await readFile(sourcePath?resolve(sourcePath):resolve(root,'catalog/source.json'));
  const indexRaw = await readFile(resolve(root,'provenance/build-inputs.json'));
  const raws = new Map();
  for (const b of JSON.parse(sourceRaw).builds.filter(b => b.provenance.kind === 'source-build'))
    raws.set(b.id,await readFile(resolve(root,'provenance',b.id+'.json')));
  return deliveryClosure(sourceRaw,indexRaw,raws);
}

/** 收据是发布工具的操作证据，不是独立签名信任根；必须精确对应当前全部目标。 */
export function validateDeliveryReceipt(receipt, closure, now=Date.now()) {
  assert(receipt?.schemaVersion === 2 && receipt.closureSha256 === closure.closureSha256 &&
    receipt.sourceSha256 === closure.sourceSha256 && receipt.sourceInputsIndexSha256 === closure.sourceInputsIndexSha256,
    'delivery source/index/closure changed since verification');
  const start=Date.parse(receipt.verificationStartedAt), end=Date.parse(receipt.finishedAt);
  assert(Number.isFinite(start) && Number.isFinite(end) && start <= end && end <= now+300000, 'invalid delivery verification interval');
  assert(Array.isArray(receipt.assets) && receipt.assets.length === closure.targets.length, 'incomplete asset receipt');
  const seen = new Set();
  for (const asset of receipt.assets) {
    assert(!seen.has(asset.fileName), 'duplicate asset receipt'); seen.add(asset.fileName);
    const target=closure.targets.find(t => t.fileName === asset.fileName);
    assert(target && ['buildId','kind','url','sizeBytes','sha256'].every(k => asset[k] === target[k]), 'asset receipt identity mismatch');
    const at=Date.parse(asset.verifiedAt);
    assert(Number.isFinite(at) && at >= start && at <= end, 'invalid asset verification time');
    if (target.kind === 'source-inputs') assert(asset.sourceInputs?.manifestSha256 === target.manifestSha256 &&
      HASH.test(asset.sourceInputs.indexSha256) && Number.isSafeInteger(asset.sourceInputs.fileCount) &&
      asset.sourceInputs.fileCount > 0, 'missing validated source-input contents: '+target.buildId);
    const buildReceipt=closure.receipts.get(target.buildId);
    if(target.kind==='runtime'&&requiresRuntimeAudio(buildReceipt))validateRuntimeAudioAudit(asset.runtimeAudio,target,buildReceipt);
    else assert(asset.runtimeAudio===undefined,'unexpected audio audit on historical runtime or source archive');
  }
  return receipt;
}
