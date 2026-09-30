// 语言偏好存储键：值为 'system'（跟随系统）或具体语言代码（'zh-CN' / 'en-US'）
const STORAGE_KEY = 'jimbdhub_language';

// 支持切换的界面语言
const SUPPORTED_LANGS = ['zh-CN', 'en-US'];

// 「跟随系统语言」的哨兵值
const AUTO_LANG = 'system';

// 无法识别或不受支持时的兜底语言。
// 这里采用英文而非中文：AppImage 目录要求非中文环境下默认显示英文界面，
// 因此任何无法判定为中文的系统语言都应回退到 en-US。
const FALLBACK_LANG = 'en-US';

let currentPref = AUTO_LANG;      // 用户偏好：'system' 或具体语言代码
let currentLang = FALLBACK_LANG;  // 当前实际生效的语言
let messages = {};
let listeners = [];

/**
 * 根据系统语言环境推断界面语言。
 *
 * 数据来源为 navigator 的语言属性——在 AppImage（QtWebEngine）下由系统 LANG / LC_*
 * 决定，在 Android WebView 下由设备语言决定。
 * 中文（zh*）→ 'zh-CN'；其余（含 C / POSIX）一律回退到英文（'en-US'）。
 *
 * 注意候选顺序：navigator.language 在最前。部分 Android WebView 会把
 * navigator.languages 硬编码成 ['en-US', 'en']（不随系统语言变化），只有
 * navigator.language 反映真实设备语言；而在浏览器中两者首项等价，故不影响。
 */
export function detectSystemLanguage() {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const candidates = [];
  if (nav) {
    if (nav.language) candidates.push(nav.language);
    if (nav.userLanguage) candidates.push(nav.userLanguage);
    if (Array.isArray(nav.languages)) candidates.push(...nav.languages);
  }
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim().toLowerCase();
    if (!tag) continue;
    const base = tag.split(/[-_]/)[0];
    if (base === 'zh') return 'zh-CN';
    if (base === 'en') return 'en-US';
  }
  return FALLBACK_LANG;
}

// 将任意偏好值解析为受支持的具体语言代码
function resolvePreference(pref) {
  if (SUPPORTED_LANGS.includes(pref)) return pref;
  return detectSystemLanguage();
}

async function loadMessages(lang) {
  try {
    // 加时间戳绕过 WebView/浏览器缓存，防止应用更新后语言文件滞后（缺键时 t() 会原样显示键名）
    const res = await fetch(`locales/${lang}.json?v=${Date.now()}`);
    if (!res.ok) throw new Error(`Failed to load ${lang}`);
    return await res.json();
  } catch (err) {
    if (lang !== FALLBACK_LANG) {
      return loadMessages(FALLBACK_LANG);
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

// 当前实际生效的语言（用于导出备份/同步，以及其它需要具体语言的场景）
export function getLanguage() {
  return currentLang;
}

// 当前语言偏好：'system' 或具体语言代码（用于设置页下拉框回显）
export function getLanguagePreference() {
  return currentPref;
}

// 内部：仅加载并应用语言，不修改用户偏好
async function applyLanguage(lang) {
  const target = resolvePreference(lang);
  if (target === currentLang && Object.keys(messages).length > 0) return;
  const loaded = await loadMessages(target);
  currentLang = target;
  messages = loaded;
  document.documentElement.lang = target;
  listeners.forEach(fn => fn(target));
}

// 显式设置具体语言并持久化（备份/同步恢复、设置页选择具体语言时使用）
export async function setLanguage(lang) {
  if (SUPPORTED_LANGS.includes(lang)) {
    currentPref = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    await applyLanguage(lang);
  } else {
    await setLanguagePreference(AUTO_LANG);
  }
}

// 设置语言偏好：AUTO_LANG 表示跟随系统语言，其余为具体语言代码
export async function setLanguagePreference(pref) {
  if (pref === AUTO_LANG || !SUPPORTED_LANGS.includes(pref)) {
    currentPref = AUTO_LANG;
    localStorage.setItem(STORAGE_KEY, AUTO_LANG);
    await applyLanguage(detectSystemLanguage());
  } else {
    await setLanguage(pref);
  }
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

/**
 * 初始化语言：优先使用用户已保存的偏好；从未设置过时跟随系统语言。
 * 非中文系统环境会因此默认显示英文界面。
 */
export async function initI18n() {
  let saved = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    saved = null;
  }
  if (SUPPORTED_LANGS.includes(saved)) {
    // 用户曾显式选择过具体语言：尊重该选择
    currentPref = saved;
    await applyLanguage(saved);
  } else {
    // 首次启动，或偏好为「跟随系统」：按系统语言自动选择
    currentPref = AUTO_LANG;
    try {
      localStorage.setItem(STORAGE_KEY, AUTO_LANG);
    } catch { /* 忽略隐私模式等场景下的写入失败 */ }
    await applyLanguage(detectSystemLanguage());
  }
  updateDOM();
}
