import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { ACCOUNT, SCHEMES, REVISION, BASE_IMPORTS, schemeCss, schemeImports, sha256, recognize, nextSchemeId } from '../extensions/firefox/catalog.mjs';
import { AVATAR_HOVER_CSS } from '../extensions/firefox/avatar-hover.mjs';
import { Publisher } from '../extensions/firefox/publisher.mjs';

function fixture() {
  let current = { id: ACCOUNT.styleId, owner_id: ACCOUNT.userId, owner_type: 'User', css: schemeCss('main'),
    updated_at: 'v1', failed_imports: [], compiledPresent: true };
  const data = {}; const calls = []; let revision = 1; let time = 10000;
  const controls = { wrongUser: false, wrongOwner: false, failStorage: false, patchMode: 'ok', conflict: false, styleReads: 0, failVerification: false };
  const storage = {
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in data).map(key => [key, structuredClone(data[key])])); },
    async set(value) { if (controls.failStorage) throw new Error('storage unavailable'); Object.assign(data, structuredClone(value)); },
    async remove(key) { delete data[key]; },
  };
  const request = async message => {
    calls.push(structuredClone(message));
    if (message.path === '/api/users/whoami') return { ok: true, value: { id: controls.wrongUser ? 1 : ACCOUNT.userId, nickname: 'SadLaboka' } };
    if (message.method === 'GET') {
      controls.styleReads++;
      if (controls.conflict && controls.styleReads === 3) current = { ...current, css: 'body{color:blue}', updated_at: 'outside' };
      if (controls.failVerification && calls.some(call => call.method === 'PATCH')) throw new Error('internal network details');
      return { ok: true, value: structuredClone({ ...current, owner_id: controls.wrongOwner ? 1 : current.owner_id }) };
    }
    assert.equal(message.method, 'PATCH');
    assert.ok(data.backups?.[0]?.css && data.pending?.phase === 'sending', 'Backup and journal must be durable before PATCH');
    if (controls.patchMode === 'no-response-no-write') throw new Error('secret-looking response must not escape');
    current = { ...current, css: message.css, updated_at: `v${++revision}` };
    if (controls.patchMode === 'failed-import') current.failed_imports = ['https://example.invalid/missing.css'];
    if (controls.patchMode === 'no-response-applied') throw new Error('lost response');
    return { ok: true, value: structuredClone(current) };
  };
  const make = () => new Publisher({ request, storage, now: () => time, limiter: { run: action => action() } });
  return { publisher: make(), make, data, calls, controls,
    get current() { return current; }, change: value => { current = { ...current, ...value }; }, advance: ms => { time += ms; } };
}

test('registry imports exact pinned repository files with the six original dependencies', async () => {
  for (const scheme of SCHEMES) {
    const bytes = execFileSync('git', ['show', `${REVISION}:${scheme.file}`]);
    assert.equal(await sha256(bytes.toString('utf8')), scheme.sourceSha256);
    assert.deepEqual(bytes.toString('utf8').match(/^@import[^\r\n]+;/gm), BASE_IMPORTS);
    const css = schemeCss(scheme.id);
    assert.equal(css.match(/@import/g).length, 7);
    assert.ok(css.includes(`/${REVISION}/${scheme.file}`));
  }
  assert.equal(await sha256(schemeImports('emerald-scarlet')), 'a51c117f1ff6eb1a91e693022dcb1d5d73d44695e4c1059b03fe48220197808d');
});

test('inline hover CSS matches the shared component and both old and new imports are recognized', async () => {
  const shared = await readFile(new URL('../css/components/22-avatar-interaction.css', import.meta.url), 'utf8');
  assert.equal(AVATAR_HOVER_CSS, shared.replaceAll('\r\n', '\n'));
  for (const scheme of SCHEMES) {
    const current = await readFile(new URL(`../${scheme.file}`, import.meta.url), 'utf8');
    assert.equal(await sha256(current), scheme.currentSourceSha256);
    assert.equal(await recognize(current), scheme.id);
    assert.equal(await recognize(schemeImports(scheme.id)), scheme.id);
    assert.equal(await recognize(schemeCss(scheme.id)), scheme.id);
    assert.equal(schemeCss(scheme.id), `${schemeImports(scheme.id)}\n\n${AVATAR_HOVER_CSS}`);
  }
  assert.equal(nextSchemeId('main'), 'emerald-scarlet'); assert.equal(nextSchemeId('emerald-scarlet'), 'main');
  assert.equal(nextSchemeId(null), null);
});

