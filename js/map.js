// map.js — denah rak (SVG). Selalu tampil utuh (viewBox tetap, tanpa scroll).
import { MAP_W, MAP_H, CELL_W, CELL_H, RACK_HEAD, ROW1_ON_TOP, rackSize, snap, clamp } from './core.js';
import { esc } from './ui.js';

export function createMap(host, opts) {
  host.innerHTML = `<svg class="map" viewBox="0 0 ${MAP_W} ${MAP_H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Denah rak gudang"></svg>`;
  const svg = host.firstElementChild;
  let racks = [], edit = false, drag = null;

  const toMap = (e) => {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  };

  function rackSvg(r, occ, hits) {
    const { w, h } = rackSize(r);
    const hasHit = [...hits].some((c) => c.charAt(0) === r.id);
    let s = `<g class="rack${hasHit ? ' has-hit' : ''}" data-id="${esc(r.id)}" transform="translate(${r.x} ${r.y})">`;
    s += `<rect class="rack-body" width="${w}" height="${h}" rx="6"/>`;
    s += `<rect class="rack-head" width="${w}" height="${RACK_HEAD}" rx="6"/>`;
    s += `<text class="rack-label" x="${w / 2}" y="${RACK_HEAD / 2 + 5}">Rak ${esc(r.id)}</text>`;
    for (let row = 1; row <= r.rows; row++) {
      for (let col = 1; col <= r.cols; col++) {
        const code = `${r.id}${col}${row}`;
        const x = (col - 1) * CELL_W;
        const y = RACK_HEAD + (ROW1_ON_TOP ? row - 1 : r.rows - row) * CELL_H;
        const hit = hits.has(code);
        s += `<g class="cell${occ.has(code) ? ' occ' : ''}${hit ? ' hit' : ''}" data-code="${code}">` +
          `<rect x="${x + 2}" y="${y + 2}" width="${CELL_W - 4}" height="${CELL_H - 4}" rx="4"/>` +
          (hit ? `<text x="${x + CELL_W / 2}" y="${y + CELL_H / 2 + 6}">${code}</text>` : '') + `</g>`;
      }
    }
    return s + '</g>';
  }

  function render(rs, occ, hits, isEdit) {
    racks = rs; edit = isEdit;
    svg.classList.toggle('editing', edit);
    svg.innerHTML =
      `<defs><pattern id="g" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="var(--grid)" stroke-width="1"/></pattern></defs>` +
      `<rect class="floor" width="${MAP_W}" height="${MAP_H}"/><rect width="${MAP_W}" height="${MAP_H}" fill="url(#g)"/>` +
      rs.map((r) => rackSvg(r, occ, hits)).join('');
  }

  svg.addEventListener('pointerdown', (e) => {
    if (!edit) return;
    const g = e.target.closest('.rack');
    if (!g) return;
    const r = racks.find((x) => x.id === g.dataset.id);
    const p = toMap(e);
    drag = { r, g, dx: p.x - r.x, dy: p.y - r.y, sx: p.x, sy: p.y, moved: false };
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = toMap(e);
    if (!drag.moved && Math.hypot(p.x - drag.sx, p.y - drag.sy) < 5) return;
    drag.moved = true;
    const { w, h } = rackSize(drag.r);
    drag.nx = clamp(snap(p.x - drag.dx), 0, MAP_W - w);
    drag.ny = clamp(snap(p.y - drag.dy), 0, MAP_H - h);
    drag.g.setAttribute('transform', `translate(${drag.nx} ${drag.ny})`);
  });
  svg.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.moved) opts.onRackMove(d.r, d.nx, d.ny); else opts.onRackTap(d.r);
  });
  svg.addEventListener('pointercancel', () => {
    if (!drag) return;
    drag.g.setAttribute('transform', `translate(${drag.r.x} ${drag.r.y})`); drag = null;
  });
  svg.addEventListener('click', (e) => {
    if (edit) return;
    const c = e.target.closest('.cell');
    if (c) opts.onCellTap(c.dataset.code);
  });

  // Satuan peta per piksel layar → teks tetap terbaca di HP.
  const fit = () => {
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    svg.style.setProperty('--u', (1 / Math.min(r.width / MAP_W, r.height / MAP_H)).toFixed(3));
  };
  if (window.ResizeObserver) new ResizeObserver(fit).observe(svg);
  fit();

  return { render };
}
