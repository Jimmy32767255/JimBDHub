import { platform } from './platform.js';

const STORAGE_KEY = 'jimbdhub_theme';

// 药品未指定颜色时的默认调色板（按药品列表顺序循环分配）
export const DEFAULT_MED_COLORS = ['#22c55e', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6'];

const DEFAULT_THEME = {
  curveLine: 'curve',
  connectMoodDots: false,
  scrollLock: false,
  autoMedLog: false,
  positiveColor: '#ef4444',
  negativeColor: '#3b82f6',
  neutralColor: '#64748b',
  backgroundColor: '#0f172a',
  surfaceColor: '#1e293b',
  surface2Color: '#334155',
  surface3Color: '#475569',
  surfaceAltColor: '#334155',
  textColor: '#f8fafc',
  textMutedColor: '#94a3b8',
  fontColorMode: 'auto',
  accentColor: '#ef4444',
  backgroundType: 'solid',
  backgroundImage: '',
  backgroundImageAutoColor: false,
  autoColorSnapshot: null,
  backgroundGradient: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)',
  useSystemTheme: false,
  uiScale: 100,
  edgeMargin: 0,
  simpleMode: false,
  simpleModeGranularity: 'day',
  simpleModeMood: true,
  simpleModeMedication: true,
  sleepDisplayMode: 'bar',
  depletionReminderDays: 3,
  bodyWeightKg: 70,
  maxLoadedRecords: 100,
  dynamicAnimationSpeed: true,
  disableAnimations: false,
  recordAddToast: true,
  customCSS: ''
};

const SYSTEM_PRESETS = {
  dark: { ...DEFAULT_THEME },
  light: {
    backgroundColor: '#f8fafc',
    surfaceColor: '#ffffff',
    surface2Color: '#e2e8f0',
    surface3Color: '#cbd5e1',
    surfaceAltColor: '#e2e8f0',
    textColor: '#0f172a',
    textMutedColor: '#64748b',
    accentColor: '#dc2626',
    positiveColor: '#dc2626',
    negativeColor: '#2563eb',
    neutralColor: '#64748b'
  }
};

let currentTheme = { ...DEFAULT_THEME };
let listeners = [];
// 最后一次主题/设置变更的原因，供自动备份等读取
export let lastThemeMutation = { reason: 'ThemeChange' };

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

function hexToRgbObj(hex) {
  const clean = (hex || '').replace('#', '');
  if (clean.length !== 6) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}

function rgbToHex({ r, g, b }) {
  const toHex = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function rgbToHsl(hex) {
  let { r, g, b } = hexToRgbObj(hex);
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0; let s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s, l };
}

function hslToRgbHex(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  s = clamp(s, 0, 1);
  l = clamp(l, 0, 1);
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return rgbToHex({ r: r * 255, g: g * 255, b: b * 255 });
}

const AUTO_COLOR_SNAPSHOT_KEYS = [
  'positiveColor', 'negativeColor', 'neutralColor',
  'backgroundColor', 'surfaceColor', 'surface2Color', 'surface3Color', 'surfaceAltColor',
  'accentColor'
];

function deriveThemeColorsFromAverage(hex) {
  const { h, s, l } = rgbToHsl(hex);
  const bg = hslToRgbHex(h, s, l);
  const surface = hslToRgbHex(h, s, clamp(l + 0.06, 0, 1));
  const surface2 = hslToRgbHex(h, s, clamp(l + 0.12, 0, 1));
  const surface3 = hslToRgbHex(h, s, clamp(l + 0.18, 0, 1));
  const surfaceAlt = surface2;
  const accentHue = (h + (s < 0.1 ? 30 : 180)) % 360;
  const accent = hslToRgbHex(accentHue, Math.max(s, 0.55), 0.55);
  const positive = accent;
  const negative = hslToRgbHex((accentHue + 210) % 360, Math.max(s, 0.45), 0.5);
  const neutral = hslToRgbHex(h, Math.min(s, 0.12), clamp(l + 0.22, 0, 1));
  return {
    positiveColor: positive,
    negativeColor: negative,
    neutralColor: neutral,
    backgroundColor: bg,
    surfaceColor: surface,
    surface2Color: surface2,
    surface3Color: surface3,
    surfaceAltColor: surfaceAlt,
    accentColor: accent
  };
}

export function extractImageAverageColor(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = 100;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      try {
        const data = ctx.getImageData(0, 0, size, size).data;
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
        if (!count) {
          resolve('#0f172a');
          return;
        }
        resolve(rgbToHex({
          r: Math.round(r / count),
          g: Math.round(g / count),
          b: Math.round(b / count)
        }));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('image-load-failed'));
    img.src = url;
  });
}

