// popup.js
const toggle = document.getElementById('enabledToggle');
const rateStatus = document.getElementById('rateStatus');
const rateTime = document.getElementById('rateTime');
const rateFootnote = document.getElementById('rateFootnote');

// ── Load initial state ────────────────────────────────────────────────────

chrome.storage.sync.get({ enabled: true }, ({ enabled }) => {
  toggle.checked = enabled;
});

chrome.storage.local.get(['ratesTimestamp', 'exchangeRates'], ({ ratesTimestamp, exchangeRates }) => {
  updateRateUI(exchangeRates, ratesTimestamp);
});

chrome.runtime.sendMessage({ type: 'GET_EXCHANGE_RATES' }, () => {
  chrome.storage.local.get(['ratesTimestamp', 'exchangeRates'], ({ ratesTimestamp, exchangeRates }) => {
    updateRateUI(exchangeRates, ratesTimestamp);
  });
});

// ── Toggle ────────────────────────────────────────────────────────────────

toggle.addEventListener('change', () => {
  const enabled = toggle.checked;
  chrome.storage.sync.set({ enabled });

  // Notify active tab's content script
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'SET_ENABLED', enabled }).catch(() => {});
    }
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────

function updateRateUI(rates, timestamp) {
  if (rates) {
    rateStatus.textContent = '✓ Available';
    rateStatus.className = 'card-value ok';
    rateTime.textContent = timestamp ? timeAgo(timestamp) : '—';
    rateFootnote.textContent = `Rates fetched: ${formatTimestamp(timestamp)}`;
  } else {
    rateStatus.textContent = '✗ Unavailable';
    rateStatus.className = 'card-value error';
    rateTime.textContent = 'Never';
    rateFootnote.textContent = 'Rates fetched: —';
  }
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatTimestamp(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}
