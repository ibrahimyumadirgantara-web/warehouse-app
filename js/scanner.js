// scanner.js — pemindai QR Code 2D lewat kamera.
// Hanya format QR yang digunakan. Barcode 1D sengaja tidak diproses.
// jsQR dipakai sebagai fallback QR ketika BarcodeDetector tidak tersedia.
// Library dimuat hanya saat scanner dibuka agar ukuran awal aplikasi tetap kecil.
let qrLoader = null;
function loadQrDecoder() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (qrLoader) return qrLoader;
  qrLoader = new Promise((resolve, reject) => {
    const urls = [
      'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
      'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js'
    ];
    let i = 0;
    const next = () => {
      if (window.jsQR) return resolve(window.jsQR);
      if (i >= urls.length) return reject(new Error('QR decoder gagal dimuat'));
      const script = document.createElement('script');
      script.src = urls[i++];
      script.async = true;
      script.onload = () => window.jsQR ? resolve(window.jsQR) : next();
      script.onerror = next;
      document.head.appendChild(script);
    };
    next();
  }).catch((e) => { qrLoader = null; throw e; });
  return qrLoader;
}
import { toast, icon } from './ui.js';

const FORMATS = ['qr_code'];

export async function scanBarcode() {
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('Kamera hanya bisa dipakai lewat HTTPS. Ketik kodenya saja.', 'warn');
    return null;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  } catch (e) {
    toast(e && e.name === 'NotAllowedError' ? 'Izin kamera ditolak. Aktifkan izin kamera untuk situs ini di pengaturan browser.' : 'Kamera tidak ditemukan atau sedang dipakai aplikasi lain.', 'error');
    return null;
  }

  let detector = null;
  let qrDecoder = null;
  if ('BarcodeDetector' in window) {
    try {
      const sup = await window.BarcodeDetector.getSupportedFormats();
      const formats = FORMATS.filter((f) => sup.includes(f));
      if (formats.length) detector = new window.BarcodeDetector({ formats });
    } catch { detector = null; }
  }
  // Jika BarcodeDetector tidak mendukung QR, siapkan decoder QR berbasis canvas.
  // Ini penting untuk Firefox/Safari dan browser lain yang belum punya BarcodeDetector.
  if (!detector || !('BarcodeDetector' in window)) {
    try { qrDecoder = await loadQrDecoder(); } catch { qrDecoder = null; }
  }

  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'scan-back';
    back.innerHTML = `<video playsinline muted autoplay></video><div class="scan-frame" aria-hidden="true"><i></i></div>
      <div class="scan-bar"><p id="shint" role="status">Arahkan kamera ke QR Code 2D</p>
        <form class="scan-manual" id="sman"><input id="scode" placeholder="atau ketik kode" autocomplete="off" aria-label="Ketik kode manual"><button class="btn small" type="submit">OK</button></form>
        <div class="scan-btns"><button class="btn" id="storch" hidden>Senter</button><button class="btn" id="sclose">${icon('x')}Tutup</button></div></div>`;
    document.body.appendChild(back);
    const video = back.querySelector('video');
    video.srcObject = stream;
    video.play().catch(() => {});

    let done = false, timer = null, last = '', hits = 0;
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

    const track = stream.getVideoTracks()[0];
    const caps = track && track.getCapabilities ? track.getCapabilities() : {};
    if (caps.torch) {
      const tb = back.querySelector('#storch');
      let on = false;
      tb.hidden = false;
      tb.onclick = async () => { on = !on; try { await track.applyConstraints({ advanced: [{ torch: on }] }); } catch { /* abaikan */ } };
    }

    async function tick() {
      if (done) return;
      let text = '';
      try {
        if (video.readyState >= 2 && video.videoWidth) {
          if (detector) {
            const r = await detector.detect(video);
            if (r.length) text = r[0].rawValue;
          } else {
            // QR adalah kode 2D. Ambil seluruh frame kamera agar QR yang berada
            // sedikit di luar tengah tetap dapat ditemukan. Batasi ukuran untuk menjaga FPS.
            const vw = video.videoWidth, vh = video.videoHeight;
            const scale = Math.min(1, 960 / Math.max(vw, vh));
            const sw = Math.max(1, Math.floor(vw * scale));
            const sh = Math.max(1, Math.floor(vh * scale));
            canvas.width = sw; canvas.height = sh;
            ctx.drawImage(video, 0, 0, vw, vh, 0, 0, sw, sh);

            if (qrDecoder) {
              const image = ctx.getImageData(0, 0, sw, sh);
              const qr = qrDecoder(image.data, sw, sh, { inversionAttempts: 'attemptBoth' });
              if (qr && qr.data) text = qr.data;
            }
          }
        }
      } catch { /* frame gagal dibaca: coba lagi */ }
      if (text) {
        // Pembaca cadangan butuh dua bacaan sama berturut-turut agar tidak salah baca.
        if (detector || text === last) hits++; else { last = text; hits = 1; }
        if (detector || hits >= 2) { finish(text); return; }
      } else hits = 0;
      timer = setTimeout(tick, detector ? 120 : 220);
    }
    timer = setTimeout(tick, 300);
  });
}
