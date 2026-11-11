import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACCOUNT, CYCLE_ORDER, SCHEMES, schemeCss, sha256, recognize } from '../extensions/firefox/catalog.mjs';
import { INTERVAL, validateState, validateStyle, planRotation, ensureCredentials, armRotation, main } from '../scripts/rotate-schemes.mjs';

const now = Date.parse('2026-11-04T12:00:00Z');
const style = (id = 'main', age = INTERVAL + 1000) => ({ id: ACCOUNT.styleId, owner_id: ACCOUNT.userId,
  owner_type: 'User', css: schemeCss(id), updated_at: new Date(now - age).toISOString() });
const credentials = (expiry = now + 3600000) => ({ clientId: 'fixture-client', clientSecret: 'fixture-secret',
  accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresAt: new Date(expiry).toISOString() });
const initial = () => ({ version: 1 });

test('all catalog schemes participate once, rotate in the explicit order and remain recognizable', async () => {
  assert.deepEqual(new Set(CYCLE_ORDER), new Set(SCHEMES.map(item => item.id)));
  assert.equal(CYCLE_ORDER.length, new Set(CYCLE_ORDER).size);
  for (let index = 0; index < CYCLE_ORDER.length; index++) {
    const plan = await planRotation(initial(), style(CYCLE_ORDER[index]), now);
    assert.equal(plan.schemeId, CYCLE_ORDER[(index + 1) % CYCLE_ORDER.length]);
    assert.equal(await recognize(plan.css), plan.schemeId);
    assert.equal(plan.cssHash, await sha256(plan.css));
    assert.equal(plan.beforeHash, await sha256(style(CYCLE_ORDER[index]).css));
  }
});

test('manual changes receive at least thirty minutes and legacy automatic state remains readable', async () => {
  const current = style('gold-jade', INTERVAL - 1);
  assert.equal((await planRotation(initial(), current, now)).kind, 'waiting');
  assert.equal((await planRotation(initial(), current, now + 1)).kind, 'ready');
  const state = { version: 1, lastAuto: { hash: await sha256(current.css), updatedAt: current.updated_at,
    completedAt: new Date(now - 1000).toISOString() } };
  assert.equal((await planRotation(state, current, now)).kind, 'waiting');
  // An external rewrite of the SAME scheme still starts a manual hold.
  current.updated_at = new Date(now).toISOString();
  assert.equal((await planRotation(state, current, now)).kind, 'waiting');
});

test('small scheduler jitter does not skip a whole rotation; two runs in one slot cannot switch twice', async () => {
  const current = style('main', INTERVAL - 1000);
  const state = { version: 1, lastAuto: { hash: await sha256(current.css), updatedAt: current.updated_at,
    completedAt: current.updated_at, slot: Math.floor((now - INTERVAL + 1000) / INTERVAL) } };
  assert.equal((await planRotation(state, current, now)).kind, 'ready');
  state.lastAuto.slot = Math.floor(now / INTERVAL);
  assert.equal((await planRotation(state, current, now)).kind, 'waiting');
});

test('unknown CSS, wrong ownership and invalid timestamps cannot produce a plan', async () => {
  await assert.rejects(planRotation(initial(), { ...style(), css: 'body{color:red}' }, now), /Неизвестный/);
  assert.throws(() => validateStyle({ ...style(), owner_id: 42 }), /принадлежит/);
  assert.throws(() => validateStyle({ ...style(), updated_at: 'bad' }), /время/);
  assert.throws(() => validateState({ version: 1, pending: {} }), /журнал/);
});

