// ui.js — helper DOM: ikon, toast, modal.

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const P = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.4c2 .7 3 2.6 3 5.6"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  menu: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  swap: '<path d="M7 4v14M3.5 14.5 7 18l3.5-3.5M17 20V6M13.5 9.5 17 6l3.5 3.5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  move: '<path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
};
export const icon = (n) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${P[n] || ''}</svg>`;

export const logoSvg = `<svg viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="96" fill="#1D5FD1"/><g fill="#fff"><rect x="96" y="112" width="140" height="92" rx="10"/><rect x="276" y="112" width="140" height="92" rx="10" opacity=".55"/><rect x="96" y="236" width="140" height="92" rx="10" opacity=".55"/></g><rect x="276" y="236" width="140" height="92" rx="10" fill="#FFB800"/><rect x="96" y="360" width="320" height="40" rx="10" fill="#fff" opacity=".35"/></svg>`;

export function toast(msg, type = 'info') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  while (box.children.length >= 3) box.firstChild.remove();
  box.appendChild(t);
  setTimeout(() => t.remove(), type === 'error' ? 5000 : 2800);
}

export function modal({ title, body, footer = '', dismissible = true, wide = false, onClose, onOpen }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header><h2>${esc(title)}</h2>${dismissible ? `<button class="icon-btn" data-close aria-label="Tutup">${icon('x')}</button>` : ''}</header>
    <div class="modal-body">${body}</div>${footer ? `<footer>${footer}</footer>` : ''}</div>`;
  const prev = document.activeElement;
  const onKey = (e) => { if (e.key === 'Escape' && dismissible) close(); };
  function close() {
    document.removeEventListener('keydown', onKey);
    back.remove();
    if (prev && prev.focus) prev.focus();
    if (onClose) onClose();
  }
  back.addEventListener('click', (e) => {
    if ((e.target === back && dismissible) || e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(back);
  const first = back.querySelector('[autofocus]') || back.querySelector('input:not([readonly]),select,button:not([data-close])');
  if (first) first.focus();
  const api = { el: back, close, $: (s) => back.querySelector(s) };
  if (onOpen) onOpen(api);
  return api;
}

export function confirmDialog(message, okLabel = 'Lanjutkan', danger = false) {
  return new Promise((resolve) => {
    const m = modal({
      title: 'Konfirmasi', body: `<p>${esc(message)}</p>`,
      footer: `<button class="btn" data-close>Batal</button><button class="btn ${danger ? 'danger' : 'primary'}" id="ok">${esc(okLabel)}</button>`,
      onClose: () => resolve(false),
    });
    m.$('#ok').onclick = () => { resolve(true); m.close(); };
  });
}

// Buka pemilih file; resolve(null) bila dibatalkan.
export function pickFile(accept) {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept; i.style.display = 'none';
    document.body.appendChild(i);
    i.addEventListener('change', () => { resolve(i.files[0] || null); i.remove(); });
    i.addEventListener('cancel', () => { resolve(null); i.remove(); });
    i.click();
  });
}
export const today = () => new Date().toISOString().slice(0, 10);
export const safeName = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
