import { t } from './i18n.js';
import { showAlert, showActionDialog } from './dialog.js';
import { platform } from './platform.js';

// 更新频道（按稳定性从高到低排列，rank 越小越稳定）。
// 选择靠后的频道会同时接收所有更稳定（rank 更小）的版本。
export const UPDATE_CHANNELS = [
  { code: 'R', rank: 0, key: 'update.channel.release' },
  { code: 'RC', rank: 1, key: 'update.channel.rc' },
  { code: 'A', rank: 2, key: 'update.channel.alpha' },
  { code: 'B', rank: 3, key: 'update.channel.beta' },
  { code: 'D', rank: 4, key: 'update.channel.development' },
  { code: 'C', rank: 5, key: 'update.channel.canary' },
  { code: 'N', rank: 6, key: 'update.channel.nightly' },
  { code: 'IP', rank: 7, key: 'update.channel.internalPreview' }
];

const CHANNEL_STORAGE_KEY = 'jimbdhub_update_channel';
// Release 中的元数据资产名（由 CI 自动构建时生成）
const UPDATE_META_NAME = 'Metadata.json';
const RELEASES_API = 'https://api.github.com/repos/Jimmy32767255/JimBDHub/releases?per_page=100';
const RELEASES_URL = 'https://github.com/Jimmy32767255/JimBDHub/releases';

export function getUpdateChannel() {
  try {
    const saved = localStorage.getItem(CHANNEL_STORAGE_KEY);
    if (saved && UPDATE_CHANNELS.some(ch => ch.code === saved)) return saved;
  } catch { /* ignore */ }
  return 'R';
}

export function setUpdateChannel(code) {
  const valid = UPDATE_CHANNELS.some(ch => ch.code === code) ? code : 'R';
  try {
    localStorage.setItem(CHANNEL_STORAGE_KEY, valid);
  } catch { /* ignore */ }
  return valid;
}

function getChannelRank(code) {
  const ch = UPDATE_CHANNELS.find(c => c.code === code);
  return ch ? ch.rank : 0;
}

// 版本比较：提取所有数字段，如 V0.0.1A-N20260814 → [0, 0, 1, 20260814]
function parseVersion(v) {
  const nums = String(v || '').replace(/^[vV]/, '').split(/[^\d]+/).map(Number).filter(n => Number.isFinite(n));
  return nums.length ? nums : [0];
}

