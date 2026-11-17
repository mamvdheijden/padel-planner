'use strict';
// Padel Planner — kleine server zonder externe dependencies (Node 20+).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_PIN = process.env.ADMIN_PIN || '';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_SETTINGS = {
  weeks: 3,
  days: [1, 2, 3, 4], // JS: 0 = zondag, 1 = maandag ... 6 = zaterdag
  minPlayers: 4,
  times: ['20:30', '21:00'], // voorkeurstijden waaruit spelers kunnen kiezen
  club: '',
  skipHolidays: true,
};

// ---------- opslag ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
let db = { settings: { ...DEFAULT_SETTINGS }, rounds: [], history: [], players: [], links: [], autoInit: false };
try {
  const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  db = { ...db, ...raw, settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) } };
  if (db.round) { if (!db.rounds.length) db.rounds = [db.round]; delete db.round; } // migratie: één ronde -> meerdere
  db.rounds.forEach((r) => { r.name = r.name || ''; });
} catch (e) {
  if (e.code !== 'ENOENT') console.error('Kon db.json niet lezen:', e.message);
}
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// ---------- datums (lokale tijd, zet TZ=Europe/Amsterdam) ----------
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const todayStr = () => fmt(new Date());

function easter(year) { // Meeus/Jones/Butcher
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}
function holidays(year) { // Nederlandse feestdagen (vrije dagen)
  const e = easter(year);
  const set = new Set([
    `${year}-01-01`, fmt(addDays(e, -2)), fmt(addDays(e, 1)), `${year}-04-27`,
    fmt(addDays(e, 39)), fmt(addDays(e, 50)), `${year}-12-25`, `${year}-12-26`,
  ]);
  return set;
}

// Eerstvolgende maandag (strikt na vandaag), daarna `weeks` weken, gefilterd op speeldagen.
function computeDates(settings, from = new Date(), startDate = '') {
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let start;
  if (/^\d{4}-\d{2}-\d{2}$/.test(startDate) && parse(startDate) > base) {
    const d = parse(startDate); // maandag op of na de gekozen datum
    start = addDays(d, (8 - d.getDay()) % 7);
  } else {
    let add = (8 - base.getDay()) % 7; // dagen tot maandag
    if (add === 0) add = 7;
    start = addDays(base, add);
  }
  const skip = new Set();
  if (settings.skipHolidays) {
    for (const y of [start.getFullYear(), start.getFullYear() + 1]) holidays(y).forEach((h) => skip.add(h));
  }
  const out = [];
  for (let i = 0; i < settings.weeks * 7; i++) {
    const d = addDays(start, i);
    const s = fmt(d);
    if (settings.days.includes(d.getDay()) && !skip.has(s)) out.push(s);
  }
  return out;
}

function newRound(settings, name = '', startDate = '') {
  return {
    id: crypto.randomBytes(4).toString('hex'),
    createdAt: new Date().toISOString(),
    name,
    settings: { ...settings },
    dates: computeDates(settings, new Date(), startDate),
    votes: [], // [{ name, dates, none, time, at }]
    accepted: null, // { date, at }
  };
}
function archive(r) {
  db.history.unshift({ ...r, archivedAt: new Date().toISOString() });
  db.history = db.history.slice(0, 30);
}
const findRound = (id) => db.rounds.find((r) => r.id === String(id || ''));
// Verlopen rondes gaan naar het archief. Is er daarna niets meer (of is dit de eerste start), dan komt er een standaardronde.
function housekeeping() {
  const today = todayStr();
  const alive = [], expired = [];
  for (const r of db.rounds) (r.dates.length && r.dates[r.dates.length - 1] >= today ? alive : expired).push(r);
  let changed = false;
  if (expired.length) { expired.forEach(archive); db.rounds = alive; changed = true; }
  if (!db.rounds.length && (expired.length || (!db.history.length && !db.autoInit))) {
    db.rounds.push(newRound(db.settings)); db.autoInit = true; changed = true;
  }
  if (changed) save();
}

// ---------- voorstel ----------
function ranking(round) {
  const today = todayStr();
  const min = round.settings.minPlayers;
  const rows = round.dates.filter((d) => d >= today).map((date) => {
    const names = round.votes.filter((v) => v.dates.includes(date)).map((v) => v.name);
    const detail = round.votes.filter((v) => v.dates.includes(date)).map((v) => ({ name: v.name, time: v.time || '' }));
    return { date, names, detail, count: names.length, ready: names.length >= min };
  });
  const ranked = rows.filter((r) => r.count > 0).sort((a, b) => b.count - a.count || a.date.localeCompare(b.date));
  const ready = ranked.filter((r) => r.ready);
  return { rows, proposal: ready[0] || null, reserve: ready[1] || null, others: ranked.filter((r) => r !== ready[0] && r !== ready[1]).slice(0, 5) };
}

