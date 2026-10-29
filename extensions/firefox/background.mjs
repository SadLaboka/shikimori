import { ORIGIN } from './catalog.mjs';
import { Publisher, UserError } from './publisher.mjs';

let selectedTabId = null;
let reloadAfter = true;
let handling = false;
const publisher = new Publisher({ storage: browser.storage.local, request: async request => {
  if (selectedTabId === null) return { ok: false, code: 'network' };
  return browser.tabs.sendMessage(selectedTabId, { channel: 'sadlaboka-api', operation: 'request', ...request }, { frameId: 0 });
} });

async function attach(tabId) {
  let ping;
  try { ping = await browser.tabs.sendMessage(tabId, { channel: 'sadlaboka-api', operation: 'ping' }, { frameId: 0 }); }
  catch { /* Existing tabs need the bridge once after installing the extension. */ }
  if (!ping?.pong) {
    await browser.scripting.executeScript({ target: { tabId }, files: ['bridge.js'] });
    ping = await browser.tabs.sendMessage(tabId, { channel: 'sadlaboka-api', operation: 'ping' }, { frameId: 0 });
  }
  if (!ping?.pong) throw new UserError('Обнови вкладку Shikimori.');
}
async function selectTab() {
  const tabs = await browser.tabs.query({ url: `${ORIGIN}/*`, currentWindow: true });
  const tab = tabs.find(item => item.active) ?? tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
  if (!tab) throw new UserError('Открой Shikimori в этом окне Firefox и войди в аккаунт SadLaboka.');
  await attach(tab.id);
  return tab.id;
}
async function handle(message) {
  if (message.action === 'open') { await browser.tabs.create({ url: `${ORIGIN}/SadLaboka` }); return { ok: true }; }
  if (message.action === 'settings') {
    if (typeof message.reload !== 'boolean') throw new UserError('Некорректная настройка.');
    await browser.storage.local.set({ reloadAfter: message.reload });
    return { ok: true };
  }
  if (!['inspect', 'apply', 'restore', 'reconcile'].includes(message.action)) throw new UserError('Неизвестное действие.');
  if (handling) throw new UserError('Дождись завершения текущей операции.', 'busy');
  handling = true;
  try {
  // Pin the tab for the full transaction, including its session/container.
  const targetTabId = message.action === 'inspect' ? await selectTab() : selectedTabId;
  if (targetTabId === null) throw new UserError('Обнови состояние оформления.');
  if (publisher.busy) throw new UserError('Дождись завершения текущей операции.', 'busy');
  selectedTabId = targetTabId;
  const preferences = await browser.storage.local.get('reloadAfter');
  reloadAfter = preferences.reloadAfter !== false;
  let result;
  if (message.action === 'inspect') result = { view: await publisher.inspect() };
  if (message.action === 'apply') result = await publisher.apply(message.schemeId, message.expected);
  if (message.action === 'restore') result = await publisher.restore(message.expected);
  if (message.action === 'reconcile') result = await publisher.reconcile();
  if (result.kind === 'success' && reloadAfter) {
    try {
      const tab = await browser.tabs.get(targetTabId);
      if (tab.active && new URL(tab.url).origin === ORIGIN) await browser.tabs.reload(targetTabId);
    } catch { result.message += ' Обнови вкладку Shikimori вручную.'; }
  }
  return { ok: true, ...result, reloadAfter };
  } finally { handling = false; }
}
browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('')) || message?.channel !== 'sadlaboka-ui') return undefined;
  return handle(message).catch(error => ({ ok: false, code: error instanceof UserError ? error.code : 'error',
    message: error instanceof UserError ? error.message : 'Операция остановлена. Обнови состояние; повторная запись автоматически не выполняется.' }));
});
