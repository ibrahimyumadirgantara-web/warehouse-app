// users.js — menu User (khusus admin): buat user, atur hak akses, nonaktifkan, reset password.
import { S, onChange, saveUser, resetPassword } from './store.js';
import { $, esc, icon, modal, toast } from './ui.js';

const MENUS = [['dashboard', 'Dashboard'], ['parts', 'Part & BOM'], ['report', 'Riwayat']];
const accessText = (u) => (u.role === 'admin' ? 'Semua akses' : [...MENUS.filter(([k]) => u.perms && u.perms[k]).map(([, l]) => l), ...(u.perms && u.perms.stock ? ['Ubah data'] : [])].join(' · ') || 'Tanpa akses');

export function mountUsers(root) {
  root.innerHTML = `<section class="pv"><div class="pv-top"><h2 class="ptitle">User &amp; hak akses</h2>
    <div class="pv-acts" style="justify-content:flex-end"><button class="btn small primary" id="newu">${icon('plus')}User baru</button></div></div>
    <div class="pv-body panel" id="ubody"></div></section>`;
  const body = $('#ubody', root);

  function render() {
    const users = S.users.slice().sort((a, b) => (a.role === b.role ? a.username.localeCompare(b.username) : a.role === 'admin' ? -1 : 1));
    body.innerHTML = `<div class="tcount">${users.length} user</div><div class="tbl">` + users.map((u) => `
      <div class="urow${u.active === false ? ' off' : ''}" data-u="${esc(u.username)}">
        <div class="uinfo"><b>${esc(u.name)}</b><span class="muted">${esc(u.username)}${u.username === S.user.username ? ' · Anda' : ''}</span></div>
        <span class="role ${u.role}">${u.role === 'admin' ? 'Admin' : 'User'}</span>
        <span class="muted uacc">${u.active === false ? 'Nonaktif' : esc(accessText(u))}</span>
        <div class="uact"><button class="icon-btn" data-act="edit" aria-label="Ubah ${esc(u.name)}">${icon('edit')}</button>
          <button class="icon-btn" data-act="reset" aria-label="Reset password ${esc(u.name)}">${icon('key')}</button></div></div>`).join('') + '</div>';
  }

  function form(user) {
    const isNew = !user;
    const u = user || { username: '', name: '', role: 'user', perms: { dashboard: true, parts: true, report: false, stock: true }, active: true };
    const self = !isNew && u.username === S.user.username;
    const m = modal({
      title: isNew ? 'User baru' : `Ubah ${u.name}`,
      body: `<form class="form" id="uf" novalidate>
        <label>Username<input name="username" value="${esc(u.username)}" ${isNew ? '' : 'readonly'} autocomplete="off" autocapitalize="off" placeholder="mis. budi.gudang"></label>
        <label>Nama lengkap<input name="name" value="${esc(u.name)}" autocomplete="off"></label>
        ${isNew ? '<label>Password awal<input name="password" type="text" autocomplete="off" placeholder="minimal 6 karakter"></label><p class="muted" style="margin:-4px 0 0;font-size:13px">User diminta menggantinya saat login pertama.</p>' : ''}
        <label>Peran<select name="role" ${self ? 'disabled' : ''}><option value="user"${u.role === 'user' ? ' selected' : ''}>User</option><option value="admin"${u.role === 'admin' ? ' selected' : ''}>Admin (semua akses)</option></select></label>
        <fieldset class="perms" id="perms"><legend>Akses menu</legend>
          ${MENUS.map(([k, l]) => `<label class="radio"><input type="checkbox" name="p_${k}" ${u.role === 'admin' || (u.perms && u.perms[k]) ? 'checked' : ''}> ${l}</label>`).join('')}
          <label class="radio"><input type="checkbox" name="p_stock" ${u.role === 'admin' || (u.perms && u.perms.stock) ? 'checked' : ''}> Boleh ubah data (stok, part, impor Excel, BOM)</label></fieldset>
        ${isNew ? '' : `<label class="radio"><input type="checkbox" name="active" ${u.active !== false ? 'checked' : ''} ${self ? 'disabled' : ''}> Akun aktif</label>`}
        <p class="err" id="uerr" role="alert"></p></form>`,
      footer: '<button class="btn" data-close>Batal</button><button class="btn primary" id="usave">Simpan</button>',
    });
    const f = m.$('#uf');
    const syncPerms = () => { const adm = f.elements.role.value === 'admin'; m.$('#perms').disabled = adm; if (adm) m.$('#perms').querySelectorAll('input').forEach((i) => { i.checked = true; }); };
    f.elements.role.addEventListener('change', syncPerms); syncPerms();
    async function save() {
      const role = self ? u.role : f.elements.role.value;
      const r = await saveUser({
        username: f.elements.username.value, name: f.elements.name.value, role,
        password: isNew ? f.elements.password.value : undefined,
        active: isNew ? true : self ? true : f.elements.active.checked,
        perms: { dashboard: f.elements.p_dashboard.checked, parts: f.elements.p_parts.checked, report: f.elements.p_report.checked, stock: f.elements.p_stock.checked },
      }, isNew);
      if (!r.ok) { m.$('#uerr').textContent = r.error; return; }
      m.close(); toast(isNew ? 'User dibuat' : 'User diperbarui', 'ok');
    }
    m.$('#usave').onclick = save;
    f.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  }

  function reset(u) {
    const m = modal({
      title: `Reset password — ${u.name}`,
      body: `<form class="form" id="rf" novalidate><label>Password baru<input name="p" type="text" autocomplete="off" placeholder="minimal 6 karakter"></label>
        <p class="muted" style="margin:0;font-size:13px">${u.username === S.user.username ? 'Anda akan diminta menggantinya lagi saat login berikutnya.' : 'User diminta menggantinya saat login berikutnya.'}</p><p class="err" id="rerr" role="alert"></p></form>`,
      footer: '<button class="btn" data-close>Batal</button><button class="btn primary" id="rsave">Reset</button>',
    });
    async function save() {
      const r = await resetPassword(u.username, m.$('#rf').elements.p.value);
      if (!r.ok) { m.$('#rerr').textContent = r.error; return; }
      m.close(); toast('Password direset', 'ok');
    }
    m.$('#rsave').onclick = save;
    m.$('#rf').addEventListener('submit', (e) => { e.preventDefault(); save(); });
  }

  $('#newu', root).onclick = () => form(null);
  body.addEventListener('click', (e) => {
    const row = e.target.closest('.urow'), btn = e.target.closest('[data-act]');
    if (!row || !btn) return;
    const u = S.users.find((x) => x.username === row.dataset.u);
    if (!u) return;
    if (btn.dataset.act === 'edit') form(u); else reset(u);
  });

  const off = onChange(render);
  render();
  return { refresh: render, destroy() { off(); } };
}