test('textarea-saved schemes rotate with exact source hashes and retain the manual hold', async () => {
  for (const id of CYCLE_ORDER) {
    const current = style(id);
    current.css = `${current.css.replaceAll('\n', '\r\n')}\r\n`;
    const plan = await planRotation(initial(), current, now);
    assert.equal(plan.kind, 'ready');
    assert.equal(plan.beforeHash, await sha256(current.css));
    assert.notEqual(plan.beforeHash, await sha256(schemeCss(id)));
    assert.equal(plan.schemeId, CYCLE_ORDER[(CYCLE_ORDER.indexOf(id) + 1) % CYCLE_ORDER.length]);
    const state = { version: 1, lastAuto: { hash: await sha256(schemeCss(id)),
      updatedAt: current.updated_at, completedAt: current.updated_at, slot: Math.floor(now / INTERVAL) - 1 } };
    current.updated_at = new Date(now - 1000).toISOString();
    assert.equal((await planRotation(state, current, now)).kind, 'waiting');
    current.css += 'body { color: red; }';
    await assert.rejects(planRotation(initial(), current, now), /Неизвестный/);
  }
});

test('a lost PATCH is only reconciled: desired CSS clears pending without a second write', async () => {
  const current = style('emerald-scarlet');
  const pending = { beforeHash: await sha256(schemeCss('main')), desiredHash: await sha256(current.css),
    startedAt: new Date(now - 1000).toISOString(), artifactId: '123' };
  const state = { version: 1, pending };
  const result = await planRotation(state, current, now);
  assert.equal(result.kind, 'reconciled');
  assert.equal(result.state.pending, null);
  assert.equal((await planRotation(result.state, current, now)).kind, 'waiting');
  await assert.rejects(planRotation(state, style('main'), now), /повторного PATCH нет/);
  await assert.rejects(planRotation(state, style('gold-jade'), now), /приостановлена/);
  assert.equal(state.pending, pending);
});

test('OAuth refresh persists a stop marker before exchange and the entire secret before clearing it', async () => {
  const events = [];
  const result = await ensureCredentials({ credentials: credentials(now), state: initial(), now, allowRefresh: true,
    mask() {}, saveState: async state => events.push(['state', structuredClone(state)]),
    saveSecret: async secret => events.push(['secret', structuredClone(secret)]),
    refresh: async () => { events.push(['refresh']); return { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 86400 }; } });
  assert.deepEqual(events.map(event => event[0]), ['state', 'refresh', 'secret', 'state']);
  assert.equal(events[0][1].refreshPending, true);
  assert.equal(events[2][1].refreshToken, 'new-refresh');
  assert.equal(result.state.refreshPending, false);
  assert.equal(result.state.credentialsHash, await sha256(JSON.stringify(result.credentials)));
});

test('dry-run cannot refresh; stale queued secrets and interrupted refresh cannot be reused', async () => {
  let calls = 0;
  const args = { credentials: credentials(now), state: initial(), now, allowRefresh: false, mask() {},
    saveState: async () => calls++, saveSecret: async () => calls++, refresh: async () => calls++ };
  await assert.rejects(ensureCredentials(args), /Dry-run/);
  assert.equal(calls, 0);
  await assert.rejects(ensureCredentials({ ...args, state: { version: 1, credentialsHash: 'a'.repeat(64) } }), /устаревший/);
  await assert.rejects(ensureCredentials({ ...args, state: { version: 1, credentialsHash: 'a'.repeat(64), refreshPending: true } }), /Незавершённое/);
});

test('lost refresh response or failed secret persistence leaves the durable stop marker', async () => {
  for (const failure of ['exchange', 'secret', 'invalid-response']) {
    let persisted;
    let exchanges = 0;
    await assert.rejects(ensureCredentials({ credentials: credentials(now), state: initial(), now, allowRefresh: true, mask() {},
      saveState: async state => { persisted = state; },
      saveSecret: async () => { if (failure === 'secret') throw new Error('fixture'); },
      refresh: async () => {
        exchanges++;
        if (failure === 'exchange') throw new Error('fixture timeout');
        return failure === 'invalid-response' ? {} : { access_token: 'next', refresh_token: 'next-refresh', expires_in: 3600 };
      } }));
    assert.equal(exchanges, 1);
    assert.equal(persisted.refreshPending, true);
  }
});

