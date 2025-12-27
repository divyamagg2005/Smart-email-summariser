function setStatus(text) {
  const s = document.getElementById('status');
  if (s) s.textContent = text || '';
}

function setCount(n) {
  const el = document.getElementById('count');
  if (el) el.textContent = (typeof n === 'number') ? String(n) : '—';
}

document.addEventListener('DOMContentLoaded', () => {
  setStatus('Fetching…');
  chrome.runtime.sendMessage({ type: 'mailmind_today_count' }, (res) => {
    if (!res || res.ok === false) {
      setStatus((res && res.error) ? String(res.error) : 'Could not load today count');
      return;
    }
    setCount(res.count);
    setStatus('');
  });
});

