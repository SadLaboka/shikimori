import { ACCOUNT, SCHEMES, schemeCss, sha256, recognize } from './catalog.mjs';

export class UserError extends Error {
  constructor(message, code = 'error') { super(message); this.code = code; }
}
export const SAFE_ERRORS = Object.freeze({
  login: 'Войди в Shikimori в выбранной вкладке.',
  forbidden: 'Shikimori не разрешил изменение этого стиля.',
  session: 'Обнови вкладку Shikimori и попробуй ещё раз: сеанс требует обновления.',
  rate: 'Shikimori ограничил частоту запросов. Подожди немного.',
  server: 'Shikimori вернул ошибку. Результат нужно проверить.',
  network: 'Нет ответа Shikimori. Проверь соединение и результат операции.',
  invalid: 'Получен неподдерживаемый запрос.',
});
const STYLE_PATH = `/api/styles/${ACCOUNT.styleId}`;
export class Publisher {
  constructor({ request, storage, now = () => Date.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), interval = 700 }) {
    Object.assign(this, { request, storage, now, sleep, interval });
    this.busy = false; this.lastRequest = -Infinity;
  }
  async exclusive(action) {
    if (this.busy) throw new UserError('Дождись завершения текущей операции.', 'busy');
    this.busy = true;
    try { return await action(); } finally { this.busy = false; }
  }
  async api(method, path, css) {
    const delay = this.interval - (this.now() - this.lastRequest);
    if (delay > 0) await this.sleep(delay);
    this.lastRequest = this.now();
    let response;
    try { response = await this.request({ method, path, ...(css === undefined ? {} : { css }) }); }
    catch { throw new UserError(SAFE_ERRORS.network); }
    if (!response?.ok) throw new UserError(SAFE_ERRORS[response?.code] ?? SAFE_ERRORS.network);
    return response.value;
  }
  async readStyle() {
    const style = await this.api('GET', STYLE_PATH);
    if (style?.id !== ACCOUNT.styleId || style.owner_id !== ACCOUNT.userId || style.owner_type !== 'User' ||
        typeof style.css !== 'string' || style.css.length > 512000 || typeof style.updated_at !== 'string' ||
        !Array.isArray(style.failed_imports)) throw new UserError('Ответ Shikimori не соответствует ожидаемому стилю.');
    return style;
  }
  async identify() {
    const identity = await this.api('GET', '/api/users/whoami');
    if (identity?.id !== ACCOUNT.userId || identity.nickname !== ACCOUNT.nickname) {
      throw new UserError('В этой вкладке нужен аккаунт SadLaboka. Другой аккаунт изменён не будет.');
    }
  }
  async view(style) {
    const state = await this.storage.get(['backups', 'pending']);
    const hash = await sha256(style.css);
    const backup = (state.backups ?? []).find(item => item.appliedHash === hash && item.styleId === ACCOUNT.styleId);
    return { connected: true, schemeId: await recognize(style.css), snapshot: { hash, updatedAt: style.updated_at },
      pending: Boolean(state.pending), canRestore: Boolean(backup) && !state.pending, backupName: backup?.name ?? null };
  }
  inspect() {
    return this.exclusive(async () => { await this.identify(); return this.view(await this.readStyle()); });
  }
  apply(id, expected) {
    if (!SCHEMES.some(scheme => scheme.id === id)) return Promise.reject(new UserError('Неизвестная схема.'));
    return this.exclusive(() => this.write(schemeCss(id), expected, id));
  }
  restore(expected) {
    return this.exclusive(async () => {
      const { backups = [] } = await this.storage.get('backups');
      const backup = backups.find(item => item.appliedHash === expected?.hash && item.styleId === ACCOUNT.styleId);
      if (!backup || typeof backup.css !== 'string' || await sha256(backup.css) !== backup.sha256) {
        throw new UserError('Подходящая резервная копия отсутствует или повреждена.');
      }
      return this.write(backup.css, expected, await recognize(backup.css));
    });
  }
  async write(css, expected, schemeId) {
    const state = await this.storage.get(['pending', 'backups']);
    if (state.pending) throw new UserError('Сначала проверь результат предыдущей публикации.');
    if (!expected || !/^[a-f0-9]{64}$/.test(expected.hash) || typeof expected.updatedAt !== 'string') {
      throw new UserError('Сначала обнови состояние оформления.');
    }
    if (typeof css !== 'string' || !css.trim() || css.length > 512000) throw new UserError('Пустой или слишком большой CSS не отправляется.');
    await this.identify();
    const before = await this.readStyle();
    const beforeHash = await sha256(before.css);
    if (beforeHash !== expected.hash || before.updated_at !== expected.updatedAt) {
      throw new UserError('CSS изменился после открытия меню. Обнови состояние и выбери схему заново.');
    }
    const desiredHash = await sha256(css);
    if (beforeHash === desiredHash) return { kind: 'unchanged', message: 'Эта схема уже установлена.', view: await this.view(before) };
    const previousId = await recognize(before.css);
    const backup = { id: crypto.randomUUID(), styleId: ACCOUNT.styleId, css: before.css, sha256: beforeHash,
      appliedHash: desiredHash, name: SCHEMES.find(item => item.id === previousId)?.name ?? 'Сохранённое оформление',
      savedAt: new Date(this.now()).toISOString() };
    const pending = { beforeHash, desiredHash, schemeId, startedAt: this.now(), phase: 'prepared' };
    // Both must be durable before any PATCH; storage failure stops publication.
    await this.storage.set({ backups: [backup, ...(state.backups ?? [])].slice(0, 5), pending });
    const latest = await this.readStyle();
    if (await sha256(latest.css) !== beforeHash || latest.updated_at !== before.updated_at) {
      await this.storage.remove('pending');
      throw new UserError('CSS изменился во время подготовки. Запись отменена.');
    }
    pending.phase = 'sending';
    await this.storage.set({ pending });
    try { await this.api('PATCH', STYLE_PATH, css); }
    catch { /* A failed response may still mean a successful PATCH. Never repeat it. */ }
    let after;
    try { after = await this.readStyle(); }
    catch { return { kind: 'uncertain', message: 'Ответ потерян. Нажми «Проверить результат»; повторная отправка заблокирована.' }; }
    return this.finish(after, pending, false);
  }
  async finish(style, pending, reconciliation) {
    const currentHash = await sha256(style.css);
    if (currentHash === pending.desiredHash) {
      await this.storage.remove('pending');
      const warning = style.failed_imports.length > 0 || !style.compiledPresent;
      return { kind: warning ? 'warning' : 'success',
        message: warning ? 'CSS сохранён, но Shikimori не загрузил всё оформление. Можно вернуть предыдущий CSS.' : 'Оформление сохранено.',
        view: await this.view(style) };
    }
    if (reconciliation && currentHash !== pending.beforeHash) {
      await this.storage.remove('pending');
      return { kind: 'warning', message: 'На сервере другой CSS. Он сохранён без изменений; обнови состояние.', view: await this.view(style) };
    }
    if (reconciliation && this.now() - pending.startedAt >= 60000) {
      await this.storage.remove('pending');
      return { kind: 'unchanged', message: 'Проверено: остался прежний CSS. Можно выбрать схему заново.', view: await this.view(style) };
    }
    return { kind: 'uncertain', message: 'Результат пока не подтверждён. Подожди минуту и нажми «Проверить результат». Повторной отправки нет.' };
  }
  reconcile() {
    return this.exclusive(async () => {
      await this.identify();
      const { pending } = await this.storage.get('pending');
      const style = await this.readStyle();
      return pending ? this.finish(style, pending, true) : { kind: 'unchanged', message: 'Незавершённых публикаций нет.', view: await this.view(style) };
    });
  }
}
