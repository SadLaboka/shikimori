import { ORIGIN } from './catalog.mjs';
import { Publisher, UserError } from './publisher.mjs';
import { ApiRateLimiter } from './rate-limit.mjs';

let selectedTabId = null;
let reloadAfter = true;
let handling = false;
let avatarOperation = false;
const publisher = new Publisher({ storage: browser.storage.local,
  limiter: new ApiRateLimiter({ storage: browser.storage.session }),
  onStage: stage => {
    browser.runtime.sendMessage({ channel: 'sadlaboka-progress', stage }).catch(() => {});
    if (avatarOperation && selectedTabId !== null) browser.tabs.sendMessage(selectedTabId,
      { channel: 'sadlaboka-avatar-progress', stage }, { frameId: 0 }).catch(() => {});
  },
  request: async request => {
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
  await browser.scripting.executeScript({ target: { tabId }, files: ['avatar.js'] });
}
async function selectTab() {
  const tabs = await browser.tabs.query({ url: `${ORIGIN}/*`, currentWindow: true });
  const tab = tabs.find(item => item.active) ?? tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
  if (!tab) throw new UserError('Открой Shikimori в этом окне Firefox и войди в аккаунт SadLaboka.');
  await attach(tab.id);
  return tab.id;
}
function ownProfile(url) {
  try { const value = new URL(url); return value.origin === ORIGIN && /^\/SadLaboka\/?$/.test(value.pathname); }
  catch { return false; }
}
async function avatarTab(sender) {
  if (sender.frameId !== 0 || !Number.isInteger(sender.tab?.id) || !ownProfile(sender.url)) {
    throw new UserError('Переключение доступно на странице профиля SadLaboka.');
  }
  const tab = await browser.tabs.get(sender.tab.id);
  if (!tab.active || !ownProfile(tab.url)) throw new UserError('Вернись на вкладку профиля SadLaboka.');
  await attach(tab.id);
  return tab.id;
}
async function handle(message, sender = null) {
  if (message.action === 'open') { await browser.tabs.create({ url: `${ORIGIN}/SadLaboka` }); return { ok: true }; }
  if (message.action === 'settings') {
    if (typeof message.reload !== 'boolean') throw new UserError('Некорректная настройка.');
    await browser.storage.local.set({ reloadAfter: message.reload });
    return { ok: true };
  }
  if (!['inspect', 'apply', 'restore', 'reconcile', 'cycle'].includes(message.action) ||
      message.action === 'cycle' && !sender) throw new UserError('Неизвестное действие.');
  if (handling) throw new UserError('Дождись завершения текущей операции.', 'busy');
  handling = true;
  try {
  // Pin the tab for the full transaction, including its session/container.
  const targetTabId = message.action === 'cycle' ? await avatarTab(sender) :
    message.action === 'inspect' ? await selectTab() : selectedTabId;
  if (targetTabId === null) throw new UserError('Обнови состояние оформления.');
  if (publisher.busy) throw new UserError('Дождись завершения текущей операции.', 'busy');
  selectedTabId = targetTabId;
  avatarOperation = message.action === 'cycle';
  const preferences = await browser.storage.local.get('reloadAfter');
  reloadAfter = preferences.reloadAfter !== false;
  let result;
  if (message.action === 'inspect') result = { view: await publisher.inspect() };
  if (message.action === 'apply') result = await publisher.apply(message.schemeId, message.expected);
  if (message.action === 'restore') result = await publisher.restore(message.expected);
  if (message.action === 'reconcile') result = await publisher.reconcile();
  if (message.action === 'cycle') result = await publisher.cycle();
  let pageReloaded = false;
  if (result.kind === 'success' && reloadAfter) {
    try {
      const tab = await browser.tabs.get(targetTabId);
      if (tab.active && new URL(tab.url).origin === ORIGIN) { await browser.tabs.reload(targetTabId); pageReloaded = true; }
    } catch { result.message += ' Обнови вкладку Shikimori вручную.'; }
  }
  return { ok: true, ...result, reloadAfter, pageReloaded };
  } finally { avatarOperation = false; handling = false; }
}
browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== browser.runtime.id) return undefined;
  let operation;
  if (message?.channel === 'sadlaboka-avatar' && message.action === 'cycle') operation = handle({ action: 'cycle' }, sender);
  else if (sender.url?.startsWith(browser.runtime.getURL('')) && message?.channel === 'sadlaboka-ui') operation = handle(message);
  else return undefined;
  return operation.catch(error => ({ ok: false, code: error instanceof UserError ? error.code : 'error',
    message: error instanceof UserError ? error.message : 'Операция остановлена. Обнови состояние; повторная запись автоматически не выполняется.' }));
});
