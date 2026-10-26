(function () {
  'use strict';

  const U = window.SiteUtils;
  const API = 'https://api.github.com';
  const CONTENT_PATH = 'content/site.json';
  const ADMIN_CONFIG_KEY = U.storageKey('anthony-admin-config');
  const ADMIN_TOKEN_KEY = U.storageKey('anthony-admin-token');
  const PREVIEW_KEY = U.storageKey('anthony-preview-content');
  const BASE_KEY = U.storageKey('anthony-preview-base');
  const MAX_UPLOAD = 48 * 1024 * 1024;
  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = function (selector, root) { return (root || document).querySelector(selector); };
  const $$ = function (selector, root) { return Array.from((root || document).querySelectorAll(selector)); };
  const esc = U.escapeHtml;
  const attr = U.escapeAttribute;

  const ICON = {
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v11.2m0 0 4.2-4.2M12 14.7 7.8 10.5M5 20h14"></path></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.4 5.8v12.4L18.6 12 8.4 5.8Z" fill="currentColor"></path></svg>',
    external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M19 14v4.5A1.5 1.5 0 0 1 17.5 20h-12A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5H10"></path></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 10.6v5.2M12 8.1v.1"></path></svg>'
  };

  const els = {
    header: $('#siteHeader'),
    brandMark: $('#brandMark'),
    brandName: $('#brandName'),
    themeToggle: $('#themeToggle'),
    cardMount: $('#cardMount'),
    homeDock: $('#homeDock'),
    orbStage: $('#orbStage'),
    homeOrb: $('#homeOrb'),
    liveRegion: $('#liveRegion'),
    previewBadge: $('#previewBadge'),
    sheetDialog: $('#sheetDialog'),
    sheetContent: $('#sheetContent'),
    toast: $('#toast')
  };

  const state = {
    content: null,
    products: [],
    activeIndex: 0,
    switching: false,
    sheetOpen: false,
    sheetKind: '',
    restoreInlineVideo: false,
    gesture: null,
    holdTimer: 0,
    tapTimer: 0,
    transitionTimer: 0,
    settleTimer: 0,
    toastTimer: 0,
    editor: null,
    connection: null,
    defaults: { owner: '', repo: '', branch: 'main' },
    sha: null,
    baseUpdatedAt: '',
    previewMode: false,
    pendingDouble: false
  };
  state.busy = false;
  state.baseContent = '';

  init();

  async function init() {
    initTheme();
    bindEvents();
    try {
      const raw = await loadContent();
      state.content = normalizeContent(raw);
      if (!state.baseContent) state.baseContent = JSON.stringify(state.content);
      state.products = state.content.products;
      state.baseUpdatedAt = state.content.updatedAt || '';
      if (!state.products.length) throw new Error('作品列表为空');
      setupChrome();
      restoreConnection();
      state.defaults = connectionDefaults();

      if (state.previewMode && els.previewBadge) els.previewBadge.classList.remove('hidden');
      const hash = decodeURIComponent(String(location.hash || '').replace(/^#/, ''));
      const hashIndex = state.products.findIndex(function (p) { return p.id === hash; });
      state.activeIndex = hashIndex >= 0 ? hashIndex : 0;
      renderProduct(state.activeIndex, { initial: true });
      els.cardMount.classList.add('is-entering');
      els.cardMount.style.setProperty('--enter-x', '14px');
      void els.cardMount.offsetWidth;
      els.cardMount.classList.remove('is-entering');
      els.cardMount.classList.add('is-settling');
      els.cardMount.setAttribute('aria-busy', 'false');
      setTimeout(function () { els.cardMount.classList.remove('is-settling'); }, prefersReduced ? 0 : 720);
    } catch (error) {
      showLoadError(error);
    }
  }

  /* ---------- content ---------- */

  async function loadContent() {
    const params = new URLSearchParams(location.search);
    if (params.get('preview') === '1') {
      try {
        const draft = localStorage.getItem(PREVIEW_KEY);
        if (draft) {
          state.previewMode = true;
          state.baseContent = localStorage.getItem(BASE_KEY) || '';
          return JSON.parse(draft);
        }
      } catch (error) { /* fall through */ }
    }
    const url = new URL(CONTENT_PATH, location.href);
    url.searchParams.set('v', String(Date.now()));
    const response = await fetch(url.toString(), { cache: 'no-store' });
    if (!response.ok) throw new Error('内容文件返回 HTTP ' + response.status);
    return response.json();
  }

  function normalizeContent(raw) {
    const content = U.normalizeContent(raw);
    content.products = content.products.map(function (product, index) {
      return Object.assign({}, product, {
        id: String(product.id || 'product-' + (index + 1)),
        name: String(product.name || '未命名产品'),
        subtitle: String(product.subtitle || ''),
        category: String(product.category || '产品'),
        description: String(product.description || ''),
        accent: U.safeColor(product.accent, '#6d86ff'),
        accent2: U.safeColor(product.accent2, '#b18cff')
      });
    });
    content.videos = content.videos.map(function (video, index) {
      const parsed = U.parseBilibili(video.bvid || video.url || '');
      return Object.assign({}, video, {
        id: String(video.id || 'film-' + (index + 1)),
        productId: String(video.productId || ''),
        title: String(video.title || '产品影像'),
        subtitle: String(video.subtitle || ''),
        description: String(video.description || ''),
        bvid: parsed ? parsed.bvid : ''
      });
    });
    content.downloads = content.downloads.map(function (download, index) {
      return Object.assign({}, download, {
        id: String(download.id || 'download-' + (index + 1)),
        productId: String(download.productId || ''),
        name: String(download.name || '安装包'),
        platform: String(download.platform || ''),
        version: String(download.version || ''),
        size: String(download.size || ''),
        date: String(download.date || ''),
        url: String(download.url || ''),
        note: String(download.note || '')
      });
    });
    content.notes = content.notes.map(function (note, index) {
      return Object.assign({}, note, { id: String(note.id || 'note-' + (index + 1)), productId: note.productId ? String(note.productId) : '' });
    });
    return content;
  }

  function productVideos(productId) {
    return state.content.videos.filter(function (video) { return video.productId === productId && video.bvid; });
  }

  function firstVideo(productId) {
    return productVideos(productId)[0] || null;
  }

  function productDownloads(productId) {
    return state.content.downloads.filter(function (download) { return download.productId === productId; });
  }

  function setupChrome() {
    const site = state.content.site || {};
    const brand = site.brand || 'Anthony';
    els.brandName.textContent = brand;
    els.brandMark.textContent = site.brandMark || brand.slice(0, 1).toUpperCase();
    const title = site.title || (brand + ' · 独立产品');
    document.title = title;
    setMeta('meta[name="description"]', site.description || '独立产品作品集');
    setMeta('meta[property="og:title"]', title);
    setMeta('meta[property="og:description"]', site.description || '独立产品作品集');
  }

  function setMeta(selector, value) {
    const node = document.querySelector(selector);
    if (node) node.setAttribute('content', value);
  }

  function updateAmbient(accent, accent2) {
    const a = $('.ambient-a');
    const b = $('.ambient-b');
    if (a) a.style.backgroundColor = accent;
    if (b) b.style.backgroundColor = accent2;
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-2', accent2);
  }

  /* ---------- render ---------- */

  function renderProduct(index, options) {
    const opts = options || {};
    const product = state.products[index];
    if (!product) return;
    state.activeIndex = index;
    const videos = productVideos(product.id);
    const video = videos[0] || null;
    const downloads = productDownloads(product.id);
    const accent = U.safeColor(product.accent, '#6d86ff');
    const accent2 = U.safeColor(product.accent2, '#b18cff');
    const label = String(index + 1).padStart(2, '0');
    const site = state.content.site || {};
    const pageTitle = site.title || '独立产品';
    const longName = String(product.name || '').length > 14;

    const actions = downloads.length
      ? '<div class="product-actions"><button class="button primary" type="button" data-action="downloads">' + ICON.download + '下载安装包 <span class="action-count">' + downloads.length + '</span></button></div>'
      : '';

    const media = '<button class="video-cover" type="button" data-action="' + (video ? 'video' : 'edit') + '" aria-label="' + attr(video ? '播放 ' + product.name + ' 产品演示' : '为 ' + product.name + ' 添加视频') + '">' +
      '<span class="cover-art" aria-hidden="true"><span class="cover-monogram">' + esc(product.name.slice(0, 1)) + '</span><span class="cover-caption">' + esc(product.name) + '</span></span>' +
      '<span class="cover-play">' + ICON.play + '</span><span class="cover-label">' + (video ? '观看产品演示' : '添加产品影像') + '</span></button>';

    els.cardMount.innerHTML =
      '<article class="product-card' + (product.layout === 'centered' ? ' layout-centered' : '') + '" data-product-id="' + attr(product.id) + '" aria-labelledby="productTitle" style="--accent:' + accent + ';--accent-2:' + accent2 + '">' +
        '<div class="product-copy">' +
          '<div class="product-kicker"><span class="index">' + label + '</span><span class="kicker-divider" aria-hidden="true"></span><span class="category">' + esc(product.category) + '</span></div>' +
          '<h1 class="product-name' + (longName ? ' is-long' : '') + '" id="productTitle">' + esc(product.name) + '</h1>' +
          (product.subtitle ? '<p class="product-subtitle">' + esc(product.subtitle) + '</p>' : '') +
          (product.description ? '<div class="product-description description-rich">' + U.markdown(product.description) + '</div>' : '') +
          actions +
        '</div>' +
        '<div class="product-media">' + media + '</div>' +
      '</article>';

    updateAmbient(accent, accent2);
    document.title = product.name + ' · ' + pageTitle;
    setMeta('meta[name="description"]', product.description || product.subtitle || (site.description || ''));
    setMeta('meta[property="og:title"]', product.name + ' · ' + pageTitle);
    setMeta('meta[property="og:description"]', product.description || product.subtitle || '');
    updateOrbLabel();
    $('#productNav').innerHTML = state.products.map(function (item, itemIndex) {
      return '<button type="button" data-product-index="' + itemIndex + '" aria-current="' + (itemIndex === index ? 'true' : 'false') + '">' + esc(item.name) + '</button>';
    }).join('') + '<button class="add-product" type="button" data-action="add" aria-label="添加作品">＋</button>';
    writeHash(product.id);
    if (!opts.silent) announce(product);
  }

  function updateOrbLabel() {
    const product = state.products[state.activeIndex];
    if (!product) return;
    els.homeOrb.setAttribute('aria-label', '当前 ' + product.name + '。左右拖动切换产品，单点播放视频，双击编辑，长按新增产品。');
  }

  function announce(product) {
    if (!els.liveRegion) return;
    els.liveRegion.textContent = '已切换到 ' + product.name + (product.subtitle ? '，' + product.subtitle : '') + '，第 ' + (state.activeIndex + 1) + ' 个，共 ' + state.products.length + ' 个。';
  }

  function writeHash(productId) {
    try {
      const next = '#' + encodeURIComponent(productId);
      if (location.hash !== next) history.replaceState(null, '', next);
    } catch (error) { /* file protocol */ }
  }

  function switchProduct(targetIndex, direction) {
    if (state.switching || state.sheetOpen || !state.products.length) return;
    if (targetIndex < 0 || targetIndex >= state.products.length) return;
    if (targetIndex === state.activeIndex) return;
    const sign = direction >= 0 ? 1 : -1;
    state.switching = true;
    els.cardMount.style.setProperty('--exit-x', (sign > 0 ? -28 : 28) + 'px');
    els.cardMount.style.setProperty('--enter-x', (sign > 0 ? 32 : -32) + 'px');
    els.cardMount.classList.remove('is-entering', 'is-settling');
    els.cardMount.classList.add('is-exiting');
    els.orbStage.classList.add('is-switching');
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch (error) { /* noop */ } }

    clearTimeout(state.transitionTimer);
    clearTimeout(state.settleTimer);
    state.transitionTimer = setTimeout(function () {
      renderProduct(targetIndex, { silent: true });
      announce(state.products[targetIndex]);
      els.cardMount.classList.remove('is-exiting');
      els.cardMount.classList.add('is-entering');
      void els.cardMount.offsetWidth;
      els.cardMount.classList.remove('is-entering');
      els.cardMount.classList.add('is-settling');
      state.settleTimer = setTimeout(function () {
        els.cardMount.classList.remove('is-settling');
        state.switching = false;
      }, prefersReduced ? 0 : 680);
    }, prefersReduced ? 0 : 185);

    setTimeout(function () { els.orbStage.classList.remove('is-switching'); }, 800);
  }

  function goRelative(delta) {
    if (state.products.length <= 1 || state.switching || state.sheetOpen) return;
    const next = (state.activeIndex + delta + state.products.length) % state.products.length;
    switchProduct(next, delta);
  }

  /* ---------- orb hand gestures ---------- */

  function bindOrb() {
    const orb = els.homeOrb;
    orb.addEventListener('pointerdown', function (event) {
      if (event.button !== 0 || event.isPrimary === false) return;
      if (state.sheetOpen || document.querySelector('dialog[open]') || !state.products.length) return;
      event.preventDefault();
      if (state.tapTimer) {
        clearTimeout(state.tapTimer);
        state.tapTimer = 0;
        state.pendingDouble = true;
      }
      state.gesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        dx: 0,
        moved: false,
        swiping: false,
        longPressed: false,
        started: performance.now()
      };
      try { orb.setPointerCapture(event.pointerId); } catch (error) { /* noop */ }
      orb.classList.add('is-pressing');
      els.orbStage.classList.add('is-holding');
      clearTimeout(state.holdTimer);
      state.holdTimer = setTimeout(function () {
        if (!state.gesture || state.gesture.moved || state.gesture.longPressed || state.sheetOpen) return;
        const gesture = state.gesture;
        gesture.longPressed = true;
        state.pendingDouble = false;
        cancelTap();
        clearTimeout(state.holdTimer);
        els.orbStage.classList.remove('is-holding');
        orb.classList.remove('is-pressing', 'is-dragging');
        resetOrbOffset();
        try { orb.releasePointerCapture(gesture.pointerId); } catch (error) { /* noop */ }
        state.gesture = null;
        if (navigator.vibrate) { try { navigator.vibrate(14); } catch (error) { /* noop */ } }
        els.homeDock.classList.add('is-faded');
        openAddEditor();
      }, 520);
    });

    orb.addEventListener('pointermove', function (event) {
      const g = state.gesture;
      if (!g || g.pointerId !== event.pointerId) return;
      if (g.longPressed) return;
      event.preventDefault();
      const dx = event.clientX - g.startX;
      const dy = event.clientY - g.startY;
      if (!g.moved && Math.max(Math.abs(dx), Math.abs(dy)) > 7) {
        g.moved = true;
        clearTimeout(state.holdTimer);
        els.orbStage.classList.remove('is-holding');
        cancelTap();
        state.pendingDouble = false;
      }
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 16) return;
      if (Math.abs(dx) < 16) return;
      g.swiping = true;
      g.dx = U.clamp(dx, -118, 118);
      orb.classList.add('is-dragging');
      setOrbOffset(g.dx);
    });

    orb.addEventListener('pointerup', function (event) {
      const g = state.gesture;
      if (!g || g.pointerId !== event.pointerId) return;
      finishGesture(event, g, false);
    });

    orb.addEventListener('pointercancel', function (event) {
      const g = state.gesture;
      if (!g || g.pointerId !== event.pointerId) return;
      finishGesture(event, g, true);
    });

    orb.addEventListener('contextmenu', function (event) { event.preventDefault(); });

    orb.addEventListener('click', function (event) {
      if (event.detail === 0 && !state.sheetOpen && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        openVideo();
      }
    });

    orb.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        goRelative(event.key === 'ArrowRight' ? 1 : -1);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        openVideo();
      } else if (event.key === 'e' || event.key === 'E') {
        event.preventDefault();
        event.stopPropagation();
        openEditEditor();
      } else if (event.key === 'n' || event.key === 'N') {
        event.preventDefault();
        event.stopPropagation();
        openAddEditor();
      } else if (event.key === 'd' || event.key === 'D') {
        event.preventDefault();
        event.stopPropagation();
        openDownloads();
      }
    });
  }

  function finishGesture(event, g, cancelled) {
    state.gesture = null;
    clearTimeout(state.holdTimer);
    els.orbStage.classList.remove('is-holding');
    els.homeOrb.classList.remove('is-pressing', 'is-dragging');
    try { if (event && event.pointerId != null) els.homeOrb.releasePointerCapture(event.pointerId); } catch (error) { /* noop */ }
    resetOrbOffset();

    if (cancelled) {
      state.pendingDouble = false;
      return;
    }
    if (g.longPressed) return;

    if (g.swiping && Math.abs(g.dx) >= 34) {
      state.pendingDouble = false;
      state.hintTimer && clearTimeout(state.hintTimer);
      els.homeDock.classList.add('is-faded');
      goRelative(g.dx < 0 ? 1 : -1);
      return;
    }

    if (!g.moved && performance.now() - g.started < 650) {
      registerTap();
    }
  }

  function registerTap() {
    if (state.pendingDouble) {
      state.pendingDouble = false;
      cancelTap();
      if (navigator.vibrate) { try { navigator.vibrate(6); } catch (error) { /* noop */ } }
      openEditEditor();
      return;
    }
    state.tapTimer = setTimeout(function () {
      state.tapTimer = 0;
      openVideo();
    }, 300);
  }

  function cancelTap() {
    clearTimeout(state.tapTimer);
    state.tapTimer = 0;
    state.pendingDouble = false;
  }

  function setOrbOffset(dx) {
    const percent = Math.min(1, Math.abs(dx) / 118);
    els.orbStage.style.setProperty('--orb-x', dx.toFixed(1) + 'px');
    els.orbStage.style.setProperty('--orb-rotate', (dx * 0.07).toFixed(2) + 'deg');
    els.orbStage.style.setProperty('--orb-scale', String(1 - percent * 0.04));
  }

  function resetOrbOffset() {
    els.orbStage.style.setProperty('--orb-x', '0px');
    els.orbStage.style.setProperty('--orb-rotate', '0deg');
    els.orbStage.style.setProperty('--orb-scale', '1');
    els.homeOrb.classList.add('is-snapping');
    clearTimeout(state.snappingTimer);
    state.snappingTimer = setTimeout(function () { els.homeOrb.classList.remove('is-snapping'); }, 620);
  }

  /* ---------- single tap: video / double tap: edit / long press: add ---------- */

  function openVideo() {
    const product = state.products[state.activeIndex];
    if (!product) return;
    const video = firstVideo(product.id);
    if (!video) {
      showToast('这个产品还没有视频，双击玻璃球添加');
      return;
    }
    pauseInlineVideo();
    const html =
      '<div class="sheet-title-block"><p class="eyebrow">PRODUCT FILM</p><h1 class="sheet-title" id="sheetVisualTitle">' + esc(product.name) + '</h1></div>' +
      '<div class="large-player"><iframe src="' + attr(U.bilibiliEmbedUrl(video.bvid, true)) + '" title="' + attr(product.name + ' 产品影像') + '" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>' +
      '<div class="player-meta"><span>视频由哔哩哔哩提供，不占用本站存储。</span><a class="media-link" href="' + attr(U.bilibiliWatchUrl(video.bvid)) + '" target="_blank" rel="noopener noreferrer">在 B 站打开 ' + ICON.external + '</a></div>';
    openSheet('PLAY / 播放', html, { width: '1040px', kind: 'video' });
  }

  function openDownloads() {
    const product = state.products[state.activeIndex];
    if (!product) return;
    const downloads = productDownloads(product.id);
    if (!downloads.length) {
      showToast('还没有安装包，双击玻璃球添加');
      return;
    }
    const items = downloads.map(function (download) {
      const href = U.safeUrl(download.url);
      const external = /^https?:\/\//i.test(href);
      const meta = [download.version ? 'v' + download.version : '', download.size, U.formatDateDot(download.date)].filter(Boolean).map(esc).join(' · ');
      return '<div class="download-item">' +
        '<span class="download-icon">' + platformIcon(download.platform) + '</span>' +
        '<span class="download-copy"><strong>' + esc(download.name) + '</strong><small>' + meta + (download.note ? ' · ' + esc(download.note) : '') + '</small></span>' +
        '<span class="download-action"><a class="button primary" href="' + attr(href || '#') + '"' +
          (external ? ' target="_blank" rel="noopener noreferrer"' : (href ? ' download="' + attr(download.name) + '"' : ' aria-disabled="true"')) +
        '>' + ICON.download + '下载</a></span>' +
      '</div>';
    }).join('');
    const html =
      '<div class="download-head"><p class="eyebrow">INSTALLERS</p><h1 class="sheet-title" id="sheetVisualTitle">' + esc(product.name) + '</h1></div>' +
      '<div class="download-list">' + items + '</div>' +
      '<p class="download-note">安装包由 GitHub Releases 或仓库直接提供。</p>';
    openSheet('DOWNLOADS / 下载', html, { width: '760px', kind: 'downloads' });
  }

  /* ---------- editor ---------- */

  function openEditEditor() {
    const product = state.products[state.activeIndex];
    if (!product) return;
    cancelTap();
    const video = firstVideo(product.id);
    state.editor = {
      mode: 'edit',
      productId: product.id,
      videoId: video ? video.id : null,
      product: product,
      downloads: U.clone(productDownloads(product.id)),
      uploadBusy: false
    };
    openEditorSheet({
      mode: 'edit',
      title: '编辑当前产品',
      name: product.name,
      subtitle: product.subtitle,
      description: product.description,
      bvid: video ? video.bvid : '',
      downloads: state.editor.downloads
    });
  }

  function openAddEditor() {
    cancelTap();
    const palette = [
      ['#6d86ff', '#b18cff'],
      ['#2fa98b', '#9ad7a5'],
      ['#e28a4a', '#f0c48f'],
      ['#d25f8f', '#e6a8c9'],
      ['#7b6bd8', '#b6a6f2']
    ][state.products.length % 5];
    const id = U.uid('brand');
    const year = String(new Date().getFullYear());
    const draft = {
      id: id,
      name: '',
      subtitle: '',
      category: '产品',
      year: year,
      status: '',
      accent: palette[0],
      accent2: palette[1],
      preview: 'generic',
      description: '',
      features: [],
      platforms: []
    };
    state.editor = { mode: 'add', productId: id, product: draft, downloads: [], uploadBusy: false };
    openEditorSheet({
      mode: 'add',
      title: '新增一个产品',
      name: '',
      subtitle: '',
      description: '',
      bvid: '',
      downloads: []
    });
  }

  function openEditorSheet(data) {
    const isAdd = data.mode === 'add';
    const connection = connectionMarkup();
    const html =
      '<form class="editor-form" id="productEditor" novalidate>' +
        '<div class="form-grid">' +
          '<label class="field"><span class="field-label">产品名称</span><input id="editName" type="text" value="' + attr(data.name) + '" placeholder="例如 TimeStudio" autocomplete="off" spellcheck="false"></label>' +
          '<label class="field"><span class="field-label">一句话介绍</span><input id="editSubtitle" type="text" value="' + attr(data.subtitle) + '" placeholder="它解决了什么问题" autocomplete="off"></label>' +
          '<label class="field full"><span class="field-label">介绍文字</span><textarea id="editDescription" placeholder="写在产品名字下面的那段话">' + esc(data.description) + '</textarea></label>' +
          '<label class="field"><span class="field-label">页面排版</span><select id="editLayout"><option value="split"' + (state.editor.product.layout !== 'centered' ? ' selected' : '') + '>左右布局</option><option value="centered"' + (state.editor.product.layout === 'centered' ? ' selected' : '') + '>居中布局</option></select></label>' +
          '<label class="field"><span class="field-label">作品主色</span><input id="editAccent" type="color" value="' + attr(U.safeColor(state.editor.product.accent, '#6d86ff').slice(0, 7)) + '"></label>' +
          '<p class="field-hint full">介绍支持分段、**粗体**、## 小标题和 - 列表。可先预览效果，再发布。</p>' +
          '<label class="field full"><span class="field-label">B 站视频链接</span><input id="editVideo" type="text" value="' + attr(data.bvid ? U.bilibiliWatchUrl(data.bvid) : '') + '" placeholder="https://www.bilibili.com/video/BV... 或 BV 号" autocomplete="off" spellcheck="false"><span class="field-hint">粘贴完整链接或 BV 号，保存后右侧会直接显示视频。</span></label>' +
        '</div>' +
        '<section class="editor-section">' +
          '<div class="editor-section-head"><div><h3>安装包</h3><p>可以上传新的安装包到仓库；上传后立即写入 downloads/，再发布内容。</p></div></div>' +
          '<div class="installer-list" id="installerList">' + installerListHtml(data.downloads) + '</div>' +
          '<label class="field"><span class="field-label">添加下载链接</span><input id="editDownloadLink" type="url" placeholder="粘贴安装包或 GitHub Releases 下载地址"><span class="field-hint">已有安装包保留；填写这里会添加一个新的下载入口。</span></label>' +
          '<div class="upload-row">' +
            '<label class="file-button">选择安装包<input id="editInstaller" type="file" accept=".apk,.exe,.msi,.dmg,.pkg,.ipa,.zip,.appx,.msix"></label>' +
            '<span class="upload-note">≤ ' + U.formatBytes(MAX_UPLOAD) + ' · 更大的文件用 Releases 后在完整管理台粘贴链接</span>' +
            '<div class="upload-progress" aria-hidden="true"><i></i></div>' +
            '<div class="upload-status" id="uploadStatus">' + (state.connection ? '还没有选择文件' : '连接 GitHub 后才能上传') + '</div>' +
          '</div>' +
        '</section>' +
        connection +
        '<div class="form-actions">' +
          '<button class="button primary" type="submit" id="saveProduct">发布到 GitHub</button>' +
          '<button class="button glass" type="button" id="previewProduct">保存并预览</button>' +
          '<button class="button quiet" type="button" id="exportProduct">导出内容</button>' +
          '<button class="button quiet" type="button" data-close-sheet>取消</button>' +
          '<span class="form-note">预览仅在此浏览器保存。发布会提交到仓库，等待 Pages 部署后公开更新。</span>' +
        '</div>' +
        '<p class="form-error hidden" id="editorError" role="alert"></p>' +
        '<div class="editor-foot"><span>快捷编辑一次处理一个视频；更多视频、外链和视觉设置可在完整管理台调整。</span><a href="admin.html" target="_blank" rel="noopener">完整管理台 ↗</a></div>' +
      '</form>';
    openSheet(isAdd ? 'ADD / 新增产品' : 'EDIT / 编辑产品', html, { width: '880px', kind: 'editor', focus: '#editName' });
    bindEditorEvents();
  }

  function connectionMarkup() {
    const connected = !!(state.connection && state.connection.token);
    const defaults = state.connection || state.defaults;
    const tokenStored = getStoredToken();
    return '<div class="publish-box' + (connected ? ' is-connected' : '') + '" id="publishBox">' +
      '<div class="publish-head">' +
        '<span class="publish-dot" aria-hidden="true"></span>' +
        '<span class="publish-label" id="publishLabel">' + (connected ? '已连接 ' + esc(state.connection.owner + '/' + state.connection.repo) + ' · 保存后直接发布' : '未连接 GitHub · 连接后才能发布') + '</span>' +
        '<button class="publish-toggle" type="button" data-action="toggle-connect">' + (connected ? '更换' : '设置') + '</button>' +
      '</div>' +
      '<div class="connect-fields hidden" id="connectFields">' +
        '<label class="field"><span class="field-label">Owner</span><input id="connectOwner" type="text" value="' + attr(defaults.owner || '') + '" autocomplete="off" spellcheck="false"></label>' +
        '<label class="field"><span class="field-label">Repository</span><input id="connectRepo" type="text" value="' + attr(defaults.repo || '') + '" autocomplete="off" spellcheck="false"></label>' +
        '<label class="field"><span class="field-label">Branch</span><input id="connectBranch" type="text" value="' + attr(defaults.branch || 'main') + '" autocomplete="off" spellcheck="false"></label>' +
        '<label class="field"><span class="field-label">Token</span><input id="connectToken" type="password" value="" placeholder="' + (tokenStored ? '已保存，留空沿用' : 'github_pat_...') + '" autocomplete="off" spellcheck="false"></label>' +
        '<p class="field-hint full">Token 仅在当前标签页会话使用，不长期保存。</p>' +
        '<div class="connect-actions full"><button class="button glass" type="button" data-action="connect-github">连接 GitHub</button><button class="button quiet" type="button" data-action="disconnect-github">断开连接</button><span class="field-hint">Contents: Read and write</span></div>' +
        '<p class="connect-message" id="connectMessage"></p>' +
        '<p class="token-note">Token 只保存在本机浏览器，不会写进网页文件。上传和发布都只会发往 api.github.com。</p>' +
      '</div>' +
    '</div>';
  }

  function installerListHtml(downloads) {
    if (!downloads || !downloads.length) return '<p class="field-hint" id="installerEmpty">还没有安装包</p>';
    return downloads.map(function (download, index) {
      return '<div class="installer-row" data-installer-index="' + index + '">' +
        '<span class="installer-icon" aria-hidden="true">↓</span>' +
        '<span class="installer-copy"><strong>' + esc(download.name) + '</strong><small>' + esc([download.platform, download.version ? 'v' + download.version : '', download.size].filter(Boolean).join(' · ') || '已添加') + '</small></span>' +
        '<button class="installer-remove" type="button" data-action="remove-installer" data-index="' + index + '" aria-label="移除这个安装包记录">×</button>' +
      '</div>';
    }).join('');
  }

  function bindEditorEvents() {
    const form = $('#productEditor');
    if (!form) return;
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      saveEditor();
    });
    $('#previewProduct').addEventListener('click', function () { saveEditor('preview'); });
    $('#exportProduct').addEventListener('click', function () { saveEditor('export'); });
    const file = $('#editInstaller');
    if (file) file.addEventListener('change', function () {
      const selected = file.files && file.files[0];
      if (selected) uploadInstaller(selected, file);
    });
    const fields = $('#connectFields');
    const toggle = $('[data-action="toggle-connect"]');
    if (toggle && fields) {
      toggle.addEventListener('click', function () {
        fields.classList.toggle('hidden');
        toggle.textContent = fields.classList.contains('hidden') ? (state.connection ? '更换' : '设置') : '收起';
      });
    }
    const connectButton = $('[data-action="connect-github"]');
    if (connectButton) connectButton.addEventListener('click', connectGithub);
    const removeButtons = $$('[data-action="remove-installer"]');
    removeButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        const index = Number(button.getAttribute('data-index'));
        if (!state.editor || !Number.isInteger(index)) return;
        if (!window.confirm('移除这个安装包记录？已经上传到仓库的文件不会被删除。')) return;
        state.editor.downloads.splice(index, 1);
        refreshInstallerList();
      });
    });
  }

  function refreshInstallerList() {
    const list = $('#installerList');
    if (!list || !state.editor) return;
    list.innerHTML = installerListHtml(state.editor.downloads);
    $$('[data-action="remove-installer"]', list).forEach(function (button) {
      button.addEventListener('click', function () {
        const index = Number(button.getAttribute('data-index'));
        if (!state.editor || !Number.isInteger(index)) return;
        if (!window.confirm('移除这个安装包记录？已经上传到仓库的文件不会被删除。')) return;
        state.editor.downloads.splice(index, 1);
        refreshInstallerList();
      });
    });
  }

  async function saveEditor(mode) {
    if (!state.editor || state.busy) return;
    const localOnly = mode === 'preview' || mode === 'export';
    const errorNode = $('#editorError');
    const saveButton = $('#saveProduct');
    if (errorNode) { errorNode.textContent = ''; errorNode.classList.add('hidden'); }
    if (state.editor.uploadBusy) {
      showEditorError('安装包还在上传，请稍等。');
      return;
    }
    const name = ($('#editName') || {}).value ? $('#editName').value.trim() : '';
    const subtitle = $('#editSubtitle') ? $('#editSubtitle').value.trim() : '';
    const description = $('#editDescription') ? $('#editDescription').value.trim() : '';
    const videoRaw = $('#editVideo') ? $('#editVideo').value.trim() : '';
    const video = videoRaw ? U.parseBilibili(videoRaw) : null;
    const layout = $('#editLayout').value === 'centered' ? 'centered' : 'split';
    const accent = U.safeColor($('#editAccent').value, '#6d86ff');
    const downloadLink = $('#editDownloadLink').value.trim();
    if (downloadLink && (!U.safeUrl(downloadLink) || !/^https?:\/\//i.test(downloadLink))) { showEditorError('请填写完整的 http 或 https 下载地址。'); return; }

    if (!name) { showEditorError('先给这个产品起一个名字。'); $('#editName') && $('#editName').focus(); return; }
    if (videoRaw && !video) { showEditorError('B 站链接没有识别出 BV 号，请粘贴完整视频链接。'); $('#editVideo') && $('#editVideo').focus(); return; }
    if (!localOnly && (!state.connection || !state.connection.token)) {
      showEditorError('先连接 GitHub，才能把修改发布到 Pages。');
      showToast('先在下方连接 GitHub');
      const fields = $('#connectFields');
      if (fields) fields.classList.remove('hidden');
      const toggle = $('[data-action="toggle-connect"]');
      if (toggle) toggle.textContent = '收起';
      const owner = $('#connectOwner');
      if (owner) owner.focus();
      return;
    }

    if (saveButton && !localOnly) {
      saveButton.disabled = true;
      saveButton.textContent = '发布中…';
    }
    setBusy(true);

    try {
      const content = U.clone(state.content);
      const productId = state.editor.productId;
      let product = content.products.find(function (item) { return item.id === productId; });
      if (!product) {
        product = {
          id: productId,
          name: name,
          subtitle: subtitle,
          category: '产品',
          year: String(new Date().getFullYear()),
          status: '',
          accent: state.editor.product.accent,
          accent2: state.editor.product.accent2,
          preview: 'generic',
          description: description,
          features: [],
          platforms: []
        };
        content.products.push(product);
      } else {
        product.name = name;
        product.subtitle = subtitle;
        product.description = description;
      }

      product.layout = layout;
      product.accent = accent;
      const oldVideo = content.videos.find(function (item) { return item.productId === productId && item.id === state.editor.videoId; });
      if (oldVideo) content.videos = content.videos.filter(function (item) { return item !== oldVideo; });
      if (video) {
        const newVideo = Object.assign({}, oldVideo || {}, {
          id: oldVideo ? oldVideo.id : U.uid('film'),
          productId: productId,
          title: name,
          subtitle: subtitle,
          bvid: video.bvid,
          description: oldVideo ? oldVideo.description : ''
        });
        content.videos.unshift(newVideo);
      }

      const downloads = (state.editor.downloads || []).map(function (download) {
        return Object.assign({}, download, { productId: productId });
      });
      if (downloadLink && !downloads.some(function (item) { return item.url === downloadLink; })) downloads.push({ id: U.uid('download'), productId: productId, name: name + ' 安装包', url: downloadLink, date: today() });
      content.downloads = content.downloads.filter(function (item) { return item.productId !== productId; }).concat(downloads);
      content.updatedAt = new Date().toISOString();

      let response = null;
      if (localOnly) {
        localStorage.setItem(BASE_KEY, state.baseContent);
        localStorage.setItem(PREVIEW_KEY, JSON.stringify(content));
        state.previewMode = true;
        els.previewBadge.classList.remove('hidden');
        if (mode === 'export') {
          const link = document.createElement('a');
          const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2) + '\n'], { type: 'application/json' }));
          link.href = objectUrl; link.download = 'site.json'; link.click();
          setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 1000);
        }
        const nextUrl = new URL(location.href); nextUrl.searchParams.set('preview', '1'); history.replaceState(null, '', nextUrl);
      } else {
        response = await publishContent(content, 'Update product · ' + name);
        state.baseContent = JSON.stringify(content);
        state.previewMode = false;
        els.previewBadge.classList.add('hidden');
        const nextUrl = new URL(location.href); nextUrl.searchParams.delete('preview'); history.replaceState(null, '', nextUrl);
      }
      state.content = content;
      state.products = content.products;
      if (!localOnly) state.baseUpdatedAt = content.updatedAt;
      state.sha = response && response.content ? response.content.sha : state.sha;
      const nextIndex = state.products.findIndex(function (item) { return item.id === productId; });
      state.activeIndex = nextIndex >= 0 ? nextIndex : state.activeIndex;
      state.restoreInlineVideo = false;
      state.editor = null;
      setBusy(false);
      closeSheet();
      renderProduct(state.activeIndex, { silent: true });
      announce(state.products[state.activeIndex]);
      showToast(localOnly ? (mode === 'export' ? '已导出内容，可替换仓库中的 content/site.json。' : '草稿已保存，仅在当前浏览器可见。') : '已提交 GitHub。Pages 部署完成后会公开更新。');
      if (navigator.vibrate) { try { navigator.vibrate(10); } catch (error) { /* noop */ } }
    } catch (error) {
      setBusy(false);
      showEditorError(formatGithubError(error));
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = '发布到 GitHub';
      }
    }
  }

  function showEditorError(message) {
    const node = $('#editorError');
    if (!node) { showToast(message); return; }
    node.textContent = message;
    node.classList.remove('hidden');
    try { node.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (error) { /* noop */ }
  }

  /* ---------- GitHub publishing ---------- */

  function getStoredToken() {
    try {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      localStorage.removeItem('anthony-admin-token');
      return sessionStorage.getItem(ADMIN_TOKEN_KEY) || '';
    } catch (error) { return ''; }
  }

  function restoreConnection() {
    let config = null;
    try { config = JSON.parse(localStorage.getItem(ADMIN_CONFIG_KEY) || 'null'); } catch (error) { config = null; }
    const token = getStoredToken();
    if (config && token && config.owner && config.repo) {
      state.connection = {
        owner: String(config.owner),
        repo: String(config.repo),
        branch: String(config.branch || 'main'),
        remember: !!config.remember,
        token: token
      };
    }
    state.defaults = connectionDefaults();
  }

  function connectionDefaults() {
    let config = null;
    try { config = JSON.parse(localStorage.getItem(ADMIN_CONFIG_KEY) || 'null'); } catch (error) { config = null; }
    if (config && config.owner && config.repo) {
      return { owner: String(config.owner), repo: String(config.repo), branch: String(config.branch || 'main') };
    }
    const repoUrl = state.content && state.content.site ? String(state.content.site.repoUrl || '') : '';
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/?#]+)/i);
    if (match) return { owner: match[1], repo: match[2].replace(/\.git$/i, ''), branch: 'main' };
    return { owner: '', repo: '', branch: 'main' };
  }

  function matchesBase(remote) {
    try {
      return U.contentFingerprint(normalizeContent(U.clone(remote))) === U.contentFingerprint(normalizeContent(JSON.parse(state.baseContent)));
    } catch (error) { return false; }
  }

  async function connectGithub() {
    if (state.busy) return;
    const owner = ($('#connectOwner') || {}).value ? $('#connectOwner').value.trim() : '';
    const repo = ($('#connectRepo') || {}).value ? $('#connectRepo').value.trim() : '';
    const branch = ($('#connectBranch') || {}).value ? $('#connectBranch').value.trim() : 'main';
    const tokenInput = $('#connectToken') ? $('#connectToken').value.trim() : '';
    const token = tokenInput || getStoredToken();
    const remember = $('#connectRemember') ? $('#connectRemember').checked : false;
    const message = $('#connectMessage');
    const button = $('[data-action="connect-github"]');
    function setMessage(text, success) {
      if (!message) return;
      message.textContent = text || '';
      message.className = 'connect-message' + (success ? ' is-success' : '');
    }
    if (!owner || !repo) { setMessage('请填写 owner 和 repository。'); return; }
    if (!token) { setMessage('请填写 GitHub Token。需要 Contents: Read and write 权限。'); return; }
    if (button) { button.disabled = true; button.textContent = '连接中…'; }
    setMessage('');
    const previous = state.connection;
    state.connection = { owner: owner, repo: repo, branch: branch, token: token, remember: remember };
    setBusy(true);
    try {
      await api('GET', '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo));
      await api('GET', '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/branches/' + encodeURIComponent(branch));
      const info = await api('GET', repoContentPath(owner, repo) + '?ref=' + encodeURIComponent(branch), null, { allow404: true });
      if (info && (!info.content || !matchesBase(JSON.parse(U.decodeBase64Utf8(info.content))))) {
        throw new Error('仓库内容与当前页面不同。请先在完整管理台读取最新内容再编辑，避免覆盖。');
      }
      state.sha = info ? info.sha : null;
      state.defaults = { owner: owner, repo: repo, branch: branch };
      persistConnection();
      const box = $('#publishBox');
      if (box) box.classList.add('is-connected');
      const label = $('#publishLabel');
      if (label) label.textContent = '已连接 ' + owner + '/' + repo + ' · 保存后直接发布';
      const fields = $('#connectFields');
      if (fields) fields.classList.add('hidden');
      const toggle = $('[data-action="toggle-connect"]');
      if (toggle) toggle.textContent = '更换';
      const uploadStatus = $('#uploadStatus');
      if (uploadStatus && !state.editor?.uploadBusy) uploadStatus.textContent = '还没有选择文件';
      setMessage('已连接。现在可以保存并发布。', true);
      showToast('已连接 GitHub');
    } catch (error) {
      state.connection = previous;
      setMessage(formatGithubError(error));
    } finally {
      setBusy(false);
      if (button) { button.disabled = false; button.textContent = '连接 GitHub'; }
    }
  }

  function persistConnection() {
    if (!state.connection) return;
    try {
      localStorage.setItem(ADMIN_CONFIG_KEY, JSON.stringify({
        owner: state.connection.owner,
        repo: state.connection.repo,
        branch: state.connection.branch,
        remember: state.connection.remember
      }));
      sessionStorage.setItem(ADMIN_TOKEN_KEY, state.connection.token);
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      localStorage.removeItem('anthony-admin-token');
    } catch (error) { /* noop */ }
  }

  function repoContentPath(owner, repo) {
    return '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/contents/' + encodeContentPath(CONTENT_PATH);
  }

  function encodeContentPath(path) {
    return String(path).split('/').map(encodeURIComponent).join('/');
  }

  async function api(method, path, body, options) {
    const opts = options || {};
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (state.connection && state.connection.token) headers.Authorization = 'Bearer ' + state.connection.token;
    if (body) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetch(API + path, {
        method: method,
        headers: headers,
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        signal: AbortSignal.timeout(30000)
      });
    } catch (error) {
      throw new Error('网络连接失败，或浏览器阻止了 GitHub API 请求。');
    }
    const text = await response.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch (error) { data = null; } }
    if (response.ok) return data;
    if (response.status === 404 && opts.allow404) return null;
    const error = new Error(data && data.message ? data.message : 'HTTP ' + response.status);
    error.status = response.status;
    throw error;
  }

  async function publishContent(content, message) {
    if (!state.connection || !state.connection.token) throw new Error('还没有连接 GitHub。');
    const path = repoContentPath(state.connection.owner, state.connection.repo);
    const latest = await api('GET', path + '?ref=' + encodeURIComponent(state.connection.branch), null, { allow404: true });
    const latestSha = latest ? latest.sha : null;
    if (state.sha && latestSha !== state.sha) {
      throw new Error('仓库里的内容刚被其他操作更新了。刷新页面后再编辑，避免覆盖。');
    }
    if (latest) {
      if (!latest.content || !matchesBase(JSON.parse(U.decodeBase64Utf8(latest.content)))) {
        throw new Error('仓库里的内容已变化。请先导出当前草稿，再在管理台读取最新内容，避免覆盖。');
      }
    }
    if (!state.sha) state.sha = latestSha;
    const body = {
      message: message,
      content: U.encodeBase64Utf8(JSON.stringify(content, null, 2) + '\n'),
      branch: state.connection.branch
    };
    if (latestSha) body.sha = latestSha;
    const response = await api('PUT', path, body);
    state.sha = response && response.content ? response.content.sha : latestSha;
    try { localStorage.removeItem(PREVIEW_KEY); localStorage.removeItem(BASE_KEY); } catch (error) { /* noop */ }
    return response;
  }

  function formatGithubError(error) {
    if (!error) return '未知错误';
    if (error.status === 401) return 'Token 无效或过期，请重新生成。';
    if (error.status === 403) return 'Token 权限不足，需要 Contents: Read and write。';
    if (error.status === 404) return '找不到仓库、分支或文件，请检查连接信息。';
    if (error.status === 409) return '仓库内容发生冲突，请刷新页面后再试。';
    if (error.status === 422) return 'GitHub 无法完成这个操作，请检查分支权限或文件名。';
    return error.message || '操作失败';
  }

  /* ---------- installer upload ---------- */

  async function uploadInstaller(file, input) {
    if (!state.editor || state.busy) return;
    const status = $('#uploadStatus');
    const progress = $('.upload-progress i');
    const fileButton = $('.file-button');
    function setStatus(text, kind) {
      if (!status) return;
      status.textContent = text;
      status.className = 'upload-status' + (kind ? ' is-' + kind : '');
    }
    if (!state.connection || !state.connection.token) {
      setStatus('先连接 GitHub，再上传安装包。', 'error');
      const fields = $('#connectFields');
      if (fields) fields.classList.remove('hidden');
      showToast('请先连接 GitHub');
      input.value = '';
      return;
    }
    if (file.size > MAX_UPLOAD) {
      setStatus('文件超过 ' + U.formatBytes(MAX_UPLOAD) + '，请使用 GitHub Releases，再把链接粘到完整管理台。', 'error');
      input.value = '';
      return;
    }

    const fileName = safeFileName(file.name);
    if (!/\.(apk|exe|msi|dmg|pkg|ipa|zip|appx|msix)$/i.test(file.name) || !file.size) { setStatus('请选择非空的安装包或 ZIP 文件。', 'error'); input.value = ''; return; }
    const uploadDirectory = 'downloads/' + U.uid('upload') + '/';
    const repoPath = uploadDirectory + fileName;
    const owner = state.connection.owner;
    const repo = state.connection.repo;
    const branch = state.connection.branch;
    const apiPath = '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/contents/' + encodeContentPath(repoPath);
    state.editor.uploadBusy = true;
    setBusy(true);
    if (fileButton) fileButton.classList.add('is-disabled');
    if (progress) progress.style.setProperty('--upload-progress', '0%');
    setStatus('正在读取文件…');

    try {
      const buffer = await file.arrayBuffer();
      const payload = {
        message: 'Upload ' + fileName,
        content: U.encodeBase64Bytes(buffer),
        branch: branch
      };
      setStatus('正在上传 ' + fileName + '…');
      await uploadPut(apiPath, payload, function (percent) {
        if (progress) progress.style.setProperty('--upload-progress', percent + '%');
        setStatus('正在上传 ' + fileName + ' · ' + Math.round(percent) + '%');
      });

      const urlPath = uploadDirectory + encodeURIComponent(fileName);
      const record = {
        id: U.uid('download'),
        productId: state.editor.productId,
        name: file.name,
        platform: inferPlatform(file.name),
        version: '',
        size: U.formatBytes(file.size),
        date: today(),
        url: urlPath,
        note: ''
      };
      const duplicate = state.editor.downloads.find(function (item) { return item.url === urlPath; });
      if (duplicate) {
        duplicate.size = record.size;
        duplicate.date = record.date;
        duplicate.name = record.name;
      } else {
        state.editor.downloads.push(record);
      }
      refreshInstallerList();
      if (progress) progress.style.setProperty('--upload-progress', '100%');
      setStatus('已上传到 ' + repoPath + '。发布内容后网站才会引用它。', 'done');
      showToast('安装包已上传');
    } catch (error) {
      setStatus(formatGithubError(error), 'error');
      showToast('上传失败：' + formatGithubError(error));
    } finally {
      state.editor.uploadBusy = false;
      setBusy(false);
      if (fileButton) fileButton.classList.remove('is-disabled');
      input.value = '';
    }
  }

  function uploadPut(apiPath, payload, onProgress) {
    return new Promise(function (resolve, reject) {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', API + apiPath, true);
      xhr.timeout = 180000;
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
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else {
          const error = new Error(data && data.message ? data.message : 'HTTP ' + xhr.status);
          error.status = xhr.status;
          reject(error);
        }
      };
      xhr.onerror = function () { reject(new Error('网络错误，上传没有完成。')); };
      xhr.ontimeout = function () { reject(new Error('上传超时。请检查 GitHub 仓库后再重试。')); };
      xhr.send(JSON.stringify(payload));
    });
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

  function today() {
    const date = new Date();
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  /* ---------- sheet system ---------- */

  function openSheet(title, bodyHtml, options) {
    const opts = options || {};
    if (!state.sheetOpen) pauseInlineVideo();
    const width = opts.width ? 'min(' + opts.width + ', calc(100vw - 16px))' : '';
    els.sheetDialog.style.width = width;
    els.sheetContent.innerHTML =
      '<div class="sheet-header"><h2 id="sheetTitle">' + esc(title) + '</h2><button class="sheet-close" type="button" data-close-sheet aria-label="关闭">' + ICON.close + '</button></div>' +
      '<div class="sheet-body">' + bodyHtml + '</div>';
    const visualTitle = $('#sheetVisualTitle', els.sheetContent);
    els.sheetDialog.setAttribute('aria-labelledby', visualTitle ? 'sheetVisualTitle' : 'sheetTitle');
    els.sheetContent.scrollTop = 0;

    if (!els.sheetDialog.open) {
      if (typeof els.sheetDialog.showModal === 'function') els.sheetDialog.showModal();
      else els.sheetDialog.setAttribute('open', '');
      state.sheetOpen = true;
      state.sheetKind = opts.kind || '';
      document.body.classList.add('sheet-open', 'is-locked');
      requestAnimationFrame(function () {
        const focusTarget = opts.focus ? $(opts.focus, els.sheetContent) : null;
        if (focusTarget) focusTarget.focus({ preventScroll: true });
        else els.sheetDialog.focus({ preventScroll: true });
      });
    }
  }

  function closeSheet() {
    if (state.busy) { showToast('操作正在进行，请稍候。'); return; }
    if (!els.sheetDialog || !els.sheetDialog.open) return;
    state.sheetOpen = false;
    document.body.classList.remove('sheet-open', 'is-locked');
    if (typeof els.sheetDialog.close === 'function') els.sheetDialog.close();
    else {
      els.sheetDialog.removeAttribute('open');
      onSheetClosed();
    }
  }

  function onSheetClosed() {
    const restore = state.restoreInlineVideo;
    const index = state.activeIndex;
    state.sheetOpen = false;
    state.sheetKind = '';
    state.editor = null;
    state.restoreInlineVideo = false;
    els.sheetContent.innerHTML = '';
    els.sheetDialog.style.width = '';
    document.body.classList.remove('sheet-open', 'is-locked');
    if (restore) renderProduct(index, { silent: true });
    setTimeout(function () { els.homeOrb.focus({ preventScroll: true }); }, 30);
  }

  function pauseInlineVideo() {
    const iframe = $('#cardMount .video-frame iframe');
    if (!iframe) return;
    iframe.src = 'about:blank';
    state.restoreInlineVideo = true;
  }

  /* ---------- theme / utilities ---------- */

  function initTheme() {
    const apply = function (theme) {
      const next = theme === 'dark' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      document.documentElement.style.colorScheme = next;
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', next === 'dark' ? '#0b0c0f' : '#f2f0ec');
      if (els.themeToggle) els.themeToggle.setAttribute('aria-label', next === 'dark' ? '切换到浅色模式' : '切换到深色模式');
    };
    apply(document.documentElement.dataset.theme);
    els.themeToggle.addEventListener('click', function () {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      apply(next);
      try { localStorage.setItem('anthony-theme', next); } catch (error) { /* noop */ }
    });
    if (window.matchMedia) {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = function (event) {
        try {
          if (!localStorage.getItem('anthony-theme')) apply(event.matches ? 'dark' : 'light');
        } catch (error) { /* noop */ }
      };
      if (media.addEventListener) media.addEventListener('change', onChange);
      else if (media.addListener) media.addListener(onChange);
    }
  }

  function bindEvents() {
    bindOrb();
    $('#editCurrent').addEventListener('click', openEditEditor);
    els.sheetDialog.addEventListener('cancel', function (event) { if (state.busy) event.preventDefault(); });
    window.addEventListener('beforeunload', function (event) { if (state.busy) { event.preventDefault(); event.returnValue = ''; } });
    document.addEventListener('keydown', function (event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      const target = event.target;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || ''))) return;
      if (target && els.homeOrb.contains(target)) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        if (!event.repeat) goRelative(event.key === 'ArrowRight' ? 1 : -1);
      } else if (event.key === 'e' || event.key === 'E') {
        event.preventDefault();
        openEditEditor();
      } else if (event.key === 'n' || event.key === 'N') {
        event.preventDefault();
        openAddEditor();
      } else if (event.key === 'd' || event.key === 'D') {
        event.preventDefault();
        openDownloads();
      }
    });

    document.addEventListener('click', function (event) {
      if (state.busy) return;
      const productButton = event.target.closest('[data-product-index]');
      if (productButton) { const next = Number(productButton.dataset.productIndex); switchProduct(next, next > state.activeIndex ? 1 : -1); return; }
      const close = event.target.closest('[data-close-sheet]');
      if (close) { event.preventDefault(); closeSheet(); return; }
      const action = event.target.closest('[data-action]');
      if (!action) return;
      const kind = action.getAttribute('data-action');
      if (kind === 'downloads') { event.preventDefault(); openDownloads(); }
      if (kind === 'video') { event.preventDefault(); openVideo(); }
      if (kind === 'edit') { event.preventDefault(); openEditEditor(); }
      if (kind === 'add') { event.preventDefault(); openAddEditor(); }
      if (kind === 'disconnect-github') {
        sessionStorage.removeItem(ADMIN_TOKEN_KEY); localStorage.removeItem(ADMIN_TOKEN_KEY); localStorage.removeItem('anthony-admin-token');
        state.connection = null; state.sha = null;
        $('#connectToken').value = ''; $('#publishLabel').textContent = '未连接 GitHub';
        $('#publishBox').classList.remove('is-connected'); showToast('已断开连接');
      }
    });

    els.sheetDialog.addEventListener('close', onSheetClosed);
    els.sheetDialog.addEventListener('click', function (event) {
      if (event.target === els.sheetDialog) closeSheet();
    });
    document.addEventListener('visibilitychange', function () {
      document.body.classList.toggle('orb-paused', document.hidden);
    });
    window.addEventListener('hashchange', function () {
      if (state.sheetOpen || state.switching) return;
      const hash = decodeURIComponent(String(location.hash || '').replace(/^#/, ''));
      const index = state.products.findIndex(function (p) { return p.id === hash; });
      if (index >= 0 && index !== state.activeIndex) switchProduct(index, index > state.activeIndex ? 1 : -1);
    });
  }

  function showToast(message) {
    if (!els.toast) return;
    clearTimeout(state.toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add('is-visible');
    state.toastTimer = setTimeout(function () { els.toast.classList.remove('is-visible'); }, 3000);
  }

  function setBusy(busy) {
    state.busy = busy;
    els.sheetContent.setAttribute('aria-busy', String(busy));
    $$('input, textarea, select, button', els.sheetContent).forEach(function (node) { node.disabled = busy; });
  }

  function showLoadError(error) {
    els.cardMount.setAttribute('aria-busy', 'false');
    els.homeDock.classList.add('hidden');
    const localHint = location.protocol === 'file:'
      ? '你现在是直接双击打开页面。浏览器会阻止本地读取 JSON，请用本地服务器或 GitHub Pages 打开。'
      : '请检查 content/site.json 是否存在且格式正确。';
    els.cardMount.innerHTML =
      '<div class="load-error"><span class="eyebrow">CONTENT UNAVAILABLE</span><h1>内容没有加载出来</h1><p>' +
      esc(localHint) + ' 技术信息：' + esc(error && error.message ? error.message : '未知错误') +
      '</p><a class="button primary" href="admin.html">打开完整管理台</a></div>';
  }

  function platformIcon(platform) {
    const key = String(platform || '').toLowerCase();
    if (key.indexOf('android') >= 0) return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="4" width="10" height="16" rx="2.5"></rect><path d="M9.5 8h5M10.5 16.5h3"></path></svg>';
    if (key.indexOf('windows') >= 0) return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.8 11 5v6H4zM13 4.7 20 4v7h-7zM4 13h7v6.2L4 18.2zM13 13h7v7l-7-.8z"></path></svg>';
    if (key.indexOf('mac') >= 0 || key.indexOf('ios') >= 0) return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.8 12.6c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.1-1.7-1.3-.1-2.6.8-3.3.8-.7 0-1.7-.8-2.8-.8-1.4 0-2.8.8-3.5 2.1-1.5 2.6-.4 6.4 1 8.5.7 1 1.5 2.1 2.6 2.1 1 0 1.4-.7 2.7-.7s1.6.7 2.7.7c1.1 0 1.9-1 2.6-2 .8-1.1 1.1-2.1 1.1-2.2-.1 0-2.2-.9-2.2-3.4Z"></path><path d="M13.8 5.9c.6-.8 1.1-1.8 1-2.9-.9.1-2 .6-2.6 1.4-.6.7-1.1 1.8-1 2.8 1 .1 2-.5 2.6-1.3Z"></path></svg>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v11.2m0 0 4.2-4.2M12 14.7 7.8 10.5M5 20h14"></path></svg>';
  }
})();
