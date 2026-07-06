import { t } from './i18n.js';

function downloadJson(jsonString, fileName) {
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function readJsonFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(t('platform.readError')));
    reader.readAsText(file);
  });
}

function pickFileWithInput() {
  return new Promise((resolve, reject) => {
    let input = document.getElementById('platform-file-input');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.id = 'platform-file-input';
      input.accept = '.json,application/json';
      input.style.display = 'none';
      document.body.appendChild(input);
    }
    input.value = '';

    const onChange = async () => {
      cleanup();
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        const text = await readJsonFromFile(file);
        resolve(text);
      } catch (err) {
        reject(err);
      }
    };

    const onBlur = () => {
      setTimeout(() => {
        if (!input.value) {
          cleanup();
          resolve(null);
        }
      }, 300);
    };

    const cleanup = () => {
      input.removeEventListener('change', onChange);
      window.removeEventListener('focus', onBlur);
    };

    input.addEventListener('change', onChange);
    window.addEventListener('focus', onBlur);
    input.click();
  });
}

function waitForAndroidCallback() {
  return new Promise((resolve, reject) => {
    const previousCallback = window.__androidBackupCallback;
    const previousError = window.__androidBackupError;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(t('platform.androidTimeout')));
    }, 60000);

    const cleanup = () => {
      clearTimeout(timeout);
      window.__androidBackupCallback = previousCallback;
      window.__androidBackupError = previousError;
    };

    window.__androidBackupCallback = (text) => {
      cleanup();
      resolve(text);
    };

    window.__androidBackupError = (message) => {
      cleanup();
      reject(new Error(message || t('platform.androidError')));
    };
  });
}

export const platform = {
  isAndroid() {
    return typeof window.AndroidBridge !== 'undefined';
  },

  isDesktop() {
    return typeof window.pywebview !== 'undefined';
  },

  async saveBackup(jsonString, fileName) {
    if (this.isAndroid()) {
      window.AndroidBridge.saveBackup(jsonString, fileName);
      return;
    }
    if (this.isDesktop()) {
      await window.pywebview.api.saveBackup(jsonString, fileName);
      return;
    }
    downloadJson(jsonString, fileName);
  },

  async pickBackup() {
    if (this.isAndroid()) {
      window.AndroidBridge.pickBackup();
      const text = await waitForAndroidCallback();
      return text;
    }
    if (this.isDesktop()) {
      const text = await window.pywebview.api.pickBackup();
      return text || null;
    }
    return pickFileWithInput();
  }
};
