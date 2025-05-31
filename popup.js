// Handles popup UI logic for TLDR extension
// - Fetches models from Ollama API
// - Handles font size and window size adjustments
// - Handles describeLink mode and summary generation

document.addEventListener('DOMContentLoaded', async () => {
  const modelSelect = document.getElementById('modelSelect');
  const fontSizeInput = document.getElementById('fontSizeInput');
  const fontSizeValue = document.getElementById('fontSizeValue');
  const summarizeBtn = document.getElementById('summarizeBtn');
  const summaryBox = document.getElementById('summaryBox');
  const urlInput = document.getElementById('urlInput');
  const regenerateBtn = document.getElementById('regenerateBtn');

  // Initially hide regenerate button
  regenerateBtn.style.display = 'none';

  // Fetch models from Ollama API
  try {
    const res = await fetch('http://localhost:11434/api/tags');
    const data = await res.json();
    data.models.forEach(model => {
      const opt = document.createElement('option');
      opt.value = model.name;
      opt.textContent = model.name;
      modelSelect.appendChild(opt);
    });
  } catch (e) {
    modelSelect.innerHTML = '<option>Error loading models</option>';
  }

  // Font size slider logic
  fontSizeInput.addEventListener('input', () => {
    fontSizeValue.textContent = fontSizeInput.value + 'px';
    summaryBox.style.fontSize = fontSizeInput.value + 'px';
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'ytldrUpdateStyle', fontSize: parseInt(fontSizeInput.value, 10) });
      }
    });
  });

  // Summarize button logic
  function updateSummarizeBtnLabel() {
    const url = urlInput.value.trim();
    if (!url) {
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        const tab = tabs[0];
        if (tab && tab.url && tab.url.includes('youtube.com/watch')) {
          summarizeBtn.textContent = 'Summarize Current';
        } else {
          summarizeBtn.textContent = 'Summarize';
        }
      });
    } else {
      summarizeBtn.textContent = 'Summarize';
    }
  }
  urlInput.addEventListener('input', updateSummarizeBtnLabel);
  document.addEventListener('DOMContentLoaded', updateSummarizeBtnLabel);

  // Autofill YouTube URL if on a YouTube page
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    const tab = tabs[0];
    if (tab && tab.url && tab.url.includes('youtube.com/watch')) {
      urlInput.value = tab.url;
      updateSummarizeBtnLabel();
    }
  });

  summarizeBtn.addEventListener('click', async () => {
    let url = urlInput.value.trim();
    let currentTabId = null;

    if (!url) {
      const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
      const tab = tabs[0];
      if (tab && tab.url && tab.url.includes('youtube.com/watch')) {
        url = tab.url;
        currentTabId = tab.id;
      } else {
        summaryBox.textContent = 'No YouTube video URL provided or detected on current page.';
        return;
      }
    } else {
      // If URL is manually entered, we might not have a tab ID for content script communication easily.
      // For now, let's assume if a URL is entered, it's for a video that might not be the active tab.
      // This part of the logic might need refinement if we want to summarize arbitrary URLs not in an active tab.
      // For this refactor, we primarily focus on summarizing the active tab or a URL that's also likely the active tab.
      const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
      currentTabId = tabs[0]?.id; // Use active tab if available
    }

    const videoId = url.match(/[?&]v=([\w-]{11})/)?.[1];
    if (!videoId) {
      summaryBox.textContent = 'Could not extract video ID from URL.';
      return;
    }

    summaryBox.textContent = 'Fetching subtitles...';
    summarizeBtn.disabled = true;
    regenerateBtn.style.display = 'none'; // Hide regenerate button during new summary generation
    summarizeBtn.textContent = 'Working…';
    summarizeBtn.style.background = '#888';
    summarizeBtn.style.cursor = 'wait';
    chrome.runtime.sendMessage({ action: 'ytldrSummarizing' }); // For any UI indication

    if (!currentTabId) {
        summaryBox.textContent = 'Cannot fetch subtitles: No active YouTube tab identified for communication.';
        summarizeBtn.disabled = false;
        updateSummarizeBtnLabel();
        summarizeBtn.style.background = '';
        summarizeBtn.style.cursor = '';
        chrome.runtime.sendMessage({ action: 'ytldrSummaryReady' });
        return;
    }

    // 1. Get subtitles from content.js
    chrome.tabs.sendMessage(currentTabId, { action: 'getSubtitles', videoId }, (subtitlesResponse) => {
      if (chrome.runtime.lastError || !subtitlesResponse || subtitlesResponse.error) {
        summaryBox.textContent = `Error fetching subtitles: ${subtitlesResponse?.error || chrome.runtime.lastError?.message || 'Unknown error'}`;
        summarizeBtn.disabled = false;
        updateSummarizeBtnLabel();
        summarizeBtn.style.background = '';
        summarizeBtn.style.cursor = '';
        chrome.runtime.sendMessage({ action: 'ytldrSummaryReady' });
        return;
      }

      summaryBox.textContent = 'Generating summary...';
      const { subtitles } = subtitlesResponse;
      const selectedModel = modelSelect.value;

      // 2. Send subtitles to background.js for summary generation
      chrome.runtime.sendMessage(
        { action: 'generateSummary', videoId, subtitles, model: selectedModel },
        (summaryResponse) => {
          if (chrome.runtime.lastError || !summaryResponse || summaryResponse.error) {
            summaryBox.textContent = `Error generating summary: ${summaryResponse?.error || chrome.runtime.lastError?.message || 'Unknown error'}`;
            regenerateBtn.style.display = 'none'; // Keep hidden on error
          } else {
            summaryBox.textContent = summaryResponse.summary;
            summaryBox.style.fontSize = fontSizeInput.value + 'px';
            regenerateBtn.style.display = 'block'; // Show regenerate button on success
          }
          summarizeBtn.disabled = false;
          updateSummarizeBtnLabel();
          summarizeBtn.style.background = '';
          summarizeBtn.style.cursor = '';
          // Regenerate button is already handled by its own logic for enabling/disabling
          chrome.runtime.sendMessage({ action: 'ytldrSummaryReady' });
        }
      );
    });
  });

  regenerateBtn.addEventListener('click', async () => {
    let url = urlInput.value.trim();
    let currentTabId = null;

    // Prioritize URL from input, then active tab
    if (!url) {
      const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
      const tab = tabs[0];
      if (tab && tab.url && tab.url.includes('youtube.com/watch')) {
        url = tab.url;
        currentTabId = tab.id;
      } else {
        summaryBox.textContent = 'No YouTube video URL available for re-generation.';
        return;
      }
    } else {
      // If URL is from input, try to get active tab ID for content script,
      // but it might not be the tab corresponding to the URL.
      const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
      currentTabId = tabs[0]?.id;
    }

    const videoId = url.match(/[?&]v=([\w-]{11})/)?.[1];
    if (!videoId) {
      summaryBox.textContent = 'Could not extract video ID from URL for re-generation.';
      return;
    }

    if (!currentTabId) {
      summaryBox.textContent = 'Cannot fetch subtitles for re-generation: No active tab identified.';
      return;
    }

    summaryBox.textContent = 'Re-fetching subtitles...';
    summarizeBtn.disabled = true;
    regenerateBtn.disabled = true;
    regenerateBtn.textContent = 'Working...';

    chrome.tabs.sendMessage(currentTabId, { action: 'getSubtitles', videoId }, (subtitlesResponse) => {
      if (chrome.runtime.lastError || !subtitlesResponse || subtitlesResponse.error) {
        summaryBox.textContent = `Error re-fetching subtitles: ${subtitlesResponse?.error || chrome.runtime.lastError?.message || 'Unknown error'}`;
        summarizeBtn.disabled = false;
        regenerateBtn.disabled = false;
        regenerateBtn.textContent = 'Re-generate Summary';
        return;
      }

      summaryBox.textContent = 'Re-generating summary (bypassing cache)...';
      const { subtitles } = subtitlesResponse;
      const selectedModel = modelSelect.value;

      chrome.runtime.sendMessage(
        { action: 'generateSummary', videoId, subtitles, model: selectedModel, bypassCache: true },
        (summaryResponse) => {
          if (chrome.runtime.lastError || !summaryResponse || summaryResponse.error) {
            summaryBox.textContent = `Error re-generating summary: ${summaryResponse?.error || chrome.runtime.lastError?.message || 'Unknown error'}`;
          } else {
            summaryBox.textContent = summaryResponse.summary;
            summaryBox.style.fontSize = fontSizeInput.value + 'px';
          }
          summarizeBtn.disabled = false;
          regenerateBtn.disabled = false;
          regenerateBtn.textContent = 'Re-generate Summary';
          regenerateBtn.style.display = 'block'; // Ensure it's visible
        }
      );
    });
  });

  // Add toggle for Create Summary button on YouTube page
  let summaryBtnToggleElement = null; // Renamed to avoid conflict
  function updateSummaryBtnToggleState() {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      const tab = tabs[0];
      if (tab && tab.id && tab.url && tab.url.includes('youtube.com/watch')) {
        chrome.tabs.sendMessage(tab.id, { action: 'ytldrCheckSummaryBtn' }, (resp) => {
          if (summaryBtnToggleElement) { // Use renamed variable
            summaryBtnToggleElement.textContent = resp && resp.enabled ? 'Hide On-Page Button' : 'Show On-Page Button';
          }
        });
      } else if (summaryBtnToggleElement) {
        summaryBtnToggleElement.textContent = 'N/A (Not a YouTube Page)';
        summaryBtnToggleElement.disabled = true;
      }
    });
  }
  summaryBtnToggleElement = document.createElement('button'); // Use renamed variable
  summaryBtnToggleElement.id = 'toggleSummaryBtn';
  summaryBtnToggleElement.style.marginBottom = '8px';
  summaryBtnToggleElement.textContent = 'Show On-Page Button'; // Initial text
  summaryBtnToggleElement.addEventListener('click', () => {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      const tab = tabs[0];
      if (tab && tab.id && tab.url && tab.url.includes('youtube.com/watch')) {
        chrome.tabs.sendMessage(tab.id, { action: 'ytldrToggleSummaryBtn' }, updateSummaryBtnToggleState);
      }
    });
  });
  if (summarizeBtn && summarizeBtn.parentNode) { // Ensure summarizeBtn exists
    summarizeBtn.parentNode.insertBefore(summaryBtnToggleElement, summarizeBtn);
  }
  updateSummaryBtnToggleState(); // Call after element is in DOM
});
