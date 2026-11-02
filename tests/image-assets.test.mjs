import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyImageReplacement,verifyImageAssets} from '../scripts/verify-image-assets.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const from='https://old.example/image.png';
const to=`https://raw.githubusercontent.com/SadLaboka/shikimori/${'a'.repeat(40)}/assets/images/${'b'.repeat(64)}.png`;
const before=Buffer.from(`.logo{background:url(${from})}@media(min-width:9000px){.hidden{color:red}}`);
const after=Buffer.from(before.toString().replaceAll(from,to));
const spec={sourceSha256:hash(before),sha256:hash(after),replacements:[{from,to}]};
test('archives and base modules match pinned originals',async()=>{assert.equal((await verifyImageAssets()).pass,true)});
test('only exact URL replacement is accepted',()=>{assert.doesNotThrow(()=>verifyImageReplacement(before,after,spec))});
test('missing inactive media rule is rejected even with a refreshed result hash',()=>{
 const altered=Buffer.from(after.toString().replace('@media(min-width:9000px){.hidden{color:red}}',''));
 assert.throws(()=>verifyImageReplacement(before,altered,{...spec,sha256:hash(altered)}),/outside/);
});
test('changed declaration, unknown original and mutable asset URL are rejected',()=>{
 const changed=Buffer.from(after.toString().replace('color:red','color:blue'));
 assert.throws(()=>verifyImageReplacement(before,changed,{...spec,sha256:hash(changed)}),/outside/);
 assert.throws(()=>verifyImageReplacement(Buffer.from('other'),after,spec),/Original/);
 assert.throws(()=>verifyImageReplacement(before,after,{...spec,replacements:[{from,to:to.replace('a'.repeat(40),'main')}]}),/Invalid/);
});
