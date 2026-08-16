const dialog = document.getElementById('app-dialog');
const messageEl = document.getElementById('app-dialog-message');
const okBtn = document.getElementById('app-dialog-ok');
const cancelBtn = document.getElementById('app-dialog-cancel');
const backdrop = dialog.querySelector('.modal-backdrop');

let queue = [];
let currentResolve = null;
let autoCloseTimer = null;
// 提示类对话框自动关闭时长（毫秒）
const ALERT_AUTO_CLOSE_MS = 3000;

function processQueue() {
  if (currentResolve || queue.length === 0) return;
  const { message, showCancel, resolve } = queue.shift();
  currentResolve = resolve;
  messageEl.textContent = message;
  cancelBtn.style.display = showCancel ? '' : 'none';
  dialog.setAttribute('aria-hidden', 'false');
  if (showCancel) {
    // 确认类对话框（如删除确认）：backdrop 拦截点击，必须明确选择
    dialog.style.pointerEvents = 'auto';
    backdrop.style.pointerEvents = 'auto';
  } else {
    // 提示类对话框（如"记录已添加"）：容器与 backdrop 不拦截点击，
    // 仅内容区（确定按钮）可交互，用户可直接继续操作，稍后自动关闭
    dialog.style.pointerEvents = 'none';
    backdrop.style.pointerEvents = 'none';
    clearTimeout(autoCloseTimer);
    autoCloseTimer = setTimeout(() => close(true), ALERT_AUTO_CLOSE_MS);
  }
  okBtn.focus();
}

function close(result) {
  if (!currentResolve) return;
  clearTimeout(autoCloseTimer);
  autoCloseTimer = null;
  dialog.style.pointerEvents = '';
  backdrop.style.pointerEvents = '';
  dialog.setAttribute('aria-hidden', 'true');
  currentResolve(result);
  currentResolve = null;
  processQueue();
}

function isCancelVisible() {
  return cancelBtn.style.display !== 'none';
}

okBtn.addEventListener('click', () => close(true));
cancelBtn.addEventListener('click', () => close(false));
backdrop.addEventListener('click', () => close(isCancelVisible() ? false : true));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && dialog.getAttribute('aria-hidden') === 'false') {
    close(isCancelVisible() ? false : true);
  }
});

function open(message, showCancel) {
  return new Promise((resolve) => {
    queue.push({ message, showCancel, resolve });
    processQueue();
  });
}

export function showAlert(message) {
  return open(message, false);
}

export function showConfirm(message) {
  return open(message, true);
}
