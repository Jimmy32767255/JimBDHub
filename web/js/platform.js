import { t } from './i18n.js';

function downloadFile(text, fileName, mimeType) {
  const blob = new Blob([text], { type: mimeType || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadJson(jsonString, fileName) {
  downloadFile(jsonString, fileName, 'application/json');
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

function waitForAndroidSyncCallback() {
  return new Promise((resolve, reject) => {
    const previousCallback = window.__androidSyncCallback;
    const previousError = window.__androidSyncError;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(t('platform.androidTimeout')));
    }, 60000);

    const cleanup = () => {
      clearTimeout(timeout);
      window.__androidSyncCallback = previousCallback;
      window.__androidSyncError = previousError;
    };

    window.__androidSyncCallback = (json) => {
      cleanup();
      try {
        resolve(JSON.parse(json));
      } catch {
        resolve({ ok: false, error: t('platform.androidError') });
      }
    };

    window.__androidSyncError = (message) => {
      cleanup();
      reject(new Error(message || t('platform.androidError')));
    };
  });
}

function waitForAndroidBackgroundImageCallback() {
  return new Promise((resolve, reject) => {
    const previousCallback = window.__androidBackgroundImageCallback;
    const previousError = window.__androidBackgroundImageError;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(t('platform.androidTimeout')));
    }, 60000);

    const cleanup = () => {
      clearTimeout(timeout);
      window.__androidBackgroundImageCallback = previousCallback;
      window.__androidBackgroundImageError = previousError;
    };

    window.__androidBackgroundImageCallback = (dataUrl) => {
      cleanup();
      resolve(dataUrl);
    };

    window.__androidBackgroundImageError = (message) => {
      cleanup();
      reject(new Error(message || t('platform.androidError')));
    };
  });
}

function waitForAndroidSystemThemeCallback() {
  return new Promise((resolve) => {
    const previousCallback = window.__androidSystemThemeCallback;
    const previousError = window.__androidSystemThemeError;
    const timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 5000);

    const cleanup = () => {
      clearTimeout(timeout);
      window.__androidSystemThemeCallback = previousCallback;
      window.__androidSystemThemeError = previousError;
    };

    window.__androidSystemThemeCallback = (json) => {
      cleanup();
      try {
        resolve(JSON.parse(json));
      } catch {
        resolve(null);
      }
    };

    window.__androidSystemThemeError = () => {
      cleanup();
      resolve(null);
    };
  });
}

function waitForAndroidAutoBackup() {
  return new Promise((resolve, reject) => {
    const previousCallback = window.__androidAutoBackupCallback;
    const previousError = window.__androidAutoBackupError;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(t('platform.androidTimeout')));
    }, 60000);

    const cleanup = () => {
      clearTimeout(timeout);
      window.__androidAutoBackupCallback = previousCallback;
      window.__androidAutoBackupError = previousError;
    };

    window.__androidAutoBackupCallback = (json) => {
      cleanup();
      try {
        resolve(JSON.parse(json));
      } catch {
        resolve({ ok: false, error: t('platform.androidError') });
      }
    };

    window.__androidAutoBackupError = (message) => {
      cleanup();
      reject(new Error(message || t('platform.androidError')));
    };
  });
}

function waitForAndroidUpdateCallback() {
  return new Promise((resolve, reject) => {
    const previousCallback = window.__androidUpdateCallback;
    const previousError = window.__androidUpdateError;
    // 更新包体积较大，等待时间放宽到 10 分钟
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(t('platform.updateTimeout')));
    }, 600000);

    const cleanup = () => {
      clearTimeout(timeout);
      window.__androidUpdateCallback = previousCallback;
      window.__androidUpdateError = previousError;
    };

    window.__androidUpdateCallback = (json) => {
      cleanup();
      try {
        resolve(JSON.parse(json));
      } catch {
        resolve({ ok: false, error: t('platform.androidError') });
      }
    };

    window.__androidUpdateError = (message) => {
      cleanup();
      reject(new Error(message || t('platform.androidError')));
    };
  });
}

function waitForAndroidBiometricCallback() {
  return new Promise((resolve, reject) => {
    const previousCallback = window.__androidBiometricCallback;
    const previousError = window.__androidBiometricError;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(t('platform.biometricTimeout')));
    }, 120000);

    const cleanup = () => {
      clearTimeout(timeout);
      window.__androidBiometricCallback = previousCallback;
      window.__androidBiometricError = previousError;
    };

    // 认证成功：回调返回保存在 Keystore 中的主密码
    window.__androidBiometricCallback = (password) => {
      cleanup();
      resolve(typeof password === 'string' && password ? password : null);
    };

    window.__androidBiometricError = (message) => {
      cleanup();
      reject(new Error(message || t('platform.biometricFailed')));
    };
  });
}

