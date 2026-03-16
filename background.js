// background.js — Service Worker
// Fetches & caches exchange rates from open.er-api.com (free, no key needed)

const EXCHANGE_RATE_URL = 'https://open.er-api.com/v6/latest/USD';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_EXCHANGE_RATES') {
    getExchangeRates().then(sendResponse);
    return true; // keep channel open for async
  }
});

async function getExchangeRates() {
  const todayKey = getDateKey();
  const { exchangeRates, ratesDate, ratesLastAttemptDate } = await chrome.storage.local.get([
    'exchangeRates',
    'ratesDate',
    'ratesLastAttemptDate',
  ]);

  // Use cached rates for the current date and avoid repeated network calls.
  if (exchangeRates && ratesDate === todayKey) {
    return { rates: exchangeRates, base: 'USD', cached: true };
  }

  // If we already tried today, don't hit the API again until tomorrow.
  if (ratesLastAttemptDate === todayKey) {
    return exchangeRates
      ? { rates: exchangeRates, base: 'USD', cached: true, stale: ratesDate !== todayKey }
      : { rates: null, base: 'USD' };
  }

  try {
    const response = await fetch(EXCHANGE_RATE_URL);
    const data = await response.json();

    if (data.result === 'success') {
      await chrome.storage.local.set({
        exchangeRates: data.rates,
        ratesTimestamp: Date.now(),
        ratesDate: todayKey,
        ratesLastAttemptDate: todayKey,
      });
      return { rates: data.rates, base: 'USD', cached: false };
    }
  } catch (err) {
    console.warn('[Unit Converter] Could not fetch exchange rates:', err.message);
  }

  await chrome.storage.local.set({ ratesLastAttemptDate: todayKey });

  // Return stale cache if available, otherwise null
  return exchangeRates
    ? { rates: exchangeRates, base: 'USD', cached: true, stale: true }
    : { rates: null, base: 'USD' };
}

function getDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
