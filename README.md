# Xplainify

**Understand before you read.**

Xplainify is an editorial, high-signal Chrome extension designed for students, developers, and people learning from the web. It clarifies complex webpages and explains code in intuitive, beginner-friendly language — powered directly by your own Google Gemini API key with zero server-side intermediaries.

## Features
- **Editorial Design System**: Built with strict sharp geometry (`0px` border-radius), subtle horizontal rules, and purposeful whitespace instead of card containers
- **Modern Typography Hierarchy**: Plus Jakarta Sans (UI, display & body across weights 400–800), JetBrains Mono (source code & technical metadata)
- **Dynamic Model Discovery**: Automatically queries Google's Models API to resolve the newest available stable Flash model with 24-hour local caching
- **Self-Healing Resilience**: Automatically detects retired models (404), invalidates cache, and re-resolves models on the fly
- **Progressive Focus Loading**: Subtle typographic scanning animation modeling information distillation
- **Webpage Summarization**: High-signal TL;DR, Key Points, and Plain English breakdown
- **Automatic Code Detection**: Detects and explains code blocks (logic, important lines, concepts, analogies)
- **Right-Click Context Menu**: Instantly explain selected code anywhere on the web
- **Zero Backend & Local Storage**: Direct browser-to-Gemini REST requests with local API key persistence
- **Strict Key & Prompt Security**: Prompt injection defenses, safe DOM rendering, and zero key logging

## Tech Stack
- Chrome Extension Manifest V3
- HTML / CSS / Vanilla JavaScript (zero framework bloat)
- Google Gemini REST API (dynamic model resolution via Models API)
- Chrome Storage & Scripting APIs

## Architecture

```mermaid
flowchart LR
    User(["👤 User"]) --> Extension["Xplainify Extension"]
    Extension --> Storage["chrome.storage.local"]
    Storage --> APIKey["User's Gemini API Key"]
    Extension --> Extractor["Content / Code Extractor"]
    Extractor --> Gemini["Google Gemini API"]
    Gemini --> Extension
    Extension --> User
```

*Note: There is no Xplainify backend. All API requests go directly from your browser to Google's Gemini API.*

## Installation

1. Clone or download this repository
   ```bash
   git clone https://github.com/yourusername/xplainify.git
   ```
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer Mode** (toggle in top-right)
4. Click **Load unpacked**
5. Select the `xplainify` folder
6. Click the Xplainify icon in your toolbar
7. Configure your Gemini API key in Settings

## Getting Your Gemini API Key

1. Visit [Google AI Studio](https://aistudio.google.com/app/api-keys)
2. Sign in with your Google account
3. Click **Create API Key**
4. Copy the generated key
5. Open Xplainify Settings
6. Paste and save your key

*Note: The free tier of Gemini API is sufficient for most usage.*

## Usage

1. **Summarize a Page**: Navigate to any webpage → Click Xplainify → Click "Summarize Page"
2. **Explain Code**: Visit a page with code (GitHub, MDN, Stack Overflow, etc.) → Click Xplainify → Click "Explain Code" → Select a code block → Read the explanation
3. **Context Menu**: Select code on any page → Right-click → "Xplainify → Explain Selected Code"

## Permissions

| Permission | Purpose |
|---|---|
| `activeTab` | Access the current tab's content when you click the extension |
| `scripting` | Inject content extraction scripts into the active tab |
| `storage` | Store your API key locally in Chrome |
| `contextMenus` | Add "Explain Selected Code" to the right-click menu |

## Privacy & Security

- **No backend** — all requests go directly to Google Gemini
- **Local storage only** — your API key never leaves your browser
- **No tracking** — no analytics, no data collection
- **No `eval()`** — AI output is never executed as code
- **Minimal permissions** — only what's needed
- **Safe rendering** — AI responses are sanitized before display
- **Untrusted input** — webpage content is treated as untrusted data

Link to [PRIVACY.md](./PRIVACY.md) for full details.

## Project Structure

```
xplainify/
├── manifest.json          # Extension configuration
├── popup.html/css/js      # Main popup UI
├── settings.html/css/js   # Settings page
├── background.js          # Service worker
├── content.js             # Content extraction
├── js/
│   ├── api.js             # Gemini API client
│   ├── prompts.js         # Prompt engineering
│   ├── storage.js         # Chrome storage wrapper
│   ├── extractor.js       # Content extraction logic
│   └── utils.js           # Utilities & safe rendering
├── icons/                 # Extension icons
├── README.md
├── PRIVACY.md
└── .gitignore
```

## Future Improvements

- Better code block selection UI
- Support for additional AI providers
- Local history of summaries and explanations
- Adjustable explanation difficulty level
- PDF and document support
- Keyboard shortcuts
- Export summaries to markdown
- More advanced learning modes

## Built By

Built by **Siddhesh Khankhoje** — [View Portfolio](https://siddheshk17-portfolio.vercel.app/)

## License

MIT License

