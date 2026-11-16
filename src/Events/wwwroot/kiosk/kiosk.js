const STRINGS = {
  es: {
    cta: 'Escanea con la cámara y toca «Aquí estoy»',
    ctaSub: 'Se abre Helloii con el evento.',
    opensOn: 'El check-in abre el {day} a las {time}',
    opensToday: 'El check-in abre hoy a las {time}',
    hereOne: 'persona ya está aquí',
    hereMany: 'personas ya están aquí',
    cameOne: 'persona vino',
    cameMany: 'personas vinieron',
    hi: '¡Hola, {name}!',
    welcome: 'Te damos la bienvenida a {title}',
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
    opensOn: 'Check-in opens on {day} at {time}',
    opensToday: 'Check-in opens today at {time}',
    hereOne: 'person is already here',
    hereMany: 'people are already here',
    cameOne: 'person came',
    cameMany: 'people came',
    hi: 'Hi, {name}!',
    welcome: 'Welcome to {title}',
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

document.documentElement.lang = LANG;
$('cta').textContent = t('cta');
$('cta-sub').textContent = t('ctaSub');

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
  app.classList.toggle('landscape', wanted === 'landscape');
  app.classList.toggle('portrait', wanted === 'portrait');
  app.classList.toggle('rotated', rotated);
  app.classList.toggle('left', rotated && fixed === 'portrait-left');
}
addEventListener('resize', layout);
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
  if (!first) {
    const logo = event.organizer?.logoUrl;
    if (logo) box.append(image(logo, 'fit'));
    else box.append(Object.assign(document.createElement('span'), { className: 'poster-initials', textContent: initialsOf(event.organizer?.name || event.title) }));
    return;
  }
  if (Math.abs(ratio - shown) > 0.01) box.append(image(first.url, 'blur'), image(first.url, 'fit'));
  else box.append(image(first.url, 'fill'));
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
  try {
    const res = await fetch(`/api/v1/events/${encodeURIComponent(code)}/attendees/${attendee.id}/photo`, {
      headers: { 'X-Kiosk-Token': token },
    });
    if (!res.ok) return null;
    url = URL.createObjectURL(await res.blob());
    photos.set(attendee.id, url);
    return url;
  } catch (_) {
    return null;
  }
}

function confetti() {
  const box = $('confetti');
  box.replaceChildren();
  const colors = ['var(--accent)', '#FFFFFF', '#FBB03B', 'var(--glow)'];
  for (let i = 0; i < 30; i++) {
    const piece = document.createElement('i');
    piece.className = 'cf';
    const angle = (Math.PI * 2 * i) / 30;
    const distance = 20 + Math.random() * 28;
    piece.style.cssText = `--x:calc(var(--u) * ${Math.cos(angle) * distance});--y:calc(var(--u) * ${Math.sin(angle) * distance});--r:${Math.random() * 720 - 360}deg;--c:${colors[i % colors.length]};--d:${Math.random() * 0.2}s`;
    box.appendChild(piece);
  }
}

async function showNext() {
  if (showing || !queue.length) return;
  showing = true;
  const attendee = queue.shift();
  const face = $('welcome-face');
  const photo = await photoOf(attendee);
  face.replaceChildren();
  if (photo) face.append(image(photo));
  else face.textContent = initialsOf(attendee.displayName || attendee.firstName);
  $('welcome-hi').textContent = t('hi', { name: attendee.firstName });
  $('welcome-sub').textContent = t('welcome', { title: event ? event.title : '' });
  const welcome = $('welcome');
  welcome.classList.remove('out');
  welcome.hidden = false;
  confetti();
  await new Promise((r) => setTimeout(r, queue.length > 4 ? 1800 : queue.length > 1 ? 2800 : 4800));
  welcome.classList.add('out');
  await new Promise((r) => setTimeout(r, 450));
  welcome.hidden = true;
  showing = false;
  showNext();
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
      queue.push(data.attendee);
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