export function takeAutoColorSnapshot(theme) {
  const snapshot = {};
  AUTO_COLOR_SNAPSHOT_KEYS.forEach(key => { snapshot[key] = theme[key]; });
  return snapshot;
}

export function buildAutoColorTheme(baseTheme, averageHex) {
  return { ...baseTheme, ...deriveThemeColorsFromAverage(averageHex) };
}

export function isAutoColorActive(theme) {
  return theme.backgroundImageAutoColor === true
    && theme.backgroundType === 'image'
    && !!theme.backgroundImage;
}

/** 按相对亮度判断颜色是否偏亮。 */
function isLightColor(hex) {
  const clean = (hex || '').replace('#', '');
  if (clean.length !== 6) return false;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5;
}

/** 计算与指定背景色形成对比的文字颜色组：auto 按背景亮度，black/white 强制指定。 */
function contrastColorsFor(bg, mode) {
  if (mode === 'black') return { text: '#000000', muted: '#475569' };
  if (mode === 'white') return { text: '#ffffff', muted: '#94a3b8' };
  return isLightColor(bg)
    ? { text: '#000000', muted: '#475569' }
    : { text: '#ffffff', muted: '#94a3b8' };
}

function shadeColor(hex, percent) {
  const f = parseInt(hex.slice(1), 16);
  const t = percent < 0 ? 0 : 255;
  const p = percent < 0 ? -percent : percent;
  const R = f >> 16;
  const G = (f >> 8) & 0x00ff;
  const B = f & 0x0000ff;
  const nr = Math.round((t - R) * p) + R;
  const ng = Math.round((t - G) * p) + G;
  const nb = Math.round((t - B) * p) + B;
  return `#${(0x1000000 + nr * 0x10000 + ng * 0x100 + nb).toString(16).slice(1)}`;
}

function getSystemScheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      return { ...DEFAULT_THEME, ...saved };
    }
  } catch {}
  return { ...DEFAULT_THEME };
}

function save(theme) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
}

// ---- 自定义 CSS（高级功能）----
// 安全机制：仅注入纯样式规则。自动拦截 @import（外部加载），限制总长度，
// 并利用浏览器 CSS 解析器（constructable stylesheet）做语法校验，非法内容不生效。
export const CUSTOM_CSS_MAX_LENGTH = 32 * 1024;

function stripImports(css) {
  return css.replace(/@import\s+[^;]+;?/gi, '');
}

export function sanitizeCustomCSS(raw = '') {
  if (typeof raw !== 'string') raw = '';
  const css = stripImports(raw).trim();
  if (css.length > CUSTOM_CSS_MAX_LENGTH) {
    throw new Error('custom-css-too-long');
  }
  if (css && typeof CSSStyleSheet !== 'undefined'
    && CSSStyleSheet.prototype && typeof CSSStyleSheet.prototype.replaceSync === 'function') {
    try {
      new CSSStyleSheet().replaceSync(css);
    } catch {
      throw new Error('custom-css-syntax');
    }
  }
  return css;
}

function applyCustomCSS(css) {
  let style = document.getElementById('custom-css-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'custom-css-style';
    document.head.appendChild(style);
  }
  let safe = '';
  try {
    safe = sanitizeCustomCSS(css);
  } catch {
    safe = '';
  }
  if (style.textContent !== safe) {
    style.textContent = safe;
  }
}

