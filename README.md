# MailMind – AI Email Assistant

MailMind is a Chrome extension that leverages Groq LLMs to summarize Gmail emails and draft concise replies directly inside Gmail. Built on Chrome Manifest V3, it uses the Gmail REST API via OAuth 2.0 and runs all heavy lifting in a service-worker background script — no external servers required beyond Gmail and Groq.

Repository: https://github.com/divyamagg2005/Smart-email-summariser

---

## ✨ Features
- One‑click summary for the currently opened email.
- Multi‑selection summarization for selected rows/threads in Inbox.
- AI‑drafted replies inserted straight into Gmail’s reply editor.
- Local SHA‑256 caches to avoid re‑summarizing identical content.
- Privacy‑minded: email content never leaves your browser except to Gmail and Groq APIs.
- Built‑in run metrics export (evaluation metrics JSON).

## 🗂️ Repository Layout
| Path | Purpose |
|------|---------|
| `manifest.json` | MV3 declaration: permissions, OAuth client, service worker, host permissions, icons. |
| `background.js` | Service worker. Handles Gmail OAuth, Gmail API fetches, Groq calls, queueing/rate‑limiting, caching, metrics, message bus. |
| `content.js` | Content script injected into `mail.google.com`. Observes Gmail DOM, renders sidebar UI, collects selections, sends/receives messages. |
| `popup.html`, `popup.js` | Extension popup. Shows today’s email count and exports evaluation metrics. |
| `evaluation_metrics.json` | Example/exported dataset of run metrics. See Architecture → Metrics. |
| `content.css`, `styles.css` | Styling placeholders. Currently minimal/empty in this repo. |
| `icons/` | Icon paths referenced by `manifest.json`. Ensure PNGs exist at 16/32/48/128 if you publish. |
| `api.txt` | Convenience file that currently stores a key string; not read by the extension at runtime. |
| `CHANGELOG.md` | Placeholder for release notes. |
| `LICENSE` | MIT license text. |

---

## 🏛️ High‑Level Architecture
```
┌──────────────┐          chrome.runtime           ┌──────────────────┐        HTTPS
│  content.js  │ ────────────────────────────────▶ │  background.js   │ ────▶ Gmail API
│ (in Gmail)   │   messages / results (JSON)      │ service worker    │        Groq API
└──────────────┘ ◀─────────────────────────────── └──────────────────┘
        ▲        DOM & UI updates          ▲            │
        │                                   └── chrome.storage.local cache ◀──┘
```

- The content script never performs external network requests. All network I/O (Gmail + Groq) is centralized in the service‑worker `background.js`.
- Results and errors are posted back to the content script for rendering in a Gmail‑native sidebar panel.

### Core Responsibilities
- `background.js`
  - Gmail OAuth via `chrome.identity.getAuthToken`.
  - Gmail message/thread fetches: `/messages/{id}?format=full` and `/threads/{id}?format=full`.
  - Body extraction from Gmail payloads (prefers `text/plain`, falls back to `text/html` stripped).
  - Groq Chat Completions calls for summaries and replies (model: `llama-3.1-8b-instant`).
  - In‑memory job queue with de‑duplication and rate limiting.
  - Cache management in `chrome.storage.local`.
  - Per‑operation run metrics (latency, throughput, token usage, queue wait, cache hits).

- `content.js`
  - Detects context in Gmail UI:
    - Opened message body via `.a3s` elements.
    - Multi‑selection via `tr.zA` rows and `data‑legacy‑*` attributes.
  - Renders a Shadow DOM sidebar with “cards” for summaries/replies.
  - Provides a reply composer and “Insert into Reply Box” action.
  - Sends user intents to `background.js` and renders results/errors.

- `popup.html` / `popup.js`
  - Shows “emails received today” (using Gmail `messages.list` with a date range query).
  - Exports evaluation metrics by triggering a JSON download built from `chrome.storage.local`.

---

## 🧠 System Architecture (Detailed)

### Messaging Contract
- From `content.js` to `background.js`:
  - `mailmind_single_summarize_request` { body, messageId?, headerId? }
  - `mailmind_multi_summarize_request` { items: [{ kind: 'message'|'thread', id }] }
  - `mailmind_single_reply_request` { body }
  - `mailmind_today_count`
  - `mailmind_export_metrics`
  - `mailmind_metrics_render_ack` { runId }

- From `background.js` to `content.js`:
  - `mailmind_single_result` { mode: 'summary'|'reply', summary, source?, runId? }
  - `mailmind_single_error` { mode: 'summary'|'reply', error, runId? }
  - `mailmind_summary_result` { messageId, summary, source?, runId? }
  - `mailmind_summary_error` { messageId, error, runId? }

### Caching Strategy
Three complementary caches minimize redundant LLM calls:
- `mailmind_id_cache`: `messageId → { summary, bodyHash }` (Gmail internal message id)
- `mailmind_hash_cache`: `sha256(body) → { summary }` (identical bodies reuse summaries)
- `mailmind_idhash_cache`: `sha256(Message‑Id header)` if available, otherwise `sha256(GmailId)` → `{ summary }`

