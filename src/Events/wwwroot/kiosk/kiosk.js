const STRINGS = {
  es: {
    cta: 'Escanea con la cámara y toca «Aquí estoy»',
    ctaSub: 'Se abre Helloii con el evento.',
    download: 'Descarga Helloii',
    opensOn: 'El check-in abre el {day} a las {time}',
    opensToday: 'El check-in abre hoy a las {time}',
    hereOne: 'persona ya está aquí',
    hereMany: 'personas ya están aquí',
    cameOne: 'persona vino',
    cameMany: 'personas vinieron',
    hi: '¡Hola, {name}!',
    welcome: '¡Te damos la bienvenida a Helloii!',
    live: 'En vivo',
    reconnecting: 'Reconectando…',
    closed: 'El check-in ya cerró',
    closedSub: 'Gracias por venir.',
    cancelled: 'Este evento se canceló',
    noToken: 'Falta el enlace del kiosco',
    noTokenSub: 'Abre el enlace completo que da el panel del evento.',
    revoked: 'Este enlace ya no es válido',
    revokedSub: 'Pide el enlace nuevo en el panel del evento.',
    notFound: 'Este evento no existe',
    notFoundSub: 'Revisa el enlace del kiosco.',
  },
  en: {
    // Modificado por Yerardy Castillo: simplificar la indicación para escanear el QR.
    cta: 'Scan the QR code with your camera',
    ctaSub: 'Helloii opens with the event.',
    download: 'Download Helloii',
    opensOn: 'Check-in opens on {day} at {time}',
    opensToday: 'Check-in opens today at {time}',
    hereOne: 'person is already here',
    hereMany: 'people are already here',
    cameOne: 'person came',
    cameMany: 'people came',
    hi: 'Hi, {name}!',
    welcome: 'Welcome to Helloii!',
    live: 'Live',
    reconnecting: 'Reconnecting…',
    closed: 'Check-in is closed',
    closedSub: 'Thanks for coming.',
    cancelled: 'This event was cancelled',
    noToken: 'The kiosk link is incomplete',
    noTokenSub: 'Open the full link from the event panel.',
    revoked: 'This link is no longer valid',
    revokedSub: 'Get the new link from the event panel.',
    notFound: 'This event does not exist',
    notFoundSub: 'Check the kiosk link.',
  },
};

const query = new URLSearchParams(location.search);
const LANG = STRINGS[query.get('lang')] ? query.get('lang') : 'es';
const t = (key, vars = {}) => STRINGS[LANG][key].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
const $ = (id) => document.getElementById(id);
const HEX = /^#[0-9a-f]{6}$/i;

const code = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
const token = new URLSearchParams(location.hash.slice(1)).get('t');
const photos = new Map();
const queue = [];
const numbers = new Intl.NumberFormat(LANG);
const dayFormat = new Intl.DateTimeFormat(LANG, { weekday: 'long', day: 'numeric', month: 'long' });
const timeFormat = new Intl.DateTimeFormat(LANG, { hour: 'numeric', minute: '2-digit' });
const capital = (s) => (s ? s.charAt(0).toLocaleUpperCase(LANG) + s.slice(1) : s);
const initialsOf = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => Array.from(w)[0]).join('').toUpperCase() || '?';

let event = null;
let count = 0;
let showing = false;
let retry = 0;
let stateTimer = 0;

// Modificado por Yerardy Castillo: detectar despliegues sin cambiar el enlace ni interrumpir una bienvenida.
const loadedVersion = document.querySelector('meta[name="helloii-kiosk-version"]')?.content;
let checkingVersion = false;
let newerVersion = false;
async function checkVersion() {
  if (!loadedVersion || checkingVersion || document.hidden) return;
  if (newerVersion) {
    if (!showing && !queue.length) location.reload();
    return;
  }
  checkingVersion = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(location.pathname + location.search, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return;
    const page = new DOMParser().parseFromString(await response.text(), 'text/html');
    const version = page.querySelector('meta[name="helloii-kiosk-version"]')?.content;
    if (version && version !== loadedVersion) {
      newerVersion = true;
      if (!showing && !queue.length) location.reload();
    }
  } catch (_) {
    // Una comprobación sin conexión no debe interrumpir el QR ni los check-ins.
  } finally {
    clearTimeout(timeout);
    checkingVersion = false;
  }
}
setInterval(checkVersion, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });
window.addEventListener('focus', checkVersion);

document.documentElement.lang = LANG;
$('cta').textContent = t('cta');
$('cta-sub').textContent = t('ctaSub');
// Modificado por Yerardy Castillo: indicar disponibilidad para iPhone y Android.
$('download-label').textContent = t('download');

