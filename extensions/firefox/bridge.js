/* Runs in Firefox's isolated content-script world. No page listeners or DOM writes. */
(() => {
  if (globalThis.__sadlabokaSchemeBridge) return;
  globalThis.__sadlabokaSchemeBridge = true;
  const stylePath = '/api/styles/1343722';
  function selectStyle(value) {
    return { id: value.id, owner_id: value.owner_id, owner_type: value.owner_type, css: value.css,
      updated_at: value.updated_at, failed_imports: value.failed_imports,
      compiledPresent: typeof value.compiled_css === 'string' && value.compiled_css.trim().length > 0 };
  }
  async function request(message) {
    const { method, path, css } = message;
    if (location.origin !== 'https://shikimori.io' ||
        !(method === 'GET' && ['/api/users/whoami', stylePath].includes(path) || method === 'PATCH' && path === stylePath)) {
      return { ok: false, code: 'invalid' };
    }
    const headers = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    // Revalidate the large public style response; never reuse an unvalidated
    // cached value. Identity and writes must always bypass the HTTP cache.
    const cache = method === 'GET' && path === stylePath ? 'no-cache' : 'no-store';
    const options = { method, headers, credentials: 'include', redirect: 'error', cache, signal: AbortSignal.timeout(20000) };
    if (method === 'PATCH') {
      if (typeof css !== 'string' || !css.trim() || css.length > 512000) return { ok: false, code: 'invalid' };
      const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
      if (!csrf) return { ok: false, code: 'session' };
      headers['X-CSRF-Token'] = csrf;
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify({ style: { css } });
    }
    try {
      const response = await fetch(path, options);
      if (!response.ok) return { ok: false, code: response.status === 401 ? 'login' : response.status === 403 ? 'forbidden' :
        response.status === 422 ? 'session' : response.status === 429 ? 'rate' : 'server' };
      const value = await response.json();
      return { ok: true, value: path === '/api/users/whoami' ? { id: value.id, nickname: value.nickname } : selectStyle(value) };
    } catch { return { ok: false, code: 'network' }; }
  }
  browser.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== browser.runtime.id || message?.channel !== 'sadlaboka-api') return undefined;
    if (message.operation === 'ping') return Promise.resolve({ ok: true, pong: true });
    if (message.operation !== 'request') return undefined;
    return request(message);
  });
})();
