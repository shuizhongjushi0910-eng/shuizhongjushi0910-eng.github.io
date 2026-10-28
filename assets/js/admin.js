(function () {
  'use strict';

  const U = window.SiteUtils;
  const API = 'https://api.github.com';
  const CONTENT_PATH = 'content/site.json';
  const TOKEN_KEY = U.storageKey('anthony-admin-token');
  const CONFIG_KEY = U.storageKey('anthony-admin-config');
  const PREVIEW_KEY = U.storageKey('anthony-preview-content');
  const PREVIEW_BASE_KEY = U.storageKey('anthony-preview-base');
  const MAX_UPLOAD = 48 * 1024 * 1024;
  const YEAR = new Date().getFullYear();

  const TABS = {
    site: { eyebrow: 'SITE', title: '首页与关于', hint: '修改站点标题、个人介绍和关于页面的内容。' },
    products: { eyebrow: 'BRANDS', title: '品牌', hint: '每个品牌是首页的一张卡片。可以新增、删除或调整顺序，删除品牌会同时移除它的影像、下载和手记。' },
    videos: { eyebrow: 'FILMS', title: '影像', hint: '粘贴哔哩哔哩链接即可。播放器嵌在网页里，不占用站点存储。' },
    downloads: { eyebrow: 'DOWNLOADS', title: '下载', hint: '安装包可以上传到仓库的 downloads 目录，也可以直接填 GitHub Releases 或其他外部链接。' },
    notes: { eyebrow: 'NOTES', title: '手记', hint: '每篇手记都支持简单的 Markdown。它会显示在对应品牌的手记层里。' },
    publish: { eyebrow: 'DEPLOY', title: '发布', hint: '把内容提交回 GitHub。Pages 会自动重新部署，通常一两分钟后生效。' }
  };

  const state = {
    content: null,
    original: null,
    sha: null,
    localSeed: null,
    connection: null,
    connected: false,
    dirty: false,
    busy: false,
    connecting: false,
    activeUploads: 0,
    tab: 'site',
    publishMessage: '',
    publishState: '',
    publishUrl: '',
    commitUrl: ''
  };

  const els = {
    connectView: document.getElementById('connectView'),
    studioView: document.getElementById('studioView'),
    connectForm: document.getElementById('connectForm'),
    connectButton: document.getElementById('connectButton'),
    localEditButton: document.getElementById('localEditButton'),
    connectError: document.getElementById('connectError'),
    ownerInput: document.getElementById('ownerInput'),
    repoInput: document.getElementById('repoInput'),
    branchInput: document.getElementById('branchInput'),
    tokenInput: document.getElementById('tokenInput'),
    saveStatus: document.getElementById('saveStatus'),
    previewDraft: document.getElementById('previewDraft'),
    publishTop: document.getElementById('publishTop'),
    themeToggle: document.getElementById('themeToggle'),
    repoChip: document.getElementById('repoChip'),
    repoName: document.getElementById('repoName'),
    branchName: document.getElementById('branchName'),
    studioTabs: document.getElementById('studioTabs'),
    productCount: document.getElementById('productCount'),
    videoCount: document.getElementById('videoCount'),
    downloadCount: document.getElementById('downloadCount'),
    noteCount: document.getElementById('noteCount'),
    panelEyebrow: document.getElementById('panelEyebrow'),
    panelTitle: document.getElementById('panelTitle'),
    panelHint: document.getElementById('panelHint'),
    panelActions: document.getElementById('panelActions'),
    panelBody: document.getElementById('panelBody'),
    disconnectButton: document.getElementById('disconnectButton'),
    toast: document.getElementById('adminToast'),
    importFile: document.getElementById('importFile')
  };

  let toastTimer = 0;
  let previewTimer = 0;
  let adminReady = false;

  init();

  async function init() {
    initTheme();
    const unlock = document.getElementById('unlockAdmin');
    if (unlock) unlock.addEventListener('click', unlockAdmin);
    await unlockAdmin();
  }

  function hasEditorAccess() {
    return !!(window.EditorAccess && window.EditorAccess.isUnlocked());
  }

  async function unlockAdmin() {
    const hint = document.getElementById('adminAccessHint');
    if (!window.EditorAccess) {
      if (hint) hint.textContent = '编辑验证未加载，请刷新重试。';
      return;
    }
    if (!await window.EditorAccess.request()) return;
    document.body.classList.remove('admin-access-locked');
    document.getElementById('adminAccess').classList.add('hidden');
    if (!adminReady) {
      adminReady = true;
      restoreConfig();
      bindEvents();
      updateSaveStatus();
      try { state.localSeed = await loadLocalSeed(); }
      catch (error) { state.localSeed = null; }
    }
  }

  function initTheme() {
    const apply = function (theme) {
      const next = theme === 'dark' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      document.documentElement.style.colorScheme = next;
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', next === 'dark' ? '#0b0c0f' : '#f2f0ec');
      els.themeToggle.setAttribute('aria-label', next === 'dark' ? '切换到浅色模式' : '切换到深色模式');
    };
    apply(document.documentElement.dataset.theme);
    els.themeToggle.addEventListener('click', function () {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      apply(next);
      try { localStorage.setItem('anthony-theme', next); } catch (error) { /* noop */ }
    });
  }

  function getStoredToken() {
    try {
      localStorage.removeItem('anthony-admin-token');
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem('anthony-admin-token');
      return sessionStorage.getItem(TOKEN_KEY) || '';
    } catch (error) {
      return '';
    }
  }

  function storeToken(token) {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
      localStorage.removeItem(TOKEN_KEY);
    } catch (error) { /* noop */ }
  }

  function storeConfig() {
    if (!state.connection) return;
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify({
        owner: state.connection.owner,
        repo: state.connection.repo,
        branch: state.connection.branch
      }));
    } catch (error) { /* noop */ }
  }

  function restoreConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      const config = raw ? JSON.parse(raw) : {};
      if (config.owner) els.ownerInput.value = config.owner;
      if (config.repo) els.repoInput.value = config.repo;
      if (config.branch) els.branchInput.value = config.branch;
    } catch (error) { /* noop */ }
    if (getStoredToken()) els.tokenInput.placeholder = '已保存，留空继续使用';
  }

  async function loadLocalSeed() {
    if (window.location.protocol === 'file:') {
      throw new Error('本地文件模式无法读取 JSON');
    }
    const response = await fetch('content/site.json?v=' + Date.now(), { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return U.normalizeContent(await response.json());
  }

  function minimalContent() {
    return U.normalizeContent({
      version: 1,
      updatedAt: new Date().toISOString(),
      site: {
        brand: 'Anthony',
        brandMark: 'A',
        tagline: '独立产品作品集',
        title: 'Anthony · 独立产品',
        description: '',
        copyright: '© ' + YEAR + ' Anthony',
        repoUrl: ''
      },
      profile: {
        headline: '把想法，做进日常。',
        intro: '',
        bio: '',
        links: [],
        email: ''
      },
      products: [],
      videos: [],
      downloads: [],
      notes: []
    });
  }

  function bindEvents() {
    els.connectForm.addEventListener('submit', function (event) {
      event.preventDefault();
      connectToRepo();
    });

    els.localEditButton.addEventListener('click', startLocalEdit);
    els.disconnectButton.addEventListener('click', disconnect);
    els.publishTop.addEventListener('click', publish);
    els.previewDraft.addEventListener('click', previewDraft);

    els.studioTabs.addEventListener('click', function (event) {
      const button = event.target.closest('[data-tab]');
      if (!button) return;
      switchTab(button.getAttribute('data-tab'));
    });

    document.addEventListener('click', onDocumentClick);
    els.panelBody.addEventListener('input', onFieldInput);
    els.panelBody.addEventListener('change', onFieldChange);

    els.importFile.addEventListener('change', importJson);
    window.addEventListener('beforeunload', function (event) {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  function setConnectError(message) {
    if (!message) {
      els.connectError.textContent = '';
      els.connectError.classList.add('hidden');
      return;
    }
    els.connectError.textContent = message;
    els.connectError.classList.remove('hidden');
  }

  function setButtonBusy(button, busy, busyLabel, normalLabel) {
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? busyLabel : normalLabel;
  }

  async function connectToRepo() {
    if (!hasEditorAccess()) return;
    if (state.connecting || state.busy || state.activeUploads) return;
    const owner = els.ownerInput.value.trim();
    const repo = els.repoInput.value.trim();
    let branch = els.branchInput.value.trim();
    const token = els.tokenInput.value.trim() || getStoredToken();

    setConnectError('');
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo) || repo === '.' || repo === '..') {
      setConnectError('请填写 GitHub 用户名和仓库名。');
      return;
    }
    if (!token) {
      setConnectError('请填写 Personal access token。Token 需要 Contents: Read and write 权限。');
      els.tokenInput.focus();
      return;
    }

    state.connecting = true;
    els.localEditButton.disabled = true;
    setButtonBusy(els.connectButton, true, '连接中…', '连接并读取');
    try {
      const repoInfo = await apiRequest('GET', '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo), null, { token: token });
      if (!branch) branch = repoInfo.default_branch || 'main';
      await apiRequest('GET', '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/branches/' + encodeURIComponent(branch), null, { token: token });
      state.connection = { owner: owner, repo: repo, branch: branch, token: token };
      await loadRemoteContent();
      state.connected = true;
      storeToken(token);
      els.tokenInput.value = '';
      els.tokenInput.placeholder = '当前标签页已连接';
      storeConfig();
      enterStudio();
      toast('已连接 ' + owner + '/' + repo);
    } catch (error) {
      state.connection = null;
      setConnectError(formatApiError(error));
    } finally {
      state.connecting = false;
      els.localEditButton.disabled = false;
      setButtonBusy(els.connectButton, false, '连接中…', '连接并读取');
    }
  }

  async function startLocalEdit() {
    if (!hasEditorAccess()) return;
    if (state.connecting || state.busy || state.activeUploads) return;
    state.connecting = true;
    setConnectError('');
    els.localEditButton.disabled = true;
    els.connectButton.disabled = true;
    try {
      if (!state.localSeed) state.localSeed = await loadLocalSeed();
      state.content = U.clone(state.localSeed);
      state.original = U.clone(state.content);
      state.sha = null;
      state.connected = false;
      state.connection = null;
      state.dirty = false;
      enterStudio();
      toast('正在本地编辑，不会提交到 GitHub');
    } catch (error) {
      setConnectError('无法读取本地内容：' + error.message);
    } finally {
      state.connecting = false;
      els.localEditButton.disabled = false;
      els.connectButton.disabled = false;
    }
  }

  function enterStudio() {
    if (!state.content) return;
    els.connectView.classList.add('hidden');
    els.studioView.classList.remove('hidden');
    if (els.previewDraft) els.previewDraft.classList.remove('hidden');
    if (els.publishTop) els.publishTop.classList.toggle('hidden', !state.connected);
    if (state.connected && state.connection) {
      els.repoChip.classList.remove('is-local');
      els.repoName.textContent = state.connection.owner + '/' + state.connection.repo;
      els.branchName.textContent = state.connection.branch;
      document.title = '内容管理 · ' + state.connection.repo;
    } else {
      els.repoChip.classList.add('is-local');
      els.repoName.textContent = '本地编辑';
      els.branchName.textContent = '不会提交';
      document.title = '内容管理 · 本地预览';
    }
    updateCounts();
    updateSaveStatus();
    switchTab('site', true);
  }

  function disconnect() {
    if (state.connecting || state.busy || state.activeUploads) { toast('请等待当前操作完成'); return; }
    if (state.dirty && !window.confirm('还有未发布的修改。断开连接会丢失这些修改，确定继续吗？')) return;
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem('anthony-admin-token');
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem('anthony-admin-token');
      localStorage.removeItem(PREVIEW_KEY);
      localStorage.removeItem(PREVIEW_BASE_KEY);
    } catch (error) { /* noop */ }
    els.tokenInput.value = '';
    els.tokenInput.placeholder = 'github_pat_...';
    state.content = null;
    state.original = null;
    state.sha = null;
    state.connected = false;
    state.connection = null;
    state.dirty = false;
    state.busy = false;
    state.activeUploads = 0;
    state.publishMessage = '';
    state.publishState = '';
    state.publishUrl = '';
    els.studioView.classList.add('hidden');
    els.connectView.classList.remove('hidden');
    els.publishTop.classList.add('hidden');
    els.previewDraft.classList.add('hidden');
    els.saveStatus.textContent = '未连接';
    els.saveStatus.className = 'save-status';
    document.title = '内容管理 · Anthony';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function apiRequest(method, path, body, options) {
    const opts = options || {};
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    const token = opts.token || (state.connection && state.connection.token);
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body) headers['Content-Type'] = 'application/json';

    let response;
    try {
      response = await fetch(API + path, {
        method: method,
        headers: headers,
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store'
      });
    } catch (error) {
      const wrapped = new Error('网络连接失败，或浏览器阻止了 GitHub API 请求。');
      wrapped.cause = error;
      throw wrapped;
    }

    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (error) { data = null; }
    }
    if (response.ok) return data;
    if (response.status === 404 && opts.allow404) return null;
    const apiMessage = data && data.message ? data.message : ('HTTP ' + response.status);
    const error = new Error(apiMessage);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  function formatApiError(error) {
    if (!error) return '未知错误';
    if (error.status === 401) return 'Token 无效或已过期。请重新生成一个具有 Contents: Read and write 权限的 Token。';
    if (error.status === 403) return 'GitHub 拒绝了这次操作。请确认 Token 对该仓库有 Contents: Read and write 权限，且没有触发速率限制。';
    if (error.status === 404) return '找不到仓库或分支。请检查 owner、repo、branch 是否正确，以及 Token 是否有权限访问。';
    if (error.status === 409) return '仓库内容刚被其他操作更新，请重新读取后再发布。';
    if (error.status === 422) return 'GitHub 无法完成这个操作。可能是分支受保护、文件名冲突或文件过大。';
    return error.message || '操作失败';
  }

  async function loadRemoteContent() {
    const path = '/repos/' + encodeURIComponent(state.connection.owner) + '/' + encodeURIComponent(state.connection.repo) + '/contents/' + encodeContentPath(CONTENT_PATH) + '?ref=' + encodeURIComponent(state.connection.branch);
    const info = await apiRequest('GET', path, null, { allow404: true });
    if (!info) {
      state.content = U.clone(state.localSeed || minimalContent());
      state.sha = null;
      state.original = U.clone(state.content);
      state.dirty = false;
      return;
    }
    const text = U.decodeBase64Utf8(info.content || '');
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error('仓库里的 content/site.json 不是有效的 JSON，请先在 GitHub 中修复。');
    }
    state.content = U.normalizeContent(parsed);
    state.original = U.clone(state.content);
    state.sha = info.sha || null;
    state.dirty = false;
  }

  function encodeContentPath(path) {
    return String(path).split('/').map(encodeURIComponent).join('/');
  }

  function updateCounts() {
    if (!state.content) return;
    els.productCount.textContent = String(state.content.products.length);
    els.videoCount.textContent = String(state.content.videos.length);
    els.downloadCount.textContent = String(state.content.downloads.length);
    els.noteCount.textContent = String(state.content.notes.length);
  }

  function updateSaveStatus() {
    if (!els.saveStatus) return;
    let text = '未连接';
    let kind = '';
    if (state.content) {
      if (!state.connected) text = '本地编辑';
      else if (state.busy) text = '发布中…';
      else if (state.activeUploads > 0) text = '上传中…';
      else if (state.dirty) { text = '未发布更改'; kind = 'is-dirty'; }
      else { text = '已同步'; kind = 'is-saved'; }
    }
    els.saveStatus.textContent = text;
    els.saveStatus.className = 'save-status ' + kind;
    const locked = state.busy || state.activeUploads > 0;
    els.panelBody.inert = locked;
    els.panelActions.inert = locked;
    els.studioTabs.inert = locked;
    els.disconnectButton.disabled = locked;
    if (els.publishTop && state.connected) {
      els.publishTop.disabled = locked;
      els.publishTop.textContent = state.busy ? '发布中…' : '发布';
    }
  }

  function touch() {
    state.dirty = true;
    updateSaveStatus();
  }

  function switchTab(tab, initial) {
    if (!state.content || !TABS[tab]) return;
    state.tab = tab;
    Array.from(els.studioTabs.querySelectorAll('[data-tab]')).forEach(function (button) {
      button.setAttribute('aria-current', button.getAttribute('data-tab') === tab ? 'true' : 'false');
    });
    const meta = TABS[tab];
    els.panelEyebrow.textContent = meta.eyebrow;
    els.panelTitle.textContent = meta.title;
    els.panelHint.textContent = meta.hint;
    renderPanelActions();
    renderPanelBody();
    updateCounts();
    updateSaveStatus();
    if (!initial) {
      const panel = document.querySelector('.studio-panel');
      if (panel && window.scrollY > 80) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function renderPanelActions() {
    const actions = [];
    if (state.tab === 'products') actions.push('<button class="button primary" type="button" data-admin-action="add-product">+ 添加品牌</button>');
    if (state.tab === 'videos') actions.push('<button class="button primary" type="button" data-admin-action="add-video">+ 添加影像</button>');
    if (state.tab === 'downloads') actions.push('<button class="button primary" type="button" data-admin-action="add-download">+ 添加下载</button>');
    if (state.tab === 'notes') actions.push('<button class="button primary" type="button" data-admin-action="add-note">+ 添加手记</button>');
    if (state.tab === 'publish') {
      if (state.connected) actions.push('<button class="button glass" type="button" data-admin-action="refresh-remote">重新读取</button>');
      else actions.push('<button class="button glass" type="button" data-admin-action="back-connect">去连接 GitHub</button>');
    }
    if (state.tab === 'site') actions.push('<button class="button glass" type="button" data-admin-action="preview-draft">预览草稿</button>');
    els.panelActions.innerHTML = actions.join('');
  }

  function renderPanelBody() {
    if (!state.content) {
      els.panelBody.innerHTML = '';
      return;
    }
    if (state.tab === 'site') renderSitePanel();
    else if (state.tab === 'products') renderProductsPanel();
    else if (state.tab === 'videos') renderVideosPanel();
    else if (state.tab === 'downloads') renderDownloadsPanel();
    else if (state.tab === 'notes') renderNotesPanel();
    else renderPublishPanel();
  }

  function escape(value) {
    return U.escapeHtml(value);
  }

  function fieldMarkup(options) {
    const opts = options || {};
    const type = opts.type || 'text';
    const path = opts.path || '';
    const value = opts.value == null ? '' : opts.value;
    const span = opts.span ? ' span-2' : '';
    const placeholder = opts.placeholder ? ' placeholder="' + U.escapeAttribute(opts.placeholder) + '"' : '';
    const dataType = opts.lines ? ' data-type="lines"' : '';
    const dataMarkdown = opts.markdown ? ' data-markdown-preview="' + U.escapeAttribute(opts.markdown) + '"' : '';
    let control = '';

    if (type === 'textarea') {
      const cls = opts.tall ? 'textarea tall' : (opts.short ? 'textarea short' : 'textarea');
      control = '<textarea class="' + cls + '" data-path="' + U.escapeAttribute(path) + '"' + dataType + dataMarkdown + placeholder + '>' + escape(value) + '</textarea>';
    } else if (type === 'select') {
      control = '<select data-path="' + U.escapeAttribute(path) + '">' + (opts.options || []).map(function (option) {
        return '<option value="' + U.escapeAttribute(option.value) + '"' + (String(option.value) === String(value) ? ' selected' : '') + '>' + escape(option.label) + '</option>';
      }).join('') + '</select>';
    } else if (type === 'color') {
      control = '<input type="color" data-path="' + U.escapeAttribute(path) + '" value="' + U.escapeAttribute(U.safeColor(value, '#6d86ff')) + '">';
    } else {
      control = '<input type="text" data-path="' + U.escapeAttribute(path) + '"' + dataType + placeholder + ' value="' + U.escapeAttribute(value) + '" autocomplete="off" spellcheck="false">';
    }

    return '<label class="field' + span + '">' +
      '<span class="field-label">' + escape(opts.label || '') + '</span>' +
      control +
      (opts.hint ? '<span class="field-hint">' + escape(opts.hint) + '</span>' : '') +
    '</label>';
  }

  function productOptions(selected, allowEmpty) {
    return (allowEmpty !== false ? '<option value="">不关联品牌</option>' : '') + state.content.products.map(function (product) {
      return '<option value="' + U.escapeAttribute(product.id) + '"' + (product.id === selected ? ' selected' : '') + '>' + escape(product.name || '未命名品牌') + '</option>';
    }).join('');
  }

  function renderSitePanel() {
    const site = state.content.site;
    const profile = state.content.profile;
    const links = profile.links || [];
    const linkRows = links.length
      ? links.map(function (link, index) {
          return '<div class="link-row">' +
            '<label class="field"><span class="field-label">名称</span><input type="text" data-path="profile.links.' + index + '.label" value="' + U.escapeAttribute(link.label || '') + '" autocomplete="off"></label>' +
            '<label class="field"><span class="field-label">链接</span><input type="text" data-path="profile.links.' + index + '.url" value="' + U.escapeAttribute(link.url || '') + '" autocomplete="off" spellcheck="false"></label>' +
            '<button class="tool-button danger" type="button" data-admin-action="remove-link" data-index="' + index + '" aria-label="删除这个链接">×</button>' +
          '</div>';
        }).join('')
      : '<p class="field-hint">还没有外部链接。</p>';

    els.panelBody.innerHTML =
      '<section class="section-card">' +
        '<div class="section-card-head"><div><h2>站点</h2><p>浏览器标题、站点名称和社交分享信息。</p></div></div>' +
        '<div class="form-grid">' +
          fieldMarkup({ label: '品牌名', path: 'site.brand', value: site.brand, placeholder: 'Anthony' }) +
          fieldMarkup({ label: '品牌标记', path: 'site.brandMark', value: site.brandMark, placeholder: 'A', hint: '左上角小方块的文字' }) +
          fieldMarkup({ label: '副标题', path: 'site.tagline', value: site.tagline, span: true, placeholder: '独立产品作品集' }) +
          fieldMarkup({ label: '浏览器标题', path: 'site.title', value: site.title, span: true }) +
          fieldMarkup({ label: '站点描述', path: 'site.description', value: site.description, type: 'textarea', short: true, span: true }) +
          fieldMarkup({ label: '版权文字', path: 'site.copyright', value: site.copyright, placeholder: '© 2026 Anthony' }) +
          fieldMarkup({ label: 'GitHub 仓库链接', path: 'site.repoUrl', value: site.repoUrl, placeholder: 'https://github.com/owner/repo' }) +
        '</div>' +
      '</section>' +
      '<section class="section-card">' +
        '<div class="section-card-head"><div><h2>关于</h2><p>点开「关于」后看到的个人介绍。</p></div></div>' +
        '<div class="form-grid">' +
          fieldMarkup({ label: '一句主标题', path: 'profile.headline', value: profile.headline, span: true, placeholder: '把想法，做进日常。' }) +
          fieldMarkup({ label: '引言', path: 'profile.intro', value: profile.intro, type: 'textarea', short: true, span: true }) +
          fieldMarkup({ label: '详细介绍', path: 'profile.bio', value: profile.bio, type: 'textarea', span: true }) +
          fieldMarkup({ label: '联系邮箱（可留空）', path: 'profile.email', value: profile.email, placeholder: 'hello@example.com' }) +
        '</div>' +
        '<div class="split-line">LINKS / 外部链接</div>' +
        '<div class="link-list">' + linkRows + '</div>' +
        '<div class="add-bar"><button class="button" type="button" data-admin-action="add-link">+ 添加一个链接</button></div>' +
      '</section>';
  }

  function renderProductsPanel() {
    const products = state.content.products;
    if (!products.length) {
      els.panelBody.innerHTML = '<div class="empty-panel"><strong>还没有品牌</strong><span>品牌是首页的一张卡片。添加第一个品牌，再从影像、下载和手记里补充内容。</span></div><div class="add-bar"><button class="button" type="button" data-admin-action="add-product">+ 添加第一个品牌</button></div>';
      return;
    }

    const cards = products.map(function (product, index) {
      return '<article class="editor-card" data-card-kind="product" data-index="' + index + '">' +
        '<div class="editor-card-head">' +
          '<span class="editor-index">' + String(index + 1).padStart(2, '0') + '</span>' +
          '<span class="editor-title"><strong>' + escape(product.name || '未命名品牌') + '</strong><small>' + escape((product.category || '未分类') + (product.status ? ' · ' + product.status : '')) + '</small></span>' +
          '<span class="editor-tools">' +
            '<button class="tool-button" type="button" data-admin-action="move-product-up" data-index="' + index + '" aria-label="上移">↑</button>' +
            '<button class="tool-button" type="button" data-admin-action="move-product-down" data-index="' + index + '" aria-label="下移">↓</button>' +
            '<button class="tool-button danger" type="button" data-admin-action="remove-product" data-index="' + index + '" aria-label="删除这个品牌">×</button>' +
          '</span>' +
        '</div>' +
        '<div class="form-grid">' +
          fieldMarkup({ label: '品牌名称', path: 'products.' + index + '.name', value: product.name, placeholder: 'TimeStudio' }) +
          fieldMarkup({ label: '一句话介绍', path: 'products.' + index + '.subtitle', value: product.subtitle, placeholder: '智能时间管理助手' }) +
          fieldMarkup({ label: '分类', path: 'products.' + index + '.category', value: product.category, placeholder: '效率工具' }) +
          fieldMarkup({ label: '年份', path: 'products.' + index + '.year', value: product.year, placeholder: '2026' }) +
          fieldMarkup({ label: '状态', path: 'products.' + index + '.status', value: product.status, placeholder: '持续更新' }) +
          fieldMarkup({ label: '预览样式', path: 'products.' + index + '.preview', value: product.preview, type: 'select', options: [
            { value: 'timeline', label: '时间轴' },
            { value: 'ledger', label: '手机 / 记账' },
            { value: 'window', label: '窗口 / 桌面' },
            { value: 'generic', label: '通用品牌卡' }
          ] }) +
          '<div class="field"><span class="field-label">主色</span><input type="color" data-path="products.' + index + '.accent" value="' + U.escapeAttribute(U.safeColor(product.accent, '#6d86ff')) + '"></div>' +
          '<div class="field"><span class="field-label">辅助色</span><input type="color" data-path="products.' + index + '.accent2" value="' + U.escapeAttribute(U.safeColor(product.accent2, '#b18cff')) + '"></div>' +
          fieldMarkup({ label: '产品介绍', path: 'products.' + index + '.description', value: product.description, type: 'textarea', span: true }) +
          fieldMarkup({ label: '功能点', path: 'products.' + index + '.features', value: (product.features || []).join('\n'), type: 'textarea', lines: true, short: true, hint: '一行一个' }) +
          fieldMarkup({ label: '平台', path: 'products.' + index + '.platforms', value: (product.platforms || []).join('\n'), type: 'textarea', lines: true, short: true, hint: '一行一个，例如 Windows / Android' }) +
        '</div>' +
      '</article>';
    }).join('');

    els.panelBody.innerHTML = cards + '<div class="add-bar"><button class="button" type="button" data-admin-action="add-product">+ 添加品牌</button></div>';
  }

  function renderVideosPanel() {
    const videos = state.content.videos;
    if (!videos.length) {
      els.panelBody.innerHTML = '<div class="empty-panel"><strong>还没有影像</strong><span>把 B 站视频链接粘进来，它会成为首页产品卡片的「观看影像」。</span></div><div class="add-bar"><button class="button" type="button" data-admin-action="add-video">+ 添加第一支影像</button></div>';
      return;
    }

    const cards = videos.map(function (video, index) {
      const parsed = U.parseBilibili(video.bvid || '');
      const valid = !!parsed;
      return '<article class="editor-card" data-card-kind="video" data-index="' + index + '">' +
        '<div class="editor-card-head">' +
          '<span class="editor-index">' + String(index + 1).padStart(2, '0') + '</span>' +
          '<span class="editor-title"><strong>' + escape(video.title || '未命名影像') + '</strong><small>' + (valid ? escape(parsed.bvid) : '还没有识别 BV 号') + '</small></span>' +
          '<span class="editor-tools">' +
            '<button class="tool-button" type="button" data-admin-action="move-video-up" data-index="' + index + '" aria-label="上移">↑</button>' +
            '<button class="tool-button" type="button" data-admin-action="move-video-down" data-index="' + index + '" aria-label="下移">↓</button>' +
            '<button class="tool-button danger" type="button" data-admin-action="remove-video" data-index="' + index + '" aria-label="删除这影像">×</button>' +
          '</span>' +
        '</div>' +
        '<div class="form-grid">' +
          '<label class="field"><span class="field-label">所属品牌</span><select data-path="videos.' + index + '.productId">' + productOptions(video.productId, false) + '</select></label>' +
          fieldMarkup({ label: '影像标题', path: 'videos.' + index + '.title', value: video.title, placeholder: '把一天，放回时间轴' }) +
          fieldMarkup({ label: '副标题', path: 'videos.' + index + '.subtitle', value: video.subtitle, placeholder: 'TimeStudio 产品演示' }) +
          '<label class="field span-2"><span class="field-label">B 站链接或 BV 号</span><input type="text" data-video-index="' + index + '" value="' + U.escapeAttribute(video.bvid || '') + '" placeholder="粘贴 https://www.bilibili.com/video/BV... 或 BV 号" autocomplete="off" spellcheck="false"></label>' +
          '<div class="field span-2"><span class="video-status ' + (valid ? 'is-valid' : 'is-invalid') + '" data-video-status="' + index + '">' + (valid ? '<strong>' + escape(parsed.bvid) + '</strong> 已识别 · <a href="' + U.escapeAttribute(parsed.url) + '" target="_blank" rel="noopener noreferrer">在 B 站打开 ↗</a>' : '把链接粘贴到上面的输入框，会自动识别 BV 号。') + '</span></div>' +
          fieldMarkup({ label: '影像描述', path: 'videos.' + index + '.description', value: video.description, type: 'textarea', short: true, span: true }) +
        '</div>' +
      '</article>';
    }).join('');

    els.panelBody.innerHTML = cards + '<div class="add-bar"><button class="button" type="button" data-admin-action="add-video">+ 添加影像</button></div>';
  }

  function renderDownloadsPanel() {
    const downloads = state.content.downloads;
    if (!downloads.length) {
      els.panelBody.innerHTML = '<div class="empty-panel"><strong>还没有下载</strong><span>可以上传安装包到仓库，也可以直接粘贴 GitHub Releases 的下载地址。</span></div><div class="add-bar"><button class="button" type="button" data-admin-action="add-download">+ 添加第一个下载</button></div>';
      return;
    }

    const cards = downloads.map(function (download, index) {
      const href = U.safeUrl(download.url);
      return '<article class="editor-card" data-card-kind="download" data-index="' + index + '">' +
        '<div class="editor-card-head">' +
          '<span class="editor-index">' + String(index + 1).padStart(2, '0') + '</span>' +
          '<span class="editor-title"><strong>' + escape(download.name || '未命名安装包') + '</strong><small>' + escape([download.platform, download.version ? 'v' + download.version : '', download.size].filter(Boolean).join(' · ') || '还没有下载地址') + '</small></span>' +
          '<span class="editor-tools">' +
            '<button class="tool-button" type="button" data-admin-action="move-download-up" data-index="' + index + '" aria-label="上移">↑</button>' +
            '<button class="tool-button" type="button" data-admin-action="move-download-down" data-index="' + index + '" aria-label="下移">↓</button>' +
            '<button class="tool-button danger" type="button" data-admin-action="remove-download" data-index="' + index + '" aria-label="删除这个下载">×</button>' +
          '</span>' +
        '</div>' +
        '<div class="form-grid">' +
          '<label class="field"><span class="field-label">所属品牌</span><select data-path="downloads.' + index + '.productId">' + productOptions(download.productId, false) + '</select></label>' +
          fieldMarkup({ label: '显示名称', path: 'downloads.' + index + '.name', value: download.name, placeholder: 'TimeStudio for Android' }) +
          fieldMarkup({ label: '平台', path: 'downloads.' + index + '.platform', value: download.platform, placeholder: 'Android / Windows / macOS' }) +
          fieldMarkup({ label: '版本', path: 'downloads.' + index + '.version', value: download.version, placeholder: '1.0.0' }) +
          fieldMarkup({ label: '文件大小', path: 'downloads.' + index + '.size', value: download.size, placeholder: '3.2 MB' }) +
          fieldMarkup({ label: '日期', path: 'downloads.' + index + '.date', value: download.date, placeholder: '2026-10-22' }) +
          fieldMarkup({ label: '下载地址', path: 'downloads.' + index + '.url', value: download.url, span: true, placeholder: 'https://github.com/.../releases/... 或 downloads/xxx.apk' }) +
          fieldMarkup({ label: '说明', path: 'downloads.' + index + '.note', value: download.note, span: true, placeholder: 'Android 8.0 及以上' }) +
          '<div class="field span-2">' +
            '<span class="field-label">上传安装包</span>' +
            '<div class="upload-zone" data-upload-zone="' + index + '">' +
              '<label>选择文件<input type="file" data-upload-download="' + index + '" accept=".apk,.exe,.msi,.dmg,.pkg,.ipa,.zip,.appx,.msix"></label>' +
              '<small>' + (state.connected ? '≤ ' + U.formatBytes(MAX_UPLOAD) + '，会提交到 downloads/ 目录' : '连接 GitHub 后才能上传') + '</small>' +
              '<div class="upload-progress" aria-hidden="true"><i></i></div>' +
              '<div class="upload-status">' + (href ? '当前地址：' + escape(href) : '还没有下载地址') + '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');

    els.panelBody.innerHTML = cards + '<div class="add-bar"><button class="button" type="button" data-admin-action="add-download">+ 添加下载</button></div>';
  }

  function renderNotesPanel() {
    const notes = state.content.notes;
    if (!notes.length) {
      els.panelBody.innerHTML = '<div class="empty-panel"><strong>还没有手记</strong><span>手记适合放产品背后的思考、更新说明或者一段短文。</span></div><div class="add-bar"><button class="button" type="button" data-admin-action="add-note">+ 添加第一篇手记</button></div>';
      return;
    }

    const cards = notes.map(function (note, index) {
      return '<article class="editor-card" data-card-kind="note" data-index="' + index + '">' +
        '<div class="editor-card-head">' +
          '<span class="editor-index">' + String(index + 1).padStart(2, '0') + '</span>' +
          '<span class="editor-title"><strong>' + escape(note.title || '未命名手记') + '</strong><small>' + escape(U.formatDateDot(note.date) || '没有日期') + (note.productId ? ' · ' + escape((state.content.products.find(function (p) { return p.id === note.productId; }) || {}).name || '') : '') + '</small></span>' +
          '<span class="editor-tools">' +
            '<button class="tool-button" type="button" data-admin-action="move-note-up" data-index="' + index + '" aria-label="上移">↑</button>' +
            '<button class="tool-button" type="button" data-admin-action="move-note-down" data-index="' + index + '" aria-label="下移">↓</button>' +
            '<button class="tool-button danger" type="button" data-admin-action="remove-note" data-index="' + index + '" aria-label="删除这篇手记">×</button>' +
          '</span>' +
        '</div>' +
        '<div class="form-grid">' +
          '<label class="field"><span class="field-label">所属品牌</span><select data-path="notes.' + index + '.productId">' + productOptions(note.productId, true) + '</select></label>' +
          fieldMarkup({ label: '标题', path: 'notes.' + index + '.title', value: note.title, placeholder: '把时间放在看得见的地方' }) +
          fieldMarkup({ label: '日期', path: 'notes.' + index + '.date', value: note.date, placeholder: '2026-10-22' }) +
          fieldMarkup({ label: '摘要', path: 'notes.' + index + '.summary', value: note.summary, span: true, placeholder: '一句会显示在列表里的摘要' }) +
          fieldMarkup({ label: '正文（支持简单 Markdown）', path: 'notes.' + index + '.body', value: note.body, type: 'textarea', tall: true, span: true, markdown: index }) +
          '<div class="field span-2"><details class="preview-details"><summary>预览 Markdown</summary><div class="prose preview-prose" data-markdown-preview="' + index + '">' + U.markdown(note.body || '') + '</div></details></div>' +
        '</div>' +
      '</article>';
    }).join('');

    els.panelBody.innerHTML = cards + '<div class="add-bar"><button class="button" type="button" data-admin-action="add-note">+ 添加手记</button></div>';
  }

  function renderPublishPanel() {
    if (!state.connected) {
      els.panelBody.innerHTML =
        '<div class="empty-panel"><strong>现在是本地编辑模式</strong><span>内容只保存在当前页面，关闭后会丢失。连接 GitHub 后才能直接发布到 Pages。</span></div>' +
        '<div class="add-bar"><button class="button primary" type="button" data-admin-action="back-connect">连接 GitHub</button></div>' +
        '<div class="publish-layout" style="margin-top:14px">' +
          '<section class="publish-card"><h2>本地备份</h2><p>可以先导出 JSON，或者预览草稿。连接 GitHub 后，内容才会提交到仓库并在 Pages 上生效。</p><div class="publish-actions"><button class="button glass" type="button" data-admin-action="export-json">导出 JSON</button><button class="button glass" type="button" data-admin-action="preview-draft">预览草稿</button></div></section>' +
        '</div>';
      return;
    }

    const pagesUrl = getPagesUrl();
    const repoUrl = getRepoUrl();
    const status = state.publishMessage
      ? '<div class="publish-status ' + (state.publishState === 'success' ? 'is-success' : state.publishState === 'error' ? 'is-error' : '') + '">' + escape(state.publishMessage) + (state.publishUrl ? ' <a href="' + U.escapeAttribute(state.publishUrl) + '" target="_blank" rel="noopener noreferrer">查看提交 ↗</a>' : '') + '</div>'
      : '<div class="publish-status">修改内容后点「发布到 GitHub」，会提交到 ' + escape(CONTENT_PATH) + '。Pages 通常需要 1–2 分钟完成部署。</div>';

    els.panelBody.innerHTML =
      '<div class="publish-layout">' +
        '<section class="publish-card">' +
          '<h2>发布到 GitHub</h2>' +
          '<p>提交后不会触发额外的构建工具。GitHub Pages 会直接重新读取新的 JSON 和静态文件。</p>' +
          '<div class="publish-meta">' +
            '<div><span>仓库</span><strong>' + escape(state.connection.owner + '/' + state.connection.repo) + '</strong></div>' +
            '<div><span>分支</span><strong>' + escape(state.connection.branch) + '</strong></div>' +
            '<div><span>内容文件</span><strong>' + escape(CONTENT_PATH) + '</strong></div>' +
            '<div><span>网站</span><strong><a href="' + U.escapeAttribute(pagesUrl) + '" target="_blank" rel="noopener noreferrer">' + escape(pagesUrl.replace(/^https?:\/\//, '')) + ' ↗</a></strong></div>' +
          '</div>' +
          '<button class="button primary publish-button' + (state.busy ? ' is-busy' : '') + '" type="button" data-admin-action="publish-now" ' + (state.busy ? 'disabled' : '') + '>' + (state.busy ? '正在发布…' : '发布到 GitHub') + '</button>' +
          status +
        '</section>' +
        '<section class="publish-card">' +
          '<h2>内容与备份</h2>' +
          '<p>下载当前 JSON、导入备份，或者打开一个新标签页预览还没发布的草稿。</p>' +
          '<div class="publish-actions">' +
            '<button class="button glass" type="button" data-admin-action="preview-draft">预览草稿</button>' +
            '<button class="button glass" type="button" data-admin-action="export-json">导出 JSON</button>' +
            '<button class="button glass" type="button" data-admin-action="import-json">导入 JSON</button>' +
            '<button class="button glass" type="button" data-admin-action="refresh-remote">重新读取仓库</button>' +
          '</div>' +
          '<div class="repo-info"><code>' + escape(repoUrl) + '</code><code>' + escape(CONTENT_PATH) + '</code></div>' +
        '</section>' +
      '</div>' +
      '<section class="section-card" style="margin-top:13px">' +
        '<div class="section-card-head"><div><h2>部署检查</h2><p>第一次部署时，确认 GitHub Pages 已经指向正确的分支。</p></div></div>' +
        '<ol class="publish-steps">' +
          '<li>仓库 Settings → Pages → Build and deployment 选择 <strong>Deploy from a branch</strong>。</li>' +
          '<li>分支选择 <strong>' + escape(state.connection.branch) + '</strong>，目录选择 <strong>/ (root)</strong>。</li>' +
          '<li>发布后等待 Pages 重新部署。若页面没有变化，强制刷新浏览器缓存。</li>' +
          '<li>视频始终来自哔哩哔哩；安装包位于 GitHub Releases 或仓库的 <code>downloads/</code> 目录。</li>' +
        '</ol>' +
      '</section>';
  }

  function onFieldInput(event) {
    if (state.busy || state.activeUploads) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.matches('[data-video-index]')) {
      handleVideoLinkInput(target);
      return;
    }

    const path = target.getAttribute('data-path');
    if (!path) return;

    if (target.matches('[data-type="lines"]')) {
      U.setByPath(state.content, path, target.value.split('\n').map(function (line) { return line.trim(); }).filter(Boolean));
    } else {
      U.setByPath(state.content, path, target.value);
    }

    if (target.matches('[data-markdown-preview]')) {
      const index = target.getAttribute('data-markdown-preview');
      const preview = els.panelBody.querySelector('[data-markdown-preview="' + index + '"].preview-prose');
      if (preview) {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(function () {
          preview.innerHTML = U.markdown(target.value);
        }, 80);
      }
    }

    touch();
  }

  function onFieldChange(event) {
    if (state.busy || state.activeUploads) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.matches('[data-video-index]')) {
      const index = Number(target.getAttribute('data-video-index'));
      const parsed = U.parseBilibili(target.value);
      if (parsed) target.value = parsed.bvid;
      if (Number.isInteger(index)) {
        updateVideoStatus(index, parsed);
      }
      return;
    }

    if (target.matches('[data-upload-download]')) {
      uploadInstaller(Number(target.getAttribute('data-upload-download')), target.files && target.files[0], target);
      return;
    }

    const path = target.getAttribute('data-path');
    if (path) touch();
  }

  function handleVideoLinkInput(target) {
    const index = Number(target.getAttribute('data-video-index'));
    if (!Number.isInteger(index) || !state.content.videos[index]) return;
    const parsed = U.parseBilibili(target.value);
    state.content.videos[index].bvid = parsed ? parsed.bvid : '';
    updateVideoStatus(index, parsed);
    touch();
  }

  function updateVideoStatus(index, parsed) {
    const status = els.panelBody.querySelector('[data-video-status="' + index + '"]');
    if (!status) return;
    if (parsed) {
      status.className = 'video-status is-valid';
      status.innerHTML = '<strong>' + escape(parsed.bvid) + '</strong> 已识别 · <a href="' + U.escapeAttribute(parsed.url) + '" target="_blank" rel="noopener noreferrer">在 B 站打开 ↗</a>';
    } else {
      status.className = 'video-status is-invalid';
      status.textContent = '还没有识别到 BV 号。请粘贴完整 B 站链接，或直接填写 BV 号。';
    }
  }

  function onDocumentClick(event) {
    const trigger = event.target.closest('[data-admin-action]');
    if (!trigger) return;
    event.preventDefault();
    if (state.busy || state.activeUploads) return;
    const action = trigger.getAttribute('data-admin-action');
    const index = Number(trigger.getAttribute('data-index'));

    if (action === 'add-product') addProduct();
    else if (action === 'remove-product') removeProduct(index);
    else if (action === 'move-product-up') moveItem('products', index, -1);
    else if (action === 'move-product-down') moveItem('products', index, 1);
    else if (action === 'add-video') addVideo();
    else if (action === 'remove-video') removeItem('videos', index, '影像');
    else if (action === 'move-video-up') moveItem('videos', index, -1);
    else if (action === 'move-video-down') moveItem('videos', index, 1);
    else if (action === 'add-download') addDownload();
    else if (action === 'remove-download') removeItem('downloads', index, '下载');
    else if (action === 'move-download-up') moveItem('downloads', index, -1);
    else if (action === 'move-download-down') moveItem('downloads', index, 1);
    else if (action === 'add-note') addNote();
    else if (action === 'remove-note') removeItem('notes', index, '手记');
    else if (action === 'move-note-up') moveItem('notes', index, -1);
    else if (action === 'move-note-down') moveItem('notes', index, 1);
    else if (action === 'add-link') addLink();
    else if (action === 'remove-link') removeLink(index);
    else if (action === 'publish-now') publish();
    else if (action === 'refresh-remote') refreshRemote();
    else if (action === 'export-json') exportJson();
    else if (action === 'import-json') els.importFile.click();
    else if (action === 'preview-draft') previewDraft();
    else if (action === 'back-connect') disconnect();
  }

  function addProduct() {
    const palette = [
      ['#6d86ff', '#b18cff'],
      ['#2fa98b', '#9ad7a5'],
      ['#e28a4a', '#f0c48f'],
      ['#d25f8f', '#e6a8c9'],
      ['#7b6bd8', '#b6a6f2']
    ];
    const colors = palette[state.content.products.length % palette.length];
    state.content.products.push({
      id: U.uid('brand'),
      name: '新品牌',
      subtitle: '一句话介绍这个产品',
      category: '其他',
      year: String(YEAR),
      status: '持续更新',
      accent: colors[0],
      accent2: colors[1],
      preview: 'generic',
      description: '',
      features: [],
      platforms: []
    });
    touch();
    updateCounts();
    renderPanelBody();
    scrollToCard('product', state.content.products.length - 1);
  }

  function removeProduct(index) {
    const product = state.content.products[index];
    if (!product) return;
    const relatedVideos = state.content.videos.filter(function (item) { return item.productId === product.id; }).length;
    const relatedDownloads = state.content.downloads.filter(function (item) { return item.productId === product.id; }).length;
    const relatedNotes = state.content.notes.filter(function (item) { return item.productId === product.id; }).length;
    const message = '删除「' + (product.name || '未命名品牌') + '」？' +
      (relatedVideos + relatedDownloads + relatedNotes > 0 ? '\n\n它关联的 ' + relatedVideos + ' 支影像、' + relatedDownloads + ' 个下载和 ' + relatedNotes + ' 篇手记也会一起删除。' : '');
    if (!window.confirm(message)) return;
    state.content.products.splice(index, 1);
    state.content.videos = state.content.videos.filter(function (item) { return item.productId !== product.id; });
    state.content.downloads = state.content.downloads.filter(function (item) { return item.productId !== product.id; });
    state.content.notes = state.content.notes.filter(function (item) { return item.productId !== product.id; });
    touch();
    updateCounts();
    renderPanelBody();
  }

  function addVideo() {
    if (!state.content.products.length) {
      toast('先添加一个品牌，再添加影像');
      return;
    }
    state.content.videos.push({
      id: U.uid('film'),
      productId: state.content.products[0].id,
      title: '新的产品影像',
      subtitle: '',
      bvid: '',
      description: ''
    });
    touch();
    updateCounts();
    renderPanelBody();
    scrollToCard('video', state.content.videos.length - 1);
  }

  function addDownload() {
    if (!state.content.products.length) {
      toast('先添加一个品牌，再添加下载');
      return;
    }
    state.content.downloads.push({
      id: U.uid('download'),
      productId: state.content.products[0].id,
      name: '新安装包',
      platform: 'Android',
      version: '',
      size: '',
      date: today(),
      url: '',
      note: ''
    });
    touch();
    updateCounts();
    renderPanelBody();
    scrollToCard('download', state.content.downloads.length - 1);
  }

  function addNote() {
    state.content.notes.push({
      id: U.uid('note'),
      productId: state.content.products[0] ? state.content.products[0].id : '',
      title: '新手记',
      date: today(),
      summary: '',
      body: ''
    });
    touch();
    updateCounts();
    renderPanelBody();
    scrollToCard('note', state.content.notes.length - 1);
  }

  function addLink() {
    state.content.profile.links.push({ label: '链接', url: '' });
    touch();
    renderPanelBody();
  }

  function removeLink(index) {
    state.content.profile.links.splice(index, 1);
    touch();
    renderPanelBody();
  }

  function removeItem(kind, index, label) {
    const item = state.content[kind][index];
    if (!item) return;
    if (!window.confirm('确定删除这个' + label + '吗？')) return;
    state.content[kind].splice(index, 1);
    touch();
    updateCounts();
    renderPanelBody();
  }

  function moveItem(kind, index, delta) {
    const list = state.content[kind];
    const target = index + delta;
    if (!list || !list[index] || target < 0 || target >= list.length) return;
    const item = list.splice(index, 1)[0];
    list.splice(target, 0, item);
    touch();
    renderPanelBody();
  }

  function scrollToCard(kind, index) {
    requestAnimationFrame(function () {
      const card = els.panelBody.querySelector('[data-card-kind="' + kind + '"][data-index="' + index + '"]');
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const input = card.querySelector('input, textarea, select');
      if (input) setTimeout(function () { input.focus({ preventScroll: true }); }, 220);
    });
  }

  function today() {
    const date = new Date();
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  function getRepoUrl() {
    if (!state.connection) return '';
    return 'https://github.com/' + state.connection.owner + '/' + state.connection.repo;
  }

  function getPagesUrl() {
    if (!state.connection) return '';
    const owner = state.connection.owner.toLowerCase();
    const repo = state.connection.repo.toLowerCase();
    if (repo === owner + '.github.io') return 'https://' + owner + '.github.io/';
    return 'https://' + owner + '.github.io/' + state.connection.repo + '/';
  }

  function validateContent() {
    const errors = [];
    const content = state.content;
    if (!content.products.length) errors.push('至少需要保留一个品牌。');
    content.products.forEach(function (product, index) {
      if (!String(product.name || '').trim()) errors.push('第 ' + (index + 1) + ' 个品牌缺少名称。');
    });
    content.videos.forEach(function (video, index) {
      if (!U.parseBilibili(video.bvid || '')) errors.push('第 ' + (index + 1) + ' 支影像的 B 站链接无效。');
      if (!String(video.title || '').trim()) errors.push('第 ' + (index + 1) + ' 支影像缺少标题。');
    });
    content.downloads.forEach(function (download, index) {
      if (!String(download.name || '').trim()) errors.push('第 ' + (index + 1) + ' 个下载缺少名称。');
      if (!U.safeUrl(download.url)) errors.push('第 ' + (index + 1) + ' 个下载缺少有效地址。');
    });
    content.notes.forEach(function (note, index) {
      if (!String(note.title || '').trim()) errors.push('第 ' + (index + 1) + ' 篇手记缺少标题。');
      if (!String(note.body || '').trim()) errors.push('第 ' + (index + 1) + ' 篇手记缺少正文。');
    });
    return errors;
  }

  async function publish() {
    if (!hasEditorAccess()) return;
    if (!state.connected || !state.connection) {
      toast('请先连接 GitHub');
      switchTab('publish');
      return;
    }
    if (state.busy) return;
    if (state.activeUploads > 0) {
      toast('还有文件正在上传，请稍等');
      return;
    }

    const errors = validateContent();
    if (errors.length) {
      state.publishMessage = errors.slice(0, 5).join(' ');
      state.publishState = 'error';
      state.publishUrl = '';
      switchTab('publish');
      renderPanelBody();
      toast('还有内容没有填完整');
      return;
    }

    state.busy = true;
    const submitted = U.clone(state.content);
    const beforePublish = U.contentFingerprint(state.content);
    state.publishMessage = '正在提交到 GitHub…';
    state.publishState = '';
    state.publishUrl = '';
    updateSaveStatus();
    if (els.publishTop) {
      els.publishTop.disabled = true;
      els.publishTop.textContent = '发布中…';
    }

    try {
      const path = '/repos/' + encodeURIComponent(state.connection.owner) + '/' + encodeURIComponent(state.connection.repo) + '/contents/' + encodeContentPath(CONTENT_PATH);
      const latest = await apiRequest('GET', path + '?ref=' + encodeURIComponent(state.connection.branch), null, { allow404: true });
      const latestSha = latest ? latest.sha : null;
      if (latestSha !== state.sha) {
        throw new Error('仓库里的内容文件刚刚被修改过。请点「重新读取仓库」，确认最新版本后再发布。');
      }

      submitted.updatedAt = new Date().toISOString();
      const serialized = JSON.stringify(submitted, null, 2) + '\n';
      const body = {
        message: 'Update site content · ' + today(),
        content: U.encodeBase64Utf8(serialized),
        branch: state.connection.branch
      };
      if (latestSha) body.sha = latestSha;
      const response = await apiRequest('PUT', path, body);
      state.sha = response && response.content ? response.content.sha : latestSha;
      state.original = U.clone(submitted);
      if (beforePublish === U.contentFingerprint(state.content)) state.content.updatedAt = submitted.updatedAt;
      state.dirty = U.contentFingerprint(state.content) !== U.contentFingerprint(submitted);
      state.publishMessage = '已提交到 GitHub，等待 Pages 部署完成。' + (state.dirty ? '发布期间的新修改仍保留为草稿，请再次发布。' : '网站生效时间取决于 Pages 部署状态。');
      state.publishState = 'success';
      state.publishUrl = response && response.commit ? response.commit.html_url : '';
      try {
        if (!state.dirty) localStorage.removeItem(PREVIEW_KEY);
        localStorage.setItem(PREVIEW_BASE_KEY, JSON.stringify(state.original));
      } catch (error) { /* noop */ }
      toast('发布成功');
    } catch (error) {
      state.publishMessage = formatApiError(error);
      state.publishState = 'error';
      state.publishUrl = '';
      toast('发布失败：' + formatApiError(error));
    } finally {
      state.busy = false;
      updateSaveStatus();
      if (state.tab === 'publish') renderPanelBody();
    }
  }

  async function refreshRemote() {
    if (state.busy || state.activeUploads) return;
    if (!state.connected || !state.connection) {
      disconnect();
      return;
    }
    if (state.dirty && !window.confirm('重新读取会覆盖当前未发布的修改，确定继续吗？')) return;
    state.busy = true;
    updateSaveStatus();
    try {
      await loadRemoteContent();
      state.publishMessage = '已重新读取仓库内容。';
      state.publishState = 'success';
      state.publishUrl = '';
      updateCounts();
      renderPanelBody();
      toast('已重新读取');
    } catch (error) {
      state.publishMessage = formatApiError(error);
      state.publishState = 'error';
      if (state.tab === 'publish') renderPanelBody();
      toast('读取失败：' + formatApiError(error));
    } finally {
      state.busy = false;
      updateSaveStatus();
    }
  }

  function previewDraft() {
    if (!state.content) return;
    try {
      localStorage.setItem(PREVIEW_KEY, JSON.stringify(state.content));
      localStorage.setItem(PREVIEW_BASE_KEY, JSON.stringify(state.original));
      window.open('index.html?preview=1', '_blank', 'noopener');
    } catch (error) {
      toast('无法保存预览草稿：浏览器存储空间不足');
    }
  }

  function exportJson() {
    if (!state.content) return;
    const blob = new Blob([JSON.stringify(state.content, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'site-content-' + today() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('已导出 JSON 备份');
  }

  function importJson(event) {
    if (state.busy || state.activeUploads) return;
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      if (state.busy || state.activeUploads) { toast('请等待当前操作完成，再导入备份'); return; }
      try {
        const parsed = JSON.parse(String(reader.result || ''));
        if (!parsed || !Array.isArray(parsed.products) || !Array.isArray(parsed.videos) || !Array.isArray(parsed.downloads) || !Array.isArray(parsed.notes)) {
          throw new Error('JSON 结构不完整');
        }
        if (!window.confirm('导入会替换当前编辑内容，确定继续吗？')) return;
        state.content = U.normalizeContent(parsed);
        touch();
        updateCounts();
        renderPanelBody();
        toast('已导入 JSON');
      } catch (error) {
        toast('导入失败：' + error.message);
      }
    };
    reader.readAsText(file);
  }

  function safeFileName(name) {
    const raw = String(name || 'installer');
    const extMatch = raw.match(/(\.[A-Za-z0-9]{1,10})$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : '';
    let base = ext ? raw.slice(0, -extMatch[1].length) : raw;
    base = base.normalize('NFKC')
      .replace(/[\\/:*?"<>|#%{}^~\[\]`]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[.\-]+|[.\-]+$/g, '');
    if (!base) base = 'installer-' + Date.now();
    return base + ext;
  }

  function inferPlatform(name) {
    const ext = String(name || '').toLowerCase().split('.').pop();
    if (ext === 'apk') return 'Android';
    if (ext === 'exe' || ext === 'msi' || ext === 'msix' || ext === 'appx') return 'Windows';
    if (ext === 'dmg' || ext === 'pkg') return 'macOS';
    if (ext === 'ipa') return 'iOS';
    return '';
  }

  async function uploadInstaller(index, file, input) {
    if (!hasEditorAccess()) return;
    if (state.busy || state.activeUploads) return;
    if (!file) return;
    const download = state.content.downloads[index];
    if (!download) return;
    const zone = input.closest('.upload-zone');
    const status = zone ? zone.querySelector('.upload-status') : null;
    const progress = zone ? zone.querySelector('.upload-progress i') : null;

    function setStatus(text, kind) {
      if (!status) return;
      status.textContent = text;
      status.className = 'upload-status' + (kind ? ' is-' + kind : '');
    }

    if (!state.connected || !state.connection) {
      setStatus('请先连接 GitHub，再上传安装包。', 'error');
      toast('请先连接 GitHub');
      input.value = '';
      return;
    }
    if (file.size > MAX_UPLOAD) {
      setStatus('文件超过 ' + U.formatBytes(MAX_UPLOAD) + '，建议上传到 GitHub Releases，然后把下载链接粘贴到上方。', 'error');
      toast('文件太大');
      input.value = '';
      return;
    }

    const fileName = U.uid('file') + '-' + safeFileName(file.name);
    const repoPath = 'downloads/' + fileName;
    const apiPath = '/repos/' + encodeURIComponent(state.connection.owner) + '/' + encodeURIComponent(state.connection.repo) + '/contents/' + encodeContentPath(repoPath);
    state.activeUploads += 1;
    if (zone) zone.classList.add('is-uploading');
    if (progress) progress.style.setProperty('--upload-progress', '0%');
    setStatus('正在读取文件…');
    updateSaveStatus();

    try {
      setStatus('正在上传 ' + fileName + '…');
      const buffer = await file.arrayBuffer();
      const base64 = U.encodeBase64Bytes(buffer);
      const payload = {
        message: 'Upload ' + fileName,
        content: base64,
        branch: state.connection.branch
      };

      await uploadPut(apiPath, payload, function (percent) {
        if (progress) progress.style.setProperty('--upload-progress', percent + '%');
        setStatus('正在上传 ' + fileName + ' · ' + Math.round(percent) + '%');
      });

      const urlPath = 'downloads/' + encodeURIComponent(fileName);
      download.url = urlPath;
      download.size = U.formatBytes(file.size);
      download.date = today();
      if (!download.platform) download.platform = inferPlatform(file.name);

      const card = zone ? zone.closest('.editor-card') : null;
      if (card) {
        const urlInput = card.querySelector('[data-path$=".url"]');
        const sizeInput = card.querySelector('[data-path$=".size"]');
        const dateInput = card.querySelector('[data-path$=".date"]');
        const platformInput = card.querySelector('[data-path$=".platform"]');
        if (urlInput) urlInput.value = urlPath;
        if (sizeInput) sizeInput.value = download.size;
        if (dateInput) dateInput.value = download.date;
        if (platformInput && download.platform) platformInput.value = download.platform;
      }
      if (progress) progress.style.setProperty('--upload-progress', '100%');
      setStatus('已上传到 ' + repoPath + '。记得点「发布」让页面引用这个文件。', 'done');
      touch();
      toast('安装包已上传');
    } catch (error) {
      setStatus('上传失败：' + formatApiError(error), 'error');
      toast('上传失败：' + formatApiError(error));
    } finally {
      state.activeUploads = Math.max(0, state.activeUploads - 1);
      if (zone) zone.classList.remove('is-uploading');
      input.value = '';
      updateSaveStatus();
    }
  }

  function uploadPut(apiPath, payload, onProgress) {
    return new Promise(function (resolve, reject) {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', API + apiPath, true);
      xhr.timeout = 300000;
      xhr.setRequestHeader('Authorization', 'Bearer ' + state.connection.token);
      xhr.setRequestHeader('Accept', 'application/vnd.github+json');
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('X-GitHub-Api-Version', '2022-11-28');
      xhr.upload.onprogress = function (event) {
        if (event.lengthComputable && onProgress) onProgress((event.loaded / event.total) * 100);
      };
      xhr.onload = function () {
        let data = null;
        try { data = JSON.parse(xhr.responseText || 'null'); } catch (error) { data = null; }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
        } else {
          const error = new Error(data && data.message ? data.message : 'HTTP ' + xhr.status);
          error.status = xhr.status;
          error.data = data;
          reject(error);
        }
      };
      xhr.onerror = function () {
        reject(new Error('网络错误，上传没有完成。'));
      };
      xhr.onabort = function () {
        reject(new Error('上传已取消。'));
      };
      xhr.ontimeout = function () {
        reject(new Error('上传超时。请检查网络，或使用 GitHub Releases 链接。'));
      };
      xhr.send(JSON.stringify(payload));
    });
  }

  function toast(message) {
    if (!els.toast) return;
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add('is-visible');
    toastTimer = setTimeout(function () {
      els.toast.classList.remove('is-visible');
    }, 3000);
  }
})();