test('avatar cycle reads fresh state, supports old imports and advances in both directions with one PATCH', async () => {
  const f = fixture(); f.change({ css: schemeImports('main') });
  let result = await f.publisher.cycle();
  assert.equal(result.kind, 'success'); assert.equal(result.view.schemeId, 'emerald-scarlet');
  assert.equal(f.data.backups[0].css, schemeImports('main'));
  assert.equal(f.calls.length, 5); assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 1);
  result = await f.publisher.cycle();
  assert.equal(result.view.schemeId, 'main'); assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 2);
});

test('avatar cycle never guesses unknown CSS, overwrites a conflict or bypasses a pending operation', async () => {
  const unknown = fixture(); unknown.change({ css: 'body{color:red}' });
  await assert.rejects(unknown.publisher.cycle(), /не распознан/);
  assert.equal(unknown.calls.some(call => call.method === 'PATCH'), false);
  const conflict = fixture(); conflict.controls.conflict = true; conflict.controls.styleReads = 1;
  await assert.rejects(conflict.publisher.cycle(), /изменился/);
  assert.equal(conflict.calls.some(call => call.method === 'PATCH'), false);
  const pending = fixture(); pending.data.pending = { phase: 'sending' };
  await assert.rejects(pending.publisher.cycle(), /предыдущей/); assert.equal(pending.calls.length, 0);
  const wrong = fixture(); wrong.controls.wrongUser = true;
  await assert.rejects(wrong.publisher.cycle(), /нужен аккаунт/);
  assert.equal(wrong.calls.some(call => call.method === 'PATCH'), false);
});