test('arming requires an uploaded backup, fresh unchanged state and live enabled flag', async () => {
  const state = initial();
  const plan = { ...(await planRotation(state, style(), now)), mode: 'publish', preparedAt: new Date(now).toISOString(),
    armed: false, stateHash: await sha256(JSON.stringify(state)) };
  let writes = 0;
  const args = { plan, state, now, enabled: true, artifactId: '123', saveState: async state => { writes++; assert.ok(state.pending); } };
  for (const changes of [{ enabled: false }, { artifactId: '' }, { artifactId: '0' },
    { now: now + 600001 }, { state: { version: 1, credentialsHash: 'a'.repeat(64) } }, { plan: { ...plan, mode: 'dry-run' } }]) {
    await assert.rejects(armRotation({ ...args, ...changes }), /Запись запрещена/);
  }
  assert.equal(writes, 0);
  assert.equal((await armRotation(args)).armed, true);
  assert.equal(writes, 1);
});

test('workflow prepare, arm and settle use mock APIs and persist pending across processes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shiki-rotation-test-'));
  const oldCwd = process.cwd();
  const savedEnv = { ...process.env };
  const realFetch = globalThis.fetch;
  let remote = style('main', INTERVAL * 4);
  remote.updated_at = new Date(Date.now() - INTERVAL * 4).toISOString();
  let state = initial();
  const calls = [];
  const output = join(directory, 'output');
  try {
    process.chdir(directory);
    Object.assign(process.env, { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'SadLaboka/shikimori', RUNNER_TEMP: directory,
      GITHUB_OUTPUT: output, ROTATION_MODE: 'dry-run', ROTATION_ADMIN_TOKEN: 'fixture-admin',
      ROTATION_CREDENTIALS: JSON.stringify(credentials(Date.now() + 3600000)), ROTATION_APPLICATION_NAME: 'Fixture' });
    globalThis.fetch = async (url, options) => {
      calls.push([String(url), options.method]);
      assert.equal(options.redirect, 'error');
      let data;
      if (String(url).endsWith('/SHIKIMORI_ROTATION_STATE')) {
        if (options.method === 'PATCH') { state = JSON.parse(JSON.parse(options.body).value); return new Response(null, { status: 204 }); }
        data = { value: JSON.stringify(state) };
      } else if (String(url).endsWith('/SHIKIMORI_ROTATION_ENABLED')) data = { value: 'true' };
      else if (String(url).endsWith('/whoami')) data = { id: ACCOUNT.userId, nickname: ACCOUNT.nickname };
      else if (String(url).endsWith(`/api/styles/${ACCOUNT.styleId}`)) data = remote;
      else throw new Error('Unexpected mock URL');
      return Response.json(data);
    };
    await main('prepare');
    assert.equal(calls.filter(call => call[1] !== 'GET').length, 0, 'dry-run must not write anywhere');
    assert.match(await readFile(output, 'utf8'), /ready=true/);
    const planPath = join(directory, 'shikimori-rotation/plan.local.json');
    const plan = JSON.parse(await readFile(planPath, 'utf8'));
    assert.equal(await sha256(await readFile(plan.cssPath, 'utf8')), plan.cssHash);
    process.env.ROTATION_MODE = 'publish';
    await main('prepare');
    process.env.BACKUP_ARTIFACT_ID = '123';
    await main('arm');
    assert.ok(state.pending);
    await assert.rejects(main('settle'), /повторного PATCH нет/);
    assert.ok(state.pending, 'failed verification must retain journal');
    remote = { ...remote, css: schemeCss('emerald-scarlet'), updated_at: new Date().toISOString() };
    await main('settle');
    assert.equal(state.pending, null);
    assert.ok(state.lastAuto);
    assert.equal(calls.filter(call => call[0].startsWith('https://shikimori.io') && call[1] !== 'GET').length, 0,
      'only deploy.ps1 is allowed to publish CSS');
  } finally {
    process.chdir(oldCwd);
    globalThis.fetch = realFetch;
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    await rm(directory, { recursive: true, force: true });
  }
});
