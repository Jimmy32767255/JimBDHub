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

// 桌面端生物认证能力缓存（null=未知，等待异步探测）；结果变化时通知监听者
let desktopBiometricSupport = null;
let desktopBiometricDetecting = false;
const desktopBiometricListeners = new Set();

function notifyDesktopBiometricSupportChange() {
  desktopBiometricListeners.forEach((fn) => fn());
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

  // 生物认证（指纹 / 面容）：Android 同步原生检测；Windows 桌面端异步探测后缓存结果
  isBiometricSupported() {
    if (this.isAndroid() && typeof window.AndroidBridge.isBiometricAvailable === 'function') {
      try {
        return window.AndroidBridge.isBiometricAvailable() === true;
      } catch {
        return false;
      }
    }
    if (this.isDesktop()) {
      if (desktopBiometricSupport === null) {
        // 首次调用触发异步探测；完成前按不支持处理，完成后通过监听器刷新 UI
        this.refreshBiometricSupport();
      }
      return desktopBiometricSupport === true;
    }
    return false;
  },

  // 异步探测桌面端生物认证能力并缓存；结果变化时通知 onBiometricSupportChange 监听者
  async refreshBiometricSupport() {
    if (!this.isDesktop() || desktopBiometricDetecting) {
      return;
    }
    if (typeof window.pywebview.api === 'undefined') {
      // 桥接尚未就绪（页面加载完成前 pywebview 才注入 api），由 whenDesktopReady 稍后重试
      return;
    }
    desktopBiometricDetecting = true;
    try {
      let supported = false;
      if (typeof window.pywebview.api.isBiometricAvailable === 'function') {
        try {
          const value = await window.pywebview.api.isBiometricAvailable();
          supported = value === true;
        } catch {
          supported = false;
        }
      }
      desktopBiometricSupport = supported;
      notifyDesktopBiometricSupportChange();
    } finally {
      desktopBiometricDetecting = false;
    }
  },

  // 订阅桌面端生物认证能力变化（如解锁界面按钮、设置面板需要据此刷新）
  onBiometricSupportChange(fn) {
    desktopBiometricListeners.add(fn);
    return () => desktopBiometricListeners.delete(fn);
  },

  // 启用桌面端窗口焦点监测（仅桌面端生效；结果由 onDesktopFocusChange 推送）
  async enableFocusMonitoring() {
    if (this.isDesktop() && typeof window.pywebview.api.watchFocusLoss === 'function') {
      try {
        await window.pywebview.api.watchFocusLoss();
      } catch {
        // 监测不可用则忽略，前端回退到 visibilitychange
      }
    }
  },

  // 订阅桌面端窗口焦点变化（true=获得焦点，false=失去焦点），用于"立即锁定"
  onDesktopFocusChange(fn) {
    if (!this.isDesktop()) return () => {};
    const handler = (hasFocus) => fn(hasFocus === true);
    window.__desktopFocusChanged = handler;
    return () => {
      if (window.__desktopFocusChanged === handler) {
        window.__desktopFocusChanged = null;
      }
    };
  },

  // 启动生物认证，认证成功后 resolve 主密码（由原生端从安全存储读取）
  async authenticateWithBiometric() {
    if (this.isAndroid() && typeof window.AndroidBridge.authenticateWithBiometric === 'function') {
      const p = waitForAndroidBiometricCallback();
      window.AndroidBridge.authenticateWithBiometric();
      return p;
    }
    if (this.isDesktop() && typeof window.pywebview.api.authenticateWithBiometric === 'function') {
      const res = await window.pywebview.api.authenticateWithBiometric();
      if (res && res.ok && typeof res.password === 'string' && res.password) {
        return res.password;
      }
      throw new Error((res && res.error) || t('platform.biometricFailed'));
    }
    throw new Error(t('platform.biometricUnsupported'));
  },

  // 将主密码保存到设备安全存储（Android Keystore / Windows Credential Manager），供生物认证解锁使用
  async saveMasterPasswordToKeystore(password) {
    if (this.isAndroid() && typeof window.AndroidBridge.saveMasterPasswordToKeystore === 'function') {
      window.AndroidBridge.saveMasterPasswordToKeystore(password);
      return;
    }
    if (this.isDesktop() && typeof window.pywebview.api.saveMasterPasswordToKeystore === 'function') {
      const res = await window.pywebview.api.saveMasterPasswordToKeystore(password);
      if (res && res.ok) return;
      throw new Error((res && res.error) || t('platform.biometricFailed'));
    }
    throw new Error(t('platform.biometricUnsupported'));
  },

  // 从设备安全存储移除主密码
  async removeMasterPasswordFromKeystore() {
    if (this.isAndroid() && typeof window.AndroidBridge.removeMasterPasswordFromKeystore === 'function') {
      window.AndroidBridge.removeMasterPasswordFromKeystore();
      return;
    }
    if (this.isDesktop() && typeof window.pywebview.api.removeMasterPasswordFromKeystore === 'function') {
      const res = await window.pywebview.api.removeMasterPasswordFromKeystore();
      if (res && res.ok) return;
      throw new Error((res && res.error) || t('platform.biometricFailed'));
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

// pywebview 在页面加载完成（loadFinished）后才注入 window.pywebview.api，
// 因此 ES 模块顶层不能直接调用桥接方法：等待桥接就绪后再启用生物认证探测与窗口焦点监测。
function whenDesktopReady(fn) {
  if (typeof window === 'undefined') return;
  let done = false;
  const timer = setInterval(() => {
    if (done) return;
    if (
      typeof window.pywebview !== 'undefined' &&
      typeof window.pywebview.api !== 'undefined' &&
      (typeof window.pywebview.api.watchFocusLoss === 'function' ||
        typeof window.pywebview.api.isBiometricAvailable === 'function')
    ) {
      done = true;
      clearInterval(timer);
      fn();
    }
  }, 150);
  // 兜底：最多等待 15 秒，避免无谓占用
  setTimeout(() => {
    if (!done) {
      clearInterval(timer);
      done = true;
    }
  }, 15000);
}

if (typeof window !== 'undefined') {
  whenDesktopReady(() => {
    platform.refreshBiometricSupport();
    platform.enableFocusMonitoring();
  });
}
