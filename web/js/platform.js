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

  /**
   * 更新全部服药提醒（Android）：按时间点调度，同一时间点的所有药品合并到一个通知。
   * 数据持久化到 SharedPreferences，应用关闭/重启后仍可触发。
   * @param scheduleJson 调度数据 JSON：{ "08:00": ["碳酸锂 1片", "喹硫平 0.5片"], "20:00": [...] }
   */
  async scheduleMedicationReminders(scheduleJson) {
    if (this.isAndroid() && typeof window.AndroidBridge.scheduleMedicationReminders === 'function') {
      window.AndroidBridge.scheduleMedicationReminders(scheduleJson);
      return { ok: true };
    }
    return { ok: false, error: t('platform.reminderUnsupported') };
  },

  /** 取消所有服药提醒（Android） */
  async cancelMedicationReminders() {
    if (this.isAndroid() && typeof window.AndroidBridge.cancelMedicationReminders === 'function') {
      window.AndroidBridge.cancelMedicationReminders();
      return { ok: true };
    }
    return { ok: false, error: t('platform.reminderUnsupported') };
  },

  /** 请求通知权限（Android 13+ 弹系统授权框；已授权或旧系统直接成功） */
  async requestNotificationPermission() {
    if (this.isAndroid() && typeof window.AndroidBridge.requestNotificationPermission === 'function') {
      window.AndroidBridge.requestNotificationPermission();
      return { ok: true };
    }
    return { ok: false, error: t('platform.reminderUnsupported') };
  },

  /** 通知权限是否已授予（Android） */
  hasNotificationPermission() {
    if (this.isAndroid() && typeof window.AndroidBridge.hasNotificationPermission === 'function') {
      return window.AndroidBridge.hasNotificationPermission();
    }
    return true;
  },

  /** 精确闹钟权限是否可用（Android 13+ 恒为 true；Android 12 需在系统设置授权） */
  hasExactAlarmPermission() {
    if (this.isAndroid() && typeof window.AndroidBridge.hasExactAlarmPermission === 'function') {
      return window.AndroidBridge.hasExactAlarmPermission();
    }
    return true;
  },

  /** 跳转系统"闹钟和提醒"设置页授权精确闹钟 */
  openExactAlarmSettings() {
    if (this.isAndroid() && typeof window.AndroidBridge.openExactAlarmSettings === 'function') {
      window.AndroidBridge.openExactAlarmSettings();
      return { ok: true };
    }
    return { ok: false };
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
  }
};
