import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ACCOUNT, ORIGIN, recognize, nextSchemeId, schemeCss, sha256 } from '../extensions/firefox/catalog.mjs';
import { recompileStyle, needsCompilation } from '../extensions/firefox/recompile.mjs';

class RotationError extends Error {}

export const INTERVAL = 30 * 60 * 1000;
const STATE = 'SHIKIMORI_ROTATION_STATE';
const SECRET = 'SHIKIMORI_ROTATION_CREDENTIALS';
const REPOSITORY = 'SadLaboka/shikimori';
const hashPattern = /^[a-f0-9]{64}$/;
const stamp = value => {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new RotationError('Некорректное время в состоянии автосмены.');
  return result;
};

export function validateState(state) {
  if (state?.version !== 1 || (state.credentialsHash && !hashPattern.test(state.credentialsHash)) ||
      (state.refreshPending && !state.credentialsHash)) throw new RotationError('Некорректное состояние автосмены.');
  if (state.pending) {
    if (!hashPattern.test(state.pending.desiredHash) || !hashPattern.test(state.pending.beforeHash) ||
        !/^\d+$/.test(String(state.pending.artifactId))) throw new RotationError('Повреждён журнал незавершённой записи.');
    stamp(state.pending.startedAt);
    if (state.pending.compilationAttempted !== undefined && typeof state.pending.compilationAttempted !== 'boolean') {
      throw new RotationError('Повреждена отметка пересборки оформления.');
    }
  }
  if (state.lastAuto) {
    if (!hashPattern.test(state.lastAuto.hash)) throw new RotationError('Повреждена отметка последней автосмены.');
    stamp(state.lastAuto.completedAt); stamp(state.lastAuto.updatedAt);
    if (state.lastAuto.slot !== undefined && (!Number.isSafeInteger(state.lastAuto.slot) || state.lastAuto.slot < 0)) {
      throw new RotationError('Повреждён интервал последней автосмены.');
    }
  }
  return state;
}

export function validateStyle(style) {
  if (style?.id !== ACCOUNT.styleId || style.owner_type !== 'User' || style.owner_id !== ACCOUNT.userId ||
      typeof style.css !== 'string') throw new RotationError('Стиль не принадлежит ожидаемому аккаунту.');
  stamp(style.updated_at);
  return style;
}

export async function planRotation(state, style, now = Date.now()) {
  validateState(state); validateStyle(style);
  if (state.refreshPending) throw new RotationError('Обновление токенов не завершено. Нужна проверка доступа.');
  const beforeHash = await sha256(style.css);
  if (state.pending) {
    if (beforeHash !== state.pending.desiredHash) {
      throw new RotationError('Результат предыдущей записи не подтверждён. Автосмена приостановлена; повторного PATCH нет.');
    }
    return { kind: 'reconciled', state: { ...state, pending: null,
      lastAuto: { hash: beforeHash, updatedAt: style.updated_at, completedAt: new Date(now).toISOString(),
        slot: Math.floor(now / INTERVAL) } } };
  }
  const current = await recognize(style.css);
  if (!current) throw new RotationError('Неизвестный CSS. Автоматика его не перезаписывает.');
  const knownAuto = state.lastAuto?.hash === beforeHash &&
    stamp(state.lastAuto.updatedAt) === stamp(style.updated_at);
  // Scheduling jitter must not turn a 29m59s automated interval into an hour.
  if (knownAuto && state.lastAuto.slot !== undefined && Math.floor(now / INTERVAL) <= state.lastAuto.slot) {
    return { kind: 'waiting', nextAt: new Date((state.lastAuto.slot + 1) * INTERVAL).toISOString() };
  }
  const changedAt = knownAuto ? stamp(state.lastAuto.completedAt) : stamp(style.updated_at);
  if ((!knownAuto || state.lastAuto.slot === undefined) && now - changedAt < INTERVAL) {
    return { kind: 'waiting', nextAt: new Date(changedAt + INTERVAL).toISOString() };
  }
  const schemeId = nextSchemeId(current);
  const css = schemeCss(schemeId);
  return { kind: 'ready', schemeId, css, cssHash: await sha256(css), beforeHash, beforeUpdatedAt: style.updated_at };
}

