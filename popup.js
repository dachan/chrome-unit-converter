// popup.js
const toggle = document.getElementById('enabledToggle');

if (!toggle) {
  console.warn('[Unit Converter] Popup toggle did not initialize as expected.');
} else {
  initPopup(toggle);
}

function initPopup(toggleEl) {
// ── Load initial state ────────────────────────────────────────────────────

chrome.storage.sync.get({ enabled: true }, ({ enabled }) => {
  toggleEl.checked = enabled;
});

chrome.storage.local.get(['ratesTimestamp'], ({ ratesTimestamp }) => {
  updateRateFootnote(ratesTimestamp);
});

chrome.runtime.sendMessage({ type: 'GET_EXCHANGE_RATES' }, () => {
  // Read and silence connection errors so popup doesn't show noisy runtime errors.
  void chrome.runtime.lastError;
  chrome.storage.local.get(['ratesTimestamp'], ({ ratesTimestamp }) => {
    updateRateFootnote(ratesTimestamp);
  });
});

// ── Toggle ────────────────────────────────────────────────────────────────

toggleEl.addEventListener('change', () => {
  const enabled = toggleEl.checked;
  chrome.storage.sync.set({ enabled });

  // Notify active tab's content script
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError) {
      return;
    }
    const tab = tabs && tabs[0];
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'SET_ENABLED', enabled }, () => {
        // Some pages cannot receive content-script messages (e.g. chrome:// URLs).
        void chrome.runtime.lastError;
      });
    }
  });
});
}

// ── Helpers ───────────────────────────────────────────────────────────────

function updateRateFootnote(timestamp) {
  const footnoteEl = document.getElementById('rateFootnote');
  if (!footnoteEl) return;
  footnoteEl.textContent = formatTimestamp(timestamp);
}

function formatTimestamp(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString([], {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
