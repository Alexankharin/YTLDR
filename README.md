# ytldr

<img src="icon128.png" alt="ytldr icon" width="64" height="64" style="float:right; margin-left:16px;" />

A browser extension that shows a summary of YouTube videos in a popup or on the page, using a locally uinstalled Ollama LLM.

## Prerequisites
Before installing the extension, you need a local Ollama server running with CORS enabled and at least one model installed. See below for setup instructions.

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
```
Then restart Ollama (see step 4).

#### Windows
Open Control Panel → System → Advanced system settings → Environment Variables.

Under User variables, click New… and add:
- Variable name: `OLLAMA_ORIGINS`
- Variable value: `*`

Restart your computer or restart the Ollama service.

### Pull a Model (e.g. Deepseek)
After Ollama is installed and CORS is configured, run:
```bash
ollama pull deepseek-r1:latest
```
Or pull any other supported model you want to use for summarization.

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
- Extension popup UI lets you:
  - Select the Ollama model for summarization (auto-fetched from your local Ollama server)
  - Adjust the font size of summaries
  - Autofill the YouTube URL field with the current video if on a YouTube page
  - Show/hide the on-page "Generate Summary" button
  - Summarize any YouTube video by URL or the current video
- Summaries are cached per video and model for instant reuse in both popup and on-page windows
- On-page summary popup is draggable and resizable
- Font size changes apply live to both popup and on-page summary windows
- Context menu and on-page button both use the same summary logic and cache

## Installation
1. Go to `chrome://extensions` (or Edge extensions page)
2. Enable Developer Mode
3. Click "Load unpacked" and select this folder

## Usage
- Open a YouTube video and click the extension icon to open the popup
- The YouTube URL field will autofill if you're on a video page
- Select your model, adjust font size, and click "Summarize" to generate or view a cached summary
- Use the toggle to show/hide the on-page "Generate Summary" button
- You can also right-click on video thumbnails for a context menu summary

## Development
- Edit `content.js` for main logic
- Edit `popup.html` and `popup.js` for extension popup
- Edit `style.css` for popup styles

## Local LLM Summarization
This extension requires a local Ollama server running at `http://localhost:11434` that accepts POST requests to `/api/generate` with `{ model, prompt }` and returns `{ response }`.

Subtitles are fetched from YouTube (if available) and sent to the local LLM for summarization. If no subtitles are found, a message is shown instead.

---

This is an MVP. Summaries are generated live and cached per video/model. UI and features are evolving rapidly.
