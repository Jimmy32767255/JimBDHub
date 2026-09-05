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
  customCSS: '',
  // 数据加密：自动锁定时间（分钟，-1 永不、0 立即切后台锁定）；生物认证开关（仅支持的平台）
  autoLockTimeout: -1,
  biometricUnlock: false
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

// ---- WCAG 对比度工具（Success Criterion 1.4.3，AA 级）----
// 正常文本对比度 ≥ 4.5:1，大文本（≥18pt 常规 / ≥14pt 加粗）≥ 3:1。
// 对比度 = (L1+0.05)/(L2+0.05)，L 为 sRGB 颜色的相对亮度。
function srgbChannelToLinear(channel) {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 相对亮度（0~1）。 */
function relativeLuminance(hex) {
  const { r, g, b } = hexToRgbObj(hex);
  return 0.2126 * srgbChannelToLinear(r)
    + 0.7152 * srgbChannelToLinear(g)
    + 0.0722 * srgbChannelToLinear(b);
}

/** 两色 WCAG 对比度（1~21）。 */
function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** sRGB gamma 空间内的 alpha 合成（与浏览器 rgba() 叠色结果一致）。 */
function compositeOver(fgHex, alpha, bgHex) {
  const fg = hexToRgbObj(fgHex);
  const bg = hexToRgbObj(bgHex);
  return rgbToHex({
    r: fg.r * alpha + bg.r * (1 - alpha),
    g: fg.g * alpha + bg.g * (1 - alpha),
    b: fg.b * alpha + bg.b * (1 - alpha)
  });
}

/**
 * 调整前景色，使其在所有给定背景上对比度 ≥ target（默认 4.5:1）。
 * 深色背景提亮前景、浅色背景压暗前景；纯黑/纯白对任意背景都能满足 4.5:1，故必然收敛。
 * direction: 'light' 提亮 | 'dark' 压暗 | null（按背景相对亮度自动判断）
 */
function ensureContrast(fgHex, bgOrList, { target = 4.5, direction = null } = {}) {
  const bgs = Array.isArray(bgOrList) ? bgOrList : [bgOrList];
  if (!fgHex || !bgs.length) return fgHex;
  const worst = hex => Math.min(...bgs.map(b => contrastRatio(hex, b)));
  if (worst(fgHex) >= target) return fgHex;
  const { h, s, l } = rgbToHsl(fgHex);
  const dir = direction || (relativeLuminance(bgs[0]) < WCAG_LUMINANCE_CROSSOVER ? 'light' : 'dark');
  let cur = l;
  for (let i = 0; i < 60; i++) {
    cur = dir === 'light' ? Math.min(1, cur + 0.03) : Math.max(0, cur - 0.03);
    const candidate = hslToRgbHex(h, s, cur);
    if (worst(candidate) >= target) return candidate;
  }
  return dir === 'light' ? '#ffffff' : '#000000';
}

// 黑字/白字对比度相等时的背景相对亮度（约 0.179），低于此值用浅字、高于此值用深字
const WCAG_LUMINANCE_CROSSOVER = 0.179;

/**
 * 计算与指定背景色形成足够对比（WCAG AA ≥4.5:1）的文字颜色组。
 * auto：按背景相对亮度选择近白/近黑（边界情况退化为纯黑/纯白以保证达标），
 *       muted 色从 slate 基色出发逐步提亮/压暗直到达标；
 * black/white：用户强制的字体颜色模式，muted 仍按达标方向推导。
 */
function contrastColorsFor(bg, mode) {
  if (mode === 'black') {
    return {
      text: '#000000',
      muted: ensureContrast('#475569', bg, { target: 4.5, direction: 'dark' })
    };
  }
  if (mode === 'white') {
    return {
      text: '#ffffff',
      muted: ensureContrast('#94a3b8', bg, { target: 4.5, direction: 'light' })
    };
  }
  const useLightText = relativeLuminance(bg) < WCAG_LUMINANCE_CROSSOVER;
  const text = useLightText
    ? (contrastRatio('#f8fafc', bg) >= 4.5 ? '#f8fafc' : '#ffffff')
    : (contrastRatio('#0f172a', bg) >= 4.5 ? '#0f172a' : '#000000');
  const muted = ensureContrast(useLightText ? '#94a3b8' : '#475569', bg, {
    target: 4.5,
    direction: useLightText ? 'light' : 'dark'
  });
  return { text, muted };
}

/**
 * 强调色渐变的深色端：在保证按钮文字对比度 ≥4.5:1 的前提下尽量加深。
 * 白字（深色强调色）时加深只会更清晰；黑字（浅色强调色）时加深到临界即止，
 * 避免渐变暗端文字看不清。
 */
function accentDarkEnd(accentHex, onAccentText) {
  if (onAccentText === '#ffffff') return shadeColor(accentHex, -0.4);
  const { h, s, l } = rgbToHsl(accentHex);
  let cur = l;
  let best = accentHex;
  for (let i = 0; i < 40; i++) {
    cur -= 0.03;
    if (cur <= 0.02) break;
    const candidate = hslToRgbHex(h, s, cur);
    if (contrastRatio(onAccentText, candidate) < 4.5) break;
    best = candidate;
  }
  return best;
}

/** 供图表等动态颜色场景调用：调整任意前景色，使其在指定背景上达到 WCAG AA 对比度。 */
export function ensureTextContrast(fgHex, bgHex, target = 4.5) {
  try {
    return ensureContrast(fgHex, bgHex, { target });
  } catch {
    return fgHex;
  }
}

/** 下拉框箭头 data-URI：颜色跟随背景层 muted 文字色，保证深/浅主题下都清晰。 */
function chevronDataUri(hex) {
  const color = (hex || '#94a3b8').replace('#', '%23');
  return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='${color}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`;
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
  // 强调色填充控件上的文字（按钮/激活标签等）：取黑、白中对比度更高者，
  // 保证任意自定义强调色上文字均 ≥4.5:1；渐变深色端同步按文字可读性推导
  const onAccent = contrastRatio('#000000', theme.accentColor)
    >= contrastRatio('#ffffff', theme.accentColor) ? '#000000' : '#ffffff';
  root.style.setProperty('--theme-on-accent', onAccent);
  root.style.setProperty('--theme-accent-dark', accentDarkEnd(theme.accentColor, onAccent));
  // 语义文字色按层级分别推导：背景层 / 卡片层 / 次背景层各取一组。
  // 中明度自定义主题下，三层背景的相对亮度可能跨过硬/白字分界（L≈0.18），
  // 共用一个文字色会数学上无解，故每层仅针对本层底色推导。
  // 色调徽标（value-badge/event-badge/quality-badge/schedule-chip 等 15% 色调底，
  // 只出现在卡片层）单独推导一组 *-chip-text：中明度主题下纯底文字与色调底文字
  // 所需明暗方向可能相反，无法共用同一颜色。
  const tint = (col, bg, alpha) => compositeOver(col, alpha, bg);
  const layerSemanticColors = layerBg => ({
    accent: ensureContrast(theme.accentColor, [layerBg], { target: 4.5 }),
    positive: ensureContrast(theme.positiveColor, [layerBg], { target: 4.5 }),
    negative: ensureContrast(theme.negativeColor, [layerBg], { target: 4.5 }),
    neutral: ensureContrast(theme.neutralColor, [layerBg], { target: 4.5 }),
    danger: ensureContrast('#ef4444', [layerBg], { target: 4.5 }),
    success: ensureContrast('#22c55e', [layerBg], { target: 4.5 }),
    sleep: ensureContrast('#8b5cf6', [layerBg], { target: 4.5 })
  });
  const setSemanticVars = (prefix, sem) => {
    root.style.setProperty(`--theme-${prefix}accent-text`, sem.accent);
    root.style.setProperty(`--theme-${prefix}positive-text`, sem.positive);
    root.style.setProperty(`--theme-${prefix}negative-text`, sem.negative);
    root.style.setProperty(`--theme-${prefix}neutral-text`, sem.neutral);
    root.style.setProperty(`--theme-${prefix}danger-text`, sem.danger);
    root.style.setProperty(`--theme-${prefix}success-text`, sem.success);
    root.style.setProperty(`--theme-${prefix}sleep-text`, sem.sleep);
  };
  // 背景层（无前缀，:root 默认）
  setSemanticVars('', layerSemanticColors(theme.backgroundColor));
  // 卡片层色调徽标文字（15% 色调底）
  const chipSemanticColors = layerBg => ({
    accent: ensureContrast(theme.accentColor, [tint(theme.accentColor, layerBg, 0.15)], { target: 4.5 }),
    positive: ensureContrast(theme.positiveColor, [tint(theme.positiveColor, layerBg, 0.15)], { target: 4.5 }),
    negative: ensureContrast(theme.negativeColor, [tint(theme.negativeColor, layerBg, 0.15)], { target: 4.5 }),
    neutral: ensureContrast(theme.neutralColor, [tint(theme.neutralColor, layerBg, 0.15)], { target: 4.5 }),
    sleep: ensureContrast('#8b5cf6', [tint('#8b5cf6', layerBg, 0.15)], { target: 4.5 })
  });
  const setChipVars = sem => {
    root.style.setProperty('--theme-surface-accent-chip-text', sem.accent);
    root.style.setProperty('--theme-surface-positive-chip-text', sem.positive);
    root.style.setProperty('--theme-surface-negative-chip-text', sem.negative);
    root.style.setProperty('--theme-surface-neutral-chip-text', sem.neutral);
    root.style.setProperty('--theme-surface-sleep-chip-text', sem.sleep);
  };
  setChipVars(chipSemanticColors(theme.surfaceColor));
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
  // 卡片层 / 次背景层语义文字色（.card、.sidebar 等作用域内重映射到对应组）
  setSemanticVars('surface-', layerSemanticColors(theme.surfaceColor));
  setSemanticVars('surface-alt-', layerSemanticColors(theme.surfaceAltColor));
  // 下拉框箭头颜色跟随背景层 muted 文字色（深/浅主题自动适配）
  root.style.setProperty('--theme-chevron', chevronDataUri(bgPair.muted));
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
