import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {assembleCss,buildCss} from '../scripts/build-css.mjs';

test('component concatenation preserves bytes, cascade order and malformed legacy fragments; stale output is rejected',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'shiki-components-'));
  try{
    await mkdir(path.join(root,'css/components'),{recursive:true});
    const manifest={version:1,parts:['components/z.css','components/a.css']};
    const save=()=>writeFile(path.join(root,'css/components.json'),JSON.stringify(manifest));
    await save();
    const first=Buffer.from('/* Кириллица */\r\n@import "https://example.test/base.css";\r\n/* split ');
    const second=Buffer.from('comment */\n@media(max-width:390px){.page{color:red}}\n');
    await writeFile(path.join(root,'css/components/z.css'),first);
    await writeFile(path.join(root,'css/components/a.css'),second);
    const expected=Buffer.concat([first,second]);
    assert.deepEqual(await assembleCss(root),expected);
    await buildCss(root,{write:true});
    await buildCss(root);
    await buildCss(root,{write:true,output:'.preview/candidate.css'});
    assert.deepEqual(await readFile(path.join(root,'.preview/candidate.css')),expected);
    const orphan=path.join(root,'css/components/orphan.css');
    await writeFile(orphan,'a{color:blue}');
    await assert.rejects(()=>assembleCss(root),/Unlisted/);
    await rm(orphan);
    await assert.rejects(()=>buildCss(root,{write:true,output:'../outside.css'}),/Output must/);
    await assert.rejects(()=>buildCss(root,{write:true,output:'.preview/../../outside.css'}),/Output must/);
    await writeFile(path.join(root,'css/components/a.css'),'changed');
    await assert.rejects(()=>buildCss(root),/stale/);
    manifest.parts.reverse();await save();
    assert.notDeepEqual(await assembleCss(root),expected);
    manifest.parts=['components/z.css','components/z.css'];await save();
    await assert.rejects(()=>assembleCss(root),/duplicate/);
    manifest.parts=['../deploy.local.json'];await save();
    await assert.rejects(()=>assembleCss(root),/Invalid/);
    manifest.parts=['components/missing.css'];await save();
    await assert.rejects(()=>assembleCss(root),/ENOENT/);
  }finally{
    const resolved=path.resolve(root);
    assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('shiki-components-'));
    await rm(resolved,{recursive:true,force:true});
  }
});

test('repository components reproduce the current deployment entrypoint exactly',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  assert.deepEqual(await assembleCss(root),await readFile(path.join(root,'styles_optimized.css')));
});
