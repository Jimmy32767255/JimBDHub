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
  recordAddToast: true
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