test('avatar and popup operations share the same publication lock', async () => {
  const f = fixture(); const view = await f.publisher.inspect();
  const operation = f.publisher.cycle();
  await assert.rejects(f.publisher.apply('main', view.snapshot), /Дождись/);
  await assert.rejects(f.publisher.cycle(), /Дождись/); await operation;
  assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 1);
});
test('switch persists exact previous CSS before one PATCH and verifies result', async () => {
  const f = fixture(); const view = await f.publisher.inspect();
  const result = await f.publisher.apply('emerald-scarlet', view.snapshot);
  assert.equal(result.kind, 'success'); assert.equal(result.view.schemeId, 'emerald-scarlet');
  assert.equal(f.current.css, schemeCss('emerald-scarlet'));
  assert.equal(f.data.backups[0].css, schemeCss('main'));
  assert.equal(f.data.pending, undefined);
  assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 1);
});
test('restore uses verified backup and saves the replaced scheme for undo', async () => {
  const f = fixture(); const initial = await f.publisher.inspect();
  const first = await f.publisher.apply('emerald-scarlet', initial.snapshot);
  const restored = await f.publisher.restore(first.view.snapshot);
  assert.equal(restored.kind, 'success'); assert.equal(f.current.css, schemeCss('main'));
  assert.equal(f.data.backups[0].css, schemeCss('emerald-scarlet'));
});
test('wrong account or style owner cannot write', async () => {
  for (const key of ['wrongUser', 'wrongOwner']) {
    const f = fixture(); f.controls[key] = true;
    await assert.rejects(f.publisher.inspect());
    assert.equal(f.calls.some(call => call.method === 'PATCH'), false);
  }
});
test('changed source or timestamp requires a fresh selection', async () => {
  for (const change of [{ css: 'body{color:blue}' }, { updated_at: 'changed' }]) {
    const f = fixture(); const view = await f.publisher.inspect(); f.change(change);
    await assert.rejects(f.publisher.apply('emerald-scarlet', view.snapshot), /изменился/);
    assert.equal(f.calls.some(call => call.method === 'PATCH'), false);
  }
});
test('a conflict after backup cancels PATCH', async () => {
  const f = fixture(); const view = await f.publisher.inspect(); f.controls.conflict = true;
  await assert.rejects(f.publisher.apply('emerald-scarlet', view.snapshot), /изменился/);
  assert.equal(f.calls.some(call => call.method === 'PATCH'), false); assert.equal(f.data.pending, undefined);
});
test('storage failure prevents any PATCH', async () => {
  const f = fixture(); const view = await f.publisher.inspect(); f.controls.failStorage = true;
  await assert.rejects(f.publisher.apply('emerald-scarlet', view.snapshot));
  assert.equal(f.calls.some(call => call.method === 'PATCH'), false);
});
test('lost PATCH response is resolved by GET without sending again', async () => {
  const f = fixture(); const view = await f.publisher.inspect(); f.controls.patchMode = 'no-response-applied';
  const result = await f.publisher.apply('emerald-scarlet', view.snapshot);
  assert.equal(result.kind, 'success'); assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 1);
});
test('uncertain operation survives background restart and blocks duplicate writes', async () => {
  const f = fixture(); const view = await f.publisher.inspect(); f.controls.patchMode = 'no-response-no-write';
  assert.equal((await f.publisher.apply('emerald-scarlet', view.snapshot)).kind, 'uncertain');
  const restarted = f.make();
  await assert.rejects(restarted.apply('emerald-scarlet', view.snapshot), /Сначала проверь/);
  assert.equal((await restarted.reconcile()).kind, 'uncertain');
  f.advance(61000);
  assert.equal((await restarted.reconcile()).kind, 'unchanged'); assert.equal(f.data.pending, undefined);
  assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 1);
});
test('failed verification leaves journal and backup available', async () => {
  const f = fixture(); const view = await f.publisher.inspect(); f.controls.failVerification = true;
  assert.equal((await f.publisher.apply('emerald-scarlet', view.snapshot)).kind, 'uncertain');
  assert.ok(f.data.pending && f.data.backups.length);
  f.controls.failVerification = false;
  assert.equal((await f.make().reconcile()).kind, 'success');
});
test('failed imports report partial save and allow manual restoration', async () => {
  const f = fixture(); const view = await f.publisher.inspect(); f.controls.patchMode = 'failed-import';
  const result = await f.publisher.apply('emerald-scarlet', view.snapshot);
  assert.equal(result.kind, 'warning'); assert.equal(result.view.canRestore, true);
});
test('already installed CSS does not create a backup or PATCH', async () => {
  const f = fixture(); const view = await f.publisher.inspect();
  assert.equal((await f.publisher.apply('main', view.snapshot)).kind, 'unchanged');
  assert.equal(f.data.backups, undefined); assert.equal(f.calls.some(call => call.method === 'PATCH'), false);
});
test('unknown scheme and damaged backup cannot be published', async () => {
  const f = fixture(); const view = await f.publisher.inspect();
  await assert.rejects(f.publisher.apply('../other', view.snapshot));
  const first = await f.publisher.apply('emerald-scarlet', view.snapshot);
  f.data.backups[0].css = 'tampered';
  await assert.rejects(f.publisher.restore(first.view.snapshot), /повреждена/);
  assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 1);
});
test('another external CSS after uncertain write is never overwritten by reconciliation', async () => {
  const f = fixture(); const view = await f.publisher.inspect(); f.controls.patchMode = 'no-response-no-write';
  await f.publisher.apply('emerald-scarlet', view.snapshot); f.change({ css: 'body{color:blue}' });
  const result = await f.publisher.reconcile();
  assert.equal(result.kind, 'warning'); assert.equal(f.current.css, 'body{color:blue}');
  assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 1);
});
test('parallel clicks cannot create two PATCH requests', async () => {
  const f = fixture(); const view = await f.publisher.inspect();
  const first = f.publisher.apply('emerald-scarlet', view.snapshot);
  await assert.rejects(f.publisher.apply('emerald-scarlet', view.snapshot), /Дождись/);
  await first;
  assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 1);
});