const sortedNames = (set) => [...set].sort((a, b) => a.localeCompare(b, 'nl'));
function knownPlayers(round) {
  const known = new Set(db.players);
  if (round) round.votes.forEach((v) => known.add(v.name));
  return known;
}

function roundState(round) {
  const known = knownPlayers(round);
  const voted = new Set(round.votes.map((v) => v.name.toLowerCase()));
  return {
    today: todayStr(),
    players: sortedNames(known),
    notVoted: sortedNames(new Set([...known].filter((n) => !voted.has(n.toLowerCase())))),
    cannot: round.votes.filter((v) => v.none).map((v) => v.name),
    round: {
      id: round.id,
      name: round.name || '',
      dates: round.dates,
      settings: { times: DEFAULT_SETTINGS.times, ...round.settings },
      accepted: round.accepted,
      votes: round.votes.map((v) => ({ name: v.name, dates: v.dates, none: !!v.none, time: v.time || '' })),
    },
    ...ranking(round),
  };
}

// Overzicht van alle open rondes; `me` = de speler (via link), `admin` = beheerder (via pincode)
function overview(req, url) {
  housekeeping();
  const me = playerFor(req, url);
  const admin = pinValid(req);
  const out = {
    today: todayStr(),
    name: me ? me.name : null,
    players: sortedNames(knownPlayers(null)),
    rounds: db.rounds.map((r) => {
      const v = me ? r.votes.find((x) => x.name.toLowerCase() === me.name.toLowerCase()) : null;
      const item = {
        id: r.id, name: r.name || '', first: r.dates[0], last: r.dates[r.dates.length - 1],
        minPlayers: r.settings.minPlayers, club: r.settings.club || '', accepted: r.accepted,
        voted: r.votes.length, total: knownPlayers(r).size,
        me: me ? (v ? (v.none ? 'none' : 'voted') : 'open') : null, meCount: v ? v.dates.length : 0,
      };
      if (admin) { const p = ranking(r).proposal; item.proposal = p ? { date: p.date, count: p.count } : null; }
      return item;
    }),
  };
  if (admin) out.defaults = db.settings;
  return out;
}

// ---------- http helpers ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const SEC_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
function send(res, code, body, headers = {}) {
  res.writeHead(code, { ...SEC_HEADERS, ...headers });
  res.end(body);
}
function json(res, code, obj) { send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 20000) { reject(new Error('te groot')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('ongeldige JSON')); } });
    req.on('error', reject);
  });
}

// PIN-controle met eenvoudige rem tegen gokken
const fails = new Map();
function clientIp(req) { return req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress; }
function checkAdmin(req, res) {
  if (!ADMIN_PIN) { json(res, 503, { error: 'ADMIN_PIN is niet ingesteld op de server.' }); return false; }
  const ip = clientIp(req);
  const f = fails.get(ip);
  if (f && f.count >= 10 && Date.now() - f.first < 10 * 60 * 1000) { json(res, 429, { error: 'Te veel pogingen. Probeer het over 10 minuten opnieuw.' }); return false; }
  const given = Buffer.from(String(req.headers['x-admin-pin'] || ''));
  const real = Buffer.from(ADMIN_PIN);
  const ok = given.length === real.length && crypto.timingSafeEqual(given, real);
  if (!ok) {
    const now = Date.now();
    if (!f || now - f.first > 10 * 60 * 1000) fails.set(ip, { count: 1, first: now }); else f.count++;
    json(res, 401, { error: 'Onjuiste pincode.' });
    return false;
  }
  fails.delete(ip);
  return true;
}

function pinValid(req) {
  if (!ADMIN_PIN) return false;
  const given = Buffer.from(String(req.headers['x-admin-pin'] || ''));
  const real = Buffer.from(ADMIN_PIN);
  return given.length === real.length && crypto.timingSafeEqual(given, real);
}
function tooMany(req) {
  const f = fails.get('w' + clientIp(req));
  return !!f && f.count >= 20 && Date.now() - f.first < 10 * 60 * 1000;
}
function bump(req) {
  const key = 'w' + clientIp(req), now = Date.now(), f = fails.get(key);
  if (!f || now - f.first > 10 * 60 * 1000) fails.set(key, { count: 1, first: now }); else f.count++;
}
// Alleen een geldige persoonlijke token geeft toegang (header of ?token=)
function playerFor(req, url) {
  const t = String(req.headers['x-player-token'] || (url && url.searchParams.get('token')) || '');
  return /^[a-f0-9]{10}$/.test(t) ? db.links.find((x) => x.token === t) || null : null;
}

