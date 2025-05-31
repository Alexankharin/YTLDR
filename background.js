// Background script for YouTube Summarizer Extension

class OllamaClient {
  constructor(baseUrl = 'http://localhost:11434') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async generate({ model = 'deepseek-r1', prompt, stream = false } = {}) {
    console.log('[OllamaClient BG] generate()', model, prompt.slice(0, 80) + '…');
    try {
      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream }),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => res.statusText);
        console.error('[OllamaClient BG] API error', res.status, err);
        throw new Error(`Ollama API error ${res.status}: ${err}`);
      }
      const jsonResponse = await res.json();
      console.log('[OllamaClient BG] API success', jsonResponse);
      return jsonResponse.response;
    } catch (e) {
      console.error('[OllamaClient BG] Network/fetch error', e);
      throw e; // Re-throw to be caught by the caller
    }
  }
}
const ollama = new OllamaClient();

function cleanSummary(rawText) {
  if (typeof rawText !== 'string') {
    return '';
  }
  // Remove <think>...</think> tags and their content
  let cleanedText = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // Remove <thinking>...</thinking> tags and their content (just in case)
  cleanedText = cleanedText.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  // Trim whitespace
  return cleanedText.trim();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'generateSummary') {
    const { videoId, subtitles, model, bypassCache } = request; // Subtitles are passed in
    const cacheKey = `${videoId}::${model}`;
    console.log(`[BG] Received generateSummary for videoId: ${videoId}, model: ${model}, bypassCache: ${bypassCache}. Cache key: ${cacheKey}`);

    const generateAndRespond = () => {
      console.log(`[BG] Generating summary via API for ${cacheKey} (bypassCache: ${bypassCache}).`);
      const prompt = `
You are a youtube video summarization assistant.
Your task is to generate a concise summary of the provided YouTube video based on subtitles.
The summary should be clear, informative, and capture the main points of the video.
Add timestamps to the summary in the format [hh:mm:ss] for each key point.
The summary should be in English and should not include any personal opinions or interpretations.
Summary should be in a single paragraph 5-10 sentences long, maybe with bulleted points if appropriate.
Do NOT include any <think> or other XML-like thinking process tags in your final output. Only provide the summary text.
Here is the transcript:
${subtitles}
`;
      ollama.generate({ model: model || 'deepseek-r1', prompt })
        .then(summaryText => {
          console.log(`[BG] Summary API call successful for ${videoId}.`);
          const cleanedSummary = cleanSummary(String(summaryText));
          console.log(`[BG] Cleaned summary for ${videoId}:`, cleanedSummary.slice(0, 100) + '...');

          chrome.storage.local.set({ [cacheKey]: cleanedSummary }, () => {
            if (chrome.runtime.lastError) {
              console.error(`[BG] Error saving (or updating) summary to cache for ${cacheKey}:`, chrome.runtime.lastError.message);
            } else {
              console.log(`[BG] Summary for ${cacheKey} saved/updated in cache.`);
            }
            sendResponse({ summary: cleanedSummary });
          });
        })
        .catch(error => {
          console.error(`[BG] Error generating summary for ${videoId}:`, error);
          sendResponse({ error: error.message || 'Failed to generate summary.' });
        });
    };

    if (bypassCache) {
      console.log(`[BG] Bypassing cache for ${cacheKey}.`);
      generateAndRespond();
    } else {
      // 1. Check cache first (if not bypassing)
      chrome.storage.local.get([cacheKey], (result) => {
        if (chrome.runtime.lastError) {
          console.error('[BG] Error reading from local storage:', chrome.runtime.lastError.message);
          // Proceed to generate if storage read fails
          generateAndRespond();
        } else if (result[cacheKey]) {
          console.log(`[BG] Cache hit for ${cacheKey}. Returning cached summary.`);
          sendResponse({ summary: result[cacheKey] });
          // No return here, as sendResponse is inside async callback.
          // The outer return true handles the async nature.
        } else {
          // 2. If not in cache, generate summary
          console.log(`[BG] Cache miss for ${cacheKey}.`);
          generateAndRespond();
        }
      });
    }
    return true; // Indicates that the response is sent asynchronously
  }

  // Keep other message listeners if they exist and are distinct
  // For example, the 'toggleDescribeLink' and 'summarizeUrl' listeners
  // It's better to have separate listeners for different actions if they don't share logic.
  // The provided code shows multiple addListener calls, which is fine,
  // but ensure their conditions (`if (request.action === '...'`) are mutually exclusive
  // or they are intended to act on the same messages.
});


// --- Existing DescribeLinkMode logic ---
let describeLinkMode = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'toggleDescribeLink') {
        describeLinkMode = !describeLinkMode;
        if (describeLinkMode) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0] && tabs[0].id) { // Check if tabId is valid
                    chrome.scripting.executeScript({
                        target: { tabId: tabs[0].id },
                        files: ['content.js']
                    }).catch(err => console.error("[BG] Error injecting content script:", err));
                } else {
                    console.error("[BG] Could not get active tab ID for describeLinkMode.");
                }
            });
        }
        sendResponse({ describeLinkMode });
         // Return true if you intend to send a response asynchronously, though not strictly necessary here.
    }
    // Note: It's generally better to have separate listeners or ensure no overlap in message handling.
    // If 'toggleDescribeLink' is the only action here, this is fine.
});

// Relay summarize requests from content script (intended for popup, but might be obsolete or need review)
// This listener seems to be for a different flow (content script -> background -> popup)
// It might conflict or be redundant with the new 'generateSummary' flow.
// For now, keeping it, but it should be reviewed in context of overall architecture.
chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg.action === 'summarizeUrl' && msg.url) {
        console.log('[BG] Relaying summarizeUrl to popup:', msg.url);
        chrome.runtime.sendMessage({ action: 'summarizeUrl', url: msg.url });
    }
});
