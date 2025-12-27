const MM_NS = "data-mailmind";
let panel;

let mmSidebarHost;
let mmSidebar;
let mmState = {
  mode: null,
  selectedKey: null,
  selectedIds: [],
  openKey: null,
  cards: new Map(),
  minimized: false,
};

function ensureSidebar() {
  if (mmSidebarHost && document.body.contains(mmSidebarHost)) return mmSidebarHost;
  mmSidebarHost = document.createElement("div");
  mmSidebarHost.setAttribute(MM_NS, "sidebar-host");
  mmSidebarHost.style.position = "fixed";
  mmSidebarHost.style.top = "72px";
  mmSidebarHost.style.right = "16px";
  mmSidebarHost.style.zIndex = "2147483647";
  mmSidebarHost.style.width = "380px";
  mmSidebarHost.style.maxHeight = "70vh";
  mmSidebarHost.style.borderRadius = "18px";
  mmSidebarHost.style.overflow = "hidden";
  mmSidebarHost.style.boxShadow = "0 10px 30px rgba(0,0,0,0.18)";
  mmSidebarHost.style.transform = "translateX(24px)";
  mmSidebarHost.style.opacity = "0";
  mmSidebarHost.style.transition = "transform 260ms ease, opacity 260ms ease";
  const shadow = mmSidebarHost.attachShadow({ mode: "open" });
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <style>
      :host { all: initial; }
      .mm { backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); background: rgba(16,18,22,0.72); border: 1px solid rgba(255,255,255,0.12); color: #fff; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
      .header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02)); }
      .title { font-size: 14px; font-weight: 600; letter-spacing: .2px; }
      .actions { display: flex; gap: 6px; }
      .btn { appearance: none; border: 0; background: rgba(255,255,255,0.16); color: #fff; padding: 6px 8px; border-radius: 10px; cursor: pointer; font-size: 12px; transition: opacity .2s ease, background .2s ease; }
      .btn:hover { background: rgba(255,255,255,0.26); }
      .body { padding: 12px; overflow: auto; max-height: 58vh; }
      .card { backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); background: linear-gradient(180deg, rgba(22,26,34,0.75), rgba(18,21,28,0.55)); border: 1px solid rgba(255,255,255,0.10); border-radius: 16px; padding: 12px; color: #f5f7fa; font-size: 13px; line-height: 1.45; box-shadow: 0 6px 20px rgba(0,0,0,.20); }
      .card + .card { margin-top: 10px; }
      .card + .composer { margin-top: 10px; }
      .composer + .card { margin-top: 10px; }
      .composer + .composer { margin-top: 10px; }
      .muted { opacity: 0.85; }
      .spinner { width: 16px; height: 16px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.35); border-top-color: #fff; animation: spin .8s linear infinite; display: inline-block; vertical-align: middle; margin-right: 8px; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .composer { margin-top: 12px; margin-bottom: 8px; background: linear-gradient(180deg, rgba(22,26,34,0.65), rgba(18,21,28,0.50)); border: 1px solid rgba(255,255,255,0.10); border-radius: 16px; padding: 10px; overflow: hidden; }
      .textarea { width: 100%; min-height: 72px; resize: vertical; padding: 10px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.20); background: rgba(0,0,0,0.28); color: #fff; outline: none; font-family: inherit; font-size: 13px; box-sizing: border-box; }
      .cta { margin-top: 8px; display: flex; justify-content: flex-end; }
      .primary { background: rgba(120,170,255,0.35); }
      .primary:hover { background: rgba(120,170,255,0.50); }
      .hidden { display: none; }
      :host(.collapsed) .body { display: none; }
      .error { color: #ffd4d4; }
      .reply-actions { margin-top: 8px; display: flex; justify-content: flex-end; }
    </style>
    <div class="mm">
      <div class="header">
        <div class="title">MailMind</div>
        <div class="actions">
          <button class="btn" part="minimize">–</button>
          <button class="btn" part="close">✕</button>
        </div>
      </div>
      <div class="body"></div>
    </div>
  `;
  shadow.appendChild(wrap);
  document.body.appendChild(mmSidebarHost);
  mmSidebar = {
    setTitle(t) { shadow.querySelector('.title').textContent = t || 'MailMind'; },
    bodyEl: shadow.querySelector('.body'),
    root: mmSidebarHost,
    shadow,
  };
  const btnMin = shadow.querySelector('button[part="minimize"]');
  const btnClose = shadow.querySelector('button[part="close"]');
  btnMin.addEventListener('click', () => {
    mmState.minimized = !mmState.minimized;
    if (mmState.minimized) mmSidebarHost.classList.add('collapsed'); else mmSidebarHost.classList.remove('collapsed');
  });
  btnClose.addEventListener('click', () => {
    resetSidebar();
  });
  requestAnimationFrame(() => {
    mmSidebarHost.style.transform = "translateX(0)";
    mmSidebarHost.style.opacity = "1";
  });
  return mmSidebarHost;
}

function resetSidebar() {
  mmState.mode = null;
  mmState.selectedKey = null;
  mmState.selectedIds = [];
  mmState.openKey = null;
  mmState.cards.clear();
  if (mmSidebar && mmSidebar.bodyEl) mmSidebar.bodyEl.innerHTML = "";
  if (mmSidebarHost && document.body.contains(mmSidebarHost)) {
    mmSidebarHost.style.transform = "translateX(24px)";
    mmSidebarHost.style.opacity = "0";
    setTimeout(() => mmSidebarHost && mmSidebarHost.remove(), 220);
  }
  mmSidebarHost = null;
  mmSidebar = null;
}

function ensureCard(id) {
  ensureSidebar();
  if (mmState.cards.has(id)) return mmState.cards.get(id);
  const card = document.createElement('div');
  card.className = 'card';
  card.setAttribute(MM_NS, 'card');
  card.dataset.id = id;
  card.innerHTML = `<span class="spinner"></span><span class="muted">Summarizing…</span>`;
  mmSidebar.bodyEl.appendChild(card);
  mmState.cards.set(id, card);
  return card;
}

function setCardContent(id, html) {
  const el = ensureCard(id);
  el.innerHTML = html;
}

function setCardError(id, text) {
  const el = ensureCard(id);
  el.innerHTML = `<div class="error">${escapeHtml(text)}</div>`;
}

function ensureComposer() {
  ensureSidebar();
  let el = mmSidebar.shadow.querySelector('[data-composer="1"]');
  if (el) return el;
  el = document.createElement('div');
  el.className = 'composer';
  el.setAttribute('data-composer', '1');
  el.innerHTML = `
    <textarea class="textarea" placeholder="Write how you want to reply (tone, intent, custom message)"></textarea>
    <div class="cta"><button class="btn primary" part="draft">Draft Reply</button></div>
    <div class="reply-actions hidden" part="reply-actions"><button class="btn primary" part="insert">Insert into Reply Box</button></div>
  `;
  mmSidebar.bodyEl.appendChild(el);
  const draftBtn = el.querySelector('button[part="draft"]');
  const insertBtn = el.querySelector('button[part="insert"]');
  draftBtn.addEventListener('click', () => {
    const { text } = getOpenEmailInfo();
    if (!text) return;
    const instr = el.querySelector('.textarea').value || '';
    draftBtn.disabled = true;
    setCardContent('single-reply', `<span class="spinner"></span><span class="muted">Drafting reply…</span>`);
    chrome.runtime.sendMessage({ type: 'mailmind_single_reply_request', body: instr ? `${text}\n\nReply guidance: ${instr}` : text });
  });
  insertBtn.addEventListener('click', () => {
    const replyCard = mmState.cards.get('single-reply');
    const reply = replyCard ? replyCard.textContent : '';
    if (reply) insertReplyIntoGmail(reply.trim());
  });
  return el;
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"]+/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function ensurePanel() { return ensureSidebar(); }

function addLine(text, id) { setCardContent(id || `msg-${Date.now()}`, escapeHtml(text)); }

function collectSelectedItems() {
  const items = [];
  const seen = new Set();
  const rows = Array.from(document.querySelectorAll('tr.zA'));
  for (const row of rows) {
    const selected = row.getAttribute('aria-selected') === 'true' || !!row.querySelector('div[role="checkbox"][aria-checked="true"]');
    if (!selected) continue;
    // Extract both Gmail internal message id (legacy) and header id if available
    let headerId = row.getAttribute('data-message-id');
    if (!headerId) {
      const msgA = row.querySelector('[data-message-id]');
      if (msgA) headerId = msgA.getAttribute('data-message-id');
    }
    let gmailId = row.getAttribute('data-legacy-message-id');
    if (!gmailId) {
      const msgSpan = row.querySelector('span[data-legacy-message-id]');
      if (msgSpan) gmailId = msgSpan.getAttribute('data-legacy-message-id');
    }
    if (gmailId && !seen.has('m:'+gmailId)) {
      items.push({ kind: 'message', id: gmailId });
      seen.add('m:'+gmailId);
      continue;
    }
    let threadId = row.getAttribute('data-legacy-thread-id') || row.getAttribute('data-thread-id');
    if (!threadId) {
      const th = row.querySelector('[data-legacy-thread-id],[data-thread-id]');
      if (th) threadId = th.getAttribute('data-legacy-thread-id') || th.getAttribute('data-thread-id');
    }
    if (threadId && !seen.has('t:'+threadId)) {
      items.push({ kind: 'thread', id: threadId });
      seen.add('t:'+threadId);
    }
  }
  if (items.length === 0) {
    const rows2 = Array.from(document.querySelectorAll('div[role="row"]'));
    for (const r of rows2) {
      const selected = !!r.querySelector('div[role="checkbox"][aria-checked="true"]');
      if (!selected) continue;
      let headerId = r.getAttribute('data-message-id') || (r.querySelector('[data-message-id]') && r.querySelector('[data-message-id]').getAttribute('data-message-id')) || null;
      let gmailId = r.getAttribute('data-legacy-message-id') || (r.querySelector('[data-legacy-message-id]') && r.querySelector('[data-legacy-message-id]').getAttribute('data-legacy-message-id')) || null;
      if (gmailId && !seen.has('m:'+gmailId)) {
        items.push({ kind: 'message', id: gmailId });
        seen.add('m:'+gmailId);
        continue;
      }
      let threadId = r.getAttribute('data-legacy-thread-id') || r.getAttribute('data-thread-id');
      if (!threadId) {
        const th = r.querySelector('[data-legacy-thread-id],[data-thread-id]');
        if (th) threadId = th.getAttribute('data-legacy-thread-id') || th.getAttribute('data-thread-id');
      }
      if (threadId && !seen.has('t:'+threadId)) {
        items.push({ kind: 'thread', id: threadId });
        seen.add('t:'+threadId);
      }
    }
  }
  return items;
}

function getOpenEmailInfo() {
  const bodies = Array.from(document.querySelectorAll('.a3s'));
  const visible = bodies.filter((el) => el.offsetParent !== null);
  const node = visible[visible.length - 1] || bodies[bodies.length - 1];
  if (!node) return { text: "", messageId: null, headerId: null };
  const clone = node.cloneNode(true);
  clone.querySelectorAll('script,style,noscript').forEach((n) => n.remove());
  const text = (clone.innerText || "").trim();
  // Try to locate the message-id near/around this body node
  let messageId = null;
  let headerId = null;
  let cur = node;
  for (let i = 0; cur && i < 6; i++) {
    if (cur.getAttribute) {
      headerId = headerId || cur.getAttribute('data-message-id');
      messageId = messageId || cur.getAttribute('data-legacy-message-id');
      if (messageId) break;
      const found = cur.querySelector && (cur.querySelector('[data-message-id]') || cur.querySelector('[data-legacy-message-id]'));
      if (found) {
        headerId = headerId || found.getAttribute('data-message-id');
        messageId = messageId || found.getAttribute('data-legacy-message-id');
        if (messageId) break;
      }
    }
    cur = cur.parentElement;
  }
  if (!messageId) {
    const any = document.querySelector('[data-message-id],[data-legacy-message-id]');
    if (any) {
      headerId = headerId || any.getAttribute('data-message-id');
      messageId = messageId || any.getAttribute('data-legacy-message-id');
    }
  }
  return { text, messageId, headerId };
}

const checkContext = debounce(() => {
  try {
    const items = collectSelectedItems();
    const selectedIds = items.map((i) => i.id);
    const selectedKey = selectedIds.slice().sort().join(',');
    const open = getOpenEmailInfo();
    const isOpen = !!open.text;

    if (selectedIds.length >= 2) {
      if (mmState.mode !== 'multi' || mmState.selectedKey !== selectedKey) {
        ensureSidebar();
        mmSidebar.setTitle('Selected Email Summaries');
        mmSidebar.bodyEl.innerHTML = '';
        mmState.cards.clear();
        mmState.mode = 'multi';
        mmState.selectedKey = selectedKey;
        mmState.selectedIds = selectedIds;
        const btnCloseM = mmSidebar.shadow && mmSidebar.shadow.querySelector('button[part="close"]');
        if (btnCloseM) btnCloseM.classList.add('hidden');
        for (const it of items) ensureCard(it.id);
        chrome.runtime.sendMessage({ type: 'mailmind_multi_summarize_request', items });
      }
      return;
    }

    if (isOpen) {
      const openKey = open.headerId || open.messageId || (open.text.slice(0, 48) + ':' + open.text.length);
      if (mmState.mode !== 'single' || mmState.openKey !== openKey) {
        ensureSidebar();
        mmSidebar.setTitle('Email Summary');
        mmSidebar.bodyEl.innerHTML = '';
        mmState.cards.clear();
        mmState.mode = 'single';
        mmState.openKey = openKey;
        const btnCloseS = mmSidebar.shadow && mmSidebar.shadow.querySelector('button[part="close"]');
        if (btnCloseS) btnCloseS.classList.remove('hidden');
        ensureCard('single-summary');
        ensureComposer();
        chrome.runtime.sendMessage({ type: 'mailmind_single_summarize_request', body: open.text, messageId: open.messageId, headerId: open.headerId });
      }
      return;
    }

    if (mmState.mode) resetSidebar();
  } catch (e) {}
}, 400);

function initObservers() {
  const mo = new MutationObserver(() => checkContext());
  mo.observe(document.documentElement || document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-checked","aria-selected","data-legacy-thread-id","data-legacy-message-id","data-message-id"] });
  window.addEventListener('hashchange', () => checkContext());
  window.addEventListener('popstate', () => checkContext());
  setInterval(() => checkContext(), 2500);
  checkContext();
}

function insertReplyIntoGmail(text) {
  function findEditor() {
    const editors = Array.from(document.querySelectorAll('div[aria-label="Message Body"], div[aria-label="Reply"][contenteditable="true"], div.editable[contenteditable="true"]'));
    return editors.find((el) => el.offsetParent !== null) || null;
  }
  let editor = findEditor();
  if (!editor) {
    const replyBtn = document.querySelector('div[role="button"][data-tooltip*="Reply"], div[aria-label="Reply"], span[role="link"][data-tooltip*="Reply"]');
    if (replyBtn) replyBtn.click();
    setTimeout(() => {
      const ed = findEditor();
      if (ed) {
        ed.focus();
        document.execCommand('insertText', false, text);
      }
    }, 400);
  } else {
    editor.focus();
    document.execCommand('insertText', false, text);
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'mailmind_popup_action') {
    if (msg.action === 'multi') {
      const items = collectSelectedItems();
      if (!items.length) return;
      ensureSidebar();
      mmSidebar.setTitle('Selected Email Summaries');
      mmSidebar.bodyEl.innerHTML = '';
      mmState.cards.clear();
      for (const it of items) ensureCard(it.id);
      chrome.runtime.sendMessage({ type: 'mailmind_multi_summarize_request', items });
    } else if (msg.action === 'single') {
      const { text, messageId, headerId } = getOpenEmailInfo();
      if (!text) return;
      ensureSidebar();
      mmSidebar.setTitle('Email Summary');
      mmSidebar.bodyEl.innerHTML = '';
      mmState.cards.clear();
      ensureCard('single-summary');
      ensureComposer();
      chrome.runtime.sendMessage({ type: 'mailmind_single_summarize_request', body: text, messageId, headerId });
    } else if (msg.action === 'reply') {
      const { text } = getOpenEmailInfo();
      if (!text) return;
      ensureSidebar();
      ensureComposer();
      setCardContent('single-reply', `<span class="spinner"></span><span class="muted">Drafting reply…</span>`);
      chrome.runtime.sendMessage({ type: 'mailmind_single_reply_request', body: text });
    }
  } else if (msg.type === 'mailmind_summary_result') {
    if (mmState.mode === 'multi') {
      setCardContent(msg.messageId || `msg-${Date.now()}`, escapeHtml(msg.summary));
    }
  } else if (msg.type === 'mailmind_summary_error') {
    if (mmState.mode === 'multi') {
      setCardError(msg.messageId || `msg-${Date.now()}`, `Error: ${msg.error}`);
    }
  } else if (msg.type === 'mailmind_single_result') {
    if (msg.mode === 'reply') {
      setCardContent('single-reply', escapeHtml(msg.summary));
      const ra = mmSidebar && mmSidebar.shadow && mmSidebar.shadow.querySelector('[part="reply-actions"]');
      const draftBtn = mmSidebar && mmSidebar.shadow && mmSidebar.shadow.querySelector('button[part="draft"]');
      if (draftBtn) draftBtn.disabled = false;
      if (ra) ra.classList.remove('hidden');
    } else {
      setCardContent('single-summary', escapeHtml(msg.summary));
    }
  } else if (msg.type === 'mailmind_single_error') {
    if (msg.mode === 'reply') {
      setCardError('single-reply', msg.error);
      const draftBtn = mmSidebar && mmSidebar.shadow && mmSidebar.shadow.querySelector('button[part="draft"]');
      if (draftBtn) draftBtn.disabled = false;
    } else {
      setCardError('single-summary', msg.error);
    }
  }
});

initObservers();

