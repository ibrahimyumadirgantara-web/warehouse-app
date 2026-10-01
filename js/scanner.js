// scanner.js — pindai QR code lewat kamera. Memakai BarcodeDetector bila ada, dan selalu punya
// pembaca QR cadangan (qr.js) untuk browser tanpa BarcodeDetector (mis. iPhone/Safari, Firefox).
// Kamera di-zoom 3x dan hanya area di dalam kotak yang dibaca, jadi QR lain di sekitarnya tidak ikut terbaca.
// Resolve: teks kode, atau null bila dibatalkan.
import { decodeCanvas } from './qr.js';
import { toast, icon } from './ui.js';

const FORMATS = ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'codabar', 'data_matrix'];
const ZOOM = 3;       // pembesaran awal
const MAX_SIDE = 640; // sisi terbesar gambar yang dikirim ke pembaca (px)

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
    back.innerHTML = `<video playsinline muted autoplay></video><div class="scan-frame" aria-hidden="true"></div>
      <div class="scan-bar"><p id="shint" role="status">Arahkan kamera ke QR code</p>
        <form class="scan-manual" id="sman"><input id="scode" placeholder="atau ketik kode" autocomplete="off" aria-label="Ketik kode manual"><button class="btn small" type="submit">OK</button></form>
        <div class="scan-btns"><button class="btn" id="szoom" type="button" hidden></button><button class="btn" id="storch" type="button" hidden>Senter</button><button class="btn" id="sclose" type="button">${icon('x')}Tutup</button></div></div>`;
    document.body.appendChild(back);
    const video = back.querySelector('video');
    const frame = back.querySelector('.scan-frame');
    video.srcObject = stream;
    video.play().catch(() => {});

    let done = false, timer = null;
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

    // Fokus otomatis terus-menerus bila didukung.
    if (caps.focusMode && caps.focusMode.includes('continuous')) {
      track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    }

    // Senter
    if (caps.torch) {
      const tb = back.querySelector('#storch');
      let on = false;
      tb.hidden = false;
      tb.onclick = async () => { on = !on; try { await track.applyConstraints({ advanced: [{ torch: on }] }); } catch { /* abaikan */ } };
    }

    // Zoom: pakai zoom kamera asli bila ada (lebih tajam). Sisa pembesaran dibuat digital (CSS + potong gambar).
    let digital = 1;
    async function setZoom(level) {
      let applied = 1;
      if (caps.zoom && typeof caps.zoom.max === 'number') {
        const target = Math.min(Math.max(level, caps.zoom.min || 1), caps.zoom.max);
        try {
          await track.applyConstraints({ advanced: [{ zoom: target }] });
          const s = track.getSettings ? track.getSettings() : {};
          applied = typeof s.zoom === 'number' ? s.zoom : target;
        } catch { applied = 1; }
      }
      digital = Math.max(1, level / Math.max(applied, 0.01));
      video.style.transform = digital > 1.01 ? `scale(${digital})` : '';
      zb.textContent = level > 1 ? `Zoom ${level}×` : 'Zoom 1×';
    }
    let level = ZOOM;
    const zb = back.querySelector('#szoom');
    zb.hidden = false;
    zb.onclick = () => { level = level > 1 ? 1 : ZOOM; setZoom(level); };
    setZoom(level);

    // Ubah posisi kotak di layar → area di dalam gambar video (memperhitungkan object-fit: cover dan zoom digital).
    function cropRect() {
      const vw = video.videoWidth, vh = video.videoHeight;
      const W = back.clientWidth, H = back.clientHeight;
      const fr = frame.getBoundingClientRect(), br = back.getBoundingClientRect();
      const s = Math.max(W / vw, H / vh);
      const ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
      const toVideo = (px, py) => {
        const qx = W / 2 + (px - W / 2) / digital, qy = H / 2 + (py - H / 2) / digital;
        return [(qx - ox) / s, (qy - oy) / s];
      };
      const [x0, y0] = toVideo(fr.left - br.left, fr.top - br.top);
      const [x1, y1] = toVideo(fr.right - br.left, fr.bottom - br.top);
      const sx = Math.max(0, Math.floor(x0)), sy = Math.max(0, Math.floor(y0));
      return { sx, sy, sw: Math.max(8, Math.min(vw, Math.ceil(x1)) - sx), sh: Math.max(8, Math.min(vh, Math.ceil(y1)) - sy) };
    }

    async function tick() {
      if (done) return;
      let text = '';
      try {
        if (video.readyState >= 2 && video.videoWidth) {
          const { sx, sy, sw, sh } = cropRect();
          const k = Math.min(1, MAX_SIDE / Math.max(sw, sh));
          canvas.width = Math.max(8, Math.round(sw * k));
          canvas.height = Math.max(8, Math.round(sh * k));
          ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
          if (detector) {
            try { const r = await detector.detect(canvas); if (r.length) text = r[0].rawValue; } catch { /* lanjut ke cadangan */ }
          }
          if (!text) {
            const r = decodeCanvas(canvas);
            if (r) text = r.text;
          }
        }
      } catch { /* frame gagal dibaca: coba lagi */ }
      if (text) { finish(text); return; }
      timer = setTimeout(tick, 100);
    }
    timer = setTimeout(tick, 300);
  });
}
