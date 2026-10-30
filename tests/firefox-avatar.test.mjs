import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT, schemeCss } from '../extensions/firefox/catalog.mjs';

let instance = 0;
async function fixture({ userId = ACCOUNT.userId, active = true, url = 'https://shikimori.io/SadLaboka' } = {}) {
  const data = {}, session = {}, requests = [], reloads = [], injections = [];
  let listener, css = schemeCss('main'), revision = 1;
  const storage = values => ({
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in values).map(key => [key, structuredClone(values[key])])); },
    async set(value) { Object.assign(values, structuredClone(value)); },
    async remove(key) { delete values[key]; },
  });
  globalThis.browser = {
    storage: { local: storage(data), session: storage(session) },
    runtime: { id: 'test-avatar-addon', getURL: path => `moz-extension://test/${path}`,
      onMessage: { addListener(value) { listener = value; } }, async sendMessage() {} },
    scripting: { async executeScript(options) { injections.push(options); } },
    tabs: { async get(id) { assert.equal(id, 7); return { id, active, url }; },
      async reload(id) { reloads.push(id); },
      async sendMessage(id, message) {
        assert.equal(id, 7);
        if (message.operation === 'ping') return { pong: true };
        if (message.channel !== 'sadlaboka-api') return {};
        requests.push(message);
        if (message.path === '/api/users/whoami') return { ok: true, value: { id: userId, nickname: 'SadLaboka' } };
        if (message.method === 'PATCH') { css = message.css; revision++; }
        return { ok: true, value: { id: ACCOUNT.styleId, owner_id: ACCOUNT.userId, owner_type: 'User', css,
          updated_at: `v${revision}`, failed_imports: [], compiledPresent: true } };
      } },
  };
  await import(`../extensions/firefox/background.mjs?avatarTest=${++instance}`);
  const sender = { id: 'test-avatar-addon', frameId: 0, url: 'https://shikimori.io/SadLaboka', tab: { id: 7 } };
  return { requests, reloads, injections, data, sender,
    send: (overrides = {}, message = { channel: 'sadlaboka-avatar', action: 'cycle' }) => listener(message, { ...sender, ...overrides }) };
}

test('page avatar switches without opening the popup and pins its own active tab', async () => {
  const f = await fixture();
  const result = await f.send();
  assert.equal(result.ok, true); assert.equal(result.view.schemeId, 'emerald-scarlet');
  assert.equal(result.pageReloaded, true); assert.deepEqual(f.reloads, [7]);
  assert.equal(f.requests.filter(request => request.method === 'PATCH').length, 1);
  assert.equal(f.data.backups[0].css, schemeCss('main'));
  assert.equal(f.injections.length, 0, 'The running avatar handler must not be reinjected');
});

test('page channel rejects another profile, iframe, inactive or navigated tab and foreign sender', async () => {
  for (const [settings, sender] of [
    [{}, { url: 'https://shikimori.io/OtherUser' }], [{}, { frameId: 1 }],
    [{}, { tab: undefined }], [{ active: false }, {}], [{ url: 'https://shikimori.io/animes' }, {}],
  ]) {
    const f = await fixture(settings); assert.equal((await f.send(sender)).ok, false);
    assert.equal(f.requests.length, 0); assert.equal(f.reloads.length, 0);
  }
  const f = await fixture(); assert.equal(f.send({ id: 'foreign-addon' }), undefined);
  assert.equal(f.send({}, { channel: 'sadlaboka-avatar', action: 'apply', schemeId: 'main' }), undefined);
  assert.equal(f.requests.length, 0);
});

test('page trigger still checks the actual signed-in user and shares the background lock', async () => {
  const wrong = await fixture({ userId: 2 }); const denied = await wrong.send();
  assert.equal(denied.ok, false); assert.match(denied.message, /нужен аккаунт/);
  assert.equal(wrong.requests.some(request => request.method === 'PATCH'), false);
  const f = await fixture(); const first = f.send();
  assert.equal((await f.send()).code, 'busy');
  assert.equal((await f.send({ url: 'moz-extension://test/popup.html' },
    { channel: 'sadlaboka-ui', action: 'inspect' })).code, 'busy');
  assert.equal((await first).ok, true);
  assert.equal(f.requests.filter(request => request.method === 'PATCH').length, 1);
});
