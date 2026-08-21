import { t } from './i18n.js';
import { showAlert, showActionDialog } from './dialog.js';
import { platform } from './platform.js';
import { checkForUpdates, runUpdate } from './update.js';

// 应用版本号：与 Android 构建的 versionName 保持一致
const APP_VERSION = 'V1.1.0R-NEC';

const REPO_URL = 'https://github.com/Jimmy32767255/JimBDHub';

const contributorsModal = document.getElementById('contributors-modal');
const contributorsListEl = document.getElementById('contributors-list');

// 议题/拉取请求 类型 → i18n 键
const CONTRIB_TYPE_MAP = {
  '议题-功能请求': 'about.contribType.feature',
  '议题-改进建议': 'about.contribType.suggestion',
  '议题-程序缺陷': 'about.contribType.bug',
  '拉取请求-缺陷修复': 'about.contribType.fix',
  '拉取请求-新功能/增强': 'about.contribType.enhance',
  '拉取请求-重构/清理': 'about.contribType.refactor',
  '拉取请求-文档/翻译': 'about.contribType.docs'
};

function showContributorsModal() {
  if (!contributorsModal) return;
  if (contributorsListEl && !contributorsListEl.children.length) {
    loadContributors();
  }
  contributorsModal.setAttribute('aria-hidden', 'false');
}

function closeContributorsModal() {
  if (contributorsModal) contributorsModal.setAttribute('aria-hidden', 'true');
}

// 用系统浏览器打开项目仓库：优先走平台桥接，纯浏览器环境退回 window.open
async function openRepository() {
  try {
    if (platform.isAndroid()) {
      window.AndroidBridge.openUrl(REPO_URL);
      return;
    }
    if (platform.isDesktop()) {
      await window.pywebview.api.openUrl(REPO_URL);
      return;
    }
    window.open(REPO_URL, '_blank');
  } catch (err) {
    window.open(REPO_URL, '_blank');
  }
}

async function loadContributors() {
  if (!contributorsListEl) return;
  try {
    const res = await fetch('contribution/contributors.md');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    renderContributors(await res.text());
  } catch (err) {
    contributorsListEl.textContent = t('about.contributorsLoadError', { message: err.message });
  }
}

// 将 contribution/contributors.md 解析渲染为贡献者列表，
// 字段格式：## 名字 / 联系方式 / ### 标题 / ![raw](截图) / 类型 / 原始 / 提出于 / 解决于 / 提交
function renderContributors(md) {
  const frag = document.createDocumentFragment();
  let section = null;
  let item = null;
  let proposedAt = '';
  let resolvedAt = '';

  const flushMeta = () => {
    if (item && (proposedAt || resolvedAt)) {
      const meta = document.createElement('div');
      meta.className = 'contributor-item-meta';
      const parts = [];
      if (proposedAt) parts.push(`${t('about.contrib.proposedAt')} ${proposedAt}`);
      if (resolvedAt) parts.push(`${t('about.contrib.resolvedAt')} ${resolvedAt}`);
      meta.textContent = parts.join(' · ');
      item.appendChild(meta);
      proposedAt = '';
      resolvedAt = '';
    }
  };

  for (const rawLine of md.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('# ')) continue; // 顶层标题与导语已由模态框标题/简介承担

    if (line.startsWith('## ')) {
      flushMeta();
      section = document.createElement('div');
      section.className = 'contributor';
      const header = document.createElement('div');
      header.className = 'contributor-header';
      const name = document.createElement('strong');
      name.className = 'contributor-name';
      name.textContent = line.slice(3).trim();
      header.appendChild(name);
      section.appendChild(header);
      frag.appendChild(section);
      item = null;
      continue;
    }

    if (line.startsWith('### ')) {
      flushMeta();
      item = document.createElement('div');
      item.className = 'contributor-item';
      const itemTitle = document.createElement('div');
      itemTitle.className = 'contributor-item-title';
      itemTitle.textContent = line.slice(4).trim();
      item.appendChild(itemTitle);
      section.appendChild(item);
      continue;
    }

    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      const img = document.createElement('img');
      img.className = 'contributor-item-image';
      img.src = 'contribution/' + imgMatch[2].replace(/^\.\//, '');
      img.alt = imgMatch[1];
      item.appendChild(img);
      continue;
    }

    if (line.startsWith('类型：')) {
      const typeKey = CONTRIB_TYPE_MAP[line.slice(3).trim()];
      if (typeKey) {
        const typeBadge = document.createElement('span');
        typeBadge.className = 'contributor-item-type';
        typeBadge.textContent = t(typeKey);
        item.querySelector('.contributor-item-title').appendChild(typeBadge);
      }
      continue;
    }

    if (line.startsWith('原始：')) {
      const original = document.createElement('blockquote');
      original.className = 'contributor-item-original';
      original.textContent = line.slice(3).trim();
      item.appendChild(original);
      continue;
    }

    if (line.startsWith('提出于：')) {
      proposedAt = line.slice(4).trim();
      continue;
    }

    if (line.startsWith('解决于：')) {
      resolvedAt = line.slice(4).trim();
      continue;
    }

    if (line.startsWith('提交：')) {
      flushMeta();
      const commit = document.createElement('div');
      commit.className = 'contributor-item-commit';
      commit.textContent = `${t('about.contrib.commit')} ${line.slice(3).trim().slice(0, 7)}`;
      item.appendChild(commit);
      continue;
    }

    if (section) {
      if (item) {
        // 未知字段兜底，避免内容丢失
        const extra = document.createElement('p');
        extra.className = 'contributor-item-original';
        extra.textContent = line;
        item.appendChild(extra);
      } else {
        const contact = document.createElement('span');
        contact.className = 'contributor-contact';
        contact.textContent = line;
        section.querySelector('.contributor-header').appendChild(contact);
      }
    }
  }
  flushMeta();
  contributorsListEl.appendChild(frag);
}

async function checkUpdate() {
  const btn = document.getElementById('about-check-update-btn');
  if (!btn) return;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = t('about.checking');
  try {
    const result = await checkForUpdates(APP_VERSION);
    if (result.status === 'noRelease') {
      await showAlert(t('update.noRelease'));
    } else if (result.status === 'update') {
      const meta = result.meta;
      const date = (meta.publishedAt || '').slice(0, 10);
      const want = await showActionDialog(
        t('update.available', {
          name: meta.name || meta.version,
          version: meta.version,
          date,
          url: meta.htmlUrl
        }),
        t('update.now')
      );
      if (want) {
        btn.disabled = true;
        btn.textContent = t('update.downloading');
        await runUpdate(meta);
      }
    } else {
      await showAlert(t('update.upToDate', { version: APP_VERSION }));
    }
  } catch (err) {
    await showAlert(t('update.checkFailed', { message: err.message }));
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

export function initAbout() {
  const versionEl = document.getElementById('about-version-value');
  if (versionEl) versionEl.textContent = APP_VERSION;

  document.getElementById('about-check-update-btn')?.addEventListener('click', checkUpdate);
  document.getElementById('about-repository-btn')?.addEventListener('click', openRepository);
  document.getElementById('about-contributors-btn')?.addEventListener('click', showContributorsModal);
  document.getElementById('contributors-close-btn')?.addEventListener('click', closeContributorsModal);
  contributorsModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeContributorsModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && contributorsModal && contributorsModal.getAttribute('aria-hidden') === 'false') {
      closeContributorsModal();
    }
  });
}