export async function ensureCredentials({ credentials, state, now, allowRefresh, saveState, saveSecret, refresh, mask }) {
  for (const key of ['clientId', 'clientSecret', 'accessToken', 'refreshToken', 'expiresAt']) {
    if (typeof credentials?.[key] !== 'string' || !credentials[key]) throw new RotationError('Неполные credentials автосмены.');
  }
  mask(credentials);
  validateState(state);
  const hash = await sha256(JSON.stringify(credentials));
  if (state.refreshPending) throw new RotationError('Незавершённое обновление OAuth. Нужна ручная проверка.');
  if (state.credentialsHash && state.credentialsHash !== hash) {
    throw new RotationError('Запуск получил устаревший или заменённый секрет. Нужна новая проверка состояния.');
  }
  if (stamp(credentials.expiresAt) > now + 10 * 60 * 1000) return { credentials, state };
  if (!allowRefresh) throw new RotationError('Токен скоро истечёт. Dry-run не обновляет OAuth.');
  // Persist BEFORE the irreversible token exchange. A lost response stops future runs.
  await saveState({ ...state, credentialsHash: hash, refreshPending: true });
  const response = await refresh(credentials);
  mask(response);
  if (!response?.access_token || !response.refresh_token || !Number.isFinite(response.expires_in) || response.expires_in < 600) {
    throw new RotationError('OAuth вернул неполные credentials. Автосмена приостановлена.');
  }
  const next = { ...credentials, accessToken: response.access_token, refreshToken: response.refresh_token,
    expiresAt: new Date(now + response.expires_in * 1000).toISOString() };
  // One secret holds the entire pair; never split a rotated pair into separate updates.
  await saveSecret(next);
  const nextState = { ...state, credentialsHash: await sha256(JSON.stringify(next)), refreshPending: false };
  await saveState(nextState);
  return { credentials: next, state: nextState };
}

export async function armRotation({ plan, state, enabled, artifactId, saveState, now = Date.now() }) {
  validateState(state);
  if (!enabled || plan.mode !== 'publish' || plan.armed || state.pending || state.refreshPending ||
      plan.stateHash !== await sha256(JSON.stringify(state)) ||
      now - stamp(plan.preparedAt) > 10 * 60 * 1000 || now < stamp(plan.preparedAt) ||
      !/^\d+$/.test(String(artifactId)) || Number(artifactId) <= 0) {
    throw new RotationError('План изменился, устарел, отключён или backup не загружен. Запись запрещена.');
  }
  const pending = { beforeHash: plan.beforeHash, desiredHash: plan.cssHash,
    startedAt: new Date(now).toISOString(), artifactId: String(artifactId) };
  await saveState({ ...state, pending });
  return { ...plan, armed: true };
}

export async function verifyCompilation({ state, style, readStyle, recompile, saveState, allowRepair }) {
  if (!state.pending || await sha256(style.css) !== state.pending.desiredHash || !needsCompilation(style)) return { state, style };
  if (!allowRepair || state.pending.compilationAttempted) {
    throw new RotationError('CSS сохранён, но сборка оформления не подтверждена. Журнал сохранён; повторного PATCH и сброса кэша нет.');
  }
  const nextState = { ...state, pending: { ...state.pending, compilationAttempted: true } };
  await saveState(nextState);
  try { await recompile(style.css); } catch { /* A lost response can still mean a completed compilation. */ }
  const after = await readStyle();
  if (await sha256(after.css) !== state.pending.desiredHash || needsCompilation(after)) {
    throw new RotationError('Пересборка не подтверждена или CSS изменён. Журнал сохранён; повторной отправки нет.');
  }
  return { state: nextState, style: after };
}

function mask(values) {
  for (const [key, value] of Object.entries(values)) {
    if (/token|secret/i.test(key) && typeof value === 'string') {
      process.stdout.write(`::add-mask::${value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}\n`);
    }
  }
}

