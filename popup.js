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

  const btn = document.getElementById('export-metrics');
  if (btn) {
    btn.addEventListener('click', () => {
      setStatus('Exporting metrics…');
      chrome.runtime.sendMessage({ type: 'mailmind_export_metrics' }, (res) => {
        if (!res || res.ok === false) {
          setStatus((res && res.error) ? String(res.error) : 'Export failed');
          return;
        }
        setStatus(`Exported ${res.count} records`);
      });
    });
  }
});

