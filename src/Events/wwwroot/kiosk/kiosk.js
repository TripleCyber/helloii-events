const STRINGS = {
  es: {
    cta: 'Escanea con la cámara y toca «Aquí estoy»',
    ctaSub: 'Se abre Helloii con el evento.',
    hereOne: '1 persona ya está aquí',
    hereMany: '{n} personas ya están aquí',
    hi: '¡Hola, {name}!',
    welcome: 'Te damos la bienvenida a {title}',
    live: 'En vivo',
    reconnecting: 'Reconectando…',
    opensAt: 'El check-in abre {when}',
    closed: 'El check-in ya cerró',
    cancelled: 'Este evento se canceló',
    noToken: 'Falta el enlace del kiosco',
    noTokenSub: 'Abre el enlace completo que da el panel del evento.',
    revoked: 'Este enlace ya no es válido',
    revokedSub: 'Pide el enlace nuevo en el panel del evento.',
    notFound: 'Este evento no existe',
    notFoundSub: 'Revisa el enlace del kiosco.',
  },
  en: {
    cta: 'Scan with your camera and tap “I’m here”',
    ctaSub: 'Helloii opens with the event.',
    hereOne: '1 person is already here',
    hereMany: '{n} people are already here',
    hi: 'Hi, {name}!',
    welcome: 'Welcome to {title}',
    live: 'Live',
    reconnecting: 'Reconnecting…',
    opensAt: 'Check-in opens {when}',
    closed: 'Check-in is closed',
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
let event = null;
let count = 0;
let showing = false;
let retry = 0;
let stateTimer = 0;

document.documentElement.lang = LANG;
$('cta').textContent = t('cta');
$('cta-sub').textContent = t('ctaSub');

const initialsOf = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => Array.from(w)[0]).join('').toUpperCase() || '?';
const dayFormat = new Intl.DateTimeFormat(LANG, { weekday: 'long', day: 'numeric', month: 'long' });
const timeFormat = new Intl.DateTimeFormat(LANG, { hour: 'numeric', minute: '2-digit' });
const capital = (s) => (s ? s.charAt(0).toLocaleUpperCase(LANG) + s.slice(1) : s);

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
  css.setProperty('--bg', pick(theme && theme.background, '#06090F'));
  css.setProperty('--accent', pick(theme && theme.accent, '#86EE60'));
  css.setProperty('--glow', pick(theme && theme.glow, '#2E6E65'));
}

function renderEvent() {
  if (!event) return;
  applyTheme(event.theme);
  document.title = `${event.title} · Kiosco`;
  document.documentElement.style.setProperty('--org', HEX.test(event.organizer?.color || '') ? event.organizer.color : '#0F1E29');

  const poster = $('poster');
  poster.replaceChildren();
  if (event.posters && event.posters.length) {
    const img = new Image();
    img.alt = '';
    img.src = event.posters[0].url;
    poster.appendChild(img);
  } else {
    poster.textContent = initialsOf(event.organizer?.name || event.title);
  }
  $('org').hidden = !event.organizer?.name;
  $('org-name').textContent = event.organizer?.name || '';
  const logo = $('org-logo');
  logo.replaceChildren();
  if (event.organizer?.logoUrl) {
    const img = new Image();
    img.alt = '';
    img.src = event.organizer.logoUrl;
    logo.appendChild(img);
  } else {
    logo.textContent = initialsOf(event.organizer?.name);
  }
  $('title').textContent = event.title;
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  $('when').textContent = `${capital(dayFormat.format(start))} · ${timeFormat.format(start)} – ${timeFormat.format(end)}`;
  $('venue').textContent = event.venue || '';
  $('qr').src = `/api/v1/events/${encodeURIComponent(code)}/qr.svg`;
  $('stage').hidden = false;
  renderCount();
  renderState();
}

function renderCount() {
  $('count').hidden = count < 1;
  $('count-text').textContent = count === 1 ? t('hereOne') : t('hereMany', { n: new Intl.NumberFormat(LANG).format(count) });
}