async function request(url, token, method = 'GET', body, userAgent = 'ShikimoriRotation') {
  let response;
  try {
    response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { Accept: 'application/json', 'User-Agent': userAgent,
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch { throw new RotationError('Сетевой запрос не завершён. Ответ и заголовки скрыты; автоматического повтора нет.'); }
  if (!response.ok) throw new RotationError(`Запрос остановлен: HTTP ${response.status}. Ответ сервера скрыт.`);
  if (response.status === 204) return null;
  try { return await response.json(); } catch { throw new RotationError('Некорректный JSON сервера; ответ скрыт.'); }
}

function githubStore(token) {
  const root = `https://api.github.com/repos/${REPOSITORY}/actions/variables`;
  return {
    async state() {
      const data = await request(`${root}/${STATE}`, token);
      try { return validateState(JSON.parse(data.value)); }
      catch { throw new RotationError('Настрой SHIKIMORI_ROTATION_STATE по инструкции. Состояние не сбрасывается автоматически.'); }
    },
    async enabled() {
      const data = await request(`${root}/SHIKIMORI_ROTATION_ENABLED`, token);
      return data.value === 'true';
    },
    async saveState(state) {
      await request(`${root}/${STATE}`, token, 'PATCH', { name: STATE, value: JSON.stringify(state) });
    },
    async saveSecret(credentials) {
      // gh seals stdin locally using the repository public key. No secret in argv or logs.
      const result = spawnSync('gh', ['secret', 'set', SECRET, '--repo', REPOSITORY], {
        input: JSON.stringify(credentials), encoding: 'utf8', timeout: 60000,
        env: { ...process.env, GH_TOKEN: token, GH_DEBUG: '' }, windowsHide: true,
      });
      if (result.error || result.status !== 0) throw new RotationError('Не удалось сохранить обновлённый секрет. Автосмена приостановлена.');
    },
  };
}

export async function main(command) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== REPOSITORY ||
      !process.env.ROTATION_ADMIN_TOKEN || !process.env.RUNNER_TEMP) {
    throw new RotationError('Этот обработчик предназначен только для workflow автосмены.');
  }
  const mode = process.env.ROTATION_MODE;
  if (!['dry-run', 'publish', 'reconcile'].includes(mode)) throw new RotationError('Неизвестный режим.');
  const store = githubStore(process.env.ROTATION_ADMIN_TOKEN);
  const directory = join(process.env.RUNNER_TEMP, 'shikimori-rotation');
  const planPath = join(directory, 'plan.local.json');
  const output = async (name, value) => {
    if (!process.env.GITHUB_OUTPUT) throw new RotationError('Нет канала результата workflow.');
    await writeFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, { flag: 'a' });
  };
  if (command === 'arm') {
    const plan = JSON.parse(await readFile(planPath, 'utf8'));
    const armed = await armRotation({ plan, state: await store.state(), enabled: await store.enabled(),
      artifactId: process.env.BACKUP_ARTIFACT_ID, saveState: store.saveState });
    await writeFile(planPath, JSON.stringify(armed));
    return;
  }
  let credentials;
  try { credentials = JSON.parse(process.env.ROTATION_CREDENTIALS); }
  catch { throw new RotationError('Не настроен секрет credentials автосмены.'); }
  mask(credentials);
  const applicationName = process.env.ROTATION_APPLICATION_NAME;
  if (!applicationName?.trim() || /[\r\n]/.test(applicationName)) throw new RotationError('Укажи точное имя OAuth-приложения.');
  const api = async (path, method, body) => {
    // Sequential calls leave room for browser extension requests too.
    await new Promise(done => setTimeout(done, 750));
    return request(ORIGIN + path, credentials.accessToken, method, body, applicationName);
  };
  const readStyle = async () => {
    const user = await api('/api/users/whoami');
    if (user.id !== ACCOUNT.userId || user.nickname !== ACCOUNT.nickname) throw new RotationError('Авторизован другой аккаунт.');
    return validateStyle(await api(`/api/styles/${ACCOUNT.styleId}`));
  };
  const recompile = async css => {
    const cookies = new Map();
    await recompileStyle(css, async (path, options) => {
      const response = await fetch(ORIGIN + path, { ...options, signal: AbortSignal.timeout(60000),
        headers: { ...options.headers, 'User-Agent': applicationName,
          ...(cookies.size ? { Cookie: [...cookies.values()].join('; ') } : {}) } });
      for (const header of response.headers.getSetCookie()) {
        const pair = header.split(';')[0];
        cookies.set(pair.slice(0, pair.indexOf('=')), pair);
      }
      return response;
    });
  };
  const verify = (state, style) => verifyCompilation({ state, style, readStyle, recompile,
    saveState: store.saveState, allowRepair: mode === 'publish' });
  if (command === 'settle') {
    const plan = JSON.parse(await readFile(planPath, 'utf8'));
    credentials = JSON.parse(await readFile(plan.credentialsPath, 'utf8'));
    const state = await store.state();
    if (!state.pending || state.pending.desiredHash !== plan.cssHash || state.pending.beforeHash !== plan.beforeHash) {
      throw new RotationError('Журнал записи изменился. Нужна проверка.');
    }
    const verified = await verify(state, await readStyle());
    const result = await planRotation(verified.state, verified.style);
    if (result.kind !== 'reconciled') throw new RotationError('Запись не подтверждена.');
    await store.saveState(result.state);
    console.log('Сохранение подтверждено. Журнал незавершённой операции закрыт.');
    return;
  }
  if (command !== 'prepare') throw new RotationError('Неизвестная команда.');
  await output('ready', 'false');
  if (mode === 'publish' && !await store.enabled()) { console.log('Автосмена отключена.'); return; }
  const ensured = await ensureCredentials({ credentials, state: await store.state(), now: Date.now(),
    allowRefresh: mode === 'publish', saveState: store.saveState, saveSecret: store.saveSecret, mask,
    refresh: item => request(`${ORIGIN}/oauth/token`, '', 'POST', {
      grant_type: 'refresh_token', client_id: item.clientId, client_secret: item.clientSecret, refresh_token: item.refreshToken,
    }, applicationName) });
  credentials = ensured.credentials;
  const verified = await verify(ensured.state, await readStyle());
  const style = verified.style;
  const result = await planRotation(verified.state, style);
  if (result.kind === 'reconciled') {
    if (mode !== 'dry-run') await store.saveState(result.state);
    console.log('Предыдущая запись подтверждена. Нового переключения в этом запуске нет.');
    return;
  }
  if (mode === 'reconcile') { console.log('Незавершённых записей нет.'); return; }
  if (result.kind === 'waiting') { console.log(`Выбранная схема сохраняется минимум до ${result.nextAt}.`); return; }
  await mkdir(directory, { recursive: true });
  const artifacts = resolve('.preview/rotation');
  await mkdir(artifacts, { recursive: true });
  const credentialsPath = join(directory, 'credentials.local.json');
  await writeFile(credentialsPath, JSON.stringify(credentials), { mode: 0o600 });
  await writeFile(join(artifacts, 'before.css'), style.css);
  await writeFile(join(artifacts, 'candidate.css'), result.css);
  await writeFile(join(artifacts, 'backup.json'), JSON.stringify({ account: ACCOUNT, beforeHash: result.beforeHash,
    beforeUpdatedAt: style.updated_at, desiredHash: result.cssHash, schemeId: result.schemeId }, null, 2));
  const configPath = join(directory, 'config.local.json');
  await writeFile(configPath, JSON.stringify({ applicationName, expectedNickname: ACCOUNT.nickname,
    expectedUserId: ACCOUNT.userId, styleId: ACCOUNT.styleId, clientId: credentials.clientId }));
  const plan = { version: 1, mode, armed: false, preparedAt: new Date().toISOString(),
    stateHash: await sha256(JSON.stringify(ensured.state)), credentialsPath, configPath,
    backupDirectory: directory, cssPath: join(artifacts, 'candidate.css'),
    cssHash: result.cssHash, beforeHash: result.beforeHash, beforeUpdatedAt: result.beforeUpdatedAt };
  await writeFile(planPath, JSON.stringify(plan));
  await output('ready', 'true');
  console.log(`Подготовлена схема ${result.schemeId}. SHA256: ${result.cssHash}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv[2]).catch(error => {
    // Never render arbitrary exceptions: JSON parsing, spawn, fetch may include secrets.
    console.error(error instanceof RotationError ? error.message : 'Автосмена остановлена. Проверь настройки и журнал SHIKIMORI_ROTATION_STATE. Служебные подробности скрыты.');
    process.exitCode = 1;
  });
}