Behavior notes:
- When any cache hits, `background.js` may backfill the others to keep maps consistent.
- Single‑open and list‑view paths share cache state; header `Message‑Id` makes summaries portable across clients.
- No TTL/eviction policy yet; see Roadmap.

### Queueing & Rate‑Limiting
- A single FIFO queue processes items one at a time.
- `QUEUE_DELAY_MS = 1800` ensures ≈33 requests/minute to Groq.
- Duplicate enqueues are prevented by an `enqueued` Set keyed by `message:{id}`.

### Evaluation Metrics
Each user operation creates a “run” with:
- `batchSize` = number of emails requested together (single vs multi‑selection).
- `latencyMs` = wall‑clock time for the run.
- `throughput` = emails per second.
- `tokensTotal`, `tokensPerEmail` = Groq usage accounting when available.
- `cacheHit` (any hit), `queueWaitMs` (avg), `queueLength` (max), `success/error`.

Exported metrics are downloaded to `evaluation_metrics.json` via the popup.

Important “batch” clarification:
- In `evaluation_metrics.json`, the “batch”/`batchSize` value is a label representing how many emails were selected in the UI. There is no true parallel or batched Groq request in `background.js`. Items are processed sequentially according to the queue and global delay.

### End‑to‑End Flows
- Single summary
  1. `content.js` extracts visible body and discovers `messageId`/`headerId` if possible.
  2. Sends `mailmind_single_summarize_request` to `background.js`.
  3. `background.js` checks caches in order: id‑hash → body‑hash; if miss, calls Groq and stores results.
  4. Sends `mailmind_single_result` back; UI renders the summary card.

- Multi selection summaries
  1. `content.js` collects `message` and/or `thread` ids from the list view and sends `mailmind_multi_summarize_request`.
  2. For `thread`, `background.js` fetches the thread, selects the last message, and proceeds.
  3. Pre‑checks id‑hash cache (header `Message‑Id` preferred); else body‑hash or enqueue for Groq.
  4. Queue processes one item at a time with spacing; each result is posted via `mailmind_summary_result`.

- AI reply drafting
  1. `content.js` sends `mailmind_single_reply_request` with the current email body and optional guidance.
  2. `background.js` calls Groq with a reply‑specific system prompt; returns plain reply text.
  3. `content.js` exposes “Insert into Reply Box” to inject HTML into Gmail’s editor.

---

## 🔐 Credentials & Permissions
- Groq API Key
  - The service worker reads `GROQ_API_KEY` directly from `background.js`. Replace the placeholder with your own key or extend the UI to store it securely.
  - Do not commit real keys. The `api.txt` file in the repo is not read at runtime.

- Google OAuth Client ID
  - `manifest.json → oauth2.client_id` must be a valid client for Gmail scope:
    - `https://www.googleapis.com/auth/gmail.readonly`

- MV3 permissions
  - `identity`, `storage`, `activeTab`, `scripting`, `tabs`, `downloads`.
  - Host permissions include `mail.google.com`, `www.googleapis.com`, and `api.groq.com`.
  - `generativelanguage.googleapis.com` is listed but unused by the current code.

Privacy note: Email content is processed locally and sent only to Gmail and Groq over HTTPS. No additional servers are involved.

---

## 🛠️ Local Installation
1. Clone: `git clone https://github.com/divyamagg2005/Smart-email-summariser.git`
2. Open `background.js` and set your Groq API key in the `GROQ_API_KEY` constant.
3. (Optional) Replace the OAuth `client_id` in `manifest.json` with one registered to your account.
4. In Chrome:
   - Navigate to `chrome://extensions`.
   - Enable Developer mode.
   - Click “Load unpacked” and select the project folder.
5. Open Gmail and either select multiple rows or open a single email to see the sidebar.

## 🚀 Usage
- Single email: open an email; the sidebar appears with a summary and a reply composer.
- Multi‑select: tick checkboxes for multiple emails/threads and click the extension icon; summaries render as stacked cards.
- Reply drafting: write optional guidance and click “Draft Reply”, then “Insert into Reply Box”. Ensure Gmail’s reply editor is visible.

## 🧪 Troubleshooting
- Gmail 401/permission issues: the worker clears cached tokens and re‑auths on the next attempt.
- Groq 429/rate limits: results may error per‑item; the global delay limits overall request rate.
- Sidebar doesn’t appear: Gmail DOM changed; selectors (`.a3s`, `tr.zA`, `data‑legacy‑*`) may need updates.
- Icons missing in Chrome: ensure PNG files exist under `icons/` as referenced in `manifest.json`.

## 🗺️ Roadmap
- Settings page for API key/model selection.
- Cache TTL/eviction and size limits.
- Smarter retries/backoff for LLM errors.
- Optional parallelism with bounded concurrency respecting rate limits.
- i18n and support for other webmail UIs.

## 📊 Notes on evaluation_metrics.json
- The file in this repo is an example of exported runs for analysis.
- `batchSize` distinguishes single vs multi‑selection size. It is not true batch processing. All Groq calls are sequential in `background.js`.

## 📄 License
MIT — see `LICENSE`.

## 👤 Author
Divyam Aggarwal — <divyamagg2005@gmail.com>

