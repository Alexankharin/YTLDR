// Placeholder for background logic if needed in the future

let describeLinkMode = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'toggleDescribeLink') {
        describeLinkMode = !describeLinkMode;
        if (describeLinkMode) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) {
                    chrome.scripting.executeScript({
                        target: { tabId: tabs[0].id },
                        files: ['content.js']
                    });
                }
            });
        }
        sendResponse({ describeLinkMode });
    }
});

// Relay summarize requests from content script to popup
chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg.action === 'summarizeUrl' && msg.url) {
        chrome.runtime.sendMessage({ action: 'summarizeUrl', url: msg.url });
    }
});
