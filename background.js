const GMAIL_API_BASE = "https://www.googleapis.com/gmail/v1/users/me";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.1-8b-instant";
const GROQ_API_KEY = "";
const ID_CACHE_KEY = "mailmind_id_cache"; // legacy: messageId -> {summary, bodyHash}
const HASH_CACHE_KEY = "mailmind_hash_cache"; // legacy: bodyHash -> {summary}
const ID_HASH_CACHE_KEY = "mailmind_idhash_cache"; // NEW: sha256(messageId) -> {summary}
const QUEUE_DELAY_MS = 1800;

let processing = false;
let queue = [];
let enqueued = new Set();

function log(...args) {
  console.log("[MailMind]", ...args);
}

function getHeader(headers, name) {
  if (!headers || !Array.isArray(headers)) return null;
  const target = String(name).toLowerCase();
  for (const h of headers) {
    if (!h || !h.name) continue;
    if (String(h.name).toLowerCase() === target) return h.value || null;
  }
  return null;
}

function getFromStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (items) => resolve(items || {}));
  });
}

function setInStorage(obj) {
  return new Promise((resolve) => {
    chrome.storage.local.set(obj, () => resolve());
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function decodeGmailBody(data) {
  if (!data) return "";
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPlainTextFromMessage(message) {
  const payload = message && message.payload;
  if (!payload) return "";

  let textPlainCandidates = [];
  let textHtmlCandidates = [];

  function walk(node) {
    if (!node) return;
    const mime = node.mimeType || "";
    if (node.body && node.body.data) {
      if (mime.startsWith("text/plain")) {
        textPlainCandidates.push(decodeGmailBody(node.body.data));
      } else if (mime.startsWith("text/html")) {
        textHtmlCandidates.push(stripHtml(decodeGmailBody(node.body.data)));
      }
    }
    if (node.parts && Array.isArray(node.parts)) {
      for (const p of node.parts) walk(p);
    }
  }

  walk(payload);
  if (textPlainCandidates.length > 0) return textPlainCandidates.join("\n\n").trim();
  if (textHtmlCandidates.length > 0) return textHtmlCandidates.join("\n\n").trim();
  if (payload.body && payload.body.data) return decodeGmailBody(payload.body.data).trim();
  return "";
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(chrome.runtime.lastError || new Error("No token"));
      } else {
        resolve(token);
      }
    });
  });
}

async function getGmailAccessToken() {
  try {
    return await getAuthToken(false);
  } catch (e) {
    log("getAuthToken non-interactive failed, retrying interactively", e && e.message);
    return await getAuthToken(true);
  }
}

