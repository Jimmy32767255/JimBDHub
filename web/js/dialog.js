const dialog = document.getElementById('app-dialog');
const messageEl = document.getElementById('app-dialog-message');
const okBtn = document.getElementById('app-dialog-ok');
const cancelBtn = document.getElementById('app-dialog-cancel');
const backdrop = dialog.querySelector('.modal-backdrop');

let queue = [];
let currentResolve = null;

function processQueue() {
  if (currentResolve || queue.length === 0) return;
  const { message, showCancel, resolve } = queue.shift();
  currentResolve = resolve;
  messageEl.textContent = message;
  cancelBtn.style.display = showCancel ? '' : 'none';
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
