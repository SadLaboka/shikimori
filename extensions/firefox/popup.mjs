import { SCHEMES } from './catalog.mjs';
const $ = id => document.getElementById(id);
let view = null;
let busy = false;
let retryTimer = null;
const send = data => browser.runtime.sendMessage({ channel: 'sadlaboka-ui', ...data });
const stages = Object.freeze({ checking: 'Проверяем аккаунт и CSS…', backup: 'Сохраняем предыдущий CSS…',
  publishing: 'Публикуем схему…', verifying: 'Проверяем сохранение…' });
browser.runtime.onMessage.addListener((message, sender) => {
  if (!busy || sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('')) ||
      message?.channel !== 'sadlaboka-progress' || !Object.hasOwn(stages, message.stage)) return undefined;
  $('status').dataset.kind = 'loading'; $('status').textContent = stages[message.stage];
  return undefined;
});
for (const scheme of SCHEMES) {
  const card = document.createElement('article'); card.className = `scheme ${scheme.id}`; card.dataset.scheme = scheme.id;
  const content = document.createElement('div');
  const swatches = document.createElement('div'); swatches.className = 'swatches'; swatches.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) swatches.append(document.createElement('i'));
  const title = document.createElement('h2'); title.textContent = scheme.name;
  const description = document.createElement('p'); description.textContent = scheme.description;
  content.append(swatches, title, description);
  const button = document.createElement('button'); button.textContent = 'Применить'; button.disabled = true;
  button.setAttribute('aria-label', `Применить схему «${scheme.name}»`);
  button.addEventListener('click', () => run({ action: 'apply', schemeId: scheme.id, expected: view?.snapshot }));
  card.append(content, button); $('schemes').append(card);
}
function render() {
  for (const card of document.querySelectorAll('.scheme')) {
    card.dataset.current = String(view?.schemeId === card.dataset.scheme);
    card.querySelector('button').disabled = busy || !view?.connected || view.pending;
  }
  $('refresh').disabled = busy;
  $('schemes').setAttribute('aria-busy', String(busy));
  $('reload').disabled = busy;
  $('restore').disabled = busy || !view?.canRestore;
  $('restore').title = view?.backupName ? `Восстановить: ${view.backupName}` : 'Резервная копия появится после первой публикации';
  $('reconcile').hidden = !view?.pending;
  $('reconcile').disabled = busy;
  $('current').textContent = view?.connected ? `Сейчас: ${SCHEMES.find(item => item.id === view.schemeId)?.name ?? 'другой CSS'}` : 'Оформление пока не проверено';
}
async function run(data) {
  if (busy) return;
  clearTimeout(retryTimer);
  let retryInspection = false;
  busy = true; render();
  $('status').dataset.kind = 'loading';
  $('status').textContent = data.action === 'inspect' ? 'Проверяем аккаунт и CSS…' : data.action === 'reconcile' ? 'Проверяем сохранённый CSS…' : 'Сохраняем оформление…';
  try {
    const result = await send(data);
    if (!result?.ok) {
      retryInspection = data.action === 'inspect' && result?.code === 'busy';
      if (data.action === 'inspect') view = null;
      $('status').dataset.kind = retryInspection ? 'loading' : 'error';
      $('status').textContent = retryInspection ? 'Переключение ещё выполняется…' : result?.message ?? 'Нет связи с расширением. Открой меню заново.';
      return;
    }
    if (result.view) view = result.view;
    if (result.kind === 'uncertain') view = { ...view, pending: true, canRestore: false };
    if (typeof result.reloadAfter === 'boolean') $('reload').checked = result.reloadAfter;
    $('status').dataset.kind = result.kind ?? '';
    $('status').textContent = result.message ?? (view?.pending ? 'Есть незавершённая публикация. Сначала проверь её результат.' : 'Выбери оформление.');
  } catch {
    view = { ...view, connected: false };
    $('status').dataset.kind = 'error'; $('status').textContent = 'Связь прервалась. Обнови состояние перед следующим действием.';
  } finally {
    busy = false; render();
    if (retryInspection) retryTimer = setTimeout(() => run({ action: 'inspect' }), 150);
  }
}
$('refresh').addEventListener('click', () => run({ action: 'inspect' }));
$('restore').addEventListener('click', () => run({ action: 'restore', expected: view?.snapshot }));
$('reconcile').addEventListener('click', () => run({ action: 'reconcile' }));
$('open').addEventListener('click', () => send({ action: 'open' }));
$('reload').addEventListener('change', async () => {
  const value = $('reload').checked;
  try { const result = await send({ action: 'settings', reload: value }); if (!result?.ok) throw new Error(); }
  catch { $('reload').checked = !value; $('status').textContent = 'Не удалось сохранить настройку.'; }
});
run({ action: 'inspect' });
