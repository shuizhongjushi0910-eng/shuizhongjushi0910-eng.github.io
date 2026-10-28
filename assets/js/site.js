(function () {
  'use strict';

  const U = window.SiteUtils;
  const API = 'https://api.github.com';
  const CONTENT_PATH = 'content/site.json';
  const ADMIN_CONFIG_KEY = U.storageKey('anthony-admin-config');
  const ADMIN_TOKEN_KEY = U.storageKey('anthony-admin-token');
  const PREVIEW_KEY = U.storageKey('anthony-preview-content');
  const BASE_KEY = U.storageKey('anthony-preview-base');
  const RAW_KEY = U.storageKey('anthony-editor-draft');
  const MAX_UPLOAD = 48 * 1024 * 1024;
  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = function (selector, root) { return (root || document).querySelector(selector); };
  const $$ = function (selector, root) { return Array.from((root || document).querySelectorAll(selector)); };
  const esc = U.escapeHtml;
  const attr = U.escapeAttribute;

  const ICON = {
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15.5 4.5 4 4M5 19l4.2-1 10-10a2.8 2.8 0 0 0-4-4l-10 10L5 19Z"></path></svg>',
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
    inlineEditing: false,
    deletedSnapshot: null,
    deletePending: null,
    rawDraft: null,
    rawSaveFailed: false,
    contextProductId: null,
    contextOpen: { video: false, downloads: false, appearance: false },
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
      setupChrome();
      restoreConnection();
      state.defaults = connectionDefaults();

      if (state.previewMode && els.previewBadge) els.previewBadge.classList.remove('hidden');
      const hash = decodeURIComponent(String(location.hash || '').replace(/^#/, ''));
      const hashIndex = state.products.findIndex(function (p) { return p.id === hash; });
      state.activeIndex = hashIndex >= 0 ? hashIndex : 0;
      const workingDraft = state.previewMode ? readRawDraft() : null;
      const workingIndex = workingDraft ? state.products.findIndex(function (p) { return p.id === workingDraft.productId; }) : -1;
      if (workingIndex >= 0) { state.rawDraft = workingDraft; state.activeIndex = workingIndex; state.inlineEditing = true; }
      else if (workingDraft) clearRawDraft();
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
    if (!product) { renderEmptyAlbum(); return; }
    state.activeIndex = index;
    if (state.contextProductId !== product.id) {
      state.contextProductId = product.id;
      state.contextOpen = { video: false, downloads: false, appearance: false };
    }
    if (state.inlineEditing) beginInlineEditor(product);
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
      ? '<div class="product-actions"><button class="button primary" type="button" data-action="downloads">' + ICON.download + '下载</button></div>'
      : '';

    const mediaTag = state.inlineEditing || video ? 'button' : 'div';
    const media = '<' + mediaTag + ' class="video-cover' + (!state.inlineEditing && !video ? ' video-placeholder' : '') + '"' + (mediaTag === 'button' ? ' type="button" data-action="' + (state.inlineEditing ? 'toggle-video' : 'video') + '" aria-label="' + attr(state.inlineEditing ? '修改视频' : '播放 ' + product.name + ' 产品演示') + '"' + (state.inlineEditing ? ' aria-controls="videoPanel" aria-expanded="' + String(state.contextOpen.video) + '"' : '') : ' aria-hidden="true"') + '>' +
      '<span class="cover-art" aria-hidden="true"><span class="cover-monogram">' + esc(product.name.slice(0, 1)) + '</span></span>' +
      '<span class="cover-play">' + (state.inlineEditing ? ICON.edit : ICON.play) + '</span><span class="cover-label">' + (state.inlineEditing ? (video ? '修改视频' : '添加视频') : '观看演示') + '</span></' + mediaTag + '>';

    const copy = state.inlineEditing
      ? '<h1 class="product-name' + (longName ? ' is-long' : '') + '" id="productTitle"><textarea class="inline-field inline-name" id="editName" rows="1" aria-label="作品名称" placeholder="作品名称" spellcheck="false">' + esc(product.name) + '</textarea></h1>' +
        '<textarea class="inline-field inline-subtitle" id="editSubtitle" rows="1" aria-label="一句话介绍" placeholder="一句话介绍">' + esc(product.subtitle) + '</textarea>' +
        '<textarea class="inline-field inline-description" id="editDescription" rows="3" aria-label="作品介绍" placeholder="写一点介绍">' + esc(product.description) + '</textarea>' + inlineDownloadsMarkup()
      : '<h1 class="product-name' + (longName ? ' is-long' : '') + '" id="productTitle">' + esc(product.name) + '</h1>' +
        (product.subtitle ? '<p class="product-subtitle">' + esc(product.subtitle) + '</p>' : '') +
        (product.description ? '<div class="product-description description-rich">' + U.markdown(product.description) + '</div>' : '') + actions;

    els.cardMount.innerHTML =
      '<article class="product-card' + (product.layout === 'centered' ? ' layout-centered' : '') + '" data-product-id="' + attr(product.id) + '" aria-labelledby="productTitle" style="--accent:' + accent + ';--accent-2:' + accent2 + '">' +
        '<div class="product-copy">' +
          copy +
        '</div>' +
        '<div class="product-media">' + media + (state.inlineEditing ? inlineVideoMarkup(video) : '') + '</div>' +
      '</article>';

    updateAmbient(accent, accent2);
    document.title = product.name + ' · ' + pageTitle;
    setMeta('meta[name="description"]', product.description || product.subtitle || (site.description || ''));
    setMeta('meta[property="og:title"]', product.name + ' · ' + pageTitle);
    setMeta('meta[property="og:description"]', product.description || product.subtitle || '');
    updateOrbLabel();
    $('#productNav').innerHTML = state.products.map(function (item, itemIndex) {
      return '<button type="button" data-product-index="' + itemIndex + '" aria-current="' + (itemIndex === index ? 'true' : 'false') + '">' + esc(item.name) + '</button>';
    }).join('');
    renderInlineToolbar();
    if (state.inlineEditing) { restoreRawDraft(); bindInlineFields(); }
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
    if (state.busy || state.switching || state.sheetOpen || !state.products.length) return;
    if (targetIndex < 0 || targetIndex >= state.products.length) return;
    if (targetIndex === state.activeIndex) return;
    if (state.inlineEditing && !checkPendingDownload()) return;
    if (state.inlineEditing && !syncInlineEditor(true)) return;
    clearRawDraft();
    state.deletePending = null;
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
      showToast('暂无视频');
      return;
    }
    pauseInlineVideo();
    const html =
      '<div class="sheet-title-block"><h1 class="sheet-title" id="sheetVisualTitle">' + esc(product.name) + '</h1></div>' +
      '<div class="large-player"><iframe src="' + attr(U.bilibiliEmbedUrl(video.bvid, true)) + '" title="' + attr(product.name + ' 产品影像') + '" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>' +
      '<div class="player-meta"><a class="media-link" href="' + attr(U.bilibiliWatchUrl(video.bvid)) + '" target="_blank" rel="noopener noreferrer">B 站打开 ' + ICON.external + '</a></div>';
    openSheet('视频', html, { width: '1040px', kind: 'video' });
  }

  function openDownloads() {
    const product = state.products[state.activeIndex];
    if (!product) return;
    const downloads = productDownloads(product.id);
    if (!downloads.length) {
      showToast('暂无安装包');
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
      '<div class="download-head"><h1 class="sheet-title" id="sheetVisualTitle">' + esc(product.name) + '</h1></div>' +
      '<div class="download-list">' + items + '</div>';
    openSheet('下载', html, { width: '760px', kind: 'downloads' });
  }

  /* ---------- editor ---------- */

  function beginInlineEditor(product) {
    const video = firstVideo(product.id);
    state.editor = { mode: 'edit', productId: product.id, videoId: video ? video.id : null, product: product, downloads: U.clone(productDownloads(product.id)), uploadBusy: false };
  }

  function openEditEditor() {
    if (state.busy) return;
    if (state.inlineEditing) { finishInlineEditing(); return; }
    cancelTap();
    state.inlineEditing = true;
    document.body.classList.add('is-editing');
    const product = state.products[state.activeIndex];
    if (product) beginInlineEditor(product);
    renderProduct(state.activeIndex, { silent: true });
  }

  function finishInlineEditing() {
    if (state.busy || (state.editor && state.editor.uploadBusy)) return;
    return saveEditor('preview');
  }

  function openAddEditor() {
    if (state.busy || (state.editor && state.editor.uploadBusy)) return;
    if (state.inlineEditing && !checkPendingDownload()) return;
    if (state.inlineEditing && state.editor && !syncInlineEditor(true)) return;
    clearRawDraft();
    state.deletePending = null;
    cancelTap();
    clearTimeout(state.transitionTimer);
    clearTimeout(state.settleTimer);
    state.switching = false;
    const palette = [['#6d86ff', '#b18cff'], ['#2fa98b', '#9ad7a5'], ['#e28a4a', '#f0c48f'], ['#d25f8f', '#e6a8c9'], ['#7b6bd8', '#b6a6f2']][state.products.length % 5];
    const product = { id: U.uid('brand'), name: '新作品', subtitle: '', description: '', category: '产品', year: String(new Date().getFullYear()), status: '', accent: palette[0], accent2: palette[1], preview: 'generic', features: [], platforms: [], layout: 'split' };
    state.content.products.push(product);
    state.products = state.content.products;
    state.activeIndex = state.products.length - 1;
    state.inlineEditing = true;
    document.body.classList.add('is-editing');
    beginInlineEditor(product);
    saveDraftContent(state.content);
    renderProduct(state.activeIndex, { silent: true });
    requestAnimationFrame(function () { const name = $('#editName'); if (name) { name.focus(); if (name.select) name.select(); } });
  }

  function renderEmptyAlbum() {
    state.activeIndex = 0;
    state.editor = null;
    state.deletePending = null;
    els.cardMount.innerHTML = '<section class="empty-album"><h1>还没有作品</h1><button class="button primary" type="button" data-action="add">新建作品</button></section>';
    els.cardMount.setAttribute('aria-busy', 'false');
    $('#productNav').innerHTML = '';
    renderInlineToolbar();
    try { const url = new URL(location.href); url.hash = ''; history.replaceState(null, '', url); } catch (error) { /* noop */ }
  }

  function renderInlineToolbar() {
    const tools = $('#inlineEditorTools');
    const toggle = $('#editCurrent');
    if (toggle) { toggle.textContent = state.inlineEditing ? '完成' : '编辑'; toggle.setAttribute('aria-pressed', String(!!state.inlineEditing)); }
    document.body.classList.toggle('is-editing', !!state.inlineEditing);
    if (!tools) return;
    tools.classList.toggle('hidden', !state.inlineEditing);
    if (!state.inlineEditing) { tools.innerHTML = ''; return; }
    const product = state.products[state.activeIndex];
    if (!product || state.deletePending !== product.id) state.deletePending = null;
    tools.innerHTML = '<div class="inline-toolbar" id="inlineToolbar" role="toolbar" aria-label="作品编辑">' +
      '<button class="button quiet" type="button" data-action="add">＋ 新建</button>' +
      (product ? '<button class="button quiet danger" type="button" data-action="delete-product">删除</button>' : '') +
      (state.deletedSnapshot ? '<button class="button quiet" type="button" data-action="undo-delete">撤销删除</button>' : '') +
      (product ? '<button class="button quiet" type="button" data-action="toggle-appearance" aria-controls="appearancePanel" aria-expanded="' + String(state.contextOpen.appearance) + '">外观</button>' : '') +
      '<button class="button quiet" type="button" data-action="github-settings">' + (state.connection ? '已连接' : 'GitHub') + '</button>' +
      '<button class="button primary" type="button" id="saveProduct" data-action="publish-inline">发布</button>' +
      '</div>' + (product ? '<div class="appearance-panel" id="appearancePanel"' + (state.contextOpen.appearance ? '' : ' hidden') + '><label>排版<select id="editLayout" aria-label="排版"><option value="split"' + (product.layout !== 'centered' ? ' selected' : '') + '>左右</option><option value="centered"' + (product.layout === 'centered' ? ' selected' : '') + '>居中</option></select></label><label>颜色<input id="editAccent" type="color" aria-label="作品颜色" value="' + attr(U.safeColor(product.accent, '#6d86ff').slice(0, 7)) + '"></label><button class="button quiet" type="button" data-action="toggle-appearance">收起</button></div>' : '') + (state.deletePending ? '<div class="inline-delete-confirm" role="alert"><span>删除这个作品？</span><button class="button quiet" type="button" data-action="cancel-delete">取消</button><button class="button quiet danger" type="button" data-action="confirm-delete">删除</button></div>' : '') + '<p class="form-error hidden" id="editorError" role="alert"></p>';
    const layout = $('#editLayout');
    const accent = $('#editAccent');
    if (product && state.rawDraft && state.rawDraft.productId === product.id) {
      if (layout) layout.value = state.rawDraft.layout;
      if (accent) accent.value = state.rawDraft.accent;
    }
    if (layout) layout.addEventListener('change', function () { if (syncInlineEditor(true)) renderProduct(state.activeIndex, { silent: true }); });
    if (accent) accent.addEventListener('input', function () {
      if (!syncInlineEditor(true, true)) return;
      const current = state.products[state.activeIndex];
      updateAmbient(current.accent, current.accent2);
      const card = $('.product-card');
      if (card) card.style.setProperty('--accent', current.accent);
    });
  }

  function inlineVideoMarkup(video) {
    return '<div class="context-panel" id="videoPanel"' + (state.contextOpen.video ? '' : ' hidden') + '><div class="context-actions"><span>视频</span><button class="button quiet" type="button" data-action="toggle-video">收起</button></div><div class="inline-video-panel"><label class="sr-only" for="editVideo">B 站视频链接</label><input class="inline-field" id="editVideo" type="text" value="' + attr(video ? U.bilibiliWatchUrl(video.bvid) : '') + '" placeholder="粘贴 B 站链接或 BV 号" autocomplete="off" spellcheck="false"><button class="button quiet" type="button" data-action="clear-video" aria-label="移除视频">移除</button></div></div>';
  }

  function inlineDownloadsMarkup() {
    return '<div class="context-group"><button class="context-toggle" type="button" data-action="toggle-downloads" aria-controls="downloadPanel" aria-expanded="' + String(state.contextOpen.downloads) + '">' + ICON.download + '<span id="downloadToggleLabel">安装包' + (state.editor.downloads.length ? ' · ' + state.editor.downloads.length : '') + '</span></button><div class="context-panel" id="downloadPanel"' + (state.contextOpen.downloads ? '' : ' hidden') + '><div class="context-actions"><span>安装包</span><button class="button quiet" type="button" data-action="toggle-downloads">收起</button></div><section class="inline-downloads" aria-label="安装包"><div class="inline-download-actions"><label class="file-button button quiet">上传<input id="editInstaller" type="file" accept=".apk,.exe,.msi,.dmg,.pkg,.ipa,.zip,.appx,.msix" aria-label="上传安装包"></label></div><div class="installer-list" id="installerList">' + installerListHtml(state.editor.downloads) + '</div><div class="inline-download-add"><input class="inline-field" id="editDownloadLink" type="url" aria-label="添加下载链接" placeholder="粘贴下载链接"><button class="button quiet" type="button" data-action="add-download-link" aria-label="添加下载链接">＋</button></div><div class="upload-progress" aria-hidden="true"><i></i></div><div class="upload-status" id="uploadStatus" role="status"></div></section></div></div>';
  }

  function toggleContextPanel(kind, force) {
    if (state.busy || !state.inlineEditing || (state.editor && state.editor.uploadBusy)) return;
    const ids = { video: 'videoPanel', downloads: 'downloadPanel', appearance: 'appearancePanel' };
    const id = ids[kind];
    if (!id) return;
    const panel = $('#' + id);
    if (!panel) return;
    const open = typeof force === 'boolean' ? force : !state.contextOpen[kind];
    state.contextOpen[kind] = open;
    panel.hidden = !open;
    if (open) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', '');
    $$('[aria-controls="' + id + '"]').forEach(function (button) { button.setAttribute('aria-expanded', String(open)); });
  }

  function focusEditorError(error) {
    if (!error || !error.selector) return;
    if (error.selector === '#editVideo') toggleContextPanel('video', true);
    if (error.selector === '#editDownloadLink' || error.selector.indexOf('[data-download-') === 0) toggleContextPanel('downloads', true);
    const target = $(error.selector);
    if (target) target.focus();
  }

  function resizeInlineField(node) {
    if (!node || node.tagName !== 'TEXTAREA') return;
    node.style.height = 'auto';
    if (node.scrollHeight) node.style.height = node.scrollHeight + 'px';
  }

  function bindInlineFields() {
    $$('.inline-field:not([data-download-field])', els.cardMount).forEach(function (node) {
      resizeInlineField(node);
      node.addEventListener('input', function (event) {
        resizeInlineField(node);
        if (event.isComposing || node.id === 'editDownloadLink') { saveRawDraft(); return; }
        syncInlineEditor(true, true);
      });
      node.addEventListener('compositionend', function () { resizeInlineField(node); if (node.id === 'editDownloadLink') saveRawDraft(); else syncInlineEditor(true, true); });
      node.addEventListener('change', function () { if (node.id !== 'editDownloadLink') syncInlineEditor(true); });
    });
    const link = $('#editDownloadLink');
    if (link) link.addEventListener('keydown', function (event) { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); addDownloadLink(); } });
    const file = $('#editInstaller');
    if (file) file.addEventListener('change', function () {
      const selected = file.files && file.files[0];
      if (selected && syncInlineEditor(true)) uploadInstaller(selected, file);
    });
    bindInstallerFields();
  }

  function addDownloadLink() {
    if (state.busy || !state.editor) return;
    const input = $('#editDownloadLink');
    if (!input || !input.value.trim()) { if (input) input.focus(); return; }
    if (!syncInlineEditor(true, false, { includePending: true })) return;
    input.value = '';
    refreshInstallerList();
    saveRawDraft();
  }

  function checkPendingDownload() {
    if (!state.editor) return true;
    const input = $('#editDownloadLink');
    if (!input || !input.value.trim()) return true;
    if (!saveRawDraft()) return false;
    showEditorError('先添加或清空下载链接。');
    toggleContextPanel('downloads', true);
    input.focus();
    return false;
  }

  function openGithubSettings() {
    if (state.busy) return;
    const html = connectionMarkup() + '<div class="form-actions"><button class="button quiet" type="button" data-action="export-inline">导出内容</button><a class="button quiet" href="admin.html" target="_blank" rel="noopener">管理台 ↗</a></div>';
    openSheet('GitHub', html, { width: '620px', kind: 'connection' });
    const fields = $('#connectFields');
    if (fields) fields.classList.remove('hidden');
    const toggle = $('[data-action="toggle-connect"]');
    if (toggle) toggle.addEventListener('click', function () { fields.classList.toggle('hidden'); toggle.textContent = fields.classList.contains('hidden') ? '设置' : '收起'; });
    const connect = $('[data-action="connect-github"]');
    if (connect) connect.addEventListener('click', connectGithub);
  }

  function saveDraftContent(content) {
    try {
      localStorage.setItem(BASE_KEY, state.baseContent);
      localStorage.setItem(PREVIEW_KEY, JSON.stringify(content));
      state.previewMode = true;
      if (els.previewBadge) els.previewBadge.classList.remove('hidden');
      const nextUrl = new URL(location.href); nextUrl.searchParams.set('preview', '1'); history.replaceState(null, '', nextUrl);
      return true;
    } catch (error) { showEditorError('草稿无法保存，请导出内容。'); return false; }
  }

  function draftBaseFingerprint() {
    try { return U.contentFingerprint(JSON.parse(state.baseContent)); } catch (error) { return ''; }
  }

  function captureRawDraft() {
    if (!state.editor) return null;
    const product = state.editor.product;
    const video = firstVideo(state.editor.productId);
    function value(selector, fallback) { const node = $(selector); return node ? String(node.value) : String(fallback || ''); }
    return {
      version: 1,
      productId: state.editor.productId,
      baseFingerprint: draftBaseFingerprint(),
      name: value('#editName', product.name),
      subtitle: value('#editSubtitle', product.subtitle),
      description: value('#editDescription', product.description),
      video: value('#editVideo', video ? U.bilibiliWatchUrl(video.bvid) : ''),
      pendingDownload: value('#editDownloadLink', ''),
      layout: value('#editLayout', product.layout || 'split') === 'centered' ? 'centered' : 'split',
      accent: U.safeColor(value('#editAccent', product.accent), '#6d86ff'),
      downloads: state.editor.downloads.map(function (item, index) {
        return { id: String(item.id), name: value('[data-download-index="' + index + '"][data-download-field="name"]', item.name), url: value('[data-download-index="' + index + '"][data-download-field="url"]', item.url) };
      })
    };
  }

  function saveRawDraft() {
    if (state.busy || !state.editor || state.editor.uploadBusy) return false;
    const draft = captureRawDraft();
    if (!draft) return true;
    state.rawDraft = draft;
    try {
      if (!saveDraftContent(state.content)) throw new Error('draft storage unavailable');
      localStorage.setItem(RAW_KEY, JSON.stringify(draft));
      state.rawSaveFailed = false;
      return true;
    } catch (error) {
      state.rawSaveFailed = true;
      showEditorError('编辑尚未保存，请保留此页面。');
      return false;
    }
  }

  function readRawDraft() {
    try {
      const raw = JSON.parse(localStorage.getItem(RAW_KEY) || 'null');
      if (!raw || raw.version !== 1 || typeof raw.productId !== 'string' || raw.baseFingerprint !== draftBaseFingerprint()) return null;
      const string = function (key) { return typeof raw[key] === 'string' ? raw[key] : ''; };
      return {
        version: 1, productId: raw.productId, baseFingerprint: raw.baseFingerprint,
        name: string('name'), subtitle: string('subtitle'), description: string('description'),
        video: string('video'), pendingDownload: string('pendingDownload'),
        layout: raw.layout === 'centered' ? 'centered' : 'split', accent: U.safeColor(raw.accent, '#6d86ff'),
        downloads: Array.isArray(raw.downloads) ? raw.downloads.filter(function (item) { return item && typeof item.id === 'string'; }).map(function (item) { return { id: item.id, name: typeof item.name === 'string' ? item.name : '', url: typeof item.url === 'string' ? item.url : '' }; }) : []
      };
    } catch (error) { return null; }
  }

  function restoreRawDraft() {
    const draft = state.rawDraft;
    if (!state.inlineEditing || !state.editor || !draft || draft.productId !== state.editor.productId || draft.baseFingerprint !== draftBaseFingerprint()) return false;
    const fields = { '#editName': draft.name, '#editSubtitle': draft.subtitle, '#editDescription': draft.description, '#editVideo': draft.video, '#editDownloadLink': draft.pendingDownload, '#editLayout': draft.layout, '#editAccent': draft.accent };
    Object.keys(fields).forEach(function (selector) { const field = $(selector); if (field) field.value = fields[selector]; });
    const rows = new Map(draft.downloads.map(function (item) { return [item.id, item]; }));
    state.editor.downloads = state.editor.downloads.map(function (item) { const row = rows.get(item.id); return row ? Object.assign({}, item, { name: row.name, url: row.url }) : item; });
    const list = $('#installerList');
    if (list) list.innerHTML = installerListHtml(state.editor.downloads);
    if (draft.video && !U.parseBilibili(draft.video)) toggleContextPanel('video', true);
    if (draft.pendingDownload || state.editor.downloads.some(function (item) { return !U.safeUrl(item.url); })) toggleContextPanel('downloads', true);
    return true;
  }

  function clearRawDraft(productId) {
    if (productId && state.rawDraft && state.rawDraft.productId !== productId) return;
    state.rawDraft = null;
    state.rawSaveFailed = false;
    try { localStorage.removeItem(RAW_KEY); } catch (error) { /* noop */ }
  }

  function buildEditorContent(validate, options) {
    const opts = options || {};
    const content = U.clone(state.content);
    if (!state.editor) return { content: content, productId: null, name: '' };
    const productId = state.editor.productId;
    const name = $('#editName') ? $('#editName').value.trim() : state.editor.product.name;
    const subtitle = $('#editSubtitle') ? $('#editSubtitle').value.trim() : state.editor.product.subtitle;
    const description = $('#editDescription') ? $('#editDescription').value.trim() : state.editor.product.description;
    const videoRaw = $('#editVideo') ? $('#editVideo').value.trim() : '';
    const video = videoRaw ? U.parseBilibili(videoRaw) : null;
    const layout = $('#editLayout') ? ($('#editLayout').value === 'centered' ? 'centered' : 'split') : (state.editor.product.layout || 'split');
    const accent = U.safeColor($('#editAccent') ? $('#editAccent').value : state.editor.product.accent, '#6d86ff');
    const downloadLink = !opts.ignorePendingDownload && $('#editDownloadLink') ? $('#editDownloadLink').value.trim() : '';
    function invalid(message, selector) { const error = new Error(message); error.selector = selector; throw error; }
    if (validate && !name) invalid('请填写作品名称。', '#editName');
    if (videoRaw && !video) invalid('请填写完整 B 站链接或 BV 号。', '#editVideo');
    if (downloadLink && (!U.safeUrl(downloadLink) || !/^https?:\/\//i.test(downloadLink))) invalid('请填写完整下载链接。', '#editDownloadLink');
    let product = content.products.find(function (item) { return item.id === productId; });
    if (!product) { product = Object.assign({}, state.editor.product, { id: productId }); content.products.push(product); }
    Object.assign(product, { name: name, subtitle: subtitle, description: description, accent: accent });
    if (layout === 'centered' || Object.prototype.hasOwnProperty.call(product, 'layout')) product.layout = layout;
    const oldVideo = content.videos.find(function (item) { return item.productId === productId && item.id === state.editor.videoId; });
    let videoId = state.editor.videoId;
    if (video) {
      videoId = oldVideo ? oldVideo.id : U.uid('film');
      if (oldVideo) oldVideo.bvid = video.bvid;
      else content.videos.unshift({ id: videoId, productId: productId, title: name, subtitle: subtitle, bvid: video.bvid, description: '' });
    } else if (oldVideo) content.videos = content.videos.filter(function (item) { return item !== oldVideo; });
    const downloads = (state.editor.downloads || []).map(function (download, index) {
      if (index === opts.omitDownloadIndex) return null;
      const item = Object.assign({}, download, { productId: productId });
      const nameInput = $('[data-download-index="' + index + '"][data-download-field="name"]');
      const urlInput = $('[data-download-index="' + index + '"][data-download-field="url"]');
      if (nameInput) item.name = nameInput.value.trim() || '安装包';
      if (urlInput) item.url = urlInput.value.trim();
      if (!U.safeUrl(item.url)) invalid('请填写有效的下载地址。', '[data-download-index="' + index + '"][data-download-field="url"]');
      return item;
    }).filter(Boolean);
    if (downloadLink && !downloads.some(function (item) { return item.url === downloadLink; })) downloads.push({ id: U.uid('download'), productId: productId, name: name + ' 安装包', url: downloadLink, date: today() });
    const remainingDownloads = new Map(downloads.map(function (item) { return [item.id, item]; }));
    content.downloads = content.downloads.reduce(function (items, item) {
      if (item.productId !== productId) items.push(item);
      else if (remainingDownloads.has(item.id)) { items.push(remainingDownloads.get(item.id)); remainingDownloads.delete(item.id); }
      return items;
    }, []).concat(Array.from(remainingDownloads.values()));
    content.updatedAt = new Date().toISOString();
    return { content: content, productId: productId, name: name, videoId: videoId };
  }

  function syncInlineEditor(validate, silent, options) {
    if (state.busy || (state.editor && state.editor.uploadBusy)) return false;
    if (state.inlineEditing && !saveRawDraft()) return false;
    try {
      const result = buildEditorContent(validate !== false, { ignorePendingDownload: !(options && options.includePending) });
      if (!saveDraftContent(result.content)) return false;
      state.content = result.content;
      state.products = state.content.products;
      if (state.editor) {
        state.editor.product = state.products.find(function (item) { return item.id === state.editor.productId; });
        state.editor.downloads = U.clone(productDownloads(state.editor.productId));
        state.editor.videoId = result.videoId;
      }
      if (!silent) { const error = $('#editorError'); if (error) { error.textContent = ''; error.classList.add('hidden'); } }
      return true;
    } catch (error) {
      if (!silent) { showEditorError(error.message); focusEditorError(error); }
      return false;
    }
  }

  function deleteCurrentProduct() {
    if (state.busy || !state.inlineEditing || !state.editor || state.editor.uploadBusy) return;
    const product = state.products[state.activeIndex];
    if (!product) return;
    state.deletePending = product.id;
    renderInlineToolbar();
    requestAnimationFrame(function () { const cancel = $('[data-action="cancel-delete"]'); if (cancel) cancel.focus(); });
  }

  function cancelDeleteProduct() {
    if (state.busy) return;
    state.deletePending = null;
    renderInlineToolbar();
  }

  function confirmDeleteProduct() {
    if (state.busy || !state.inlineEditing || !state.editor || state.editor.uploadBusy) return;
    let product = state.products[state.activeIndex];
    if (!product || !state.deletePending || state.deletePending !== product.id) { state.deletePending = null; renderInlineToolbar(); return; }
    state.deletePending = null;
    syncInlineEditor(true, true);
    product = state.products[state.activeIndex];
    const id = product.id;
    clearRawDraft(id);
    const snapshot = { product: U.clone(product), index: state.activeIndex };
    ['videos', 'downloads', 'notes'].forEach(function (key) {
      snapshot[key] = state.content[key].map(function (item, index) { return { item: U.clone(item), index: index }; }).filter(function (entry) { return entry.item.productId === id; });
      state.content[key] = state.content[key].filter(function (item) { return item.productId !== id; });
    });
    state.deletedSnapshot = snapshot;
    state.content.products.splice(state.activeIndex, 1);
    state.content.updatedAt = new Date().toISOString();
    state.products = state.content.products;
    state.activeIndex = Math.min(state.activeIndex, Math.max(0, state.products.length - 1));
    state.editor = null;
    saveDraftContent(state.content);
    renderProduct(state.activeIndex, { silent: true });
    showToast('已删除 · 可撤销');
  }

  function undoDelete() {
    if (state.busy || !state.deletedSnapshot || (state.editor && state.editor.uploadBusy)) return;
    if (state.inlineEditing && !checkPendingDownload()) return;
    if (state.editor && !syncInlineEditor(true)) return;
    const snapshot = state.deletedSnapshot;
    if (state.products.some(function (item) { return item.id === snapshot.product.id; })) return;
    state.content.products.splice(Math.min(snapshot.index, state.products.length), 0, U.clone(snapshot.product));
    ['videos', 'downloads', 'notes'].forEach(function (key) {
      snapshot[key].forEach(function (entry) { if (!state.content[key].some(function (item) { return item.id === entry.item.id; })) state.content[key].splice(Math.min(entry.index, state.content[key].length), 0, U.clone(entry.item)); });
    });
    state.products = state.content.products;
    state.activeIndex = state.products.findIndex(function (item) { return item.id === snapshot.product.id; });
    state.deletedSnapshot = null;
    state.editor = null;
    state.content.updatedAt = new Date().toISOString();
    saveDraftContent(state.content);
    renderProduct(state.activeIndex, { silent: true });
  }


  function connectionMarkup() {
    const connected = !!(state.connection && state.connection.token);
    const defaults = state.connection || state.defaults;
    const tokenStored = getStoredToken();
    return '<div class="publish-box' + (connected ? ' is-connected' : '') + '" id="publishBox">' +
      '<div class="publish-head">' +
        '<span class="publish-dot" aria-hidden="true"></span>' +
        '<span class="publish-label" id="publishLabel">' + (connected ? '已连接 ' + esc(state.connection.owner + '/' + state.connection.repo) : '连接仓库') + '</span>' +
        '<button class="publish-toggle" type="button" data-action="toggle-connect">' + (connected ? '更换' : '设置') + '</button>' +
      '</div>' +
      '<div class="connect-fields hidden" id="connectFields">' +
        '<label class="field"><span class="field-label">用户名</span><input id="connectOwner" type="text" value="' + attr(defaults.owner || '') + '" autocomplete="off" spellcheck="false"></label>' +
        '<label class="field"><span class="field-label">仓库</span><input id="connectRepo" type="text" value="' + attr(defaults.repo || '') + '" autocomplete="off" spellcheck="false"></label>' +
        '<label class="field"><span class="field-label">分支</span><input id="connectBranch" type="text" value="' + attr(defaults.branch || 'main') + '" autocomplete="off" spellcheck="false"></label>' +
        '<label class="field"><span class="field-label">Token</span><input id="connectToken" type="password" value="" placeholder="' + (tokenStored ? '已保存，留空沿用' : 'github_pat_...') + '" autocomplete="off" spellcheck="false"></label>' +
        '<p class="field-hint full">仅当前标签页使用 · Contents: Read and write</p>' +
        '<div class="connect-actions full"><button class="button glass" type="button" data-action="connect-github">连接 GitHub</button><button class="button quiet" type="button" data-action="disconnect-github">断开连接</button><span class="field-hint">Contents: Read and write</span></div>' +
        '<p class="connect-message" id="connectMessage"></p>' +
      '</div>' +
    '</div>';
  }

  function installerListHtml(downloads) {
    if (!downloads || !downloads.length) return '';
    return downloads.map(function (download, index) {
      return '<div class="inline-installer-row" data-installer-index="' + index + '"><input class="inline-field" type="text" data-download-index="' + index + '" data-download-field="name" aria-label="安装包名称" value="' + attr(download.name) + '" placeholder="安装包名称"><input class="inline-field" type="text" data-download-index="' + index + '" data-download-field="url" aria-label="安装包下载地址" value="' + attr(download.url) + '" placeholder="下载地址" spellcheck="false"><button class="button quiet installer-remove" type="button" data-action="remove-installer" data-index="' + index + '" aria-label="移除安装包">×</button></div>';
    }).join('');
  }

  function bindInstallerFields() {
    $$('[data-download-field]', $('#installerList') || els.cardMount).forEach(function (input) {
      input.disabled = !!state.busy;
      input.addEventListener('input', function (event) { if (event.isComposing) saveRawDraft(); else syncInlineEditor(true, true); });
      input.addEventListener('compositionend', function () { syncInlineEditor(true, true); });
      input.addEventListener('change', function () { syncInlineEditor(true); });
    });
  }

  function refreshInstallerList() {
    const list = $('#installerList');
    if (!list || !state.editor) return;
    list.innerHTML = installerListHtml(state.editor.downloads);
    const count = $('#downloadToggleLabel');
    if (count) count.textContent = '安装包' + (state.editor.downloads.length ? ' · ' + state.editor.downloads.length : '');
    bindInstallerFields();
  }

  function removeInstaller(index) {
    if (state.busy || !state.editor || state.editor.uploadBusy || !Number.isInteger(index)) return;
    const record = state.editor.downloads[index];
    if (!record) return;
    const workingDraft = captureRawDraft();
    let keepWorkingRows = false;
    let content;
    try { content = buildEditorContent(true, { omitDownloadIndex: index, ignorePendingDownload: true }).content; }
    catch (error) {
      keepWorkingRows = true;
      content = U.clone(state.content);
      content.downloads = content.downloads.filter(function (item) { return !(item.productId === state.editor.productId && item.id === record.id); });
      content.updatedAt = new Date().toISOString();
    }
    state.content = content;
    state.products = content.products;
    state.editor.product = state.products.find(function (item) { return item.id === state.editor.productId; });
    state.editor.downloads = U.clone(productDownloads(state.editor.productId));
    if (keepWorkingRows && workingDraft) {
      const rows = new Map(workingDraft.downloads.map(function (item) { return [item.id, item]; }));
      state.editor.downloads = state.editor.downloads.map(function (item) { const row = rows.get(item.id); return row ? Object.assign({}, item, { name: row.name, url: row.url }) : item; });
    }
    saveDraftContent(content);
    refreshInstallerList();
    if (state.inlineEditing) saveRawDraft();
  }

  async function saveEditor(mode) {
    if (state.busy || (!state.editor && !state.inlineEditing)) return;
    const localOnly = mode === 'preview' || mode === 'export';
    const keepEditing = mode === 'publish-inline';
    const errorNode = $('#editorError');
    const saveButton = $('#saveProduct');
    if (errorNode) { errorNode.textContent = ''; errorNode.classList.add('hidden'); }
    if (state.editor && state.editor.uploadBusy) { showEditorError('安装包正在上传。'); return; }
    if (state.inlineEditing && state.editor && !saveRawDraft()) return;
    let result;
    try { result = buildEditorContent(true); }
    catch (error) { showEditorError(error.message); focusEditorError(error); return; }
    if (!localOnly && (!state.connection || !state.connection.token)) {
      showEditorError('连接 GitHub 后发布。');
      if (state.inlineEditing) openGithubSettings();
      else { const fields = $('#connectFields'); if (fields) fields.classList.remove('hidden'); }
      return;
    }
    if (saveButton && !localOnly) { saveButton.disabled = true; saveButton.textContent = '发布中…'; }
    setBusy(true);
    try {
      const content = result.content;
      let response = null;
      if (localOnly) {
        if (!saveDraftContent(content)) throw new Error('草稿无法保存。');
        if (mode === 'export') {
          const link = document.createElement('a');
          const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2) + '\n'], { type: 'application/json' }));
          link.href = objectUrl; link.download = 'site.json'; link.click();
          setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 1000);
        }
      } else {
        response = await publishContent(content, result.name ? 'Update product · ' + result.name : 'Update portfolio');
        state.baseContent = JSON.stringify(content);
        state.previewMode = false;
        if (els.previewBadge) els.previewBadge.classList.add('hidden');
        const nextUrl = new URL(location.href); nextUrl.searchParams.delete('preview'); history.replaceState(null, '', nextUrl);
      }
      state.content = content;
      state.products = content.products;
      clearRawDraft();
      if (!localOnly) state.baseUpdatedAt = content.updatedAt;
      state.sha = response && response.content ? response.content.sha : state.sha;
      const nextIndex = state.products.findIndex(function (item) { return item.id === result.productId; });
      state.activeIndex = nextIndex >= 0 ? nextIndex : Math.min(state.activeIndex, Math.max(0, state.products.length - 1));
      state.restoreInlineVideo = false;
      state.editor = null;
      state.inlineEditing = keepEditing;
      state.deletePending = null;
      setBusy(false);
      closeSheet();
      renderProduct(state.activeIndex, { silent: true });
      if (state.products[state.activeIndex]) announce(state.products[state.activeIndex]);
      showToast(localOnly ? (mode === 'export' ? '已导出' : '草稿已保存') : '已提交，等待部署');
    } catch (error) {
      setBusy(false);
      showEditorError(formatGithubError(error));
      if (saveButton) { saveButton.disabled = false; saveButton.textContent = state.inlineEditing ? '发布' : '发布到 GitHub'; }
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
      if (label) label.textContent = '已连接 ' + owner + '/' + repo;
      const fields = $('#connectFields');
      if (fields) fields.classList.add('hidden');
      const toggle = $('[data-action="toggle-connect"]');
      if (toggle) toggle.textContent = '更换';
      const uploadStatus = $('#uploadStatus');
      if (uploadStatus && !state.editor?.uploadBusy) uploadStatus.textContent = '';
      setMessage('已连接', true);
      showToast('已连接');
    } catch (error) {
      state.connection = previous;
      setMessage(formatGithubError(error));
    } finally {
      setBusy(false);
      if (button) { button.disabled = false; button.textContent = '连接 GitHub'; }
      if (state.inlineEditing) renderInlineToolbar();
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
      setStatus('超过 ' + U.formatBytes(MAX_UPLOAD) + '，请上传到 Releases 后粘贴链接。', 'error');
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
      setStatus('已上传 · 发布后生效', 'done');
      showToast('安装包已上传');
    } catch (error) {
      setStatus(formatGithubError(error), 'error');
      showToast('上传失败：' + formatGithubError(error));
    } finally {
      state.editor.uploadBusy = false;
      setBusy(false);
      if (fileButton) fileButton.classList.remove('is-disabled');
      input.value = '';
      if (state.inlineEditing) syncInlineEditor(true, true);
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
    if (!state.inlineEditing) state.editor = null;
    state.restoreInlineVideo = false;
    els.sheetContent.innerHTML = '';
    els.sheetDialog.style.width = '';
    document.body.classList.remove('sheet-open', 'is-locked');
    if (restore) renderProduct(index, { silent: true });
    setTimeout(function () { const target = state.inlineEditing ? $('#editCurrent') : ($('#editCurrent') || els.homeOrb); if (target) target.focus({ preventScroll: true }); }, 30);
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
    window.addEventListener('beforeunload', function (event) { if (state.busy || state.rawSaveFailed) { event.preventDefault(); event.returnValue = ''; } });
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
      if (kind === 'toggle-video') { event.preventDefault(); toggleContextPanel('video'); }
      if (kind === 'toggle-downloads') { event.preventDefault(); toggleContextPanel('downloads'); }
      if (kind === 'toggle-appearance') { event.preventDefault(); toggleContextPanel('appearance'); }
      if (kind === 'edit') { event.preventDefault(); openEditEditor(); }
      if (kind === 'edit-video') { event.preventDefault(); if (!state.inlineEditing) openEditEditor(); toggleContextPanel('video', true); const field = $('#editVideo'); if (field) field.focus(); }
      if (kind === 'add') { event.preventDefault(); openAddEditor(); }
      if (kind === 'delete-product') { event.preventDefault(); deleteCurrentProduct(); }
      if (kind === 'confirm-delete') { event.preventDefault(); confirmDeleteProduct(); }
      if (kind === 'cancel-delete') { event.preventDefault(); cancelDeleteProduct(); }
      if (kind === 'undo-delete') { event.preventDefault(); undoDelete(); }
      if (kind === 'github-settings') { event.preventDefault(); openGithubSettings(); }
      if (kind === 'publish-inline') { event.preventDefault(); saveEditor('publish-inline'); }
      if (kind === 'export-inline') { event.preventDefault(); saveEditor('export'); }
      if (kind === 'add-download-link') { event.preventDefault(); addDownloadLink(); }
      if (kind === 'remove-installer') { event.preventDefault(); removeInstaller(Number(action.getAttribute('data-index'))); }
      if (kind === 'clear-video') { event.preventDefault(); const field = $('#editVideo'); if (field) { field.value = ''; if (syncInlineEditor(true)) renderProduct(state.activeIndex, { silent: true }); } }
      if (kind === 'disconnect-github') {
        sessionStorage.removeItem(ADMIN_TOKEN_KEY); localStorage.removeItem(ADMIN_TOKEN_KEY); localStorage.removeItem('anthony-admin-token');
        state.connection = null; state.sha = null;
        if ($('#connectToken')) $('#connectToken').value = ''; if ($('#publishLabel')) $('#publishLabel').textContent = '连接仓库';
        if ($('#publishBox')) $('#publishBox').classList.remove('is-connected');
        renderInlineToolbar(); showToast('已断开');
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
    [els.cardMount, $('#inlineEditorTools'), $('#productNav')].filter(Boolean).forEach(function (root) { $$('input, textarea, select, button', root).forEach(function (node) { node.disabled = busy; }); });
    const edit = $('#editCurrent'); if (edit) edit.disabled = busy;
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