function applyCSS(theme) {
  const root = document.documentElement;
  root.style.setProperty('--theme-positive', theme.positiveColor);
  root.style.setProperty('--theme-positive-rgb', hexToRgb(theme.positiveColor));
  root.style.setProperty('--theme-negative', theme.negativeColor);
  root.style.setProperty('--theme-negative-rgb', hexToRgb(theme.negativeColor));
  root.style.setProperty('--theme-neutral', theme.neutralColor);
  root.style.setProperty('--theme-neutral-rgb', hexToRgb(theme.neutralColor));
  root.style.setProperty('--theme-accent', theme.accentColor);
  root.style.setProperty('--theme-accent-rgb', hexToRgb(theme.accentColor));
  root.style.setProperty('--theme-accent-dark', shadeColor(theme.accentColor, -0.4));
  root.style.setProperty('--theme-bg', theme.backgroundColor);
  root.style.setProperty('--theme-bg-rgb', hexToRgb(theme.backgroundColor));
  root.style.setProperty('--theme-surface', theme.surfaceColor);
  root.style.setProperty('--theme-surface-rgb', hexToRgb(theme.surfaceColor));
  root.style.setProperty('--theme-surface-2', theme.surface2Color);
  root.style.setProperty('--theme-surface-2-rgb', hexToRgb(theme.surface2Color));
  root.style.setProperty('--theme-surface-3', theme.surface3Color);
  root.style.setProperty('--theme-surface-3-rgb', hexToRgb(theme.surface3Color));
  root.style.setProperty('--theme-surface-alt', theme.surfaceAltColor);
  root.style.setProperty('--theme-surface-alt-rgb', hexToRgb(theme.surfaceAltColor));
  const mode = theme.fontColorMode || 'auto';
  // 为整体背景、卡片、次要背景分别计算对比文字色（含 muted），供各层元素使用
  const bgPair = contrastColorsFor(theme.backgroundColor, mode);
  const surfacePair = contrastColorsFor(theme.surfaceColor, mode);
  const altPair = contrastColorsFor(theme.surfaceAltColor, mode);
  root.style.setProperty('--theme-text', bgPair.text);
  root.style.setProperty('--theme-text-rgb', hexToRgb(bgPair.text));
  root.style.setProperty('--theme-text-muted', bgPair.muted);
  root.style.setProperty('--theme-text-muted-rgb', hexToRgb(bgPair.muted));
  root.style.setProperty('--theme-surface-text', surfacePair.text);
  root.style.setProperty('--theme-surface-text-rgb', hexToRgb(surfacePair.text));
  root.style.setProperty('--theme-surface-text-muted', surfacePair.muted);
  root.style.setProperty('--theme-surface-text-muted-rgb', hexToRgb(surfacePair.muted));
  root.style.setProperty('--theme-surface-alt-text', altPair.text);
  root.style.setProperty('--theme-surface-alt-text-rgb', hexToRgb(altPair.text));
  root.style.setProperty('--theme-surface-alt-text-muted', altPair.muted);
  root.style.setProperty('--theme-surface-alt-text-muted-rgb', hexToRgb(altPair.muted));
  root.style.setProperty('--ui-scale-ratio', theme.uiScale / 100);
  root.style.setProperty('--edge-margin', `${theme.edgeMargin}px`);
  // 无障碍：关闭所有动画/过渡
  root.classList.toggle('no-animations', theme.disableAnimations === true);
  applyBackground(theme);
  applyCustomCSS(theme.customCSS);
}

function applyBackground(theme) {
  const root = document.getElementById('ui-scale-root') || document.body;
  const type = theme.backgroundType || 'solid';
  root.style.backgroundImage = '';
  root.style.backgroundSize = '';
  root.style.backgroundPosition = '';
  root.style.backgroundRepeat = '';
  if (type === 'image' && theme.backgroundImage) {
    root.style.backgroundImage = `url(${theme.backgroundImage})`;
    root.style.backgroundSize = 'cover';
    root.style.backgroundPosition = 'center';
    root.style.backgroundRepeat = 'no-repeat';
    root.style.backgroundColor = theme.backgroundColor;
  } else if (type === 'gradient' && theme.backgroundGradient) {
    root.style.background = theme.backgroundGradient;
  } else {
    root.style.background = theme.backgroundColor;
  }
}

export function getTheme() {
  return { ...currentTheme };
}

export function setTheme(partial, reason = 'ThemeChange') {
  currentTheme = { ...currentTheme, ...partial };
  save(currentTheme);
  applyCSS(currentTheme);
  lastThemeMutation = { reason };
  listeners.forEach(fn => fn(currentTheme, reason));
}

export function resetTheme() {
  setTheme({ ...DEFAULT_THEME }, 'ThemeReset');
}

export async function applySystemTheme() {
  const scheme = getSystemScheme();
  const theme = { ...SYSTEM_PRESETS[scheme], useSystemTheme: true };
  try {
    // 拉取系统强调色与背景色，获取不到则回退到亮/暗预设
    const sys = await platform.getSystemTheme();
    if (sys) {
      if (sys.accentColor) theme.accentColor = sys.accentColor;
      if (sys.backgroundColor) theme.backgroundColor = sys.backgroundColor;
    }
  } catch (e) {
    // 忽略异常，使用预设
  }
  setTheme(theme, 'SystemTheme');
}

export function initTheme() {
  currentTheme = load();
  if (currentTheme.useSystemTheme) {
    const scheme = getSystemScheme();
    currentTheme = { ...currentTheme, ...SYSTEM_PRESETS[scheme], useSystemTheme: true };
    // 异步拉取系统强调色/背景色增强，失败则保持预设
    applySystemTheme();
  }
  applyCSS(currentTheme);

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (currentTheme.useSystemTheme) {
      applySystemTheme();
    }
  });
}

export function subscribe(fn) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter(l => l !== fn);
  };
}

export function getSystemSchemeName() {
  return getSystemScheme();
}
