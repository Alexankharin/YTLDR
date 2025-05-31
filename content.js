// ==UserScript==
// @name         YouTube Context‐Menu Summaries (Draggable & Resizable Popup)
// @namespace    http://yourdomain.com/
// @version      2.1‐dragresize
// @description  Summarize YouTube videos via right‐click, with a draggable & resizable summary window.
// @match        https://www.youtube.com/*
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  // ─────────────────────────────────────────────────────────────────────────────
  // Preserve original logic for fetching and summarizing transcripts. UI only
  // modifications below (menu registration, context menu, draggable & resizable
  // popup, and caching). Hover‐based summarization has been removed.
  // ─────────────────────────────────────────────────────────────────────────────

  class LocalOllamaClient {
    constructor(baseUrl = 'http://localhost:11434') {
      this.baseUrl = baseUrl.replace(/\/$/, '');
    }
    async generate({ model = 'deepseek-r1', prompt, stream = false } = {}) {
      console.log('[Ollama] generate()', model, prompt.slice(0, 50) + '…');
      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream }),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => res.statusText);
        console.error('[Ollama] error', res.status, err);
        throw new Error(`Ollama API error ${res.status}: ${err}`);
      }
      const j = await res.json();
      console.log('[Ollama] success', j);
      return j.response;
    }
  }
  const ollama = new LocalOllamaClient();

  // ─────────────────────────────────────────────────────────────────────────────
  // Cache for summaries: { [videoId]: summaryString }
  // ─────────────────────────────────────────────────────────────────────────────
  const summaryCache = {};

  async function fetchSubtitles(videoId) {
    console.group(`[Subs] fetchSubtitles(${videoId})`);
    let pr = null;
    try {
      const html = await fetch(`https://www.youtube.com/watch?v=${videoId}`).then(r => r.text());
      const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{.*?\});/s);
      if (m) pr = JSON.parse(m[1]);
    } catch (e) {
      console.error('[Subs] page/JSON error', e);
    }
    if (!pr) { console.error('[Subs] no playerResponse'); console.groupEnd(); return null; }

    const tracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const manual = tracks.find(t => t.languageCode === 'en' && !t.kind);
    const auto   = tracks.find(t => t.languageCode === 'en');
    const track  = manual || auto;
    if (!track) { console.error('[Subs] no English track'); console.groupEnd(); return null; }

    let xmlRaw = '';
    try {
      const r = await fetch(track.baseUrl);
      if (r.ok) xmlRaw = await r.text();
    } catch (e) {
      console.error('[Subs] XML fetch error', e);
    }

    let text = '';
    if (xmlRaw) {
      const doc = new DOMParser().parseFromString(xmlRaw, 'text/xml');
      text = Array.from(doc.getElementsByTagName('text'))
                  .map(n => n.textContent.trim())
                  .filter(Boolean).join(' ');
      if (text) {
        console.log('[Subs] ✔ XML succeeded');
        console.groupEnd();
        return text;
      }
    }

    let srv3Raw = '';
    try {
      const url = `${track.baseUrl}&fmt=srv3`;
      const r = await fetch(url);
      if (r.ok) srv3Raw = await r.text();
    } catch (e) {
      console.error('[Subs] srv3 fetch error', e);
    }
    if (srv3Raw) {
      const lines = srv3Raw.split(/\r?\n/);
      text = lines.filter(l => l.trim().startsWith('{'))
                  .map(l => { try { return JSON.parse(l).segs.map(s => s.utf8).join(''); } catch { return ''; } })
                  .join(' ').trim();
      if (text) {
        console.log('[Subs] ✔ srv3 JSON succeeded');
        console.groupEnd();
        return text;
      }
    }

    if (srv3Raw) {
      try {
        const doc = new DOMParser().parseFromString(srv3Raw, 'text/xml');
        text = Array.from(doc.getElementsByTagName('text'))
                    .map(n => n.textContent.trim())
                    .filter(Boolean).join(' ');
        if (text) {
          console.log('[Subs] ✔ srv3 XML fallback succeeded');
          console.groupEnd();
          return text;
        }
      } catch (e) {
        console.error('[Subs] srv3-XML parse error', e);
      }
    }

    console.error('[Subs] ✖ all methods failed');
    console.groupEnd();
    return null;
  }

  // Wrapper to use cache and avoid re-generating
  async function getCachedSummary(videoId, model) {
    const cacheKey = model ? `${videoId}::${model}` : videoId;
    if (summaryCache[cacheKey]) {
      return summaryCache[cacheKey];
    }
    const summary = await fetchSummary(videoId, model);
    summaryCache[cacheKey] = summary;
    return summary;
  }

  // Update fetchSummary to accept model
  async function fetchSummary(videoId, model) {
    console.log(`[Summary] fetchSummary(${videoId})`);
    const subs = await fetchSubtitles(videoId);
    if (!subs) return 'No subtitles available for this video.';
    const prompt = `
      You are a youtube video summarization assistant.
      Your task is to generate a concise summary of the provided YouTube video based on subtitles.
      the summary should be clear, informative, and capture the main points of the video.
      Add timestamps to the summary in the format [hh:mm:ss] for each key point.
      The summary should be in English and should not include any personal opinions or interpretations.
      Summary should be in a single paragraph 5-10 sentences long, maybe with bulleted points if appropriate.
      Here is the transcript:
  ${subs}
  `;
    try {
      return await ollama.generate({ prompt, model: model || 'deepseek-r1' });
    } catch (e) {
      console.error('[Summary] error', e);
      return `Failed to summarize: ${e.message}`;
    }
  }

  function cleanSummary(raw) {
    // Remove any stray <think>…</think> just in case
    // Remove everything before the last </think> tag (inclusive)
    const lastThink = raw.lastIndexOf('</think>');
    let cleaned = raw;
    if (lastThink !== -1) {
      cleaned = raw.slice(lastThink + 8); // 8 = '</think>'.length
    }
    return cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }

  function createSummaryPopup(rawText, rect, opts = {}) {
    const text = cleanSummary(rawText);
    removeSummaryPopup();

    // Container for popup + close button
    const popup = document.createElement('div');
    popup.className = 'ytldr-summary-popup';

    // Font and size options
    const fontSize = opts.fontSize || window.ytldrFontSize || 14;
    // Remove winWidth/winHeight, let CSS handle size, allow resize

    // Basic styles + draggable and resizable
    Object.assign(popup.style, {
      position: 'fixed',
      top: `${rect.top}px`,
      left: `${rect.right + 8}px`,
      background: 'rgba(34,34,34,0.98)',
      color: '#fff',
      padding: '16px 18px 16px 18px',
      borderRadius: '12px',
      zIndex: 9999,
      minWidth: '220px',
      minHeight: '120px',
      maxWidth: '90vw',
      maxHeight: '80vh',
      overflow: 'auto',
      resize: 'both',
      boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
      fontSize: fontSize + 'px',
      lineHeight: '1.6',
      whiteSpace: 'pre-wrap',
      cursor: 'default',
      transition: 'box-shadow 0.2s, background 0.2s',
      border: '1.5px solid #c00',
      backdropFilter: 'blur(2px)'
    });

    // Close (×) button
    const closeBtn = document.createElement('span');
    closeBtn.textContent = '×';
    Object.assign(closeBtn.style, {
      position: 'absolute',
      top: '8px',
      right: '14px',
      cursor: 'pointer',
      fontSize: '20px',
      fontWeight: 'bold',
      color: '#aaa',
      zIndex: 10000,
      transition: 'color 0.2s'
    });
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = '#fff'; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = '#aaa'; });
    closeBtn.addEventListener('click', () => removeSummaryPopup());
    popup.appendChild(closeBtn);

    // Summary text
    const content = document.createElement('div');
    content.textContent = text;
    content.style.marginTop = '18px';
    content.style.fontSize = fontSize + 'px';
    popup.appendChild(content);

    document.body.appendChild(popup);

    // If popup overflows on the right, flip to left
    let pr = popup.getBoundingClientRect();
    if (pr.right > window.innerWidth) {
      popup.style.left = `${rect.left - pr.width - 8}px`;
      pr = popup.getBoundingClientRect();
      if (pr.left < 0) popup.style.left = '10px';
    }

    // Dragging Logic (only drag if not on resize handle)
    let isDragging = false;
    let startX, startY, startLeft, startTop;
    const onMouseDown = (e) => {
      // Only drag if not on the resize handle (bottom-right corner)
      const rectNow = popup.getBoundingClientRect();
      if (
        e.target === closeBtn ||
        (e.offsetX > rectNow.width - 24 && e.offsetY > rectNow.height - 24)
      ) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rectNow.left;
      startTop = rectNow.top;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    };
    const onMouseMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      popup.style.left = `${startLeft + dx}px`;
      popup.style.top = `${startTop + dy}px`;
    };
    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    popup.addEventListener('mousedown', onMouseDown);

    // Listen for font size changes from popup.js
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'ytldrUpdateStyle' && msg.fontSize) {
        popup.style.fontSize = msg.fontSize + 'px';
        content.style.fontSize = msg.fontSize + 'px';
      }
    });
  }

  function removeSummaryPopup() {
    document.querySelectorAll('.ytldr-summary-popup').forEach(el => el.remove());
  }

  function getVideoIdFromUrl(u) {
    const m = u.match(/[?&]v=([\w-]{11})/);
    return m && m[1];
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // We’ve removed all hover listeners and functions (onHover, onOut, addHoverListeners).
  // Now only the context menu will trigger “Generate Summary”.
  // ─────────────────────────────────────────────────────────────────────────────

  function addSummaryButton(model) {
    // Optionally retain “Generate Summary” button on any watch page
    if (!/v=([\w-]{11})/.test(location.search)) return;
    if (document.getElementById('ytldr-summary-btn')) return;
    if (!summaryBtnEnabled) return;

    const btn = document.createElement('button');
    btn.id = 'ytldr-summary-btn';
    btn.textContent = 'Generate Summary';
    Object.assign(btn.style, {
      position: 'fixed',
      top: '80px',
      right: '30px',
      zIndex: 10000,
      background: '#c00',
      color: '#fff',
      border: 'none',
      padding: '12px 18px',
      borderRadius: '6px',
      fontSize: '16px',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      whiteSpace: 'nowrap'
    });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Summarizing…';
      btn.style.background = '#888';
      btn.style.cursor = 'wait';
      const vid = getVideoIdFromUrl(location.search);
      if (vid) {
        const rect = btn.getBoundingClientRect();
        const summary = await getCachedSummary(vid, model);
        createSummaryPopup(summary, rect, { fontSize: window.ytldrFontSize });
      }
      btn.disabled = false;
      btn.textContent = 'Generate Summary';
      btn.style.background = '#c00';
      btn.style.cursor = 'pointer';
    });
    document.body.appendChild(btn);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Tampermonkey/Greasemonkey menu command (same as before)
  // ─────────────────────────────────────────────────────────────────────────────

  function registerMenuCommand() {
    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('Generate Summary for Current Video', async () => {
        const vid = getVideoIdFromUrl(location.search);
        if (!vid) {
          alert('No YouTube video detected on this page.');
          return;
        }
        // Use center of window as reference for popup
        const rect = {
          top: window.innerHeight / 2 - 100,
          right: window.innerWidth / 2
        };
        const summary = await getCachedSummary(vid);
        createSummaryPopup(summary, rect);
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Custom right-click context menu (“Generate Summary”)
  // ─────────────────────────────────────────────────────────────────────────────

  let customContextMenu = null;

  function createCustomContextMenu(x, y, videoId) {
    removeCustomContextMenu();

    // Container
    const menu = document.createElement('div');
    menu.className = 'ytldr-context-menu';
    Object.assign(menu.style, {
      position: 'fixed',
      top: `${y}px`,
      left: `${x}px`,
      background: '#333',
      color: '#fff',
      borderRadius: '4px',
      boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
      zIndex: 10001,
      minWidth: '160px',
      fontSize: '14px',
    });

    // “Generate Summary” item
    const item = document.createElement('div');
    item.textContent = 'Generate Summary';
    Object.assign(item.style, {
      padding: '8px 12px',
      cursor: 'pointer',
    });
    item.addEventListener('mouseenter', () => { item.style.background = '#444'; });
    item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
    item.addEventListener('click', async () => {
      removeCustomContextMenu();
      const vid = videoId || getVideoIdFromUrl(location.search);
      if (!vid) {
        alert('No YouTube video detected here.');
        return;
      }
      const rect2 = { top: y, right: x + 150 };
      const summary = await getCachedSummary(vid);
      createSummaryPopup(summary, rect2);
    });
    menu.appendChild(item);

    // Separator
    const sep = document.createElement('div');
    Object.assign(sep.style, {
      height: '1px',
      background: '#555',
      margin: '4px 0',
    });
    menu.appendChild(sep);

    // “Close Menu” item
    const closeItem = document.createElement('div');
    closeItem.textContent = 'Close Menu';
    Object.assign(closeItem.style, {
      padding: '8px 12px',
      cursor: 'pointer',
    });
    closeItem.addEventListener('mouseenter', () => { closeItem.style.background = '#444'; });
    closeItem.addEventListener('mouseleave', () => { closeItem.style.background = 'transparent'; });
    closeItem.addEventListener('click', () => removeCustomContextMenu());
    menu.appendChild(closeItem);

    document.body.appendChild(menu);
    customContextMenu = menu;

    // Adjust if overflowing viewport
    const rectBounds = menu.getBoundingClientRect();
    if (rectBounds.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rectBounds.width - 10}px`;
    }
    if (rectBounds.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rectBounds.height - 10}px`;
    }
  }

  function removeCustomContextMenu() {
    if (customContextMenu) {
      customContextMenu.remove();
      customContextMenu = null;
    }
  }

  function onPageClick(e) {
    // Close custom context menu on any left-click outside
    if (customContextMenu) {
      removeCustomContextMenu();
    }
  }

  function setupCustomContextMenu() {
    // Intercept right-clicks on thumbnails and on the page
    document.addEventListener('contextmenu', (e) => {
      // Only show when right-clicking on:
      // - a thumbnail link (video preview) OR
      // - on a watch page (outside of native UI elements)
      let vid = null;

      // Check if right-clicked element is a thumbnail link
      const anchor = e.target.closest('a#thumbnail');
      if (anchor && anchor.href) {
        vid = getVideoIdFromUrl(anchor.href);
      }

      // If on a watch page and click not on a thumbnail, allow summary for current video
      if (!vid && /v=([\w-]{11})/.test(location.search)) {
        vid = getVideoIdFromUrl(location.search);
      }

      if (vid) {
        e.preventDefault();
        const x = e.clientX;
        const y = e.clientY;
        createCustomContextMenu(x, y, vid);
      }
    });

    // Close menu on any left-click or Escape key
    document.addEventListener('click', onPageClick);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') removeCustomContextMenu();
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Initialization: set up summary button, menu cmd, and context menu only.
  // Hover logic has been completely removed.
  // ─────────────────────────────────────────────────────────────────────────────

  function init() {
    addSummaryButton();
    registerMenuCommand();
    setupCustomContextMenu();
  }

  window.addEventListener('DOMContentLoaded', init);
  document.addEventListener('yt-navigate-finish', init);

  // DescribeLink mode: listen for YouTube video link clicks and send to extension
  if (window === window.top) {
    document.addEventListener('click', function (e) {
      let el = e.target;
      while (el && el.tagName !== 'A') el = el.parentElement;
      if (el && el.href && el.href.includes('youtube.com/watch')) {
        chrome.runtime.sendMessage({ action: 'summarizeUrl', url: el.href });
      }
    }, true);
  }

  // Listen for show/hide on-page summary button toggle from popup
  let summaryBtnEnabled = true;
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'ytldrToggleSummaryBtn') {
      summaryBtnEnabled = !summaryBtnEnabled;
      if (summaryBtnEnabled) {
        addSummaryButton();
      } else {
        const btn = document.getElementById('ytldr-summary-btn');
        if (btn) btn.remove();
      }
      sendResponse && sendResponse();
    }
    if (msg.action === 'ytldrCheckSummaryBtn') {
      const btn = document.getElementById('ytldr-summary-btn');
      sendResponse && sendResponse({ enabled: !!btn });
    }
  });

  // Listen for summary requests from popup and return cached summary if available
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'ytldrGetSummary') {
      const url = msg.url;
      const model = msg.model;
      const vid = getVideoIdFromUrl(url);
      if (!vid) {
        sendResponse && sendResponse({ summary: 'No YouTube video detected.' });
        return;
      }
      getCachedSummary(vid, model).then(summary => {
        sendResponse && sendResponse({ summary });
      });
      return true; // async
    }
  });
})();
