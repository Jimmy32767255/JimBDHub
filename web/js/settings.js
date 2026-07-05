import { store } from './store.js';
import { platform } from './platform.js';

function defaultFileName() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `jimbdhub_backup_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
}

async function exportBackup() {
  try {
    const data = store.buildBackup();
    const json = JSON.stringify(data, null, 2);
    await platform.saveBackup(json, defaultFileName());
  } catch (err) {
    alert(`导出失败：${err.message}`);
  }
}

async function importBackup(text) {
  try {
    const data = JSON.parse(text);
    if (!store.validateBackup(data)) {
      alert('备份文件格式不正确或版本不匹配。');
      return;
    }
    if (!confirm('导入备份将覆盖当前所有数据，确定继续吗？')) {
      return;
    }
    const ok = store.restoreBackup(data);
    if (ok) {
      alert('导入成功，数据已恢复。');
    } else {
      alert('导入失败，数据格式校验未通过。');
    }
  } catch (err) {
    alert(`导入失败：${err.message}`);
  }
}

async function onImportClick() {
  try {
    const text = await platform.pickBackup();
    if (text) {
      await importBackup(text);
    }
  } catch (err) {
    alert(`导入失败：${err.message}`);
  }
}

export function initSettings() {
  const exportBtn = document.getElementById('export-backup-btn');
  const importBtn = document.getElementById('import-backup-btn');
  const importInput = document.getElementById('import-backup-input');

  exportBtn?.addEventListener('click', exportBackup);
  importBtn?.addEventListener('click', () => {
    if (platform.isAndroid()) {
      onImportClick();
    } else {
      importInput?.click();
    }
  });

  importInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await importBackup(text);
    } catch (err) {
      alert(`读取文件失败：${err.message}`);
    }
    e.target.value = '';
  });
}
