/* A local editor UI lock. GitHub authorization still protects repository writes. */
(function () {
  'use strict';

  let unlocked = false;
  let active = null;

  function decode(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('config');
    return Uint8Array.from(atob(value), function (char) { return char.charCodeAt(0); });
  }

  async function loadVerifier() {
    const url = new URL('content/editor-access.json', document.baseURI);
    const response = await fetch(url.toString(), { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('config');
    const config = await response.json();
    if (!config || config.version !== 1 || config.algorithm !== 'PBKDF2-SHA-256' ||
        !Number.isInteger(config.iterations) || config.iterations < 100000 || config.iterations > 1000000) throw new Error('config');
    const salt = decode(config.salt);
    const verifier = decode(config.verifier);
    if (salt.length < 16 || salt.length > 64 || verifier.length !== 32) throw new Error('config');
    return { salt: salt, verifier: verifier, iterations: config.iterations };
  }

  function finish(session, accepted) {
    if (active !== session) return;
    active = null;
    session.input.value = '';
    if (accepted) unlocked = true;
    if (session.dialog.open) session.dialog.close();
    session.dialog.remove();
    document.body.classList.remove('editor-access-open');
    if (session.previousFocus && session.previousFocus.isConnected) session.previousFocus.focus({ preventScroll: true });
    session.resolve(accepted);
  }

  async function submit(session, event) {
    event.preventDefault();
    if (active !== session || session.busy) return;
    if (!session.input.value) {
      session.error.textContent = '请输入编辑密码。';
      session.input.focus();
      return;
    }
    let password = session.input.value;
    session.input.value = '';
    session.busy = true;
    session.input.disabled = true;
    session.submit.disabled = true;
    session.submit.textContent = '验证中…';
    session.error.textContent = '';
    session.input.removeAttribute('aria-invalid');
    try {
      if (!window.crypto || !window.crypto.subtle) throw new Error('crypto');
      const config = await loadVerifier();
      if (active !== session) return;
      const bytes = new TextEncoder().encode(password);
      password = '';
      let key;
      try { key = await window.crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveBits']); }
      finally { bytes.fill(0); }
      if (active !== session) return;
      const bits = await window.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: config.salt, iterations: config.iterations }, key, 256);
      if (active !== session) return;
      const actual = new Uint8Array(bits);
      let difference = 0;
      for (let i = 0; i < actual.length; i += 1) difference |= actual[i] ^ config.verifier[i];
      actual.fill(0);
      if (difference === 0) { finish(session, true); return; }
      session.error.textContent = '密码不正确，请重试。';
      session.input.setAttribute('aria-invalid', 'true');
    } catch (error) {
      if (active === session) session.error.textContent = error.message === 'crypto'
        ? '浏览器不支持验证，请使用 HTTPS 地址或 localhost。'
        : '无法读取编辑验证，请检查网络后重试。';
    } finally {
      password = '';
      if (active === session) {
        session.busy = false;
        session.input.disabled = false;
        session.submit.disabled = false;
        session.submit.textContent = '解锁';
        session.input.focus();
      }
    }
  }

  function request() {
    if (unlocked) return Promise.resolve(true);
    if (active) return active.promise;
    const dialog = document.createElement('dialog');
    dialog.className = 'editor-access-dialog';
    dialog.setAttribute('aria-labelledby', 'editorAccessTitle');
    dialog.innerHTML = '<form class="editor-access-form" novalidate>' +
      '<span class="editor-access-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="3"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"></path></svg></span>' +
      '<h2 id="editorAccessTitle">编辑验证</h2>' +
      '<label for="editorAccessPassword">编辑密码</label>' +
      '<input id="editorAccessPassword" name="editor-password" type="password" autocomplete="current-password" autocapitalize="none" spellcheck="false" aria-describedby="editorAccessError" autofocus>' +
      '<p class="editor-access-error" id="editorAccessError" role="alert" aria-live="polite"></p>' +
      '<div class="editor-access-actions"><button type="button" class="button quiet" data-editor-cancel>取消</button><button type="submit" class="button primary">解锁</button></div>' +
      '</form>';
    const session = {
      dialog: dialog, input: dialog.querySelector('input'), error: dialog.querySelector('[role="alert"]'),
      submit: dialog.querySelector('[type="submit"]'), previousFocus: document.activeElement, busy: false
    };
    session.promise = new Promise(function (resolve) { session.resolve = resolve; });
    active = session;
    dialog.querySelector('form').addEventListener('submit', function (event) { submit(session, event); });
    dialog.querySelector('[data-editor-cancel]').addEventListener('click', function () { finish(session, false); });
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); finish(session, false); });
    dialog.addEventListener('close', function () { finish(session, false); });
    dialog.addEventListener('click', function (event) { if (event.target === dialog) finish(session, false); });
    document.body.appendChild(dialog);
    document.body.classList.add('editor-access-open');
    try { dialog.showModal(); session.input.focus(); }
    catch (error) { finish(session, false); }
    return session.promise;
  }

  window.EditorAccess = Object.freeze({
    request: request,
    isUnlocked: function () { return unlocked; },
    lock: function () { unlocked = false; if (active) finish(active, false); }
  });
})();
