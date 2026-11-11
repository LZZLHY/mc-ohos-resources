/**
 * 从真实生产导出器验证Git来源闭环。只在显式仓外输出下新建小Git夹具；消费者都是同批
 * 夹具目录，不导出到维护者官网/主工程。成功证明无借用、无其他工作树、无独有源后回收；失败留现场。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const producer=fileURLToPath(new URL('..',import.meta.url));
const names=['tools/protocol.mjs','lib/catalog-validation.mjs','lib/catalog-v2.mjs','catalog/host-history.json'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

test('export freezes committed Git blobs, canonical LF and exact source identity; dirty inputs fail closed',()=>{
  const output=process.env.AMCL_RUN_DIR;
  assert(output&&path.isAbsolute(output),'AMCL_RUN_DIR must explicitly name external fixture output');
  const outputRoot=fs.realpathSync(output);
  assert(!outputRoot.startsWith(fs.realpathSync(producer)+path.sep),'fixture output must remain outside source repository');
  const area=fs.mkdtempSync(path.join(outputRoot,'contract-export-fixture-'));
  const repo=path.join(area,'source'),cases=[];
  const git=(...args)=>execFileSync('git',['-C',repo,...args],{maxBuffer:1024*1024});
  const check=(name,body)=>{body();cases.push(name);};
  try{
    fs.mkdirSync(repo);
    // 导出器的待恢复检查现与R12发行事务共用模块；夹具携带真实依赖正文，不用空桩
    // 绕过激活保护。只复制本仓tools/lib文本，正式对象库与外部凭据不进入夹具。
    for(const directory of ['tools','lib'])for(const name of fs.readdirSync(path.join(producer,directory))){
      if(!name.endsWith('.mjs'))continue;
      fs.mkdirSync(path.join(repo,directory),{recursive:true});
      fs.copyFileSync(path.join(producer,directory,name),path.join(repo,directory,name));
    }
    for(const name of [...names,'tools/export-clients.mjs','lib/browser-catalog.mjs','catalog/trusted-keys.json','catalog/v1/stable.json','catalog/v1/preview.json']){
      const target=path.join(repo,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(producer,name),target);
    }
    fs.writeFileSync(path.join(repo,'.gitattributes'),'*.mjs text eol=lf\n*.json -text\n');
    git('-c','init.defaultBranch=main','init');git('config','user.name','AMCL isolated export test');git('config','user.email','export-test@invalid');git('config','core.autocrlf','false');
    git('add','--','.gitattributes','tools','lib','catalog');git('commit','-m','reproducible export test input');
    const initial=git('rev-parse','HEAD').toString('utf8').trim();
    const run=name=>{
      const web=path.join(area,name+'-web'),app=path.join(area,name+'-app');
      const child=spawnSync(process.execPath,[path.join(repo,'tools/export-clients.mjs'),'--web',web,'--app',app],{cwd:repo,encoding:'utf8',maxBuffer:1024*1024});
      return{child,web,app};
    };
    const verify=(result,commit)=>{
      assert.equal(result.child.status,0,result.child.stderr);
      const directory=path.join(result.web,'scripts/runtime-catalog-contract');
      const manifest=JSON.parse(fs.readFileSync(path.join(directory,'source.json'),'utf8'));
      assert.equal(manifest.schemaVersion,1);assert.equal(manifest.sourceRepository,'https://github.com/LZZLHY/mc-ohos-resources');
      assert.equal(manifest.sourceCommit,commit);assert.equal(manifest.hashBasis,'git-blob-lf');assert.deepEqual(Object.keys(manifest.files).sort(),names.slice().sort());
      assert.equal(manifest.trustedKeys.sha256,digest(fs.readFileSync(path.join(directory,'catalog/trusted-keys.json'))));
      for(const name of names){
        const blob=git('cat-file','blob',commit+':'+name),copied=fs.readFileSync(path.join(directory,name));
        assert.deepEqual(copied,blob,name);assert.equal(manifest.files[name],digest(blob),name);assert(!copied.includes(Buffer.from('\r\n')),name);
      }
      return manifest;
    };
    const rejected=(name,reason)=>{
      const result=run(name);assert.notEqual(result.child.status,0);assert.match(result.child.stderr,reason);
      assert(!fs.existsSync(result.web),'dirty verifier must be rejected before writing web consumer');
      assert(!fs.existsSync(result.app),'dirty verifier must be rejected before writing app builtin');
    };
    check('clean export records the frozen commit and exact module Git blob hashes',()=>verify(run('clean'),initial));
    check('CRLF checkout exports canonical LF blobs without changing source identity',()=>{
      for(const name of names){const blob=git('cat-file','blob',initial+':'+name);fs.writeFileSync(path.join(repo,name),blob.toString('utf8').replace(/\n/g,'\r\n'));}
      const manifest=verify(run('crlf'),initial);assert.deepEqual(manifest.normalizationEvidence.normalizedFiles.sort(),names.slice().sort());assert.equal(manifest.normalizationEvidence.canonicalBytesMatchCommit,true);
    });
    const changed=names[0],original=git('cat-file','blob',initial+':'+changed);
    const restore=()=>{fs.writeFileSync(path.join(repo,changed),original);git('add','--',changed);};
    check('unstaged verifier drift is rejected before the dirty module executes',()=>{
      fs.writeFileSync(path.join(repo,changed),Buffer.concat([original,Buffer.from('\nthrow Error("dirty verifier executed before freeze");\n')]));
      rejected('unstaged',/uncommitted drift/);restore();
    });
    check('staged verifier drift is rejected instead of being attributed to old HEAD',()=>{
      fs.writeFileSync(path.join(repo,changed),Buffer.concat([original,Buffer.from('\n// staged fixture delta\n')]));git('add','--',changed);
      rejected('staged',/uncommitted drift/);restore();
    });
    check('assume-unchanged cannot hide different working module bytes',()=>{
      git('update-index','--assume-unchanged','--',changed);fs.writeFileSync(path.join(repo,changed),Buffer.concat([original,Buffer.from('\n// hidden fixture delta\n')]));
      assert.equal(git('status','--porcelain=v1','--',changed).length,0);rejected('hidden',/worktree bytes differ/);
      fs.writeFileSync(path.join(repo,changed),original);git('update-index','--no-assume-unchanged','--',changed);
    });
    check('newly committed verifier bytes export their actual new commit and hash',()=>{
      fs.writeFileSync(path.join(repo,changed),Buffer.concat([original,Buffer.from('\n// committed fixture delta\n')]));git('add','--',changed);git('commit','-m','known reproducible verifier fixture delta');
      const current=git('rev-parse','HEAD').toString('utf8').trim();assert.notEqual(current,initial);const manifest=verify(run('committed'),current);
      assert.notEqual(manifest.files[changed],digest(original));
    });
    // 该Git银行为本轮亲建，只有可由本测试重新生成的复制品和标注的fixture delta；没有借用对象/远端/其他工作树。
    // 将本轮刻意制造的CRLF工作副本还原成同一HEAD原字节，证明没有夹具外独有工作修改。
    const tracked=git('ls-files','-z').toString('utf8').split('\0').filter(Boolean);
    for(const name of tracked)fs.writeFileSync(path.join(repo,name),git('cat-file','blob','HEAD:'+name));
    git('add','--',...tracked);
    assert.equal(git('status','--porcelain=v1').length,0);assert.equal(git('remote').length,0);
    assert.equal(git('worktree','list','--porcelain').toString('utf8').split('\n').filter(line=>line.startsWith('worktree ')).length,1);
    assert(!fs.existsSync(path.join(repo,'.git/objects/info/alternates')));
    assert(fs.realpathSync(area).startsWith(outputRoot+path.sep));
    fs.rmSync(area,{recursive:true});
    console.log(JSON.stringify({passed:cases.length,cases,fixtureClosed:true,independentGitFixtureReproducible:true}));
  }catch(error){console.error('Export fixture retained at '+area);throw error;}
});
