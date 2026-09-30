// scanner.js — scanner QR Code 2D lewat kamera.
// Mengutamakan BarcodeDetector (jika browser mendukung QR), lalu memakai jsQR
// sebagai fallback untuk Firefox/Safari/browser yang tidak punya BarcodeDetector.
import { toast, icon } from './ui.js';

const QR_FORMATS = ['qr_code'];
const JSQR_URLS = [
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
  'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js'
];

let jsqrPromise = null;

function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (jsqrPromise) return jsqrPromise;
  jsqrPromise = new Promise((resolve) => {
    let index = 0;
    const tryNext = () => {
      if (window.jsQR) return resolve(window.jsQR);
      if (index >= JSQR_URLS.length) return resolve(null);
      const s = document.createElement('script');
      s.src = JSQR_URLS[index++];
      s.async = true;
      s.onload = () => resolve(window.jsQR || null);
      s.onerror = tryNext;
      document.head.appendChild(s);
    };
    tryNext();
  });
  return jsqrPromise;
}

export async function scanBarcode() {
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('Kamera hanya bisa dipakai lewat HTTPS. Ketik kodenya saja.', 'warn');
    return null;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    });
  } catch (e) {
    toast(e && e.name === 'NotAllowedError'
      ? 'Izin kamera ditolak. Aktifkan izin kamera untuk situs ini di pengaturan browser.'
      : 'Kamera tidak ditemukan atau sedang dipakai aplikasi lain.', 'error');
    return null;
  }

  // QR saja: jangan menerima barcode 1D/Data Matrix.
  let detector = null;
  if ('BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      if (supported.includes('qr_code')) {
        detector = new window.BarcodeDetector({ formats: QR_FORMATS });
      }
    } catch { detector = null; }
  }

  // Firefox umumnya tidak menyediakan BarcodeDetector. Muat decoder QR fallback.
  const qrDecoder = detector ? null : await loadJsQR();

  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'scan-back';
    back.innerHTML = `<video playsinline muted autoplay></video>
      <div class="scan-frame" aria-hidden="true"><i></i></div>
      <div class="scan-bar">
        <p id="shint" role="status">Arahkan kamera ke QR Code 2D</p>
        <form class="scan-manual" id="sman">
          <input id="scode" placeholder="atau ketik kode" autocomplete="off" aria-label="Ketik kode manual">
          <button class="btn small" type="submit">OK</button>
        </form>
        <div class="scan-btns">
          <button class="btn" id="storch" hidden>Senter</button>
          <button class="btn" id="sclose">${icon('x')}Tutup</button>
        </div>
      </div>`;
    document.body.appendChild(back);

    const video = back.querySelector('video');
    video.srcObject = stream;
    video.play().catch(() => {});

    let done = false;
    let timer = null;
    let last = '';
    let hits = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    function finish(value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      stream.getTracks().forEach((t) => t.stop());
      back.remove();
      if (value && navigator.vibrate) navigator.vibrate(60);
      resolve(value || null);
    }

    const onKey = (e) => { if (e.key === 'Escape') finish(null); };
    document.addEventListener('keydown', onKey);
    back.querySelector('#sclose').onclick = () => finish(null);
    back.querySelector('#sman').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = back.querySelector('#scode').value.trim();
      if (v) finish(v);
    });

    // Zoom 2,5x bila kamera/browser menyediakan kontrol zoom.
    const track = stream.getVideoTracks()[0];
    const caps = track && track.getCapabilities ? track.getCapabilities() : {};
    if (caps.zoom) {
      try {
        const min = Number.isFinite(caps.zoom.min) ? caps.zoom.min : 1;
        const max = Number.isFinite(caps.zoom.max) ? caps.zoom.max : 2.5;
        const target = Math.max(min, Math.min(2.5, max));
        awaitZoom(track, target);
      } catch { /* abaikan jika perangkat menolak zoom */ }
    }

    if (caps.torch) {
      const tb = back.querySelector('#storch');
      let on = false;
      tb.hidden = false;
      tb.onclick = async () => {
        on = !on;
        try { await track.applyConstraints({ advanced: [{ torch: on }] }); } catch { /* abaikan */ }
      };
    }

    function scanWithJsQR() {
      if (!qrDecoder || video.readyState < 2 || !video.videoWidth) return '';
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      // Ambil area persegi yang sama dengan bingkai scanner.
      const side = Math.floor(Math.min(vw, vh) * 0.72);
      canvas.width = side;
      canvas.height = side;
      ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, side, side);
      const image = ctx.getImageData(0, 0, side, side);
      const result = qrDecoder(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
      return result && result.data ? result.data : '';
    }

    async function tick() {
      if (done) return;
      let text = '';
      try {
        if (video.readyState >= 2 && video.videoWidth) {
          if (detector) {
            const results = await detector.detect(video);
            const qr = results.find((r) => r.rawValue);
            if (qr) text = qr.rawValue;
          } else {
            text = scanWithJsQR();
          }
        }
      } catch { /* frame gagal dibaca: coba lagi */ }

      if (text) {
        if (text === last) hits++;
        else { last = text; hits = 1; }
        // Dua frame sama untuk mengurangi false positive.
        if (hits >= 2) { finish(text); return; }
      } else {
        hits = 0;
      }
      timer = setTimeout(tick, detector ? 120 : 100);
    }

    timer = setTimeout(tick, 300);
  });
}

async function awaitZoom(track, target) {
  await track.applyConstraints({ advanced: [{ zoom: target }] });
}
