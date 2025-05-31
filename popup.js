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
    if (!url) {
      // Try to get current YouTube video URL
      const tabs = await new Promise(r => chrome.tabs.query({active: true, currentWindow: true}, r));
      const tab = tabs[0];
      if (tab && tab.url && tab.url.includes('youtube.com/watch')) {
        url = tab.url;
      } else {
        summaryBox.textContent = 'No YouTube video URL provided or detected.';
        return;
      }
    }
    summaryBox.textContent = 'Generating summary...';
    summarizeBtn.disabled = true;
    summarizeBtn.textContent = 'Summarizing…';
    summarizeBtn.style.background = '#888';
    summarizeBtn.style.cursor = 'wait';
    chrome.runtime.sendMessage({ action: 'ytldrSummarizing' });
    // Try to get from cache first
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      const tabId = tabs[0]?.id;
      chrome.tabs.sendMessage(tabId, { action: 'ytldrGetSummary', url, model: modelSelect.value }, async (resp) => {
        if (resp && resp.summary && !resp.summary.startsWith('Failed to summarize')) {
          summaryBox.textContent = resp.summary;
          summaryBox.style.fontSize = fontSizeInput.value + 'px';
          summarizeBtn.disabled = false;
          updateSummarizeBtnLabel();
          summarizeBtn.style.background = '';
          summarizeBtn.style.cursor = '';
          chrome.runtime.sendMessage({ action: 'ytldrSummaryReady' });
        } else {
          // Not in cache or failed, generate
          try {
            const res = await fetch('http://localhost:11434/api/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: modelSelect.value,
                prompt: `Summarize this YouTube video: ${url}`
              })
            });
            const data = await res.json();
            summaryBox.textContent = data.response || 'No summary.';
            summaryBox.style.fontSize = fontSizeInput.value + 'px';
            // Save to cache in content script
            chrome.tabs.sendMessage(tabId, { action: 'ytldrGetSummary', url, model: modelSelect.value }, () => {});
          } catch (e) {
            summaryBox.textContent = 'Error generating summary.';
          }
          summarizeBtn.disabled = false;
          updateSummarizeBtnLabel();
          summarizeBtn.style.background = '';
          summarizeBtn.style.cursor = '';
          chrome.runtime.sendMessage({ action: 'ytldrSummaryReady' });
        }
      });
    });
  });

  // Add toggle for Create Summary button on YouTube page
  let summaryBtnToggle = null;
  function updateSummaryBtnToggleState() {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      const tab = tabs[0];
      if (tab && tab.url && tab.url.includes('youtube.com/watch')) {
        chrome.tabs.sendMessage(tab.id, { action: 'ytldrCheckSummaryBtn' }, (resp) => {
          if (summaryBtnToggle) {
            summaryBtnToggle.textContent = resp && resp.enabled ? 'Hide On-Page Button' : 'Show On-Page Button';
          }
        });
      }
    });
  }
  summaryBtnToggle = document.createElement('button');
  summaryBtnToggle.id = 'toggleSummaryBtn';
  summaryBtnToggle.style.marginBottom = '8px';
  summaryBtnToggle.textContent = 'Show On-Page Button';
  summaryBtnToggle.addEventListener('click', () => {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      const tab = tabs[0];
      if (tab && tab.url && tab.url.includes('youtube.com/watch')) {
        chrome.tabs.sendMessage(tab.id, { action: 'ytldrToggleSummaryBtn' }, updateSummaryBtnToggleState);
      }
    });
  });
  summarizeBtn.parentNode.insertBefore(summaryBtnToggle, summarizeBtn);
  updateSummaryBtnToggleState();
});
