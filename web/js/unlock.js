import { store } from './store.js';
import { platform } from './platform.js';
import { t } from './i18n.js';
import { getTheme } from './theme.js';

// 解锁界面与会话自动锁定管理。
// 自动锁定时间存于主题设置 autoLockTimeout（分钟）：-1 永不、0 立即（切到后台即锁定）、1/5/15 空闲超时。

let unlockReady = false;
let onUnlockedCallback = null;
let autoLockTimer = null;
let autoLockDispose = null;

function showUnlockScreen() {
  const el = document.getElementById('unlock-screen');
  if (el) el.hidden = false;
  const input = document.getElementById('unlock-password');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 50);
  }
  const err = document.getElementById('unlock-error');
  if (err) err.textContent = '';
  updateBiometricButton();
}

function hideUnlockScreen() {
  const el = document.getElementById('unlock-screen');
  if (el) el.hidden = true;
}

function updateBiometricButton() {
  const btn = document.getElementById('unlock-biometric-btn');
  if (!btn) return;
  const supported = platform.isBiometricSupported() && getTheme().biometricUnlock === true;
  btn.hidden = !supported;
}

// 绑定解锁界面事件（只绑定一次）。解锁成功后调用 onUnlocked
export function setupUnlockUI(onUnlocked) {
  if (unlockReady) return;
  unlockReady = true;
  onUnlockedCallback = onUnlocked;

  const form = document.getElementById('unlock-form');
  const input = document.getElementById('unlock-password');
  const errEl = document.getElementById('unlock-error');
  const bioBtn = document.getElementById('unlock-biometric-btn');

  async function doUnlock(password) {
    if (!password) return;
    if (errEl) errEl.textContent = '';
    const ok = await store.unlock(password);
    if (ok) {
      if (onUnlockedCallback) await onUnlockedCallback();
    } else {
      if (errEl) errEl.textContent = t('unlock.wrongPassword');
      if (input) {
        input.value = '';
        input.focus();
      }
    }
  }

  form?.addEventListener('submit', e => {
    e.preventDefault();
    doUnlock(input?.value || '');
  });

  bioBtn?.addEventListener('click', async () => {
    bioBtn.disabled = true;
    try {
      const password = await platform.authenticateWithBiometric();
      if (password) {
        await doUnlock(password);
      } else {
        if (errEl) errEl.textContent = t('unlock.biometricFailed');
      }
    } catch (err) {
      if (errEl) errEl.textContent = t('unlock.biometricFailed', { message: err.message });
    } finally {
      bioBtn.disabled = false;
    }
  });
}

// 显示解锁界面（启动或自动锁定后调用）
export function showUnlock() {
  stopAutoLock();
  showUnlockScreen();
}

// 隐藏解锁界面（解锁成功后调用）
export function hideUnlock() {
  hideUnlockScreen();
}

// 会话超时自动锁定：用户在设置中选择的自动锁定时间发生变化时调用 restartAutoLock
export function restartAutoLock(getTimeoutMinutes, onLocked) {
  stopAutoLock();
  if (typeof getTimeoutMinutes !== 'function' || typeof onLocked !== 'function') return;
  const events = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'];

  const arm = () => {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
    const minutes = getTimeoutMinutes();
    if (minutes === undefined || minutes === null || minutes < 0) return; // 永不
    if (minutes === 0) return; // 立即：由 visibilitychange 切后台触发
    autoLockTimer = setTimeout(onLocked, minutes * 60 * 1000);
  };

  const onActivity = () => arm();

  const onVisibility = () => {
    const minutes = getTimeoutMinutes();
    if (document.hidden) {
      if (minutes === 0) {
        onLocked();
      }
    } else if (minutes > 0) {
      // 回到前台：按空闲计时器当前状态处理（超时已由 setTimeout 触发）
      arm();
    } else if (minutes < 0) {
      // 永不：不处理
    }
  };

  events.forEach(ev => document.addEventListener(ev, onActivity, { passive: true, capture: true }));
  document.addEventListener('visibilitychange', onVisibility);

  autoLockDispose = () => {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
    events.forEach(ev => document.removeEventListener(ev, onActivity, { capture: true }));
    document.removeEventListener('visibilitychange', onVisibility);
  };

  arm();
}

// 停止自动锁定计时（锁定期间无需计时）
export function stopAutoLock() {
  clearTimeout(autoLockTimer);
  autoLockTimer = null;
  if (autoLockDispose) {
    autoLockDispose();
    autoLockDispose = null;
  }
}