function waitForDesktopUpdateCallback() {
  return new Promise((resolve, reject) => {
    const previousCallback = window.__desktopUpdateCallback;
    // 更新包体积较大，等待时间放宽到 10 分钟
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(t('platform.updateTimeout')));
    }, 600000);

    const cleanup = () => {
      clearTimeout(timeout);
      window.__desktopUpdateCallback = previousCallback;
    };

    window.__desktopUpdateCallback = (result) => {
      cleanup();
      resolve(result && typeof result === 'object' ? result : { ok: false, error: t('platform.desktopError') });
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

  // 保存任意文本文件（如 Markdown 导出），浏览器端使用指定 MIME 类型下载
  async saveTextFile(text, fileName, mimeType = 'text/markdown') {
    if (this.isAndroid()) {
      window.AndroidBridge.saveTextFile(text, fileName);
      return;
    }
    if (this.isDesktop()) {
      await window.pywebview.api.saveTextFile(text, fileName);
      return;
    }
    downloadFile(text, fileName, mimeType);
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
  },

  isAutoBackupSupported() {
    return this.isAndroid() || this.isDesktop();
  },

  async chooseBackupFolder() {
    if (this.isAndroid() && typeof window.AndroidBridge.chooseBackupFolder === 'function') {
      window.AndroidBridge.chooseBackupFolder();
      return waitForAndroidAutoBackup();
    }
    if (this.isDesktop() && typeof window.pywebview.api.chooseBackupFolder === 'function') {
      return window.pywebview.api.chooseBackupFolder() || { ok: false, error: t('platform.desktopError') };
    }
    return { ok: false, error: t('platform.backupUnsupported') };
  },

  async listAutoBackups(folder) {
    if (this.isAndroid() && typeof window.AndroidBridge.listAutoBackups === 'function') {
      window.AndroidBridge.listAutoBackups(folder);
      return waitForAndroidAutoBackup();
    }
    if (this.isDesktop() && typeof window.pywebview.api.listAutoBackups === 'function') {
      return window.pywebview.api.listAutoBackups(folder) || { ok: false, error: t('platform.desktopError') };
    }
    return { ok: false, error: t('platform.backupUnsupported') };
  },

  async writeAutoBackup(folder, jsonString, maxCount, reason) {
    if (this.isAndroid() && typeof window.AndroidBridge.writeAutoBackup === 'function') {
      window.AndroidBridge.writeAutoBackup(folder, jsonString, maxCount, reason);
      return waitForAndroidAutoBackup();
    }
    if (this.isDesktop() && typeof window.pywebview.api.writeAutoBackup === 'function') {
      return window.pywebview.api.writeAutoBackup(folder, jsonString, maxCount, reason) || { ok: false, error: t('platform.desktopError') };
    }
    return { ok: false, error: t('platform.backupUnsupported') };
  },

  async readAutoBackup(folder, fileName) {
    if (this.isAndroid() && typeof window.AndroidBridge.readAutoBackup === 'function') {
      window.AndroidBridge.readAutoBackup(folder, fileName);
      return waitForAndroidAutoBackup();
    }
    if (this.isDesktop() && typeof window.pywebview.api.readAutoBackup === 'function') {
      return window.pywebview.api.readAutoBackup(folder, fileName) || { ok: false, error: t('platform.desktopError') };
    }
    return { ok: false, error: t('platform.backupUnsupported') };
  },

  async deleteAutoBackup(folder, fileName) {
    if (this.isAndroid() && typeof window.AndroidBridge.deleteAutoBackup === 'function') {
      window.AndroidBridge.deleteAutoBackup(folder, fileName);
      return waitForAndroidAutoBackup();
    }
    if (this.isDesktop() && typeof window.pywebview.api.deleteAutoBackup === 'function') {
      return window.pywebview.api.deleteAutoBackup(folder, fileName) || { ok: false, error: t('platform.desktopError') };
    }
    return { ok: false, error: t('platform.backupUnsupported') };
  },

  isSyncSupported() {
    return this.isAndroid() || this.isDesktop();
  },

  isWidgetSupported() {
    return this.isAndroid() || this.isDesktop();
  },

  isEventReminderSupported() {
    return this.isAndroid();
  },

  isMedicationReminderSupported() {
    return this.isAndroid();
  },

  // 生物认证（指纹 / 面容）：仅 Android 端支持；桌面端暂未实现，纯浏览器不支持
  isBiometricSupported() {
    if (this.isAndroid() && typeof window.AndroidBridge.isBiometricAvailable === 'function') {
      try {
        return window.AndroidBridge.isBiometricAvailable() === true;
      } catch {
        return false;
      }
    }
    return false;
  },

  // 启动生物认证，认证成功后 resolve 主密码（由原生端从 Keystore 读取）
  async authenticateWithBiometric() {
    if (this.isAndroid() && typeof window.AndroidBridge.authenticateWithBiometric === 'function') {
      const p = waitForAndroidBiometricCallback();
      window.AndroidBridge.authenticateWithBiometric();
      return p;
    }
    throw new Error(t('platform.biometricUnsupported'));
  },

  // 将主密码保存到设备安全存储（Android Keystore），供生物认证解锁使用
  async saveMasterPasswordToKeystore(password) {
    if (this.isAndroid() && typeof window.AndroidBridge.saveMasterPasswordToKeystore === 'function') {
      window.AndroidBridge.saveMasterPasswordToKeystore(password);
      return;
    }
    throw new Error(t('platform.biometricUnsupported'));
  },

  // 从设备安全存储移除主密码
  async removeMasterPasswordFromKeystore() {
    if (this.isAndroid() && typeof window.AndroidBridge.removeMasterPasswordFromKeystore === 'function') {
      window.AndroidBridge.removeMasterPasswordFromKeystore();
      return;
    }
    throw new Error(t('platform.biometricUnsupported'));
  },

  async addWidget() {
    if (this.isAndroid()) {
      window.AndroidBridge.addWidget();
      return { ok: true };
    }
    if (this.isDesktop()) {
      return window.pywebview.api.addWidgetShortcut() || { ok: false, error: t('platform.desktopError') };
    }
    return { ok: false, error: t('platform.widgetUnsupported') };
  },

  async pickBackgroundImage() {
    if (this.isAndroid()) {
      window.AndroidBridge.pickBackgroundImage();
      const dataUrl = await waitForAndroidBackgroundImageCallback();
      return dataUrl || null;
    }
    return null;
  },

  async addEventReminder({ title, description, beginTime, endTime }) {
    if (this.isAndroid() && typeof window.AndroidBridge.addCalendarEvent === 'function') {
      window.AndroidBridge.addCalendarEvent(title, description, beginTime, endTime);
      return { ok: true };
    }
    return { ok: false, error: t('platform.reminderUnsupported') };
  },

  async addMedicationReminders({ name, times }) {
    if (this.isAndroid() && typeof window.AndroidBridge.setAlarm === 'function') {
      for (const time of times) {
        const [hour, minute] = time.split(':').map(Number);
        window.AndroidBridge.setAlarm(hour, minute, name);
      }
      return { ok: true };
    }
    return { ok: false, error: t('platform.reminderUnsupported') };
  },

  async getSystemTheme() {
    if (this.isAndroid() && typeof window.AndroidBridge.getSystemTheme === 'function') {
      window.AndroidBridge.getSystemTheme();
      const data = await waitForAndroidSystemThemeCallback();
      return data && typeof data === 'object' ? data : null;
    }
    if (this.isDesktop() && typeof window.pywebview.api.getSystemTheme === 'function') {
      try {
        const data = await window.pywebview.api.getSystemTheme();
        return data && typeof data === 'object' ? data : null;
      } catch {
        return null;
      }
    }
    return null;
  },

  async enableSync() {
    if (this.isAndroid()) {
      window.AndroidBridge.enableSync();
      return waitForAndroidSyncCallback();
    }
    if (this.isDesktop()) {
      return window.pywebview.api.enableSync() || { ok: false, error: t('platform.desktopError') };
    }
    return { ok: false, error: t('platform.syncUnsupported') };
  },

  async disableSync() {
    if (this.isAndroid()) {
      window.AndroidBridge.disableSync();
      return { ok: true };
    }
    if (this.isDesktop()) {
      await window.pywebview.api.disableSync();
      return { ok: true };
    }
    return { ok: false, error: t('platform.syncUnsupported') };
  },

  async writeSyncFile(jsonString) {
    if (this.isAndroid()) {
      window.AndroidBridge.writeSyncFile(jsonString);
      return waitForAndroidSyncCallback();
    }
    if (this.isDesktop()) {
      return window.pywebview.api.writeSyncFile(jsonString) || { ok: false, error: t('platform.desktopError') };
    }
    return { ok: false, error: t('platform.syncUnsupported') };
  },

  onSyncFileChanged(callback) {
    window.__syncthingCallback = callback;
  },

  isUpdateDownloadSupported() {
    return this.isAndroid() || this.isDesktop();
  },

  // 下载更新包并启动安装（下载与 SHA-512 校验在原生端完成），返回 { ok, error?, path? }
  async downloadAndInstallUpdate({ url, sha512, fileName }) {
    if (this.isAndroid() && typeof window.AndroidBridge.downloadAndInstallApk === 'function') {
      const p = waitForAndroidUpdateCallback();
      window.AndroidBridge.downloadAndInstallApk(url, sha512, fileName);
      return p;
    }
    if (this.isDesktop() && typeof window.pywebview.api.downloadUpdate === 'function') {
      const p = waitForDesktopUpdateCallback();
      const started = await window.pywebview.api.downloadUpdate(url, sha512, fileName);
      if (!started || started.ok !== true) {
        return { ok: false, error: (started && started.error) || t('platform.desktopError') };
      }
      return p;
    }
    return { ok: false, error: t('platform.updateUnsupported') };
  },

  // 用系统浏览器打开外部链接；纯浏览器环境退回 window.open
  async openExternalUrl(url) {
    try {
      if (this.isAndroid()) {
        window.AndroidBridge.openUrl(url);
        return;
      }
      if (this.isDesktop()) {
        await window.pywebview.api.openUrl(url);
        return;
      }
      window.open(url, '_blank');
    } catch (err) {
      window.open(url, '_blank');
    }
  }
};
