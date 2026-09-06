const DEFAULT_LANG = 'zh-CN';
const STORAGE_KEY = 'jimbdhub_language';

let currentLang = DEFAULT_LANG;
let messages = {};
let listeners = [];

async function loadMessages(lang) {
  try {
    // 加时间戳绕过 WebView/浏览器缓存，防止应用更新后语言文件滞后（缺键时 t() 会原样显示键名）
    const res = await fetch(`locales/${lang}.json?v=${Date.now()}`);
    if (!res.ok) throw new Error(`Failed to load ${lang}`);
    return await res.json();
  } catch (err) {
    if (lang !== DEFAULT_LANG) {
      return loadMessages(DEFAULT_LANG);
    }
    return {};
  }
}

function interpolate(str, params = {}) {
  return str.replace(/\{(\w+)\}/g, (_, key) => (params[key] !== undefined ? params[key] : `{${key}}`));
}

export function t(key, params) {
  const msg = messages[key];
  if (msg === undefined) return key;
  return interpolate(String(msg), params);
}

export function getLanguage() {
  return currentLang;
}

export async function setLanguage(lang) {
  if (lang === currentLang && Object.keys(messages).length > 0) return;
  const loaded = await loadMessages(lang);
  currentLang = lang;
  messages = loaded;
  localStorage.setItem(STORAGE_KEY, lang);
  document.documentElement.lang = lang;
  listeners.forEach(fn => fn(lang));
}

export function subscribe(fn) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter(l => l !== fn);
  };
}

export function updateDOM(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (key) {
      let params;
      if (el.dataset.i18nParams) {
        try { params = JSON.parse(el.dataset.i18nParams); } catch { params = undefined; }
      }
      el.textContent = t(key, params);
    }
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    if (key) el.placeholder = t(key);
  });
  root.querySelectorAll('[data-i18n-aria]').forEach(el => {
    const key = el.dataset.i18nAria;
    if (key) el.setAttribute('aria-label', t(key));
  });
}

export async function initI18n() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const lang = saved || DEFAULT_LANG;
  await setLanguage(lang);
  updateDOM();
}
