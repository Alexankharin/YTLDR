# ytldr

A browser extension that shows a summary of YouTube videos when you hover over them.

## Prerequisites
Before installing the extension, you need a local Ollama server running with CORS enabled and the Deepseek model installed. Follow the steps below:

### Install Ollama

#### macOS / Linux (via Homebrew)
```bash
brew install ollama
```

#### Windows
Download and run the Windows installer from https://ollama.com.

### Enable CORS for Ollama
By default, Ollama listens on localhost:11434. To allow your browser (which runs on https://www.youtube.com) to send requests, set the `OLLAMA_ORIGINS` environment variable to `*`.

#### macOS / Linux
```bash
export OLLAMA_ORIGINS="*"
# (Optional) to let Ollama listen on all network interfaces:
export OLLAMA_HOST="0.0.0.0"
```
Then restart Ollama (see step 4).

#### Windows
Open Control Panel → System → Advanced system settings → Environment Variables.

Under User variables, click New… and add:
- Variable name: `OLLAMA_ORIGINS`
- Variable value: `*`

Restart your computer or restart the Ollama service.

### Pull the Deepseek model
After Ollama is installed and CORS is configured, run:
```bash
ollama pull deepseek-r1:latest
```
This downloads `deepseek-r1:1.5b` to your local Ollama instance.

### Start the Ollama server
If Ollama did not auto-start, launch it in a terminal/PowerShell:
```bash
ollama serve
```
By default, it will listen on http://localhost:11434. You can verify it’s running by visiting http://localhost:11434 in your browser or using:
```bash
curl http://localhost:11434
```
You should see a simple confirmation that Ollama is up.

## Features
- Injects a content script into YouTube
- Shows a popup with a summary when hovering over video thumbnails
- (Planned) Fetches summaries from an API

## Installation
1. Go to `chrome://extensions` (or Edge extensions page)
2. Enable Developer Mode
3. Click "Load unpacked" and select this folder

## Usage
- Hover over any YouTube video thumbnail to see a summary popup.

## Development
- Edit `content.js` for main logic
- Edit `popup.html` for extension popup
- Edit `style.css` for popup styles

## Local LLM Summarization
This extension requires a local LLM server running at `http://localhost:5000/summarize` that accepts POST requests with `{ text: <subtitles> }` and returns `{ summary: <summary> }`.

Subtitles are fetched from YouTube (if available) and sent to the local LLM for summarization. If no subtitles are found, a message is shown instead.

---

This is an MVP. Summaries are currently placeholders.
