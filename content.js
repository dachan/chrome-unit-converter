// content.js — Unit detection, highlighting, and conversion popover

(function () {
  'use strict';

  if (window.__unitConverterLoaded) return;
  window.__unitConverterLoaded = true;

  // ─── State ────────────────────────────────────────────────────────────────

  let exchangeRates = null;
  let enabled = true;
  let booted = false;
  let popover = null;
  let hideTimer = null;
  let flushTimer = null;
  const pendingNodes = [];

  // ─── Boot ─────────────────────────────────────────────────────────────────

  Promise.all([fetchExchangeRates(), loadSettings()]).then(([rates, settings]) => {
    exchangeRates = rates;
    enabled = settings.enabled !== false;
    if (enabled) boot();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SET_ENABLED') {
      enabled = msg.enabled;
      enabled ? boot() : teardown();
    }
  });

  function fetchExchangeRates() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_EXCHANGE_RATES' }, (res) => {
        resolve(res && res.rates ? res.rates : null);
      });
    });
  }

  function loadSettings() {
    return new Promise((resolve) => chrome.storage.sync.get({ enabled: true }, resolve));
  }

  // ─── Formatters ───────────────────────────────────────────────────────────

  function fmt(n) {
    const abs = Math.abs(n);
    if (abs === 0) return '0';
    if (abs >= 10000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (abs >= 100) return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
    if (abs >= 1) return n.toFixed(2);
    if (abs >= 0.01) return n.toFixed(4);
    return n.toExponential(2);
  }

  function fmtCurrency(n) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function parseNum(s) {
    const t = s.replace(/,/g, '').trim();
    return /[kK]$/.test(t) ? parseFloat(t) * 1000 : parseFloat(t);
  }

  // ─── Conversions ──────────────────────────────────────────────────────────

  function convertTemp(value, unit) {
    unit = unit.toUpperCase();
    if (unit === 'F') {
      const c = (value - 32) * 5 / 9;
      return [{ label: '°C', value: fmt(c) }, { label: 'K', value: fmt(c + 273.15) }];
    }
    if (unit === 'C') {
      const f = value * 9 / 5 + 32;
      return [{ label: '°F', value: fmt(f) }, { label: 'K', value: fmt(value + 273.15) }];
    }
    const c = value - 273.15;
    return [{ label: '°C', value: fmt(c) }, { label: '°F', value: fmt(c * 9 / 5 + 32) }];
  }

  const LENGTH_TO_M = {
    km: 1000, kilometer: 1000, kilometers: 1000,
    m: 1, meter: 1, meters: 1,
    cm: 0.01, centimeter: 0.01, centimeters: 0.01,
    mm: 0.001, millimeter: 0.001, millimeters: 0.001,
    mile: 1609.344, miles: 1609.344, mi: 1609.344,
    foot: 0.3048, feet: 0.3048, ft: 0.3048,
    inch: 0.0254, inches: 0.0254,
    yard: 0.9144, yards: 0.9144, yd: 0.9144,
  };
  const METRIC_LENGTH = new Set(['km', 'kilometer', 'kilometers', 'm', 'meter', 'meters', 'cm', 'centimeter', 'centimeters', 'mm', 'millimeter', 'millimeters']);

  function convertLength(value, unit) {
    const key = unit.toLowerCase();
    const m = value * (LENGTH_TO_M[key] || 1);
    if (METRIC_LENGTH.has(key)) {
      const results = [];
      if (m >= 500) results.push({ label: 'mi', value: fmt(m / 1609.344) });
      results.push({ label: 'ft', value: fmt(m / 0.3048) });
      if (m < 0.3) results.push({ label: 'in', value: fmt(m / 0.0254) });
      return results.length ? results : [{ label: 'mi', value: fmt(m / 1609.344) }, { label: 'ft', value: fmt(m / 0.3048) }];
    }
    if (m >= 500) return [{ label: 'km', value: fmt(m / 1000) }, { label: 'm', value: fmt(m) }];
    if (m >= 1) return [{ label: 'm', value: fmt(m) }, { label: 'cm', value: fmt(m * 100) }];
    return [{ label: 'cm', value: fmt(m * 100) }, { label: 'mm', value: fmt(m * 1000) }];
  }

  const WEIGHT_TO_KG = {
    kg: 1, kilogram: 1, kilograms: 1,
    g: 0.001, gram: 0.001, grams: 0.001,
    lb: 0.453592, lbs: 0.453592, pound: 0.453592, pounds: 0.453592,
    oz: 0.0283495, ounce: 0.0283495, ounces: 0.0283495,
    tonne: 1000, tonnes: 1000,
    ton: 907.185, tons: 907.185,
  };
  const METRIC_WEIGHT = new Set(['kg', 'kilogram', 'kilograms', 'g', 'gram', 'grams', 'tonne', 'tonnes']);

  function convertWeight(value, unit) {
    const key = unit.toLowerCase();
    const kg = value * (WEIGHT_TO_KG[key] || 1);
    if (METRIC_WEIGHT.has(key)) {
      return [{ label: 'lb', value: fmt(kg / 0.453592) }, { label: 'oz', value: fmt(kg / 0.0283495) }];
    }
    return [{ label: 'kg', value: fmt(kg) }, { label: 'g', value: fmt(kg * 1000) }];
  }

  const VOLUME_TO_L = {
    l: 1, liter: 1, litre: 1, liters: 1, litres: 1,
    ml: 0.001, milliliter: 0.001, millilitre: 0.001, milliliters: 0.001, millilitres: 0.001,
    gal: 3.78541, gallon: 3.78541, gallons: 3.78541,
    qt: 0.946353, quart: 0.946353, quarts: 0.946353,
    pt: 0.473176, pint: 0.473176, pints: 0.473176,
    floz: 0.0295735,
  };
  const METRIC_VOLUME = new Set(['l', 'liter', 'litre', 'liters', 'litres', 'ml', 'milliliter', 'millilitre', 'milliliters', 'millilitres']);

  function convertVolume(value, unit) {
    const key = unit.toLowerCase().replace(/[\s.]/g, '').replace('fluidounces', 'floz').replace('fluidounce', 'floz');
    const liters = value * (VOLUME_TO_L[key] || 1);
    if (METRIC_VOLUME.has(key)) {
      return [{ label: 'gal', value: fmt(liters / 3.78541) }, { label: 'fl oz', value: fmt(liters / 0.0295735) }];
    }
    return [{ label: 'L', value: fmt(liters) }, { label: 'mL', value: fmt(liters * 1000) }];
  }

  const SPEED_TO_MPS = {
    mph: 0.44704, milesperhour: 0.44704,
    kph: 1 / 3.6, 'km/h': 1 / 3.6, kilometersperhour: 1 / 3.6,
    'm/s': 1, meterspersecond: 1,
  };

  function convertSpeed(value, unit) {
    const key = unit.toLowerCase().replace(/\s+/g, '');
    const mps = value * (SPEED_TO_MPS[key] || 1);
    if (key === 'mph' || key === 'milesperhour') {
      return [{ label: 'km/h', value: fmt(mps * 3.6) }, { label: 'm/s', value: fmt(mps) }];
    }
    if (key === 'kph' || key === 'km/h' || key === 'kilometersperhour') {
      return [{ label: 'mph', value: fmt(mps / 0.44704) }, { label: 'm/s', value: fmt(mps) }];
    }
    return [{ label: 'mph', value: fmt(mps / 0.44704) }, { label: 'km/h', value: fmt(mps * 3.6) }];
  }

  const AREA_TO_SQM = {
    squaremeter: 1, squaremeters: 1, sqm: 1,
    squarekilometer: 1e6, squarekilometers: 1e6, sqkm: 1e6,
    squarefoot: 0.092903, squarefeet: 0.092903, sqft: 0.092903,
    squaremile: 2589988.11, squaremiles: 2589988.11, sqmi: 2589988.11,
    squareyard: 0.836127, squareyards: 0.836127, sqyd: 0.836127,
    acre: 4046.86, acres: 4046.86,
    hectare: 10000, hectares: 10000, ha: 10000,
    'm²': 1, 'km²': 1e6, 'cm²': 0.0001, 'mm²': 0.000001,
    'ft²': 0.092903, 'mi²': 2589988.11, 'yd²': 0.836127,
  };
  const METRIC_AREA = new Set(['sqm', 'squaremeter', 'squaremeters', 'sqkm', 'squarekilometer', 'squarekilometers', 'ha', 'hectare', 'hectares', 'm²', 'km²', 'cm²', 'mm²']);

  function convertArea(value, unit) {
    const key = /²/.test(unit) ? unit.toLowerCase() : unit.toLowerCase().replace(/\s+/g, '').replace('squareft', 'sqft');
    const sqm = value * (AREA_TO_SQM[key] || 1);
    if (METRIC_AREA.has(key)) {
      return [{ label: 'sq ft', value: fmt(sqm / 0.092903) }, { label: 'acres', value: fmt(sqm / 4046.86) }];
    }
    return [{ label: 'sq m', value: fmt(sqm) }, { label: 'ha', value: fmt(sqm / 10000) }];
  }

  // ─── Currency ─────────────────────────────────────────────────────────────

  const SYMBOL_TO_CODE = {
    'C$': 'CAD', 'A$': 'AUD', 'HK$': 'HKD', 'NZ$': 'NZD', 'S$': 'SGD',
    '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR',
    '₩': 'KRW', '₽': 'RUB', '₪': 'ILS', '₺': 'TRY', '฿': 'THB',
    '₴': 'UAH', '₦': 'NGN',
  };

  const CODE_TO_SYMBOL = {
    USD: '$', CAD: 'C$', AUD: 'A$', HKD: 'HK$', NZD: 'NZ$', SGD: 'S$',
    EUR: '€', GBP: '£', JPY: '¥', INR: '₹', KRW: '₩', RUB: '₽',
    ILS: '₪', TRY: '₺', THB: '฿', UAH: '₴', NGN: '₦',
  };

  function buildCurrencyConversions(value, fromCode) {
    if (!exchangeRates) return [{ label: '', value: 'Rates unavailable — check connection' }];
    const usdVal = value / (exchangeRates[fromCode] || 1);
    const targets = ['USD', 'CAD', 'EUR', 'GBP', 'JPY'].filter((c) => c !== fromCode).slice(0, 3);
    return targets.map((code) => ({
      label: code,
      value: (CODE_TO_SYMBOL[code] || '') + fmtCurrency(usdVal * (exchangeRates[code] || 1)),
    }));
  }

  const NEARBY_CODE_RE = /\b(USD|EUR|GBP|JPY|CAD|AUD|CHF|CNY|INR|KRW|BRL|MXN|SEK|NOK|DKK|NZD|SGD|HKD|TRY|RUB|ZAR|SAR|AED|PLN|THB|IDR|MYR|PHP|CZK|ILS)\b/;

  function getNearbyCode(el) {
    if (!el) return null;
    const parent = el.parentElement;
    if (!parent) return null;
    // Check siblings of el, then siblings of el's parent
    const candidates = [...parent.children];
    if (parent.parentElement) candidates.push(...parent.parentElement.children);
    for (const node of candidates) {
      if (node === el || node === parent) continue;
      const m = node.textContent?.trim().match(NEARBY_CODE_RE);
      if (m) return m[1];
    }
    return null;
  }

  function convertCurrencySymbol(value, symbol, contextEl) {
    const nearby = getNearbyCode(contextEl);
    return buildCurrencyConversions(value, nearby || SYMBOL_TO_CODE[symbol] || 'USD');
  }

  function convertCurrencyCode(value, code) {
    return buildCurrencyConversions(value, code.toUpperCase());
  }

  // ─── Date / Time ──────────────────────────────────────────────────────────

  const MONTH_NAMES = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
    apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
    aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
    nov: 10, november: 10, dec: 11, december: 11,
  };

  const TZ_OFFSETS = {
    UTC: 0, GMT: 0,
    EST: -300, EDT: -240, CST: -360, CDT: -300,
    MST: -420, MDT: -360, PST: -480, PDT: -420,
    IST: 330, JST: 540, CET: 60, CEST: 120, AEST: 600, AEDT: 660,
  };

  const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const LOCAL_DTF = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });

  function relativeTime(date) {
    const diff = date.getTime() - Date.now();
    const abs = Math.abs(diff);
    if (abs < 45000) return 'just now';
    if (abs < 2700000) return RTF.format(Math.round(diff / 60000), 'minute');
    if (abs < 79200000) return RTF.format(Math.round(diff / 3600000), 'hour');
    if (abs < 2505600000) return RTF.format(Math.round(diff / 86400000), 'day');
    if (abs < 31536000000) return RTF.format(Math.round(diff / (30 * 86400000)), 'month');
    return RTF.format(Math.round(diff / (365.25 * 86400000)), 'year');
  }

  function convertDatetime(date, dateOnly = false) {
    if (isNaN(date.getTime())) return [{ label: '', value: 'Invalid date' }];
    const results = [{ label: 'relative', value: relativeTime(date) }];
    if (!dateOnly) results.push({ label: 'local', value: LOCAL_DTF.format(date) });
    return results;
  }

  function parseWrittenDate(m) {
    const month = MONTH_NAMES[m[1].toLowerCase()];
    const day = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    if (m[4] !== undefined) {
      let hour = parseInt(m[4], 10);
      const min = parseInt(m[5], 10);
      if (m[6] && m[6].toLowerCase() === 'pm' && hour < 12) hour += 12;
      if (m[6] && m[6].toLowerCase() === 'am' && hour === 12) hour = 0;
      if (m[7]) {
        const offset = TZ_OFFSETS[m[7].toUpperCase()];
        if (offset !== undefined) {
          return convertDatetime(new Date(Date.UTC(year, month, day, hour, min) - offset * 60000));
        }
      }
      return convertDatetime(new Date(year, month, day, hour, min));
    }
    return convertDatetime(new Date(year, month, day, 12, 0), true);
  }

  const RELATIVE_UNIT_MS = {
    second: 1000, seconds: 1000, sec: 1000, secs: 1000,
    minute: 60000, minutes: 60000, min: 60000, mins: 60000,
    hour: 3600000, hours: 3600000, hr: 3600000, hrs: 3600000, h: 3600000,
    day: 86400000, days: 86400000, d: 86400000,
    week: 604800000, weeks: 604800000, wk: 604800000, wks: 604800000, w: 604800000,
    month: 2592000000, months: 2592000000, mo: 2592000000, mos: 2592000000, m: 2592000000,
  };

  function convertRelativeTime(m) {
    const full = m[0];
    const isPast = /ago\b/i.test(full);
    const durationStr = m[1] || m[3];
    let totalMs = 0;
    const re = /(\d+)\s*(weeks?|wks?|w|months?|mos?|days?|d|hours?|hr?s?|h|minutes?|mins?|seconds?|secs?|m)/gi;
    let part;
    while ((part = re.exec(durationStr)) !== null) {
      totalMs += parseInt(part[1], 10) * (RELATIVE_UNIT_MS[part[2].toLowerCase()] || 0);
    }
    if (!totalMs) return [{ label: '', value: 'Could not parse' }];
    return convertDatetime(new Date(Date.now() + (isPast ? -totalMs : totalMs)));
  }

  function parseTZTime(m) {
    let hour = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (m[3] && m[3].toLowerCase() === 'pm' && hour < 12) hour += 12;
    if (m[3] && m[3].toLowerCase() === 'am' && hour === 12) hour = 0;
    const offset = TZ_OFFSETS[m[4].toUpperCase()] ?? 0;
    const now = new Date();
    return convertDatetime(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), hour, min) - offset * 60000));
  }

  // ─── Patterns ─────────────────────────────────────────────────────────────

  const _CODES = 'USD|EUR|GBP|JPY|CAD|AUD|CHF|CNY|INR|KRW|BRL|MXN|SEK|NOK|DKK|NZD|SGD|HKD|TRY|RUB|ZAR|SAR|AED|PLN|THB|IDR|MYR|PHP|CZK|ILS';
  const _SYMS = 'C\\$|A\\$|HK\\$|NZ\\$|S\\$|\\$|€|£|¥|₹|₩|₽|₪|₺|฿|₴|₦';
  const _NUM = '[\\d,]+(?:\\.\\d+)?(?:\\s*[kK])?';

  const PATTERNS = [
    // Temperature: 72°F, -10°C, 300K
    {
      regex: /([-+]?\d+(?:\.\d+)?)\s*°\s*([CFKcfk])\b/g,
      type: 'temperature', label: 'Temperature', icon: '🌡',
      convert: (m) => convertTemp(parseFloat(m[1]), m[2]),
    },
    // Temperature spelled out: 72 degrees Fahrenheit
    {
      regex: /([-+]?\d+(?:\.\d+)?)\s+degrees?\s+(fahrenheit|celsius|kelvin)\b/gi,
      type: 'temperature', label: 'Temperature', icon: '🌡',
      convert: (m) => convertTemp(parseFloat(m[1]), m[2][0]),
    },
    // Weight
    {
      regex: /\b([\d,]+(?:\.\d+)?(?:\s*[kK])?)\s*(kilograms?|kg|pounds?|lbs?|ounces?|oz|grams?|tonnes?|tons?)\b/gi,
      type: 'weight', label: 'Weight', icon: '⚖',
      convert: (m) => convertWeight(parseNum(m[1]), m[2]),
    },
    // Length
    {
      regex: /\b([\d,]+(?:\.\d+)?(?:\s*[kK])?)\s*(kilometers?|km|miles?|centimeters?|cm|millimeters?|mm|meters?|feet|foot|ft|inches|yards?|yd)\b/gi,
      type: 'length', label: 'Length', icon: '📏',
      convert: (m) => convertLength(parseNum(m[1]), m[2]),
    },
    // Volume
    {
      regex: /\b([\d,]+(?:\.\d+)?(?:\s*[kK])?)\s*(liters?|litres?|milliliters?|millilitres?|ml|gallons?|gal|quarts?|qt|pints?|(?:fl\.?\s*oz|fluid\s+ounces?))\b/gi,
      type: 'volume', label: 'Volume', icon: '🧪',
      convert: (m) => convertVolume(parseNum(m[1]), m[2]),
    },
    // Speed
    {
      regex: /\b([\d,]+(?:\.\d+)?(?:\s*[kK])?)\s*(mph|kph|km\/h|m\/s)\b/gi,
      type: 'speed', label: 'Speed', icon: '🚀',
      convert: (m) => convertSpeed(parseNum(m[1]), m[2]),
    },
    // Area — spelled out
    {
      regex: /\b([\d,]+(?:\.\d+)?(?:\s*[kK])?)\s*(sq(?:uare)?\s*(?:feet|foot|ft|meters?|km|miles?|yards?)|acres?|hectares?|ha)\b/gi,
      type: 'area', label: 'Area', icon: '📐',
      convert: (m) => convertArea(parseNum(m[1]), m[2]),
    },
    // Area — superscript notation (m², km², ft² …)
    {
      regex: /([\d,]+(?:\.\d+)?)\s*(km²|cm²|mm²|mi²|yd²|ft²|m²)/g,
      type: 'area', label: 'Area', icon: '📐',
      convert: (m) => convertArea(parseFloat(m[1].replace(/,/g, '')), m[2]),
    },
    // ISO datetime: 2024-03-15T14:30:00Z
    {
      regex: /\b(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:Z|[+-]\d{2}:?\d{2}))\b/g,
      type: 'datetime', label: 'Date & Time', icon: '🕐',
      convert: (m) => convertDatetime(new Date(m[1])),
    },
    // Written date: March 15, 2024 [at 2:30 PM EST]
    {
      regex: /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?:[,\s]+(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?\s*(EST|CST|MST|PST|EDT|CDT|MDT|PDT|UTC|GMT))?\b/gi,
      type: 'datetime', label: 'Date & Time', icon: '🕐',
      convert: (m) => parseWrittenDate(m),
    },
    // Time with timezone: 2:30 PM EST, 14:30 UTC
    {
      regex: /\b(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?\s*(EST|CST|MST|PST|EDT|CDT|MDT|PDT|UTC|GMT)\b/gi,
      type: 'datetime', label: 'Time', icon: '🕐',
      convert: (m) => parseTZTime(m),
    },
    // Relative time: "11 h 24 min ago", "in 5 minutes", "2 hours from now"
    {
      regex: /\b((?:\d+\s*(?:weeks?|wks?|w|months?|mos?|days?|d|hours?|hr?s?|h|minutes?|mins?|seconds?|secs?|m)\s*){1,4})(ago|from\s+now)\b|\bin\s+((?:\d+\s*(?:weeks?|wks?|w|months?|mos?|days?|d|hours?|hr?s?|h|minutes?|mins?|seconds?|secs?|m)\s*){1,4})\b/gi,
      type: 'datetime', label: 'Date & Time', icon: '🕐',
      convert: (m) => convertRelativeTime(m),
    },
    // Currency — code before symbol+number: "CAD $3,149.00"
    {
      regex: new RegExp(`\\b(${_CODES})\\s*(${_SYMS})\\s*(${_NUM})\\b`, 'g'),
      type: 'currency', label: 'Currency', icon: '💱',
      convert: (m) => convertCurrencyCode(parseNum(m[3]), m[1]),
    },
    // Currency — symbol before number, code after: "$3,149.00 CAD"
    {
      regex: new RegExp(`(${_SYMS})\\s*(${_NUM})\\s*(${_CODES})\\b`, 'g'),
      type: 'currency', label: 'Currency', icon: '💱',
      convert: (m) => convertCurrencyCode(parseNum(m[2]), m[3]),
    },
    // Currency — symbol only: "$30k", "€500"
    {
      regex: new RegExp(`(${_SYMS})\\s*(${_NUM})\\b`, 'g'),
      type: 'currency', label: 'Currency', icon: '💱',
      convert: (m, ctx) => convertCurrencySymbol(parseNum(m[2]), m[1], ctx),
    },
    // Currency — code after number: "3,149 USD"
    {
      regex: new RegExp(`\\b(${_NUM})\\s*(${_CODES})\\b`, 'g'),
      type: 'currency', label: 'Currency', icon: '💱',
      convert: (m) => convertCurrencyCode(parseNum(m[1]), m[2]),
    },
  ];

  // ─── Highlight color ──────────────────────────────────────────────────────

  function getEffectiveBg(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
      node = node.parentElement;
    }
    return 'rgb(255, 255, 255)';
  }

  function parseRgb(str) {
    const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : [255, 255, 255];
  }

  function luminance([r, g, b]) {
    const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }

  function highlightColors(parentEl) {
    const lum = luminance(parseRgb(getEffectiveBg(parentEl)));
    if (lum > 0.5) {
      return { bg: 'rgba(255,193,7,0.22)', bgHover: 'rgba(255,193,7,0.50)', shadow: 'none', shadowHover: 'none' };
    }
    return {
      bg: 'transparent',
      bgHover: 'rgba(255,200,60,0.15)',
      shadow: 'inset 0 -1px 0 rgba(255,200,60,0.55)',
      shadowHover: 'inset 0 -1px 0 rgba(255,200,60,0.90)',
    };
  }

  // ─── DOM Processing ───────────────────────────────────────────────────────

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'TEXTAREA', 'INPUT',
    'SELECT', 'BUTTON', 'CODE', 'PRE', 'KBD', 'SAMP', 'VAR', 'MATH',
    'SVG', 'CANVAS', 'AUDIO', 'VIDEO',
  ]);

  function shouldSkip(el) {
    return (
      SKIP_TAGS.has(el.tagName) ||
      el.isContentEditable ||
      el.classList.contains('unit-converter-highlight') ||
      !!el.closest('#unit-converter-popover')
    );
  }

  function processTextNode(node) {
    if (!node.parentNode || !node.isConnected) return;
    const text = node.nodeValue;
    if (!text || !text.trim()) return;

    const matches = [];
    for (const pat of PATTERNS) {
      const re = new RegExp(pat.regex.source, pat.regex.flags);
      let m;
      while ((m = re.exec(text)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length, raw: m[0], match: m, pat });
      }
    }
    if (matches.length === 0) return;

    matches.sort((a, b) => a.start - b.start);
    const final = [];
    let cursor = 0;
    for (const m of matches) {
      if (m.start >= cursor) {
        final.push(m);
        cursor = m.end;
      }
    }

    const colors = highlightColors(node.parentElement);
    const frag = document.createDocumentFragment();
    let pos = 0;

    for (const m of final) {
      if (m.start > pos) frag.appendChild(document.createTextNode(text.slice(pos, m.start)));
      const span = document.createElement('span');
      span.className = 'unit-converter-highlight';
      span.dataset.unitType = m.pat.type;
      span.textContent = m.raw;
      span.style.setProperty('--uc-hi', colors.bg);
      span.style.setProperty('--uc-hi-hover', colors.bgHover);
      span.style.setProperty('--uc-shadow', colors.shadow);
      span.style.setProperty('--uc-shadow-hover', colors.shadowHover);
      span._ucConvert = () => m.pat.convert(m.match, span.parentElement);
      span._ucIcon = m.pat.icon;
      span._ucLabel = m.pat.label;
      frag.appendChild(span);
      pos = m.end;
    }

    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    node.parentNode.replaceChild(frag, node);
  }

  function processElement(el) {
    if (el.nodeType === Node.TEXT_NODE) {
      processTextNode(el);
      return;
    }
    if (el.nodeType !== Node.ELEMENT_NODE || shouldSkip(el)) return;

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || shouldSkip(parent)) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue?.trim()) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);

    const BATCH = 60;
    function runBatch(i) {
      for (let j = i; j < Math.min(i + BATCH, nodes.length); j++) {
        if (nodes[j].isConnected) processTextNode(nodes[j]);
      }
      if (i + BATCH < nodes.length) setTimeout(() => runBatch(i + BATCH), 0);
    }
    runBatch(0);
  }

  // ─── Mutation Observer ────────────────────────────────────────────────────

  const observer = new MutationObserver((mutations) => {
    if (!enabled) return;
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.classList.contains('unit-converter-highlight') || node.id === 'unit-converter-popover') continue;
          pendingNodes.push(node);
        } else if (node.nodeType === Node.TEXT_NODE) {
          const parent = node.parentElement;
          if (parent && !parent.classList.contains('unit-converter-highlight')) {
            pendingNodes.push(node);
          }
        }
      }
    }
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flushPending, 600);
  });

  function flushPending() {
    const toProcess = pendingNodes.splice(0);
    if (!toProcess.length) return;
    observer.disconnect();
    for (const node of toProcess) {
      if (node.isConnected) processElement(node);
    }
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ─── Popover ──────────────────────────────────────────────────────────────

  function buildPopover() {
    popover = document.createElement('div');
    popover.id = 'unit-converter-popover';
    popover.setAttribute('role', 'tooltip');
    popover.setAttribute('aria-live', 'polite');
    document.body.appendChild(popover);
    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mouseout', onMouseOut);
    document.addEventListener('scroll', hidePopover, { passive: true });
  }

  function onMouseOver(e) {
    const span = e.target.closest?.('.unit-converter-highlight');
    if (!span) return;
    clearTimeout(hideTimer);
    showPopover(span);
  }

  function onMouseOut(e) {
    const span = e.target.closest?.('.unit-converter-highlight');
    if (!span) return;
    if (popover?.contains(e.relatedTarget)) return;
    hideTimer = setTimeout(hidePopover, 120);
  }

  function showPopover(span) {
    const conversions = span._ucConvert?.() ?? [];
    const icon = span._ucIcon || '';
    const label = span._ucLabel || span.dataset.unitType;
    const rows = conversions.map((c) =>
      `<div class="uc-row"><span class="uc-label">${escHtml(c.label)}</span><span class="uc-val">${escHtml(c.value)}</span></div>`
    ).join('');
    popover.innerHTML =
      `<div class="uc-header"><span class="uc-icon">${icon}</span>${escHtml(label)}</div>` +
      `<div class="uc-body">${rows}</div>`;
    popover.classList.add('uc-visible');
    positionPopover(span.getBoundingClientRect());
  }

  function positionPopover(rect) {
    popover.style.left = '-9999px';
    popover.style.top = '-9999px';
    const pw = popover.offsetWidth;
    const ph = popover.offsetHeight;
    const sx = window.scrollX;
    const sy = window.scrollY;
    let left = rect.left + sx + rect.width / 2 - pw / 2;
    let top = rect.bottom + sy + 10;
    left = Math.max(sx + 8, Math.min(left, sx + window.innerWidth - pw - 8));
    if (rect.bottom + ph + 10 > window.innerHeight) top = rect.top + sy - ph - 10;
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  function hidePopover() {
    popover?.classList.remove('uc-visible');
  }

  function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ─── Boot / Teardown ──────────────────────────────────────────────────────

  function boot() {
    if (booted) return;
    booted = true;
    if (!popover) buildPopover();
    processElement(document.body);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function teardown() {
    booted = false;
    observer.disconnect();
    clearTimeout(flushTimer);
    hidePopover();
    document.querySelectorAll('.unit-converter-highlight').forEach((el) => {
      el.replaceWith(document.createTextNode(el.textContent));
    });
  }
})();