function renderState() {
  clearTimeout(stateTimer);
  if (!event) return;
  const now = Date.now();
  const opens = Date.parse(event.checkIn.opensAt);
  const closes = Date.parse(event.checkIn.closesAt);
  $('notice').hidden = true;
  if (event.cancelled) {
    notice(t('cancelled'), event.title);
    return;
  }
  if (now >= closes) {
    notice(t('closed'), count > 0 ? (count === 1 ? t('hereOne') : t('hereMany', { n: count })) : '');
    return;
  }
  if (now < opens) {
    $('cta-sub').textContent = t('opensAt', { when: `${dayFormat.format(new Date(opens))} · ${timeFormat.format(new Date(opens))}` });
  } else {
    $('cta-sub').textContent = t('ctaSub');
  }
  const next = [opens, closes].filter((ms) => ms > now).sort((a, b) => a - b)[0];
  if (next) stateTimer = setTimeout(renderState, Math.min(next - now + 500, 2 ** 31 - 1));
}

async function avatarOf(attendee) {
  const el = document.createElement('span');
  el.className = 'avatar';
  el.textContent = initialsOf(attendee.displayName || attendee.firstName);
  if (!attendee.hasPhoto) return el;
  try {
    let url = photos.get(attendee.id);
    if (!url) {
      const res = await fetch(`/api/v1/events/${encodeURIComponent(code)}/attendees/${attendee.id}/photo`, {
        headers: { 'X-Kiosk-Token': token },
      });
      if (!res.ok) return el;
      url = URL.createObjectURL(await res.blob());
      photos.set(attendee.id, url);
    }
    const img = new Image();
    img.alt = '';
    img.src = url;
    el.replaceChildren(img);
  } catch (_) {
    // Initials stay.
  }
  return el;
}

async function addFace(attendee, animate) {
  const face = document.createElement('div');
  face.className = 'face';
  if (!animate) face.style.animation = 'none';
  const name = document.createElement('span');
  name.textContent = attendee.firstName;
  face.append(await avatarOf(attendee), name);
  const faces = $('faces');
  faces.prepend(face);
  while (faces.children.length > 8) faces.lastChild.remove();
}

function confetti() {
  const box = $('confetti');
  box.replaceChildren();
  const colors = ['var(--accent)', '#FFFFFF', '#FBB03B', 'var(--glow)'];
  for (let i = 0; i < 28; i++) {
    const piece = document.createElement('i');
    piece.className = 'cf';
    const angle = (Math.PI * 2 * i) / 28;
    const distance = 18 + Math.random() * 26;
    piece.style.cssText = `--x:${Math.cos(angle) * distance}vmin;--y:${Math.sin(angle) * distance}vmin;--r:${Math.random() * 720 - 360}deg;--c:${colors[i % colors.length]};--d:${Math.random() * 0.2}s`;
    box.appendChild(piece);
  }
}

async function showNext() {
  if (showing || !queue.length) return;
  showing = true;
  const attendee = queue.shift();
  const face = $('welcome-face');
  const avatar = await avatarOf(attendee);
  face.replaceChildren(...avatar.childNodes);
  if (!face.childNodes.length) face.textContent = initialsOf(attendee.displayName);
  $('welcome-hi').textContent = t('hi', { name: attendee.firstName });
  $('welcome-sub').textContent = t('welcome', { title: event ? event.title : '' });
  const welcome = $('welcome');
  welcome.classList.remove('out');
  welcome.hidden = false;
  confetti();
  await new Promise((r) => setTimeout(r, queue.length > 2 ? 2600 : 4800));
  welcome.classList.add('out');
  await new Promise((r) => setTimeout(r, 450));
  welcome.hidden = true;
  showing = false;
  showNext();
}

function connect() {
  const scheme = location.protocol === 'https:' ? 'wss://' : 'ws://';
  const ws = new WebSocket(`${scheme}${location.host}/api/v1/events/${encodeURIComponent(code)}/live`);
  let closedByServer = null;
  ws.onopen = () => ws.send(JSON.stringify({ token }));
  ws.onmessage = async (msg) => {
    let data;
    try { data = JSON.parse(msg.data); } catch (_) { return; }
    if (data.type === 'hello') {
      retry = 0;
      status(true);
      event = data.event;
      count = event.attendeeCount || 0;
      renderEvent();
      $('faces').replaceChildren();
      for (const attendee of (data.recent || []).slice().reverse()) await addFace(attendee, false);
    } else if (data.type === 'checkin') {
      count = data.count;
      renderCount();
      queue.push(data.attendee);
      addFace(data.attendee, true);
      showNext();
    } else if (data.type === 'event') {
      event = data.event;
      count = event.attendeeCount || count;
      renderEvent();
    } else if (data.type === 'revoked') {
      closedByServer = 'revoked';
    }
  };
  ws.onclose = (e) => {
    if (closedByServer === 'revoked' || e.code === 1008) {
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