// Modificado por Yerardy Castillo: detectar espacios flex que algunos WebView Android ignoran.
const gapProbe = document.createElement('div');
gapProbe.style.cssText = 'position:absolute;left:-9999px;display:flex;flex-direction:column;row-gap:1px;';
gapProbe.append(document.createElement('div'), document.createElement('div'));
document.body.append(gapProbe);
if (gapProbe.scrollHeight !== 1) document.documentElement.classList.add('no-flex-gap');
gapProbe.remove();

// The event may fix the orientation; a sideways TV then gets the page turned 90°.
function layout() {
  const app = $('app');
  const wide = innerWidth >= innerHeight;
  const fixed = event?.kioskOrientation;
  const wanted = fixed === 'landscape' ? 'landscape'
    : fixed === 'portrait' || fixed === 'portrait-left' ? 'portrait'
    : wide ? 'landscape' : 'portrait';
  const rotated = (wanted === 'landscape') !== wide;
  const w = rotated ? innerHeight : innerWidth;
  const h = rotated ? innerWidth : innerHeight;
  app.style.setProperty('--w', `${w / 100}px`);
  app.style.setProperty('--h', `${h / 100}px`);
  // Modificado por Yerardy Castillo: calcular medidas sin depender de min() en CSS de Android.
  app.style.setProperty('--u', `${Math.min(w, h) / 100}px`);
  const portrait = wanted === 'portrait';
  const sizes = {
    'title-size': portrait ? Math.min(w * .076, h * .042) : Math.min(w * .044, h * .076),
    'meta-size': portrait ? Math.min(w * .034, h * .019) : Math.min(w * .018, h * .031),
    'qr-size': portrait ? Math.min(w * .46, h * .20) : Math.min(w * .22, h * .40),
    'cta-size': portrait ? Math.min(w * .048, h * .027) : Math.min(w * .022, h * .038),
    'sub-size': portrait ? Math.min(w * .030, h * .017) : Math.min(w * .014, h * .025),
    'state-title-size': portrait ? Math.min(w * .070, h * .040) : Math.min(w * .036, h * .064),
    'state-sub-size': portrait ? Math.min(w * .034, h * .019) : Math.min(w * .016, h * .028),
    'count-size': portrait ? Math.min(w * .120, h * .058) : Math.min(w * .050, h * .085),
    'count-label-size': portrait ? Math.min(w * .034, h * .019) : Math.min(w * .016, h * .028),
    'welcome-face-size': Math.min(w * .56, h * .40),
    'welcome-name-size': Math.min(w * .085, h * .075),
  };
  for (const [name, size] of Object.entries(sizes)) app.style.setProperty(`--${name}`, `${size}px`);
  app.classList.toggle('landscape', wanted === 'landscape');
  app.classList.toggle('portrait', wanted === 'portrait');
  app.classList.toggle('rotated', rotated);
  app.classList.toggle('left', rotated && fixed === 'portrait-left');

  // Modificado por Yerardy Castillo: reservar el tamaño del póster también en Android sin aspect-ratio.
  const poster = $('poster');
  const ratio = Number(poster.style.getPropertyValue('--pr')) || 0.8;
  const posterWidth = wanted === 'portrait'
    ? Math.min(w * 0.86, h * 0.27 * ratio)
    : Math.min(w * (ratio > 1.2 ? 0.46 : 0.38), h * 0.84 * ratio);
  poster.style.width = `${posterWidth}px`;
  poster.style.height = `${posterWidth / ratio}px`;
}
addEventListener('resize', layout);
addEventListener('orientationchange', layout);
layout();

function notice(title, sub) {
  $('notice-title').textContent = title;
  $('notice-sub').textContent = sub || '';
  $('notice').hidden = false;
}

function status(live) {
  $('status').classList.toggle('off', !live);
  $('status-text').textContent = live ? t('live') : t('reconnecting');
}

function applyTheme(theme) {
  const css = document.documentElement.style;
  const pick = (v, fallback) => (typeof v === 'string' && HEX.test(v) ? v : fallback);
  css.setProperty('--bg', pick(theme?.background, '#06090F'));
  css.setProperty('--accent', pick(theme?.accent, '#86EE60'));
  css.setProperty('--glow', pick(theme?.glow, '#2E6E65'));
  css.setProperty('--org', pick(event?.organizer?.color, '#0F1E29'));
}

function image(src, cls) {
  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  img.src = src;
  if (cls) img.className = cls;
  return img;
}

// The box takes the poster's own shape, between 4:5 and 16:9; anything beyond sits on its blurred self.
function renderPoster() {
  const box = $('poster');
  box.replaceChildren();
  const first = event.posters?.[0];
  $('backdrop').style.backgroundImage = first ? `url("${first.url}")` : '';
  const ratio = first ? first.width / first.height : 0.8;
  const shown = Math.min(Math.max(ratio, 0.8), 16 / 9);
  box.style.setProperty('--pa', String(shown));
  box.style.setProperty('--pr', String(shown));
  $('app').classList.toggle('wide-media', shown > 1.2);
  layout();
  if (!first) {
    const logo = event.organizer?.logoUrl;
    if (logo) box.append(image(logo, 'fit'));
    else box.append(Object.assign(document.createElement('span'), { className: 'poster-initials', textContent: initialsOf(event.organizer?.name || event.title) }));
    return;
  }
  // Modificado por Yerardy Castillo: conservar la transparencia del póster sin una copia difuminada detrás.
  box.append(image(first.url, 'fit'));
}

