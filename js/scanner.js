// scanner.js — pindai barcode lewat kamera. Memakai BarcodeDetector bila ada (QR, Code128, EAN, dll.),
// jika tidak memakai pembaca 1D bawaan (barcode.js). Resolve: teks kode, atau null bila dibatalkan.
import { decodeCanvas } from './barcode.js';
import { toast, icon } from './ui.js';

const FORMATS = ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'codabar', 'data_matrix'];

export async function scanBarcode() {
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('Kamera hanya bisa dipakai lewat HTTPS. Ketik kodenya saja.', 'warn');
    return null;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
  } catch (e) {
    toast(e && e.name === 'NotAllowedError' ? 'Izin kamera ditolak. Aktifkan izin kamera untuk situs ini di pengaturan browser.' : 'Kamera tidak ditemukan atau sedang dipakai aplikasi lain.', 'error');
    return null;
  }

  let detector = null;
  if ('BarcodeDetector' in window) {
    try {
      const sup = await window.BarcodeDetector.getSupportedFormats();
      const formats = FORMATS.filter((f) => sup.includes(f));
      if (formats.length) detector = new window.BarcodeDetector({ formats });
    } catch { detector = null; }
  }

  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'scan-back';
    back.innerHTML = `<video playsinline muted autoplay></video><div class="scan-frame" aria-hidden="true"><i></i></div>
      <div class="scan-bar"><p id="shint" role="status">Arahkan kamera ke barcode</p>
        <form class="scan-manual" id="sman"><input id="scode" placeholder="atau ketik kode" autocomplete="off" aria-label="Ketik kode manual"><button class="btn small" type="submit">OK</button></form>
        <div class="scan-btns"><button class="btn" id="storch" hidden>Senter</button><button class="btn" id="sclose">${icon('x')}Tutup</button></div></div>`;
    document.body.appendChild(back);
    const video = back.querySelector('video');
    video.srcObject = stream;
    video.play().catch(() => {});

    let done = false, timer = null, last = '', hits = 0;
    const canvas = document.createElement('canvas');

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

    // Perbesar kamera untuk QR 2D. Tidak semua perangkat/browser mendukung
    // kontrol zoom, jadi hanya diterapkan jika capability zoom tersedia.
    if (caps.zoom) {
      try {
        const targetZoom = Math.max(caps.zoom.min ?? 1, Math.min(2.5, caps.zoom.max ?? 2.5));
        await track.applyConstraints({ advanced: [{ zoom: targetZoom }] });
      } catch { /* perangkat tidak mendukung penerapan zoom */ }
    }

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
            // QR 2D dibaca dari area persegi di tengah, sesuai bingkai scanner.
            const vw = video.videoWidth, vh = video.videoHeight;
            const side = Math.floor(Math.min(vw, vh) * 0.72);
            canvas.width = side; canvas.height = side;
            canvas.getContext('2d', { willReadFrequently: true }).drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, side, side);
            const r = decodeCanvas(canvas);
            if (r) text = r.text;
          }
        }
      } catch { /* frame gagal dibaca: coba lagi */ }
      if (text) {
        // Pembaca cadangan butuh dua bacaan sama berturut-turut agar tidak salah baca.
        if (detector || text === last) hits++; else { last = text; hits = 1; }
        if (detector || hits >= 2) { finish(text); return; }
      } else hits = 0;
      timer = setTimeout(tick, detector ? 120 : 140);
    }
    timer = setTimeout(tick, 300);
  });
}
