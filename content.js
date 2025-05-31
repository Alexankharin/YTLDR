(() => {
  // ─────────────────────────────────────────────────────────────────────────────
  // Preserve original logic for fetching and summarizing transcripts. UI only
  // modifications below (menu registration, context menu, draggable & resizable
  // popup, and caching). Hover‐based summarization has been removed.
  // ─────────────────────────────────────────────────────────────────────────────

  // OllamaClient is now in background.js

  // ─────────────────────────────────────────────────────────────────────────────
  // Cache for summaries: { [videoId]: summaryString }
  // ─────────────────────────────────────────────────────────────────────────────
  // summaryCache object removed, caching is now handled by background.js

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

  // Renamed from fetchSummary, now messages background.js
  async function requestSummaryFromBackground(videoId, model) {
    console.log(`[Content] requestSummaryFromBackground for videoId: ${videoId}, model: ${model}`);
    const subtitles = await fetchSubtitles(videoId);
    if (!subtitles) {
      console.error('[Content] No subtitles available, cannot request summary.');
      return 'No subtitles available for this video.';
    }

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'generateSummary', videoId, subtitles, model },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('[Content] Error sending message to background:', chrome.runtime.lastError.message);
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response.error) {
            console.error('[Content] Error from background script:', response.error);
            reject(new Error(response.error));
          } else {
            console.log('[Content] Summary received from background:', response.summary.slice(0,100) + '...');
            resolve(response.summary);
          }
        }
      );
    });
  }

  // cleanSummary function removed, it's now in background.js

  function createSummaryPopup(rawText, rect, opts = {}) {
    // const text = cleanSummary(rawText); // Summary is already cleaned by background.js
    const text = rawText; // Use rawText directly as it's pre-cleaned by background
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
        // Passing null for model, as on-page button relies on background's default model.
        const summary = await requestSummaryFromBackground(vid, null);
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
  // Initialization: set up summary button, menu cmd, and context menu only.
  // Hover logic has been completely removed.
  // ─────────────────────────────────────────────────────────────────────────────

  function init() {
    addSummaryButton();
  }

  window.addEventListener('DOMContentLoaded', init);
  document.addEventListener('yt-navigate-finish', init);

  // DescribeLink mode related code removed.

  // Listen for show/hide on-page summary button toggle from popup
  let summaryBtnEnabled = true; // Default to enabled

  // Combined message listener for actions from popup.js
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'ytldrToggleSummaryBtn') {
      summaryBtnEnabled = !summaryBtnEnabled;
      if (summaryBtnEnabled) {
        addSummaryButton(); // Attempt to add button if enabled
      } else {
        const btn = document.getElementById('ytldr-summary-btn');
        if (btn) btn.remove();
      }
      sendResponse({ success: true, summaryBtnEnabled }); // Respond with current state
      return; // No async response needed here
    }

    if (msg.action === 'ytldrCheckSummaryBtn') {
      const btn = document.getElementById('ytldr-summary-btn');
      sendResponse({ enabled: !!btn && summaryBtnEnabled }); // Check both existence and enabled state
      return; // No async response needed here
    }

    // Listener for popup.js to request subtitles
    if (msg.action === 'getSubtitles') {
      const { videoId } = msg;
      console.log(`[Content] Received getSubtitles request for videoId: ${videoId}`);
      if (!videoId) {
        sendResponse({ error: 'No videoId provided for getSubtitles.' });
        return false;
      }
      fetchSubtitles(videoId)
        .then(subtitles => {
          if (subtitles) {
            sendResponse({ subtitles });
          } else {
            sendResponse({ error: 'Failed to fetch subtitles.' });
          }
        })
        .catch(error => {
          console.error(`[Content] Error fetching subtitles for ${videoId}:`, error);
          sendResponse({ error: error.message || 'Error fetching subtitles.' });
        });
      return true; // Indicates asynchronous response
    }
  });
})();