function whenText() {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const sameDay = start.toDateString() === end.toDateString();
  const range = sameDay && typeof timeFormat.formatRange === 'function'
    ? timeFormat.formatRange(start, end)
    : `${timeFormat.format(start)} – ${sameDay ? '' : capital(dayFormat.format(end)) + ' '}${timeFormat.format(end)}`;
  return `${capital(dayFormat.format(start))} · ${range}`;
}

function renderEvent() {
  if (!event) return;
  applyTheme(event.theme);
  layout();
  document.title = `${event.title} · Kiosco`;
  renderPoster();
  $('org').hidden = !event.organizer?.name;
  $('org-name').textContent = event.organizer?.name || '';
  const logo = $('org-logo');
  logo.replaceChildren();
  if (event.organizer?.logoUrl) logo.append(image(event.organizer.logoUrl));
  else logo.textContent = initialsOf(event.organizer?.name);
  $('title').textContent = event.title;
  $('when').textContent = whenText();
  $('venue').textContent = event.venue || '';
  $('venue').hidden = !event.venue;
  $('qr').src = `/api/v1/events/${encodeURIComponent(code)}/qr.svg`;
  $('stage').hidden = false;
  renderState();
}

function renderCount(bump) {
  const closed = event && (Date.now() >= Date.parse(event.checkIn.closesAt) || event.cancelled);
  const box = $('count');
  box.hidden = count < 1 || event?.cancelled;
  $('count-num').textContent = numbers.format(count);
  $('count-label').textContent = count === 1 ? t(closed ? 'cameOne' : 'hereOne') : t(closed ? 'cameMany' : 'hereMany');
  if (bump) {
    box.classList.remove('bump');
    void box.offsetWidth;
    box.classList.add('bump');
  }
}

function renderState() {
  clearTimeout(stateTimer);
  if (!event) return;
  const now = Date.now();
  const opens = Date.parse(event.checkIn.opensAt);
  const closes = Date.parse(event.checkIn.closesAt);
  const state = $('state');
  $('notice').hidden = true;
  state.className = 'state';
  if (event.cancelled || now >= closes) {
    $('scan').hidden = true;
    state.hidden = false;
    state.classList.add(event.cancelled ? 'cancelled' : 'closed');
    $('state-icon').textContent = event.cancelled ? '✕' : '✓';
    $('state-title').textContent = event.cancelled ? t('cancelled') : t('closed');
    $('state-sub').textContent = event.cancelled ? '' : t('closedSub');
  } else {
    $('scan').hidden = false;
    state.hidden = true;
    const notYet = now < opens;
    $('opens').hidden = !notYet;
    if (notYet) {
      const at = new Date(opens);
      const today = at.toDateString() === new Date().toDateString();
      $('opens').textContent = today
        ? t('opensToday', { time: timeFormat.format(at) })
        : t('opensOn', { day: dayFormat.format(at), time: timeFormat.format(at) });
    }
  }
  renderCount(false);
  const next = [opens, closes].filter((ms) => ms > now).sort((a, b) => a - b)[0];
  if (next) stateTimer = setTimeout(renderState, Math.min(next - now + 500, 2 ** 31 - 1));
}

