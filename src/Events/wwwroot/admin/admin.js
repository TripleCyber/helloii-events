const view = document.getElementById('view');
const STATES = { open: 'Abierto', notYet: 'Próximo', closed: 'Cerrado', cancelled: 'Cancelado' };
const DEFAULT_THEME = { background: '#06090F', accent: '#86EE60', glow: '#2E6E65', button: ['#B9F7A0', '#6FE38A', '#1FB255'], buttonText: '#04210F' };
const PRESETS = [
  ['Helloii', DEFAULT_THEME],
  ['Coral', { background: '#170B1E', accent: '#FF8A5B', glow: '#7A2E5C', button: ['#FFC2A6', '#FF8A5B', '#E8553A'], buttonText: '#2A0E06' }],
  ['Azul', { background: '#08111F', accent: '#7CC4FF', glow: '#1E3A8A', button: ['#BFE3FF', '#7CC4FF', '#2F7DE1'], buttonText: '#04172E' }],
  ['Violeta', { background: '#120A1F', accent: '#C084FC', glow: '#5B21B6', button: ['#E9D5FF', '#C084FC', '#7C3AED'], buttonText: '#1E0A33' }],
];
const MAX = { poster: 2 * 1024 * 1024, logo: 512 * 1024 };
let refreshTimer = 0;

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const fill = (el, ...children) => el.replaceChildren(...children.flat().filter((c) => c != null && c !== false));

async function api(path, { method = 'GET', body, type } = {}) {
  const headers = { 'X-Events-Admin': '1' };
  if (body !== undefined && !(body instanceof Blob)) headers['Content-Type'] = 'application/json';
  if (type) headers['Content-Type'] = type;
  const res = await fetch(`api/admin${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error('request failed'), { status: res.status, errors: data?.errors || [`Error ${res.status}`] });
  return data;
}

function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 2600);
}

const pad = (n) => String(n).padStart(2, '0');
const toLocal = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocal = (value) => (value ? new Date(value).toISOString() : null);
const dateFmt = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('es', { hour: 'numeric', minute: '2-digit' });
const fmt = (iso) => (iso ? dateFmt.format(new Date(iso)) : '');
const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => Array.from(w)[0]).join('').toUpperCase() || '?';

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copiado');
  } catch (_) {
    prompt('Copia el enlace:', text);
  }
}

// ---------- List ----------

async function renderList() {
  fill(view, h('p', { class: 'sub' }, 'Cargando…'));
  const events = await api('/events');
  const list = h('div', { class: 'list' });
  if (!events.length) list.append(h('div', { class: 'empty' }, 'Todavía no hay eventos. Crea el primero con «Nuevo evento».'));
  for (const e of events) {
    list.append(h('div', { class: 'card' },
      h('div', { class: 'card-main' },
        h('div', { class: 'card-title' }, e.title, ' ', h('span', { class: `chip ${e.state}` }, STATES[e.state] || e.state),
          e.debug ? h('span', { class: 'chip' }, 'debug') : null),
        h('div', { class: 'card-meta' }, `${fmt(e.startsAt)} → ${fmt(e.endsAt)} · ${e.code}`)),
      h('div', { class: 'card-count' }, h('strong', {}, e.attendeeCount), h('span', { class: 'sub' }, 'asistentes')),
      h('div', { class: 'card-actions' },
        h('a', { class: 'btn btn-sm', href: `#/evento/${e.code}` }, 'Editar'),
        h('a', { class: 'btn btn-sm', href: `#/evento/${e.code}/asistencia` }, 'Asistencia'))));
  }
  fill(view, h('div', { class: 'page-head' }, h('h1', {}, 'Eventos')), list);
}

// ---------- Editor ----------

