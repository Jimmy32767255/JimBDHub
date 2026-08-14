import { t } from './i18n.js';

const dialog = document.getElementById('app-dialog');
const messageEl = document.getElementById('app-dialog-message');
const okBtn = document.getElementById('app-dialog-ok');
const cancelBtn = document.getElementById('app-dialog-cancel');
const backdrop = dialog.querySelector('.modal-backdrop');

let queue = [];
let currentResolve = null;

function processQueue() {
  if (currentResolve || queue.length === 0) return;
  const { message, showCancel, okLabel, resolve } = queue.shift();
  currentResolve = resolve;
  messageEl.textContent = message;
  cancelBtn.style.display = showCancel ? '' : 'none';
  if (okLabel) {
    // 自定义按钮文案：暂存原 data-i18n，避免 updateDOM 语言刷新时覆盖
    okBtn.textContent = okLabel;
    delete okBtn.dataset.i18n;
  } else {
    okBtn.dataset.i18n = 'common.ok';
    okBtn.textContent = t('common.ok');
  }
  dialog.setAttribute('aria-hidden', 'false');
  okBtn.focus();
}

function close(result) {
  if (!currentResolve) return;
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

function open(message, showCancel, okLabel) {
  return new Promise((resolve) => {
    queue.push({ message, showCancel, okLabel, resolve });
    processQueue();
  });
}

export function showAlert(message) {
  return open(message, false);
}

export function showConfirm(message) {
  return open(message, true);
}

// 带自定义确认按钮文案的确认框，点击确认按钮返回 true，取消返回 false
export function showActionDialog(message, actionLabel) {
  return open(message, true, actionLabel);
}
