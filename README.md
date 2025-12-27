# MailMind – AI Email Assistant

MailMind is a Chrome extension that leverages Groq LLMs to **summarize Gmail emails** and **draft concise replies** directly inside Gmail. Built on **Chrome Manifest V3**, it interacts with the Gmail REST API via OAuth 2.0 and runs all heavy lifting in a service-worker background script—no external servers required.

## ✨ Features
- **One-click summaries** for the currently opened email.
- **Batch summarization** of multiple selected messages/threads.
- **AI-drafted replies** inserted straight into Gmail’s reply editor.
- **Local SHA-256 cache** to avoid re-summarising identical content.
- **Privacy-minded**: data never leaves your browser except to Groq & Gmail APIs.

## 🗂️ Repository Layout
| Path | Purpose |
|------|---------|
| `manifest.json` | Extension declaration (permissions, OAuth, service-worker, icons). |
| `background.js` | Service-worker that handles Gmail & Groq API calls, queues jobs, and stores caches in `chrome.storage.local`. |
| `content.js` | Injected into `mail.google.com`; observes the DOM, renders the sidebar UI, and exchanges messages with the background worker. |
| `popup.html` + `popup.js` | Toolbar popup showing today’s email count via Gmail API. |
| `icons/` | PNG icons (16, 32, 48, 128 px). |
| `styles.css`, `content.css` | Minimal styling for popup and injected UI. |

## 🏛️ High-Level Architecture
```
┌──────────────┐          chrome.runtime           ┌──────────────────┐        HTTPS
│  content.js  │ ────────────────────────────────▶ │  background.js   │ ────▶ Gmail API
│ (in Gmail)   │   messages / results (JSON)      │ service-worker   │        Groq API
└──────────────┘ ◀─────────────────────────────── └──────────────────┘
        ▲        DOM & UI updates          ▲            │
        │                                   └── chrome.storage.local cache ◀──┘
```
1. `content.js` detects context (opened message, selected rows) and posts a message.
2. `background.js` authenticates with Google (`chrome.identity`) and fetches message bodies if required.
3. If no cached summary exists, it calls the **Groq Chat Completions** endpoint with a system prompt tailored for summaries or replies.
4. Cleaned output is cached (`id`, `bodyHash`, `idHash`) and sent back.
5. `content.js` updates the sidebar or inserts the drafted reply.

### Caching Keys
| Storage key | Maps to | Notes |
|-------------|---------|-------|
| `mailmind_id_cache` | `messageId → {summary, bodyHash}` | Legacy lookup. |
| `mailmind_hash_cache` | `sha256(body) → {summary}` | Duplicate body reuse. |
| `mailmind_idhash_cache` | `sha256(Message-Id header) → {summary}` | Stable across clients. |

### Queue & Rate-Limiting
`QUEUE_DELAY_MS = 1800 ms` ensures at most ~33 requests/min to Groq. Items are de-duplicated via `enqueued` Set and processed sequentially.

## 🔐 Credentials
| What | Where | Purpose |
|------|-------|---------|
| **Groq API Key** | Set constant `GROQ_API_KEY` in `background.js` (or extend UI to store it). | Needed for LLM calls. |
| **Google OAuth Client ID** | `manifest.json → oauth2.client_id` | Required for Gmail API access. Replace with your own for production. |

## 🛠️ Local Installation
1. Clone the repo: `git clone https://github.com/divyamagg2005/Smart-email-summariser.git`.
2. Open `background.js`, paste your Groq API key in `GROQ_API_KEY`.
3. (Optional) Replace the OAuth `client_id` with one registered to your domain.
4. In Chrome:
   - Navigate to `chrome://extensions`.
   - Enable **Developer mode**.
   - Click **Load unpacked** and select the project folder.
5. Open Gmail, select or open emails, and use the extension icon.

## 🚀 Usage Tips
- **Single email**: open it; the sidebar auto-appears with a summary and *Draft Reply* option.
- **Multiple selection**: tick several checkboxes, click the extension icon; summaries for each appear stacked.
- **Reply drafting**: enter optional guidance (tone, bullet points) then click *Draft Reply* and *Insert into Reply Box*.

## 🧩 Contributing
1. Fork → create a feature branch.
2. Keep code style consistent (`prettier` coming soon).
3. Do **not** commit private keys.
4. Submit a PR – issues and feature requests welcome!

## 🗺️ Roadmap
- Settings page for API key & model selection.
- Cache expiry and size limits.
- Support Outlook web, mobile browsers.
- i18n.

## 📄 License
MIT (to be added).

---
**Author:** Divyam Aggarwal <divyamagg2005@gmail.com>