// Modificado por Yerardy Castillo: ampliar el póster sin modificar los datos del evento.
function openPoster(url, description) {
  const dialog = h('dialog', { class: 'poster-modal', 'aria-label': description },
    h('button', { type: 'button', class: 'btn poster-modal-close', 'aria-label': 'Cerrar imagen', onclick: () => dialog.close() }, '✕'),
    h('img', { src: url, alt: description }));
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

function blankEvent() {
  const start = new Date();
  start.setDate(start.getDate() + 7);
  start.setHours(18, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 0, 0, 0);
  return {
    code: '', title: '', description: '', venue: '',
    organizer: { name: '', color: '#0F1E29', logoMediaId: null, logoUrl: null },
    startsAt: start.toISOString(), endsAt: end.toISOString(), checkInOpensAt: null, checkInClosesAt: null,
    cancelled: false, theme: structuredClone(DEFAULT_THEME), posters: [],
    debug: false, kioskOrientation: 'auto',
  };
}

async function renderEditor(code) {
  fill(view, h('p', { class: 'sub' }, 'Cargando…'));
  const creating = !code;
  const ev = creating ? blankEvent() : await api(`/events/${encodeURIComponent(code)}`);
  ev.theme = { ...structuredClone(DEFAULT_THEME), ...(ev.theme || {}) };
  const phone = h('div', { class: 'phone' });
  const errorsBox = h('div', { class: 'errors', hidden: true });

  const field = (label, input, hint) => h('label', {}, label, input, hint ? h('span', { class: 'hint' }, hint) : null);
  const text = (value, onInput, attrs = {}) => h('input', { type: 'text', value: value || '', oninput: (e) => { onInput(e.target.value); preview(); }, ...attrs });
  const when = (value, onInput) => h('input', { type: 'datetime-local', value: toLocal(value), oninput: (e) => { onInput(fromLocal(e.target.value)); preview(); } });
  const color = (get, set) => {
    const picker = h('input', { type: 'color', value: get() });
    const hex = h('input', { type: 'text', value: get(), maxlength: 7 });
    picker.addEventListener('input', () => { set(picker.value.toUpperCase()); hex.value = get(); preview(); });
    hex.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) { set(hex.value.toUpperCase()); picker.value = hex.value; preview(); } });
    return h('div', { class: 'color' }, picker, hex);
  };

  async function upload(kind, file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw Object.assign(new Error(), { errors: ['Sólo JPG, PNG o WebP'] });
    if (file.size > MAX[kind]) throw Object.assign(new Error(), { errors: [`La imagen pesa más de ${MAX[kind] / 1024 / 1024} MB`] });
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    const saved = await api(`/media?kind=${kind}`, { method: 'POST', body: file, type: file.type });
    return { ...saved, ...size };
  }

  const postersBox = h('div', { class: 'posters' });
  function drawPosters() {
    fill(postersBox, 
      ...ev.posters.map((p, i) => h('div', { class: 'poster-item' },
        h('button', { type: 'button', class: 'poster-preview', 'aria-label': `Ampliar póster ${i + 1}`, onclick: () => openPoster(p.url, `Póster ${i + 1} de ${ev.title || 'este evento'}`) },
          h('img', { src: p.url, alt: '' })),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-sm', disabled: i === 0, onclick: () => { [ev.posters[i - 1], ev.posters[i]] = [ev.posters[i], ev.posters[i - 1]]; drawPosters(); preview(); } }, '←'),
          h('button', { class: 'btn btn-sm btn-danger', onclick: () => { ev.posters.splice(i, 1); drawPosters(); preview(); } }, '✕'),
          h('button', { class: 'btn btn-sm', disabled: i === ev.posters.length - 1, onclick: () => { [ev.posters[i + 1], ev.posters[i]] = [ev.posters[i], ev.posters[i + 1]]; drawPosters(); preview(); } }, '→')))),
      ev.posters.length < 8 ? h('label', { class: 'upload' }, 'Subir póster',
        h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, hidden: true, onchange: async (e) => {
          for (const file of e.target.files) {
            try {
              const p = await upload('poster', file);
              ev.posters.push({ mediaId: p.mediaId, url: p.url, width: p.width, height: p.height });
            } catch (err) { showErrors(err.errors); }
          }
          drawPosters();
          preview();
        } })) : null);
  }

  const logoBox = h('div', { class: 'logo-row' });
  function drawLogo() {
    fill(logoBox, 
      h('div', { class: 'logo', style: `--org:${ev.organizer.color}` }, ev.organizer.logoUrl ? h('img', { src: ev.organizer.logoUrl, alt: '' }) : initials(ev.organizer.name)),
      h('label', { class: 'btn btn-sm' }, ev.organizer.logoUrl ? 'Cambiar logo' : 'Subir logo',
        h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true, onchange: async (e) => {
          try {
            const logo = await upload('logo', e.target.files[0]);
            ev.organizer.logoMediaId = logo.mediaId;
            ev.organizer.logoUrl = logo.url;
            drawLogo();
            preview();
          } catch (err) { showErrors(err.errors); }
        } })),
      ev.organizer.logoUrl ? h('button', { class: 'btn btn-sm btn-danger', onclick: () => { ev.organizer.logoMediaId = null; ev.organizer.logoUrl = null; drawLogo(); preview(); } }, 'Quitar') : null);
  }

  function preview() {
    const th = ev.theme;
    phone.style.cssText = `--bg:${th.background};--accent:${th.accent};--glow:${th.glow};--btn-a:${th.button[0]};--btn-b:${th.button[1]};--btn-c:${th.button[2]};--btn-text:${th.buttonText};--org:${ev.organizer.color}`;
    const poster = h('div', { class: 'ph-poster' });
    const first = ev.posters[0];
    if (first) {
      if (first.height / first.width < 1.25) poster.append(h('img', { class: 'blur', src: first.url, alt: '' }), h('img', { class: 'fit', src: first.url, alt: '' }));
      else poster.append(h('img', { src: first.url, alt: '' }));
    } else {
      poster.append(ev.organizer.logoUrl ? h('div', { class: 'logo', style: 'width:96px;height:96px' }, h('img', { src: ev.organizer.logoUrl, alt: '' })) : initials(ev.organizer.name || ev.title));
    }
    if (ev.organizer.name) {
      poster.append(h('div', { class: 'ph-org' }, h('div', { class: 'logo' }, ev.organizer.logoUrl ? h('img', { src: ev.organizer.logoUrl, alt: '' }) : initials(ev.organizer.name)), ev.organizer.name));
    }
    const start = new Date(ev.startsAt);
    const end = new Date(ev.endsAt);
    fill(phone, 
      poster,
      ev.cancelled ? h('div', { class: 'ph-stamp' }, 'CANCELADO') : null,
      h('div', { class: 'ph-info' },
        h('div', { class: 'ph-title' }, ev.title || 'Título del evento'),
        h('div', { class: 'ph-meta' }, isNaN(start) ? '' : `${dateFmt.format(start)} – ${isNaN(end) ? '' : timeFmt.format(end)}`),
        ev.venue ? h('div', { class: 'ph-meta' }, ev.venue) : null,
        h('div', { class: 'ph-chip' }, h('i'), '128 personas ya están aquí')),
      h('div', { class: 'ph-bottom' },
        h('div', { class: 'ph-who' }, 'Saldrás en la pantalla como Juanito'),
        h('div', { class: 'ph-btn' }, 'Aquí estoy')));
  }

  function showErrors(list) {
    errorsBox.replaceChildren(...(list || []).map((e) => h('div', {}, e)));
    errorsBox.hidden = !list?.length;
    if (list?.length) errorsBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function save() {
    showErrors([]);
    const body = {
      code: creating ? ev.code || null : undefined,
      title: ev.title, description: ev.description, venue: ev.venue,
      organizer: { name: ev.organizer.name, color: ev.organizer.color, logoMediaId: ev.organizer.logoMediaId },
      startsAt: ev.startsAt, endsAt: ev.endsAt, checkInOpensAt: ev.checkInOpensAt, checkInClosesAt: ev.checkInClosesAt,
      cancelled: ev.cancelled, theme: ev.theme, debug: ev.debug, kioskOrientation: ev.kioskOrientation,
      posters: ev.posters.map((p) => ({ mediaId: p.mediaId, width: p.width, height: p.height })),
    };
    try {
      const saved = creating
        ? await api('/events', { method: 'POST', body })
        : await api(`/events/${encodeURIComponent(code)}`, { method: 'PUT', body });
      toast('Guardado');
      if (creating) location.hash = `#/evento/${saved.code}`;
      else renderEditor(saved.code);
    } catch (err) {
      showErrors(err.errors);
    }
  }

  async function remove() {
    if (!confirm(`¿Borrar «${ev.title}»? También se borra su asistencia.`)) return;
    await api(`/events/${encodeURIComponent(code)}`, { method: 'DELETE' });
    toast('Evento borrado');
    location.hash = '#/';
  }

  const theme = ev.theme;
  const form = h('div', { class: 'form' },
    errorsBox,
    h('section', { class: 'section' }, h('h2', {}, 'Evento'),
      field('Título', text(ev.title, (v) => (ev.title = v), { maxlength: 120, required: true })),
      field('Descripción', h('textarea', { maxlength: 2000, oninput: (e) => { ev.description = e.target.value; } }, ev.description || '')),
      h('div', { class: 'grid2' },
        field('Lugar', text(ev.venue, (v) => (ev.venue = v), { maxlength: 200 })),
        creating
          ? field('Código del QR', text(ev.code, (v) => (ev.code = v.trim()), { maxlength: 16, placeholder: 'automático' }), '10 a 16 letras o números; vacío = se genera.')
          : field('Código del QR', h('input', { type: 'text', value: ev.code, disabled: true })))),
    h('section', { class: 'section' }, h('h2', {}, 'Fechas'),
      h('div', { class: 'grid2' },
        field('Empieza', when(ev.startsAt, (v) => (ev.startsAt = v))),
        field('Termina', when(ev.endsAt, (v) => (ev.endsAt = v)), 'Después de esta hora no se permite nada.'),
        field('El check-in abre', when(ev.checkInOpensAt, (v) => (ev.checkInOpensAt = v)), 'Vacío: 1 hora antes de empezar.'),
        field('El check-in cierra', when(ev.checkInClosesAt, (v) => (ev.checkInClosesAt = v)), 'Vacío: cuando termina.')),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: ev.cancelled, onchange: (e) => { ev.cancelled = e.target.checked; preview(); } }), 'Evento cancelado')),
    h('section', { class: 'section' }, h('h2', {}, 'Organizador'),
      h('div', { class: 'grid2' },
        field('Nombre', text(ev.organizer.name, (v) => { ev.organizer.name = v; drawLogo(); }, { maxlength: 80 })),
        field('Color', color(() => ev.organizer.color, (v) => { ev.organizer.color = v; drawLogo(); }))),
      logoBox),
    h('section', { class: 'section' }, h('h2', {}, 'Pósters'), h('span', { class: 'hint' }, 'Caja 4:5. Más alto se recorta abajo; más ancho entra completo sobre el mismo difuminado. Hasta 8, máximo 2 MB.'), postersBox),
    h('section', { class: 'section' }, h('h2', {}, 'Pantalla del evento (kiosco)'),
      field('Orientación', h('select', { onchange: (e) => { ev.kioskOrientation = e.target.value; } },
        [['auto', 'Automática (según la pantalla)'], ['landscape', 'Horizontal'], ['portrait', 'Vertical: TV girada a la derecha'], ['portrait-left', 'Vertical: TV girada a la izquierda']].map(([value, text]) =>
          h('option', { value, selected: ev.kioskOrientation === value }, text))),
        'Automática sirve para cualquier TV o tablet. Si la TV está montada de lado y la imagen no gira sola, elige hacia qué lado se giró.')),
    h('section', { class: 'section' }, h('h2', {}, 'Pruebas'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: ev.debug, onchange: (e) => { ev.debug = e.target.checked; } }),
        'Modo debug en la página del evento'),
      h('span', { class: 'hint' }, 'Muestra el botón para simular estados y errores en el teléfono. Apágalo para el evento real.')),
    h('section', { class: 'section' }, h('h2', {}, 'Colores'),
      h('div', { class: 'presets' }, PRESETS.map(([name, p]) => h('button', { class: 'btn btn-sm preset', onclick: () => { ev.theme = structuredClone(p); renderColors(); preview(); } },
        h('span', { class: 'swatch', style: `background:${p.background}` }), h('span', { class: 'swatch', style: `background:${p.accent}` }), name))),
      h('div', { id: 'colors' })),
    h('div', { class: 'actions' },
      creating ? h('span') : h('button', { class: 'btn btn-danger', onclick: remove }, 'Borrar evento'),
      h('button', { class: 'btn btn-primary', onclick: save }, creating ? 'Crear evento' : 'Guardar cambios')));

  function renderColors() {
    const t = ev.theme;
    form.querySelector('#colors').replaceChildren(h('div', { class: 'grid3' },
      field('Fondo', color(() => t.background, (v) => (t.background = v))),
      field('Acento', color(() => t.accent, (v) => (t.accent = v))),
      field('Brillo', color(() => t.glow, (v) => (t.glow = v))),
      field('Botón (claro)', color(() => t.button[0], (v) => (t.button[0] = v))),
      field('Botón (medio)', color(() => t.button[1], (v) => (t.button[1] = v))),
      field('Botón (oscuro)', color(() => t.button[2], (v) => (t.button[2] = v))),
      field('Texto del botón', color(() => t.buttonText, (v) => (t.buttonText = v)))));
  }

  const share = creating ? null : h('section', { class: 'section share' }, h('h2', {}, 'Compartir'),
    h('div', { class: 'qr-box' },
      h('img', { src: `api/admin/events/${encodeURIComponent(ev.code)}/qr.svg`, alt: 'QR del evento' }),
      h('div', { class: 'share' },
        h('div', { class: 'sub' }, 'El QR abre la app en el evento.'),
        h('div', {}, h('a', { class: 'btn btn-sm', href: `api/admin/events/${encodeURIComponent(ev.code)}/qr.svg`, download: `qr-${ev.code}.svg` }, 'Descargar QR')))),
    h('div', { class: 'share-row' }, h('span', { class: 'sub' }, 'Enlace del QR'), h('code', {}, ev.eventLink), h('button', { class: 'btn btn-sm', onclick: () => copy(ev.eventLink) }, 'Copiar')),
    h('div', { class: 'share-row' }, h('span', { class: 'sub' }, 'Kiosco'), h('code', {}, ev.kioskUrl),
      h('div', { class: 'card-actions' },
        h('button', { class: 'btn btn-sm', onclick: () => copy(ev.kioskUrl) }, 'Copiar'),
        h('a', { class: 'btn btn-sm', href: ev.kioskUrl, target: '_blank', rel: 'noopener' }, 'Abrir'),
        h('button', { class: 'btn btn-sm btn-danger', onclick: async () => {
          if (!confirm('¿Cambiar el enlace del kiosco? Las pantallas abiertas dejan de funcionar.')) return;
          await api(`/events/${encodeURIComponent(code)}/kiosk-token`, { method: 'POST' });
          renderEditor(code);
        } }, 'Cambiar'))),
    h('div', {}, h('a', { class: 'btn btn-sm', href: `#/evento/${ev.code}/asistencia` }, `Asistencia (${ev.attendeeCount})`)));

  if (share) form.insertBefore(share, form.children[1]);
  fill(view, 
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, creating ? 'Nuevo evento' : ev.title), creating ? null : h('span', { class: `chip ${ev.state}` }, STATES[ev.state])),
      h('a', { class: 'btn', href: '#/' }, 'Volver')),
    h('div', { class: 'editor' }, form, h('aside', { class: 'side' }, h('span', { class: 'label' }, 'Vista previa'), phone)));
  renderColors();
  drawPosters();
  drawLogo();
  preview();
}

