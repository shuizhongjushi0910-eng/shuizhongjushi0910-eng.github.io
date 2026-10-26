/* Shared helpers. No dependencies. */
(function () {
  'use strict';

  const ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return ESCAPE_MAP[char];
    });
  }

  function safeUrl(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    if (/[\u0000-\u0020\u007f-\u009f\\]/.test(raw)) return '';
    try {
      const parsed = new URL(raw, 'https://portfolio.invalid/');
      if (!/^(https?:|mailto:|tel:)$/.test(parsed.protocol)) return '';
      if (parsed.username || parsed.password) return '';
    } catch (error) { return ''; }
    return raw;
  }

  function storageKey(name) {
    const pathname = window.location && window.location.pathname || '/';
    const directory = pathname.endsWith('/') ? pathname : pathname.slice(0, pathname.lastIndexOf('/') + 1);
    return 'anthony:' + directory + ':' + String(name);
  }

  function contentFingerprint(value) {
    function stable(item) {
      if (Array.isArray(item)) return item.map(stable);
      if (!item || typeof item !== 'object') return item;
      const result = Object.create(null);
      Object.keys(item).sort().forEach(function (key) { result[key] = stable(item[key]); });
      return result;
    }
    return JSON.stringify(stable(value));
  }

  function safeColor(value, fallback) {
    return /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(String(value || '').trim())
      ? String(value).trim()
      : (fallback || '#6d86ff');
  }

  function parseBilibili(input) {
    const raw = String(input == null ? '' : input).trim();
    if (!raw) return null;
    let candidate = raw;
    if (!/^BV[0-9A-Za-z]{10}$/.test(candidate)) {
      try {
        const url = new URL(raw);
        if (!/^https?:$/.test(url.protocol) || !/^(www\.|m\.)?bilibili\.com$/.test(url.hostname) || url.username || url.password) return null;
        const path = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/);
        if (!path) return null;
        candidate = path[1];
      } catch (error) { return null; }
    }
    const match = candidate.match(/^BV[0-9A-Za-z]{10}$/);
    if (match) {
      return {
        bvid: match[0],
        url: 'https://www.bilibili.com/video/' + match[0] + '/'
      };
    }
    return null;
  }

  function bilibiliEmbedUrl(bvid, autoplay) {
    const id = String(bvid || '').trim();
    if (!/^BV[0-9A-Za-z]{10}$/.test(id)) return '';
    const query = [
      'isOutside=true',
      'bvid=' + encodeURIComponent(id),
      'p=1',
      'page=1',
      'as_wide=1',
      'autoplay=' + (autoplay ? '1' : '0'),
      'high_quality=1',
      'danmaku=0'
    ].join('&');
    return 'https://player.bilibili.com/player.html?' + query;
  }

  function bilibiliWatchUrl(bvid) {
    const id = String(bvid || '').trim();
    return /^BV[0-9A-Za-z]{10}$/.test(id) ? 'https://www.bilibili.com/video/' + id + '/' : '';
  }

  function dateParts(input) {
    const match = String(input || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!match) return null;
    return { year: match[1], month: Number(match[2]), day: Number(match[3]) };
  }

  function formatDateDot(input, fallback) {
    const parts = dateParts(input);
    if (!parts) return fallback || '';
    return parts.year + '.' + String(parts.month).padStart(2, '0') + '.' + String(parts.day).padStart(2, '0');
  }

  function formatDateCN(input, fallback) {
    const parts = dateParts(input);
    if (!parts) return fallback || '';
    return parts.year + ' 年 ' + parts.month + ' 月 ' + parts.day + ' 日';
  }

  function formatBytes(bytes) {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size <= 0) return '';
    if (size >= 1024 * 1024 * 1024) return (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    if (size >= 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + ' MB';
    if (size >= 1024) return Math.round(size / 1024) + ' KB';
    return size + ' B';
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function renderInline(text) {
    let source = String(text == null ? '' : text).replace(/\u0000/g, '');
    const code = [];
    source = source.replace(/`([^`]+)`/g, function (_, value) {
      code.push('<code>' + escapeHtml(value) + '</code>');
      return '\u0000CODE' + (code.length - 1) + '\u0000';
    });
    source = escapeHtml(source);

    source = source.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, url) {
      const href = safeUrl(url.replace(/&amp;/g, '&'));
      if (!href) return label;
      return '<a href="' + escapeAttribute(href) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
    });

    source = source.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    source = source.replace(/(^|[\s（(])\*([^*\n]+)\*(?=$|[\s，。！？、）)])/g, '$1<em>$2</em>');
    source = source.replace(/\u0000CODE(\d+)\u0000/g, function (_, index) {
      return code[Number(index)] || '';
    });
    return source;
  }

  function markdown(input) {
    const source = String(input == null ? '' : input).replace(/\r\n?/g, '\n');
    const lines = source.split('\n');
    const html = [];
    let paragraph = [];
    let listType = '';
    let listItems = [];
    let quoteLines = [];
    let inCode = false;
    let codeLines = [];
    let codeLang = '';

    function flushParagraph() {
      if (!paragraph.length) return;
      html.push('<p>' + paragraph.map(renderInline).join('<br>') + '</p>');
      paragraph = [];
    }

    function flushList() {
      if (!listItems.length) return;
      const tag = listType === 'ol' ? 'ol' : 'ul';
      html.push('<' + tag + '>' + listItems.map(function (item) {
        return '<li>' + renderInline(item) + '</li>';
      }).join('') + '</' + tag + '>');
      listItems = [];
      listType = '';
    }

    function flushQuote() {
      if (!quoteLines.length) return;
      html.push('<blockquote>' + quoteLines.map(function (line) {
        return renderInline(line);
      }).join('<br>') + '</blockquote>');
      quoteLines = [];
    }

    function flushAll() {
      flushParagraph();
      flushList();
      flushQuote();
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const trimmed = line.trim();

      if (inCode) {
        if (/^```/.test(trimmed)) {
          html.push('<pre><code' + (codeLang ? ' class="language-' + escapeAttribute(codeLang) + '"' : '') + '>' + escapeHtml(codeLines.join('\n')) + '</code></pre>');
          inCode = false;
          codeLines = [];
          codeLang = '';
        } else {
          codeLines.push(line);
        }
        continue;
      }

      if (/^```/.test(trimmed)) {
        flushAll();
        inCode = true;
        codeLang = trimmed.slice(3).trim().split(/\s+/)[0] || '';
        continue;
      }

      if (!trimmed) {
        flushAll();
        continue;
      }

      if (/^([-*_])(?:\s*\1){2,}$/.test(trimmed)) {
        flushAll();
        html.push('<hr>');
        continue;
      }

      const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        flushAll();
        const level = Math.min(6, heading[1].length);
        html.push('<h' + level + '>' + renderInline(heading[2]) + '</h' + level + '>');
        continue;
      }

      const quote = trimmed.match(/^>\s?(.*)$/);
      if (quote) {
        flushParagraph();
        flushList();
        quoteLines.push(quote[1]);
        continue;
      }

      const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
      const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
      if (unordered || ordered) {
        flushParagraph();
        flushQuote();
        const nextType = unordered ? 'ul' : 'ol';
        if (listType && listType !== nextType) flushList();
        listType = nextType;
        listItems.push((unordered || ordered)[1]);
        continue;
      }

      flushList();
      flushQuote();
      paragraph.push(trimmed);
    }

    if (inCode) {
      html.push('<pre><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>');
    }
    flushAll();
    return html.join('\n');
  }

  function debounce(fn, delay) {
    let timer = 0;
    return function () {
      const args = arguments;
      const context = this;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(context, args);
      }, delay);
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function pathKeys(path) {
    const keys = String(path || '').split('.').filter(Boolean);
    if (keys.some(function (key) { return key === '__proto__' || key === 'constructor' || key === 'prototype'; })) return [];
    return keys;
  }

  function getByPath(object, path) {
    const keys = pathKeys(path);
    if (!keys.length) return undefined;
    let current = object;
    for (const key of keys) {
      if (current == null || !Object.prototype.hasOwnProperty.call(current, key)) return undefined;
      current = current[key];
    }
    return current;
  }

  function setByPath(object, path, value) {
    const keys = pathKeys(path);
    if (!keys.length) return object;
    let current = object;
    for (let i = 0; i < keys.length - 1; i += 1) {
      const key = keys[i];
      if (!Object.prototype.hasOwnProperty.call(current, key) || current[key] == null || typeof current[key] !== 'object') {
        current[key] = /^\d+$/.test(keys[i + 1]) ? [] : {};
      }
      current = current[key];
    }
    current[keys[keys.length - 1]] = value;
    return object;
  }

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function encodeBase64Utf8(value) {
    const bytes = new TextEncoder().encode(String(value));
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function decodeBase64Utf8(base64) {
    const clean = String(base64 || '').replace(/\s/g, '');
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function encodeBase64Bytes(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function normalizeContent(raw) {
    const data = isPlainObject(raw) ? raw : {};
    data.version = Number(data.version) || 1;
    data.site = isPlainObject(data.site) ? data.site : {};
    data.profile = isPlainObject(data.profile) ? data.profile : {};
    data.products = Array.isArray(data.products) ? data.products : [];
    data.videos = Array.isArray(data.videos) ? data.videos : [];
    data.downloads = Array.isArray(data.downloads) ? data.downloads : [];
    data.notes = Array.isArray(data.notes) ? data.notes : [];
    data.profile.links = Array.isArray(data.profile.links) ? data.profile.links : [];
    data.products.forEach(function (product, index) {
      product.id = String(product.id || 'product-' + (index + 1));
      product.features = Array.isArray(product.features) ? product.features : [];
      product.platforms = Array.isArray(product.platforms) ? product.platforms : [];
    });
    data.videos.forEach(function (video, index) {
      video.id = String(video.id || 'video-' + (index + 1));
    });
    data.downloads.forEach(function (download, index) {
      download.id = String(download.id || 'download-' + (index + 1));
    });
    data.notes.forEach(function (note, index) {
      note.id = String(note.id || 'note-' + (index + 1));
    });
    return data;
  }

  window.SiteUtils = {
    escapeHtml: escapeHtml,
    escapeAttribute: escapeAttribute,
    safeUrl: safeUrl,
    storageKey: storageKey,
    contentFingerprint: contentFingerprint,
    safeColor: safeColor,
    parseBilibili: parseBilibili,
    bilibiliEmbedUrl: bilibiliEmbedUrl,
    bilibiliWatchUrl: bilibiliWatchUrl,
    formatDateDot: formatDateDot,
    formatDateCN: formatDateCN,
    formatBytes: formatBytes,
    clamp: clamp,
    markdown: markdown,
    renderInline: renderInline,
    debounce: debounce,
    clone: clone,
    isPlainObject: isPlainObject,
    getByPath: getByPath,
    setByPath: setByPath,
    uid: uid,
    encodeBase64Utf8: encodeBase64Utf8,
    decodeBase64Utf8: decodeBase64Utf8,
    encodeBase64Bytes: encodeBase64Bytes,
    normalizeContent: normalizeContent
  };
})();
