/* Isolated extension listener. No code is executed in Shikimori's JS world. */
(() => {
  if (globalThis.__sadlabokaAvatarSwitch) return;
  globalThis.__sadlabokaAvatarSwitch = true;
  const selector = '.p-profiles .profile-head .c-brief .avatar';
  const stages = { checking: 'Проверяем аккаунт и CSS…', backup: 'Сохраняем предыдущий CSS…',
    publishing: 'Переключаем цветовую схему…', verifying: 'Проверяем сохранение…' };
  let busy = false, notice = null, noticeTimer;
  function ownAvatar() {
    if (location.origin !== 'https://shikimori.io' || !/^\/SadLaboka\/?$/.test(location.pathname)) return null;
    const avatar = document.querySelector(selector);
    return avatar?.querySelector(':scope > img[alt="SadLaboka"]') ? avatar : null;
  }
  function decorate() {
    const avatar = ownAvatar();
    if (!avatar || avatar.hasAttribute('role')) return;
    avatar.setAttribute('role', 'button'); avatar.setAttribute('tabindex', '0');
    avatar.setAttribute('aria-label', 'Переключить цветовую схему');
    avatar.setAttribute('title', 'Следующая цветовая схема');
    avatar.style.cursor = 'pointer';
  }
  function show(text, temporary = false) {
    clearTimeout(noticeTimer);
    if (!notice?.isConnected) {
      notice = document.createElement('div'); notice.setAttribute('role', 'status');
      notice.setAttribute('aria-live', 'polite');
      notice.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:2147483647;max-width:calc(100vw - 40px);padding:10px 14px;border-radius:8px;background:#17191f;color:#f4f4f4;font:14px/1.4 sans-serif;box-shadow:0 2px 12px #0008;pointer-events:none;';
      document.body.append(notice);
    }
    notice.textContent = text;
    if (temporary) noticeTimer = setTimeout(() => notice?.remove(), 7000);
  }
  function inOverlay(avatar, event) {
    const picture = getComputedStyle(avatar, '::before');
    if (picture.content === 'none' || picture.display === 'none' || picture.backgroundImage === 'none') return false;
    const frame = getComputedStyle(avatar, '::after');
    const style = frame.getPropertyValue('--sadlaboka-avatar-frame').trim() === 'rounded-square' ? frame : picture;
    const rect = avatar.getBoundingClientRect();
    const width = parseFloat(style.width), height = parseFloat(style.height);
    const x = rect.left + avatar.clientLeft + (parseFloat(style.left) || 0) + (parseFloat(style.marginLeft) || 0) + width / 2;
    const y = rect.top + avatar.clientTop + (parseFloat(style.top) || 0) + (parseFloat(style.marginTop) || 0) + height / 2;
    if (!(width > 0 && height > 0)) return false;
    // Match the visible contour, including old circular CSS before its first
    // update and the new rounded-square frame. Decorative glow stays noninteractive.
    const transform = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
    const scaleX = Math.abs(transform.a) || 1, scaleY = Math.abs(transform.d) || 1;
    const dx = Math.abs(event.clientX - x) / scaleX, dy = Math.abs(event.clientY - y) / scaleY;
    if (dx > width / 2 || dy > height / 2) return false;
    const corner = style.borderTopLeftRadius.trim().split(/\s+/);
    const radius = (value, size) => Math.min(size / 2, Math.max(0, value.endsWith('%') ? parseFloat(value) * size / 100 : parseFloat(value) || 0));
    const rx = radius(corner[0], width), ry = radius(corner[1] ?? corner[0], height);
    if (!rx || !ry) return true;
    const qx = Math.max(0, dx - (width / 2 - rx)), qy = Math.max(0, dy - (height / 2 - ry));
    return (qx / rx) ** 2 + (qy / ry) ** 2 <= 1;
  }
  async function cycle(avatar) {
    if (busy) return;
    busy = true; avatar.setAttribute('aria-busy', 'true'); show('Проверяем аккаунт и CSS…');
    try {
      const result = await browser.runtime.sendMessage({ channel: 'sadlaboka-avatar', action: 'cycle' });
      const text = result?.message ?? 'Нет связи с расширением. Открой его меню и проверь состояние.';
      show(text + (result?.kind === 'success' && !result.pageReloaded ? ' Обнови страницу, чтобы увидеть схему.' : ''), true);
    } catch { show('Связь прервалась. Проверь результат в меню расширения перед следующим переключением.', true); }
    finally { busy = false; avatar.removeAttribute('aria-busy'); }
  }
  document.addEventListener('click', event => {
    if (!event.isTrusted || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const avatar = ownAvatar();
    if (!avatar || !(event.target instanceof Element) || !avatar.contains(event.target) ||
        event.target.closest('button,input,select,textarea,.profile-actions') || !inOverlay(avatar, event)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void cycle(avatar);
  }, true);
  document.addEventListener('keydown', event => {
    if (!event.isTrusted || event.repeat || !['Enter', ' '].includes(event.key) ||
        event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const avatar = ownAvatar();
    if (!avatar || event.target !== avatar) return;
    event.preventDefault(); event.stopImmediatePropagation(); void cycle(avatar);
  }, true);
  browser.runtime.onMessage.addListener((message, sender) => {
    if (busy && sender.id === browser.runtime.id && sender.url?.startsWith(browser.runtime.getURL('')) &&
        message?.channel === 'sadlaboka-avatar-progress' && Object.hasOwn(stages, message.stage)) show(stages[message.stage]);
    return undefined;
  });
  decorate(); document.addEventListener('turbolinks:load', decorate);
})();