// ---------- Attendance ----------

async function renderAttendance(code) {
  fill(view, h('p', { class: 'sub' }, 'Cargando…'));
  const [ev, rows] = await Promise.all([api(`/events/${encodeURIComponent(code)}`), api(`/events/${encodeURIComponent(code)}/attendance`)]);
  const body = h('tbody', {}, rows.map((r) => h('tr', {},
    h('td', {}, h('span', { class: 'avatar' }, r.hasPhoto ? h('img', { src: `api/admin/events/${encodeURIComponent(code)}/attendees/${r.id}/photo`, alt: '' }) : initials(r.displayName))),
    h('td', {}, h('strong', {}, r.displayName), h('div', { class: 'sub' }, r.firstName)),
    h('td', { class: 'sub' }, r.username),
    h('td', {}, fmt(r.checkedInAt)),
    h('td', {}, h('button', { class: 'btn btn-sm btn-danger', onclick: async () => {
      if (!confirm(`¿Quitar a ${r.displayName}? Podrá volver a hacer check-in.`)) return;
      await api(`/events/${encodeURIComponent(code)}/attendees/${r.id}`, { method: 'DELETE' });
      toast('Asistente quitado');
      renderAttendance(code);
    } }, 'Quitar')))));
  fill(view, 
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, `Asistencia · ${ev.title}`), h('span', { class: 'sub' }, 'Se actualiza sola cada 10 segundos.')),
      h('div', { class: 'card-actions' },
        h('a', { class: 'btn', href: `api/admin/events/${encodeURIComponent(code)}/attendance.csv` }, 'Descargar CSV'),
        h('a', { class: 'btn', href: `#/evento/${code}` }, 'Editar evento'))),
    h('div', { class: 'section' },
      h('div', {}, h('span', { class: 'big' }, rows.length), ' ', h('span', { class: 'sub' }, rows.length === 1 ? 'persona' : 'personas')),
      rows.length
        ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Nombre'), h('th', {}, 'Usuario'), h('th', {}, 'Llegó'), h('th', {}, ''))), body)
        : h('div', { class: 'empty' }, 'Todavía no hay check-ins.')));
  refreshTimer = setTimeout(() => location.hash.endsWith('/asistencia') && renderAttendance(code), 10000);
}

// ---------- Router ----------

async function route() {
  clearTimeout(refreshTimer);
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try {
    if (parts[0] === 'nuevo') await renderEditor(null);
    else if (parts[0] === 'evento' && parts[2] === 'asistencia') await renderAttendance(decodeURIComponent(parts[1]));
    else if (parts[0] === 'evento') await renderEditor(decodeURIComponent(parts[1]));
    else await renderList();
  } catch (err) {
    fill(view, h('div', { class: 'errors' }, ...(err.errors || ['No se pudo cargar.'])));
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();
