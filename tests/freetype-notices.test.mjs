/** 精确 notice 重算与派生分类测试；全部文本为自有小夹具，不执行生成器。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {sha256} from '../tools/protocol.mjs';
import {verifyDerivedFreeTypeNotices} from '../tools/freetype-notices.mjs';
const raw=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');

/** 真实完整新增 hunk 与对应摘要，负例会刷新派生摘要以检验原文关系。 */
function fixture(){
  const major='17',path='src/fixture.c',target='src/java.desktop/share/native/libfreetype/'+path;
  const block='/* Copyright (C) 2026 Fixture Author\nPermission is hereby granted for this synthetic test only.\n*/';
  const source=block+'\nint fixture(void) { return 0; }\n',lines=source.slice(0,-1).split('\n');
  const patch=Buffer.from(`diff --git a/${target} b/${target}\nnew file mode 100644\n--- /dev/null\n+++ b/${target}\n@@ -0,0 +1,${lines.length} @@\n`+lines.map(x=>'+'+x).join('\n')+'\n');
  const patchPath='prebuilt/jdk/17/patches/0016.patch',licensePath='prebuilt/fontconfig/licenses/fixture/FTL.TXT';
  const license=Buffer.from('Original synthetic upstream license\n'),generator=Buffer.from('# captured generator fixture; never executed\n');
  const item={jdkCommit:'f'.repeat(40),commit:'a'.repeat(40),version:'2.13.3',patch:patchPath,patchSha256:sha256(patch),
    importedFiles:{[path]:{target,sha256:sha256(source)}},licenses:{'docs/FTL.TXT':{path:licensePath,sha256:sha256(license)}}};
  const completion={repository:'https://source.invalid/freetype',runtimes:{[major]:item}};
  const text='AMCL FreeType completion: original source notices\n'+
    'Derived distribution supplement; not an original compiler input.\n'+
    `JDK major: ${major}\nFreeType version: ${item.version}\n`+
    `Upstream repository: ${completion.repository}\nUpstream commit: ${item.commit}\nCompletion patch: ${item.patch}\n`+
    'The exact added-file list, original notice text and matching license text follow.\n'+
    `\n[Added source file] ${path}\nSHA-256: ${sha256(source)}\n\n${block}\n`+
    `\n[Upstream license file] docs/FTL.TXT\nSHA-256: ${sha256(license)}\n\n`+license.toString()+'\n';
  const record={jdkCommit:item.jdkCommit,commit:item.commit,version:item.version,patch:item.patch,patchSha256:item.patchSha256,
    licenses:item.licenses,sourceFiles:{[path]:{sha256:sha256(source),target,noticeBlocksSha256:[sha256(block)]}}};
  const manifest={schemaVersion:1,kind:'version-matched-freetype-notices',scope:'derived-distribution-supplement',compiledInput:false,
    generatorSha256:sha256(generator),runtimes:{[major]:record}};
  const audit={schemaVersion:1,scope:'derived-distribution-supplement',compiledInput:false,major,
    generatorSha256:sha256(generator),path:'legal/amcl-freetype-completion/NOTICE.txt',mode:0o100644};
  const receipt={build:{major,commit:item.jdkCommit},derivation:{fontBundle:{derivedNotices:audit}}};
  const bundle={schemaVersion:2,noticeManifest:{},notices:{[major]:{target:audit.path,mode:0o100644}}};
  const files=new Map([[patchPath,patch],[licensePath,license],['font-provider/derived-notices/generator.py',generator],
    ['scripts/freetype-notices.py',generator]]),index={files:{},frozenFiles:{[patchPath]:sha256(patch),[licensePath]:sha256(license)},derivedNoticeFiles:{}};
  const f={files,index,receipt,bundle,manifest,audit,record,completion,actual:Buffer.from(text)};
  f.refresh=()=>{
    const c=raw(completion),cpath='prebuilt/fontconfig/freetype-completion.json';
    files.set(cpath,c);index.frozenFiles[cpath]=sha256(c);audit.completionManifestSha256=sha256(c);manifest.completionManifestSha256=sha256(c);
    record.sha256=sha256(f.actual);record.bytes=f.actual.length;audit.sha256=record.sha256;audit.bytes=record.bytes;
    Object.assign(bundle.notices[major],{sha256:record.sha256,bytes:record.bytes});
    const m=raw(manifest);files.set('font-provider/derived-notices/manifest.json',m);audit.manifestSha256=sha256(m);bundle.noticeManifest.sha256=sha256(m);
    files.set('font-provider/derived-notices/NOTICE.txt',f.actual);
    index.files=Object.fromEntries([...files].map(([n,b])=>[n,sha256(b)]));
    index.derivedNoticeFiles=Object.fromEntries(Object.entries(index.files).filter(([n])=>n.startsWith('font-provider/derived-notices/')||n==='scripts/freetype-notices.py'));
  };
  f.refresh();return f;
}

test('notice is reconstructed byte-for-byte from original frozen inputs',()=>{
  const f=fixture(),result=verifyDerivedFreeTypeNotices(f.files,f.index,f.receipt,f.bundle);
  assert.equal(result.sha256,sha256(f.actual));assert.equal(result.mode,0o100644);
});
for(const [name,change] of [
  ['author text omitted',f=>f.actual=Buffer.from(f.actual.toString().replace('Fixture Author','Author omitted'))],
  ['license text rewritten',f=>f.actual=Buffer.from(f.actual.toString().replace('Original synthetic upstream license','Rewritten license'))],
  ['false compiled classification',f=>f.manifest.compiledInput=true],
  ['another JDK commit',f=>f.receipt.build.commit='0'.repeat(40)],
  ['incomplete exact added-file list',f=>f.record.sourceFiles={}],
  ['wrong runtime destination',f=>f.bundle.notices['17'].target='lib/libfreetype.so'],
  ['notice claims executable mode',f=>f.audit.mode=0o100755],
])test('notice rejects '+name+' after refreshing derived hashes',()=>{
  const f=fixture();change(f);f.refresh();assert.throws(()=>verifyDerivedFreeTypeNotices(f.files,f.index,f.receipt,f.bundle));
});
test('notice cannot be added to old frozenFiles',()=>{
  const f=fixture();f.index.frozenFiles['font-provider/derived-notices/NOTICE.txt']=sha256(f.actual);
  assert.throws(()=>verifyDerivedFreeTypeNotices(f.files,f.index,f.receipt,f.bundle),/original compilation/);
});
test('modern v2 cannot omit notice; historical v1 remains auditable',()=>{
  const f=fixture();delete f.receipt.derivation.fontBundle.derivedNotices;
  assert.throws(()=>verifyDerivedFreeTypeNotices(f.files,f.index,f.receipt,f.bundle),/lacks derived notice/);
  f.bundle.schemaVersion=1;f.index.derivedNoticeFiles={};
  assert.equal(verifyDerivedFreeTypeNotices(f.files,f.index,f.receipt,f.bundle),null);
});