async function gmailFetch(path) {
  const token = await getGmailAccessToken();
  const res = await fetch(`${GMAIL_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    chrome.identity.getAuthToken({ interactive: false }, (t) => {
      if (t) chrome.identity.removeCachedAuthToken({ token: t }, () => {});
    });
  }
  return res;
}

async function fetchMessageById(messageId) {
  log("Gmail API fetch starts for message", messageId);
  const res = await gmailFetch(`/messages/${encodeURIComponent(messageId)}?format=full`);
  const data = await res.json();
  log("Gmail API response received for message", messageId, { status: res.status });
  if (!res.ok) throw new Error(`Gmail message get failed: ${res.status}`);
  return data;
}

async function fetchThreadById(threadId) {
  log("Gmail API fetch starts for thread", threadId);
  const res = await gmailFetch(`/threads/${encodeURIComponent(threadId)}?format=full`);
  const data = await res.json();
  log("Gmail API response received for thread", threadId, { status: res.status });
  if (!res.ok) throw new Error(`Gmail thread get failed: ${res.status}`);
  return data;
}

async function getGroqApiKey() {
  return GROQ_API_KEY;
}

async function callGroq(promptText) {
  const apiKey = await getGroqApiKey();
  if (!apiKey) throw new Error("Groq API key missing");
  log("Groq API call starts");
  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: "You are an email assistant. Output only the concise summary sentences. Do not include any preface such as 'Here is a summary', 'Summary:', or similar. No markdown, no labels, no headings." },
        { role: "user", content: `Email content to summarize:\n"""\n${promptText}\n"""\nSummarize in 3–4 clear sentences. Output only the summary text.` },
      ],
      temperature: 0.2,
      max_tokens: 512,
    }),
  });
  const data = await res.json().catch(() => ({}));
  log("Groq raw response", data);
  if (!res.ok) throw new Error(`Groq API error ${res.status}`);
  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error("Groq API returned no text");
  return cleanSummaryOutput(String(text).trim());
}

async function callGroqReply(emailText) {
  const apiKey = await getGroqApiKey();
  if (!apiKey) throw new Error("Groq API key missing");
  log("Groq API call starts (reply)");
  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: "You are an email assistant. Output only the direct reply body text. Do not include any preface, notes, labels, or explanations. Do not quote the original email. No markdown. Start directly with the greeting or the first sentence." },
        { role: "user", content: `Email to reply to:\n"""\n${emailText}\n"""\nCompose a concise, professional reply. Output only the reply body text, with no preamble or labels.` },
      ],
      temperature: 0.3,
      max_tokens: 512,
    }),
  });
  const data = await res.json().catch(() => ({}));
  log("Groq raw response (reply)", data);
  if (!res.ok) throw new Error(`Groq API error ${res.status}`);
  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error("Groq API returned no text");
  return cleanReplyOutput(String(text).trim());
}

function cleanReplyOutput(t) {
  let s = String(t || "").trim();
  s = s.replace(/^(here\s*is|here'?s|this\s*is|below\s*is)\b[\s\S]{0,80}?\:\s*/i, "");
  s = s.replace(/^\s*(a\s*)?concise(,|\s)+professional\s+reply\b[\s\S]*?\:\s*/i, "");
  s = s.replace(/^\s*(reply|response)\s*:\s*/i, "");
  return s.trim();
}

function cleanSummaryOutput(t) {
  let s = String(t || "").trim();
  s = s.replace(/^(here\s*is|here'?s|this\s*is|below\s*is)\b[\s\S]{0,80}?\:\s*/i, "");
  s = s.replace(/^\s*(summary|tl;dr)\s*:\s*/i, "");
  s = s.replace(/^\s*in\s*\d+\s*(?:-?\s*)?sentences\s*:\s*/i, "");
  return s.trim();
}

async function getCaches() {
  const items = await getFromStorage([ID_CACHE_KEY, HASH_CACHE_KEY, ID_HASH_CACHE_KEY]);
  return {
    idCache: items[ID_CACHE_KEY] || {},
    hashCache: items[HASH_CACHE_KEY] || {},
    idHashCache: items[ID_HASH_CACHE_KEY] || {},
  };
}

async function setCaches(idCache, hashCache, idHashCache) {
  await setInStorage({ [ID_CACHE_KEY]: idCache, [HASH_CACHE_KEY]: hashCache, [ID_HASH_CACHE_KEY]: idHashCache });
}

async function ensureSummaryCached(messageId, emailText) {
  const { idCache, hashCache, idHashCache } = await getCaches();
  // Check Gmail messageId cache
  const existing = idCache[messageId];
  if (existing && existing.summary && existing.bodyHash) {
    const gmailIdHash = await sha256(String(messageId || ""));
    if (!idHashCache[gmailIdHash]) {
      idHashCache[gmailIdHash] = { summary: existing.summary, ts: Date.now(), messageId };
      await setCaches(idCache, hashCache, idHashCache);
    }
    return { cached: true, summary: existing.summary, bodyHash: existing.bodyHash };
  }
  // Compute body hash and check cache
  const bodyHash = await sha256(emailText);
  if (hashCache[bodyHash] && hashCache[bodyHash].summary) {
    const summary = hashCache[bodyHash].summary;
    idCache[messageId] = { summary, bodyHash, ts: Date.now() };
    const gmailIdHash = await sha256(String(messageId || ""));
    idHashCache[gmailIdHash] = { summary, ts: Date.now(), messageId };
    await setCaches(idCache, hashCache, idHashCache);
    return { cached: true, summary, bodyHash };
  }
  return { cached: false, bodyHash };
}

async function checkCachedByIdHash(messageId) {
  const idHash = await sha256(String(messageId || ""));
  const { idHashCache } = await getCaches();
  const entry = idHashCache[idHash];
  if (entry && entry.summary) return { cached: true, summary: entry.summary, idHash };
  return { cached: false, idHash };
}

function sendToTab(tabId, payload) {
  if (typeof tabId !== "number") return;
  chrome.tabs.sendMessage(tabId, payload, () => void 0);
}

async function countTodayMessages() {
  const now = new Date();
  const next = new Date(now);
  next.setDate(now.getDate() + 1);
  const fmt = (dt) => {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}/${m}/${d}`;
  };
  const q = `after:${fmt(now)} before:${fmt(next)}`;
  let count = 0;
  let pageToken = undefined;
  do {
    const url = `/messages?q=${encodeURIComponent(q)}&includeSpamTrash=false&maxResults=500` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ``);
    const res = await gmailFetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Gmail list failed: ${res.status}`);
    if (data && Array.isArray(data.messages)) count += data.messages.length;
    pageToken = data && data.nextPageToken;
  } while (pageToken);
  return count;
}

async function processQueue() {
  if (processing) return;
  processing = true;
  log("Queue processing started. Size:", queue.length);
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    enqueued.delete(item.key);
    log("Processing queue item", { key: item.key, remaining: queue.length });
    try {
      const { idCache, hashCache, idHashCache } = await getCaches();
      // Check id-hash cache again before calling Groq (defensive).
      const idHashEntry = item.idHash ? idHashCache[item.idHash] : undefined;
      if (idHashEntry && idHashEntry.summary) {
        log("Cache hit by idHash during processing", { messageId: item.messageId });
        sendToTab(item.tabId, {
          type: "mailmind_summary_result",
          messageId: item.messageId,
          summary: idHashEntry.summary,
          source: "cache-id",
        });
        await sleep(QUEUE_DELAY_MS);
        continue;
      }
      const idEntry = idCache[item.messageId];
      if (idEntry && idEntry.summary && idEntry.bodyHash === item.bodyHash) {
        log("Cache hit by messageId during processing", item.messageId);
        sendToTab(item.tabId, {
          type: "mailmind_summary_result",
          messageId: item.messageId,
          summary: idEntry.summary,
          source: "cache",
        });
        await sleep(QUEUE_DELAY_MS);
        continue;
      }

      const summary = await callGroq(item.emailText);
      log("Final parsed summary", { messageId: item.messageId, length: summary.length });

      idCache[item.messageId] = { summary, bodyHash: item.bodyHash, ts: Date.now() };
      hashCache[item.bodyHash] = { summary, ts: Date.now(), messageId: item.messageId };
      // Store both header-id hash (if known) and gmail-id hash
      if (item.idHash) {
        idHashCache[item.idHash] = { summary, ts: Date.now(), messageId: item.messageId };
      }
      const gmailIdHash = await sha256(String(item.messageId || ""));
      idHashCache[gmailIdHash] = { summary, ts: Date.now(), messageId: item.messageId };
      await setCaches(idCache, hashCache, idHashCache);

      sendToTab(item.tabId, {
        type: "mailmind_summary_result",
        messageId: item.messageId,
        summary,
        source: "groq",
      });
    } catch (e) {
      log("Queue item failed", { key: item && item.key, error: e && e.message });
      sendToTab(item.tabId, {
        type: "mailmind_summary_error",
        messageId: item && item.messageId,
        error: (e && e.message) || String(e),
      });
    }
    await sleep(QUEUE_DELAY_MS);
  }
  processing = false;
  log("Queue processing ended.");
}

async function handleMultiSummarizeRequest(items, tabId) {
  log("Email IDs received for multi summarize", items);
  for (const it of items) {
    try {
      if (!it || !it.kind || !it.id) continue;
      if (it.kind === "message") {
        const key = `message:${it.id}`;
        if (enqueued.has(key)) {
          log("Duplicate prevented (message)", it.id);
          continue;
        }
        // Pre-check id-hash using Gmail internal id to allow single->multi reuse without Gmail fetch
        const preIdHashCheck = await checkCachedByIdHash(it.id);
        if (preIdHashCheck.cached) {
          log("Cache-id pre-hit (multi:message, gmailId)", { messageId: it.id });
          sendToTab(tabId, {
            type: "mailmind_summary_result",
            messageId: it.id,
            summary: preIdHashCheck.summary,
            source: "cache-id",
          });
          continue;
        }
        const msg = await fetchMessageById(it.id);
        // Prefer header Message-Id for id-hash caching
        const headerMessageId =
          getHeader(msg && msg.payload && msg.payload.headers, 'Message-Id') ||
          getHeader(msg && msg.payload && msg.payload.headers, 'Message-ID');
        const text = extractPlainTextFromMessage(msg);
        let idHashCheck = { cached: false, idHash: undefined };
        if (headerMessageId) {
          idHashCheck = await checkCachedByIdHash(headerMessageId);
          if (idHashCheck.cached) {
            // Backfill caches so future single/multi hits work without Gmail fetch
            const bodyHash = await sha256(text);
            const { idCache, hashCache, idHashCache } = await getCaches();
            idCache[it.id] = { summary: idHashCheck.summary, bodyHash, ts: Date.now() };
            hashCache[bodyHash] = { summary: idHashCheck.summary, ts: Date.now(), messageId: it.id };
            const gmailIdHash = await sha256(String(it.id || ""));
            idHashCache[gmailIdHash] = { summary: idHashCheck.summary, ts: Date.now(), messageId: it.id };
            await setCaches(idCache, hashCache, idHashCache);
            log("Backfilled caches from header-id hit (multi:message)", { messageId: it.id });
            sendToTab(tabId, {
              type: "mailmind_summary_result",
              messageId: it.id,
              summary: idHashCheck.summary,
              source: "cache-id",
            });
            continue;
          }
        }
        const cacheCheck = await ensureSummaryCached(it.id, text);
        if (cacheCheck.cached) {
          // If we have a header id but id-hash wasn't cached, persist it now
          if (headerMessageId && idHashCheck && idHashCheck.idHash && !idHashCheck.cached) {
            const { idCache, hashCache, idHashCache } = await getCaches();
            idHashCache[idHashCheck.idHash] = { summary: cacheCheck.summary, ts: Date.now(), messageId: it.id };
            await setCaches(idCache, hashCache, idHashCache);
          }
          sendToTab(tabId, {
            type: "mailmind_summary_result",
            messageId: it.id,
            summary: cacheCheck.summary,
            source: "cache",
          });
          continue;
        }
        const qItem = {
          key,
          messageId: it.id,
          bodyHash: cacheCheck.bodyHash,
          emailText: text,
          idHash: idHashCheck.idHash, // may be undefined if header id not found
          tabId,
        };
        queue.push(qItem);
        enqueued.add(key);
        log("Queue state changed: added", { key, size: queue.length });
      } else if (it.kind === "thread") {
        const t = await fetchThreadById(it.id);
        const messages = (t && t.messages) || [];
        if (!messages.length) continue;
        const last = messages[messages.length - 1];
        const msgId = last.id;
        const key = `message:${msgId}`;
        if (enqueued.has(key)) {
          log("Duplicate prevented (thread->message)", msgId);
          continue;
        }
        const headerMessageId =
          getHeader(last && last.payload && last.payload.headers, 'Message-Id') ||
          getHeader(last && last.payload && last.payload.headers, 'Message-ID');
        const text = extractPlainTextFromMessage(last);
        let idHashCheck = { cached: false, idHash: undefined };
        if (headerMessageId) {
          idHashCheck = await checkCachedByIdHash(headerMessageId);
          if (idHashCheck.cached) {
            const bodyHash = await sha256(text);
            const { idCache, hashCache, idHashCache } = await getCaches();
            idCache[msgId] = { summary: idHashCheck.summary, bodyHash, ts: Date.now() };
            hashCache[bodyHash] = { summary: idHashCheck.summary, ts: Date.now(), messageId: msgId };
            const gmailIdHash = await sha256(String(msgId || ""));
            idHashCache[gmailIdHash] = { summary: idHashCheck.summary, ts: Date.now(), messageId: msgId };
            await setCaches(idCache, hashCache, idHashCache);
            log("Backfilled caches from header-id hit (multi:thread)", { messageId: msgId });
            sendToTab(tabId, {
              type: "mailmind_summary_result",
              messageId: msgId,
              summary: idHashCheck.summary,
              source: "cache-id",
            });
            continue;
          }
        }
        const cacheCheck = await ensureSummaryCached(msgId, text);
        if (cacheCheck.cached) {
          if (headerMessageId && idHashCheck && idHashCheck.idHash && !idHashCheck.cached) {
            const { idCache, hashCache, idHashCache } = await getCaches();
            idHashCache[idHashCheck.idHash] = { summary: cacheCheck.summary, ts: Date.now(), messageId: msgId };
            await setCaches(idCache, hashCache, idHashCache);
          }
          sendToTab(tabId, {
            type: "mailmind_summary_result",
            messageId: msgId,
            summary: cacheCheck.summary,
            source: "cache",
          });
          continue;
        }
        const qItem = {
          key,
          messageId: msgId,
          bodyHash: cacheCheck.bodyHash,
          emailText: text,
          idHash: idHashCheck.idHash,
          tabId,
        };
        queue.push(qItem);
        enqueued.add(key);
        log("Queue state changed: added", { key, size: queue.length });
      }
    } catch (e) {
      log("Failed preparing item", it, e && e.message);
      sendToTab(tabId, {
        type: "mailmind_summary_error",
        messageId: it && it.id,
        error: (e && e.message) || String(e),
      });
    }
  }
  processQueue();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (msg && msg.type === "mailmind_multi_summarize_request") {
      const tabId = msg.tabId || (sender && sender.tab && sender.tab.id);
      handleMultiSummarizeRequest(Array.isArray(msg.items) ? msg.items : [], tabId);
      sendResponse({ ok: true });
      return true;
    }
    if (msg && msg.type === "mailmind_today_count") {
      (async () => {
        try {
          const n = await countTodayMessages();
          sendResponse({ ok: true, count: n });
        } catch (e) {
          sendResponse({ ok: false, error: (e && e.message) || String(e) });
        }
      })();
      return true;
    }
    if (msg && msg.type === "mailmind_single_summarize_request") {
      const tabId = msg.tabId || (sender && sender.tab && sender.tab.id);
      (async () => {
        try {
          const messageId = msg.messageId;
          const headerId = msg.headerId;
          // 1) Try ID-hash cache (prefer header Message-Id if available)
          if (headerId) {
            const idHashCheck = await checkCachedByIdHash(headerId);
            if (idHashCheck.cached) {
              log("Single summary: cache-id hit (header)", { headerId });
              sendToTab(tabId, { type: "mailmind_single_result", mode: "summary", summary: idHashCheck.summary, source: "cache-id" });
              sendResponse({ ok: true, cached: true });
              return;
            }
          } else if (messageId) {
            const idHashCheck = await checkCachedByIdHash(messageId);
            if (idHashCheck.cached) {
              log("Single summary: cache-id hit (gmailId)", { messageId });
              sendToTab(tabId, { type: "mailmind_single_result", mode: "summary", summary: idHashCheck.summary, source: "cache-id" });
              sendResponse({ ok: true, cached: true });
              return;
            }
          }
          // 2) Try body-hash cache
          const bodyText = msg.body || "";
          const bodyHash = await sha256(bodyText);
          {
            const { hashCache } = await getCaches();
            if (hashCache[bodyHash] && hashCache[bodyHash].summary) {
              log("Single summary: cache-body hit", { bodyHash });
              sendToTab(tabId, { type: "mailmind_single_result", mode: "summary", summary: hashCache[bodyHash].summary, source: "cache-body" });
              sendResponse({ ok: true, cached: true });
              return;
            }
          }
          // 3) Call Groq
          const summary = await callGroq(bodyText);
          log("Final parsed summary (single)", { length: summary.length });
          // Store in caches: body-hash always; id-hash if we have id
          const { idCache, hashCache, idHashCache } = await getCaches();
          hashCache[bodyHash] = { summary, ts: Date.now(), messageId: messageId || null };
          const idBasis = headerId || messageId;
          if (idBasis) {
            const idHash = (await checkCachedByIdHash(idBasis)).idHash;
            idHashCache[idHash] = { summary, ts: Date.now(), messageId: messageId || null };
            log("Single summary: stored id-hash mapping", { idBasis });
          }
          await setCaches(idCache, hashCache, idHashCache);
          sendToTab(tabId, { type: "mailmind_single_result", mode: "summary", summary, source: "groq" });
          sendResponse({ ok: true });
        } catch (e) {
          sendToTab(tabId, { type: "mailmind_single_error", mode: "summary", error: (e && e.message) || String(e) });
          sendResponse({ ok: false, error: (e && e.message) || String(e) });
        }
      })();
      return true;
    }
    if (msg && msg.type === "mailmind_single_reply_request") {
      const tabId = msg.tabId || (sender && sender.tab && sender.tab.id);
      (async () => {
        try {
          const reply = await callGroqReply(msg.body || "");
          log("Final parsed reply (single)", { length: reply.length });
          sendToTab(tabId, { type: "mailmind_single_result", mode: "reply", summary: reply });
          sendResponse({ ok: true });
        } catch (e) {
          sendToTab(tabId, { type: "mailmind_single_error", mode: "reply", error: (e && e.message) || String(e) });
          sendResponse({ ok: false, error: (e && e.message) || String(e) });
        }
      })();
      return true;
    }
  } catch (e) {
    log("onMessage handler error", e && e.message);
  }
});

log("Service worker loaded");