async function photoOf(attendee) {
  if (!attendee.hasPhoto) return null;
  let url = photos.get(attendee.id);
  if (url) return url;
  // Modificado por Yerardy Castillo: la foto no debe retrasar la bienvenida ni el regreso al QR.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`/api/v1/events/${encodeURIComponent(code)}/attendees/${attendee.id}/photo`, {
      headers: { 'X-Kiosk-Token': token },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    url = URL.createObjectURL(await res.blob());
    photos.set(attendee.id, url);
    return url;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Modificado por Yerardy Castillo: descargar y preparar la foto antes de mostrar el círculo, sin iniciales.
async function preparePhoto(attendee) {
  const url = await photoOf(attendee);
  if (!url) return null;
  return new Promise((resolve) => {
    const photo = new Image();
    const finish = (result) => {
      clearTimeout(timeout);
      photo.onload = photo.onerror = null;
      resolve(result);
    };
    const timeout = setTimeout(() => finish(null), 500);
    photo.onload = () => finish(photo);
    photo.onerror = () => finish(null);
    photo.alt = attendee.displayName || attendee.firstName || '';
    photo.src = url;
  });
}

function confetti() {
  const box = $('confetti');
  box.replaceChildren();
  // Modificado por Yerardy Castillo: fuegos artificiales escalonados detrás de la bienvenida, aptos para Android.
  const colors = ['#FF4B55', '#FFD65A', '#67F59B', '#6BDBFF', '#FFFFFF', '#E4A0FF'];
  const origins = [[15, 18], [85, 23], [10, 65], [90, 70], [38, 10], [65, 85], [18, 88], [83, 43]];
  const fragment = document.createDocumentFragment();
  origins.forEach(([left, top], burst) => {
    for (let i = 0; i < 24; i++) {
      const piece = document.createElement('i');
      piece.className = 'cf';
      const angle = (Math.PI * 2 * i) / 24;
      const distance = 12 + Math.random() * 15;
      piece.style.cssText = `left:${left}%;top:${top}%;--x:calc(var(--u) * ${Math.cos(angle) * distance});--y:calc(var(--u) * ${Math.sin(angle) * distance});--c:${colors[burst % colors.length]};--d:${burst * .19}s`;
      fragment.appendChild(piece);
    }
  });
  box.appendChild(fragment);
}

async function showNext() {
  if (showing || !queue.length) return;
  showing = true;
  const pending = queue.shift();
  const attendee = pending.attendee;
  // El QR permanece disponible mientras se prepara la foto; los 4 segundos empiezan al mostrarla.
  const preparedPhoto = await pending.photo;
  const face = $('welcome-face');
  // Modificado por Yerardy Castillo: nombre completo y foto circular con regreso automático a los 4 segundos.
  const name = attendee.displayName || attendee.firstName || '';
  if (preparedPhoto) face.replaceChildren(preparedPhoto);
  else {
    const placeholder = document.createElement('span');
    placeholder.textContent = '👤';
    placeholder.setAttribute('aria-label', LANG === 'en' ? 'Photo unavailable' : 'Foto no disponible');
    face.replaceChildren(placeholder);
  }
  $('welcome-hi').textContent = t('hi', { name });
  // Modificado por Yerardy Castillo: usar el logo oficial de Helloii dentro de la bienvenida.
  const welcomeWords = t('welcome').split('Helloii');
  const welcomeLogo = image('/kiosk/assets/helloii-welcome-logo.png', 'welcome-wordmark');
  welcomeLogo.alt = 'Helloii';
  $('welcome-sub').replaceChildren(document.createTextNode(welcomeWords[0]), welcomeLogo, document.createTextNode(welcomeWords[1] || ''));
  $('welcome-event').textContent = event?.title || '';
  const welcome = $('welcome');
  welcome.classList.remove('out');
  welcome.hidden = false;
  confetti();
  try {
    // Modificado por Yerardy Castillo: incluir la salida suave dentro de los 4 segundos totales.
    await new Promise((r) => setTimeout(r, 3550));
    welcome.classList.add('out');
    await new Promise((r) => setTimeout(r, 450));
  } finally {
    welcome.hidden = true;
    $('confetti').replaceChildren();
    showing = false;
    showNext();
  }
}

function connect() {
  const scheme = location.protocol === 'https:' ? 'wss://' : 'ws://';
  const ws = new WebSocket(`${scheme}${location.host}/api/v1/events/${encodeURIComponent(code)}/live`);
  let revoked = false;
  ws.onopen = () => ws.send(JSON.stringify({ token }));
  ws.onmessage = (msg) => {
    let data;
    try { data = JSON.parse(msg.data); } catch (_) { return; }
    if (data.type === 'hello' || data.type === 'event') {
      retry = 0;
      status(true);
      event = data.event;
      count = event.attendeeCount || 0;
      renderEvent();
    } else if (data.type === 'checkin') {
      count = data.count;
      renderCount(true);
      // Modificado por Yerardy Castillo: preparar la foto en cuanto llega el check-in, incluso si hay cola.
      queue.push({ attendee: data.attendee, photo: preparePhoto(data.attendee) });
      showNext();
    } else if (data.type === 'revoked') {
      revoked = true;
    }
  };
  ws.onclose = (e) => {
    if (revoked || e.code === 1008) {
      notice(t('revoked'), t('revokedSub'));
      status(false);
      return;
    }
    if (e.code === 1001 && e.reason === 'event deleted') {
      notice(t('notFound'), t('notFoundSub'));
      return;
    }
    status(false);
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, 1000 * 2 ** (retry - 1));
  };
}

let idle = 0;
document.addEventListener('pointermove', () => {
  document.body.classList.add('pointer');
  clearTimeout(idle);
  idle = setTimeout(() => document.body.classList.remove('pointer'), 2500);
});
document.addEventListener('dblclick', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
});

if (!token) {
  notice(t('noToken'), t('noTokenSub'));
} else {
  status(false);
  connect();
}