async function bridgeFixture() {
  const source = await readFile(new URL('../extensions/firefox/bridge.js', import.meta.url), 'utf8');
  let listener; const calls = []; let listens = 0;
  const context = vm.createContext({ location: { origin: 'https://shikimori.io' }, AbortSignal,
    document: { querySelector: () => ({ content: 'synthetic-csrf-test-only' }) },
    browser: { runtime: { id: 'test-addon', onMessage: { addListener(value) { listener = value; listens++; } } } },
    fetch: async (path, options) => { calls.push({ path, options }); return { ok: true, json: async () => ({ id: 1343722,
      owner_id: 1408017, owner_type: 'User', css: 'body{}', updated_at: 'v1', failed_imports: [], compiled_css: 'body{}', private_field: 'synthetic-private-field' }) }; },
  });
  vm.runInContext(source, context); vm.runInContext(source, context);
  assert.equal(listens, 1);
  return { calls, send: (data, sender = { id: 'test-addon' }) => listener({ channel: 'sadlaboka-api', operation: 'request', ...data }, sender) };
}
test('bridge uses page session and CSRF only for the fixed API endpoint', async () => {
  const f = await bridgeFixture(); const result = await f.send({ method: 'PATCH', path: '/api/styles/1343722', css: 'body{}' });
  assert.equal(result.ok, true); assert.equal(result.value.private_field, undefined);
  assert.equal(f.calls[0].options.credentials, 'include'); assert.equal(f.calls[0].options.redirect, 'error');
  assert.equal(f.calls[0].options.headers['X-CSRF-Token'], 'synthetic-csrf-test-only');
  assert.equal(f.calls[0].options.body, JSON.stringify({ style: { css: 'body{}' } }));
});
test('bridge rejects foreign senders, other endpoints, empty CSS and unsupported methods', async () => {
  const f = await bridgeFixture();
  assert.equal(f.send({ method: 'PATCH', path: '/api/styles/1343722', css: 'body{}' }, { id: 'other-addon' }), undefined);
  for (const data of [{ method: 'PATCH', path: '/api/styles/1', css: 'body{}' },
    { method: 'POST', path: '/oauth/token' }, { method: 'PATCH', path: '/api/styles/1343722', css: '' }]) {
    assert.equal((await f.send(data)).ok, false);
  }
  assert.equal(f.calls.length, 0);
});
test('manifest grants access only to Shikimori and contains no external code', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extensions/firefox/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.host_permissions, ['https://shikimori.io/*']);
  assert.deepEqual(manifest.permissions, ['storage', 'scripting']);
  assert.equal(manifest.web_accessible_resources, undefined); assert.equal(manifest.externally_connectable, undefined);
  assert.equal(manifest.manifest_version, 3);
});
test('style GET requires server revalidation while identity and writes bypass cache', async () => {
  const f = await bridgeFixture();
  await f.send({ method: 'GET', path: '/api/styles/1343722' });
  await f.send({ method: 'GET', path: '/api/users/whoami' });
  await f.send({ method: 'PATCH', path: '/api/styles/1343722', css: 'body{}' });
  assert.deepEqual(f.calls.map(call => call.options.cache), ['no-cache', 'no-store', 'no-store']);
});
test('read-only identity and source requests overlap and a failure waits for both', async () => {
  let release, started = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const publisher = new Publisher({ storage: { get: async () => ({}) }, limiter: { run: action => action() }, request: async message => {
    started++;
    if (message.path === '/api/users/whoami') return { ok: false, code: 'login' };
    await gate;
    return { ok: true, value: { id: ACCOUNT.styleId, owner_id: ACCOUNT.userId, owner_type: 'User', css: 'body{}',
      updated_at: 'v1', failed_imports: [], compiledPresent: true } };
  } });
  const inspection = publisher.inspect();
  const failed = assert.rejects(inspection, /Войди/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, 2); assert.equal(publisher.busy, true);
  release(); await failed; assert.equal(publisher.busy, false);
});
test('publication progress does not add requests or block the transaction', async () => {
  const f = fixture(), stages = [];
  f.publisher.onStage = stage => { stages.push(stage); };
  const view = await f.publisher.inspect(); stages.length = 0;
  await f.publisher.apply('emerald-scarlet', view.snapshot);
  assert.deepEqual(stages, ['checking', 'backup', 'publishing', 'verifying']);
  assert.equal(f.calls.length, 7);
  f.publisher.onStage = () => { throw Error('UI unavailable'); };
  const current = await f.publisher.inspect();
  assert.equal((await f.publisher.apply('main', current.snapshot)).kind, 'success');
});