function compareVersions(a, b) {
  const an = parseVersion(a);
  const bn = parseVersion(b);
  const len = Math.max(an.length, bn.length);
  for (let i = 0; i < len; i++) {
    const x = an[i] || 0;
    const y = bn[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// 按产物命名约定 <OS>-<ARCH>.<ext> 从 Release 资产推断文件信息（兼容没有元数据的旧版本）
function fileFromAsset(asset) {
  const m = asset.name.match(/^(Microsoft-Windows|GNU-Linux|Google-Android)-(amd64|x86_64|arm64|aarch64)\./);
  if (!m) return null;
  const osMap = { 'Microsoft-Windows': 'windows', 'GNU-Linux': 'linux', 'Google-Android': 'android' };
  const archMap = { amd64: 'amd64', x86_64: 'amd64', arm64: 'arm64', aarch64: 'arm64' };
  return {
    name: asset.name,
    os: osMap[m[1]],
    arch: archMap[m[2]],
    url: asset.browser_download_url,
    sha512: ''
  };
}

// 读取某个 Release 的更新元数据；没有 Metadata.json 资产时视为稳定版（R 频道），文件从资产推断
async function getReleaseMeta(release) {
  const asset = (release.assets || []).find(a => a.name === UPDATE_META_NAME);
  const legacy = {
    version: release.tag_name || release.name || '',
    channel: 'R',
    files: (release.assets || []).map(fileFromAsset).filter(Boolean),
    htmlUrl: release.html_url || RELEASES_URL,
    publishedAt: release.published_at || ''
  };
  if (!asset) return legacy;
  try {
    const meta = await fetchJson(asset.browser_download_url);
    return {
      version: meta.version || legacy.version,
      channel: UPDATE_CHANNELS.some(ch => ch.code === meta.channel) ? meta.channel : 'R',
      files: Array.isArray(meta.files) ? meta.files : legacy.files,
      htmlUrl: meta.url || release.html_url || RELEASES_URL,
      publishedAt: meta.published_at || release.published_at || ''
    };
  } catch {
    return null; // 元数据拉取失败则跳过该 Release
  }
}

// 检查更新：在所选频道的所有 Release 中挑版本最新的一个。
// 返回 { status: 'noRelease' | 'upToDate' | 'update', meta?, version? }
export async function checkForUpdates(appVersion) {
  const releases = await fetchJson(RELEASES_API);
  if (!Array.isArray(releases) || releases.length === 0) {
    return { status: 'noRelease' };
  }

  const selectedRank = getChannelRank(getUpdateChannel());
  let best = null;
  let hasMeta = false;

  for (const release of releases) {
    if (release.draft) continue;
    const meta = await getReleaseMeta(release);
    if (!meta) continue;
    if (getChannelRank(meta.channel) > selectedRank) continue; // 不属于所选频道（或更不稳定）
    hasMeta = true;
    if (!best || compareVersions(meta.version, best.version) > 0) {
      best = meta;
    }
  }

  // 没有任何可用元数据时，回退到旧逻辑：仅比较最新 Release 的 tag
  if (!best) {
    const first = releases.find(r => !r.draft);
    if (first && (first.tag_name || '').toLowerCase() !== appVersion.toLowerCase()) {
      best = {
        version: first.tag_name || first.name || '',
        channel: 'R',
        files: (first.assets || []).map(fileFromAsset).filter(Boolean),
        htmlUrl: first.html_url || RELEASES_URL,
        publishedAt: first.published_at || ''
      };
    } else {
      return { status: 'upToDate', version: appVersion };
    }
  }

  if (compareVersions(best.version, appVersion) <= 0) {
    return { status: 'upToDate', version: appVersion };
  }
  return { status: 'update', meta: best };
}

// 依据当前运行环境（Android / Windows / Linux）从元数据中找到对应的安装包
function pickFileForPlatform(files) {
  if (!Array.isArray(files) || files.length === 0) return null;
  if (platform.isAndroid()) {
    return files.find(f => f.os === 'android' && f.arch === 'arm64')
      || files.find(f => f.os === 'android')
      || null;
  }
  const isWindows = /win/i.test(navigator.userAgent);
  if (isWindows) {
    return files.find(f => f.os === 'windows' && f.arch === 'amd64')
      || files.find(f => f.os === 'windows')
      || null;
  }
  return files.find(f => f.os === 'linux' && f.arch === 'amd64')
    || files.find(f => f.os === 'linux')
    || null;
}

// 纯浏览器环境的降级下载：前端下载 + SHA-512 校验 + 触发浏览器下载
async function browserDownloadAndVerify(file) {
  const res = await fetch(file.url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  if (file.sha512 && typeof crypto?.subtle?.digest === 'function') {
    const digest = await crypto.subtle.digest('SHA-512', buf);
    const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    if (hex.toLowerCase() !== String(file.sha512).toLowerCase()) {
      throw new Error('verify_failed');
    }
  }
  const blob = new Blob([buf]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name || 'jimbdhub-update';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function updateErrorMessage(err) {
  if (err && err.message === 'verify_failed') return t('update.verifyFailed');
  if (err && err.message === 'launch_failed') return t('update.launchFailed');
  return t('update.downloadFailed', { message: err && err.message ? err.message : '' });
}

// 下载更新包：桥接端负责下载、SHA-512 校验与启动安装；
// 失败时询问用户是否前往浏览器手动下载。
export async function runUpdate(meta) {
  const file = pickFileForPlatform(meta.files);
  if (!file) {
    const go = await showActionDialog(t('update.noFileForPlatform'), t('update.manualDownload'));
    if (go) await platform.openExternalUrl(meta.htmlUrl || RELEASES_URL);
    return;
  }
  try {
    if (platform.isUpdateDownloadSupported()) {
      const result = await platform.downloadAndInstallUpdate({
        url: file.url,
        sha512: file.sha512,
        fileName: file.name
      });
      if (!result || result.ok !== true) {
        throw new Error(result?.error || 'download_failed');
      }
      await showAlert(t('update.installStarted'));
    } else {
      await browserDownloadAndVerify(file);
      await showAlert(t('update.installStarted'));
    }
  } catch (err) {
    const go = await showActionDialog(t('update.downloadFailedPrompt', { message: updateErrorMessage(err) }), t('update.manualDownload'));
    if (go) {
      await platform.openExternalUrl(meta.htmlUrl || RELEASES_URL);
    }
  }
}