const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 30);

// Persoonlijke links: /p/<naam>-<token>. De token is de enige geheime component.
const slugify = (n) => String(n).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20);
const linkPath = (l) => `/p/${slugify(l.name) ? slugify(l.name) + '-' : ''}${l.token}`;
function ensureLink(name) {
  const known = db.players.find((n) => n.toLowerCase() === name.toLowerCase());
  let l = db.links.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!l) { l = { name: known || name, token: crypto.randomBytes(5).toString('hex') }; db.links.push(l); }
  if (!known) db.players.push(l.name);
  return l;
}

// ---------- routes ----------
async function api(req, res, url) {
  const m = req.method;
  const p = url.pathname;

  if (m === 'GET' && p === '/api/state') {
    if (tooMany(req)) return json(res, 429, { error: 'Te veel pogingen. Probeer het later opnieuw.' });
    if (!playerFor(req, url) && !pinValid(req)) { bump(req); return json(res, 401, { error: 'Alleen toegankelijk met een persoonlijke link.' }); }
    return json(res, 200, overview(req, url));
  }

  if (m === 'GET' && p === '/api/round') {
    if (tooMany(req)) return json(res, 429, { error: 'Te veel pogingen. Probeer het later opnieuw.' });
    if (!playerFor(req, url) && !pinValid(req)) { bump(req); return json(res, 401, { error: 'Alleen toegankelijk met een persoonlijke link.' }); }
    housekeeping();
    const round = findRound(url.searchParams.get('id'));
    if (!round) return json(res, 404, { error: 'Deze ronde bestaat niet (meer).' });
    return json(res, 200, roundState(round));
  }

  if (m === 'GET' && p === '/api/whoami') {
    const key = 'w' + clientIp(req);
    const f = fails.get(key);
    if (f && f.count >= 20 && Date.now() - f.first < 10 * 60 * 1000) return json(res, 429, { error: 'Te veel pogingen. Probeer het later opnieuw.' });
    const t = String(url.searchParams.get('token') || '');
    const l = db.links.find((x) => x.token === t);
    if (!l) {
      const now = Date.now();
      if (!f || now - f.first > 10 * 60 * 1000) fails.set(key, { count: 1, first: now }); else f.count++;
      return json(res, 404, { error: 'Deze link is niet (meer) geldig.' });
    }
    return json(res, 200, { name: l.name });
  }

  if (m === 'POST' && p === '/api/vote') {
    const body = await readBody(req);
    if (tooMany(req)) return json(res, 429, { error: 'Te veel pogingen. Probeer het later opnieuw.' });
    const owner = playerFor(req, url);
    if (!owner) { bump(req); return json(res, 401, { error: 'Je hebt een persoonlijke link nodig om te stemmen.' }); }
    const name = owner.name;
    housekeeping();
    const round = findRound(body.id);
    if (!round) return json(res, 404, { error: 'Deze ronde bestaat niet (meer).' });
    const today = todayStr();
    const none = body.none === true;
    const dates = none ? [] : [...new Set((Array.isArray(body.dates) ? body.dates : []).filter((d) => round.dates.includes(d) && d >= today))];
    if (!none && !dates.length) return json(res, 400, { error: "Kies minstens één datum, of vink 'Ik kan geen enkele datum' aan." });
    const time = (round.settings.times || DEFAULT_SETTINGS.times).includes(body.time) ? body.time : '';
    const idx = round.votes.findIndex((v) => v.name.toLowerCase() === name.toLowerCase());
    if (idx === -1 && round.votes.length >= 40) return json(res, 400, { error: 'Te veel spelers in deze ronde.' });
    if (idx === -1) round.votes.push({ name, dates, none, time, at: new Date().toISOString() });
    else round.votes[idx] = { name: round.votes[idx].name, dates, none, time, at: new Date().toISOString() };
    if (!db.players.some((n) => n.toLowerCase() === name.toLowerCase())) db.players.push(name);
    save();
    return json(res, 200, roundState(round));
  }

  if (p.startsWith('/api/admin/')) {
    if (!checkAdmin(req, res)) return;
    if (m === 'GET' && p === '/api/admin/check') return json(res, 200, { ok: true });

    if (m === 'GET' && p === '/api/admin/links') {
      db.players.slice().forEach((n) => ensureLink(n));
      save();
      return json(res, 200, { links: db.links.map((l) => ({ name: l.name, path: linkPath(l), issued: !!l.issued })) });
    }

    if (m === 'POST' && p === '/api/admin/link-issued') {
      const b = await readBody(req);
      const l = db.links.find((x) => x.name.toLowerCase() === cleanName(b.name).toLowerCase());
      if (!l) return json(res, 404, { error: 'Onbekende speler.' });
      l.issued = true;
      save();
      return json(res, 200, { ok: true });
    }

    if (m === 'POST' && p === '/api/admin/player-link') {
      const b = await readBody(req);
      const name = cleanName(b.name);
      if (!name) return json(res, 400, { error: 'Vul een naam in.' });
      ensureLink(name);
      save();
      return json(res, 200, overview(req, url));
    }

    if (m === 'POST' && p === '/api/admin/round') {
      const b = await readBody(req);
      const s = {
        weeks: Math.min(8, Math.max(1, parseInt(b.weeks, 10) || DEFAULT_SETTINGS.weeks)),
        days: [...new Set((Array.isArray(b.days) ? b.days : []).map(Number).filter((d) => d >= 0 && d <= 6))],
        minPlayers: Math.min(12, Math.max(2, parseInt(b.minPlayers, 10) || DEFAULT_SETTINGS.minPlayers)),
        club: String(b.club || '').slice(0, 60),
        skipHolidays: b.skipHolidays !== false,
        times: [...new Set(String(b.times || '').split(/[,\s]+/).filter((t) => /^\d{1,2}:\d{2}$/.test(t)).map((t) => t.padStart(5, '0')))].slice(0, 4),
      };
      if (!s.times.length) s.times = DEFAULT_SETTINGS.times;
      if (!s.days.length) return json(res, 400, { error: 'Kies minstens één speeldag.' });
      if (db.rounds.length >= 10) return json(res, 400, { error: 'Maximaal 10 open rondes tegelijk. Sluit eerst een ronde af.' });
      const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      const r = newRound(s, name, String(b.start || ''));
      if (!r.dates.length) return json(res, 400, { error: 'Met deze instellingen zijn er geen speeldagen.' });
      db.settings = s;
      db.rounds.push(r);
      save();
      return json(res, 200, { ...overview(req, url), created: r.id });
    }

    if (m === 'POST' && p === '/api/admin/accept') {
      const b = await readBody(req);
      const round = findRound(b.id);
      if (!round) return json(res, 404, { error: 'Deze ronde bestaat niet (meer).' });
      if (!round.dates.includes(b.date)) return json(res, 400, { error: 'Onbekende datum.' });
      round.accepted = { date: b.date, at: new Date().toISOString() };
      save();
      return json(res, 200, roundState(round));
    }

    if (m === 'POST' && p === '/api/admin/reopen') {
      const b = await readBody(req);
      const round = findRound(b.id);
      if (!round) return json(res, 404, { error: 'Deze ronde bestaat niet (meer).' });
      round.accepted = null;
      save();
      return json(res, 200, roundState(round));
    }

    if (m === 'POST' && p === '/api/admin/close-round') {
      const b = await readBody(req);
      const round = findRound(b.id);
      if (!round) return json(res, 404, { error: 'Deze ronde bestaat niet (meer).' });
      archive(round);
      db.rounds = db.rounds.filter((r) => r !== round);
      save();
      return json(res, 200, overview(req, url));
    }

    if (m === 'POST' && p === '/api/admin/remove-player') {
      const b = await readBody(req);
      const name = cleanName(b.name).toLowerCase();
      db.rounds.forEach((r) => { r.votes = r.votes.filter((v) => v.name.toLowerCase() !== name); });
      db.players = db.players.filter((n) => n.toLowerCase() !== name);
      db.links = db.links.filter((l) => l.name.toLowerCase() !== name);
      save();
      return json(res, 200, overview(req, url));
    }
  }
  return json(res, 404, { error: 'Niet gevonden.' });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '/admin' || rel.startsWith('/p/')) rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Niet gevonden');
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    send(res, 200, buf, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') return send(res, 200, 'ok');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 400, { error: e.message || 'Fout' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Padel Planner draait op poort ${PORT} (data: ${DATA_DIR})`);
    if (!ADMIN_PIN) console.warn('LET OP: ADMIN_PIN is niet ingesteld, de beheerkant is uitgeschakeld.');
  });
}
module.exports = { computeDates, holidays, easter, fmt };
