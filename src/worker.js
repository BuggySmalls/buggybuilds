// cerealbowlers.org — static site plus bowler accounts.
// Everything in ./public is served as-is. Only /api/* reaches this code.
// Accounts live in one Durable Object (SQLite). No emails, no phone numbers:
// a username plus a 4-digit code or a swipe pattern.

import { DurableObject } from 'cloudflare:workers';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const stub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('league'));
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};

/* ------------------------------------------------------------------ */
const COOKIE = 'cb_session';
const SESSION_DAYS = 365;
const MAX_FAILS = 10;           // wrong codes before a lockout (was 5; loosened by Nick, Oct 28 2026)
const LOCK_MINUTES = 5;         // doubles with each further lockout, capped at LOCK_MAX_MINUTES (was 15, no cap)
const LOCK_MAX_MINUTES = 60;
const SIGNUPS_PER_IP_HOUR = 8;
const PHOTO_MAX = 200 * 1024;
const SHEET_MAX = 1500 * 1024; // scoresheet photos are resized in the browser first
const COLORS = ['#B83A3A', '#3C6FB8', '#2E8A64', '#8A55B8', '#B87A2E', '#2E8A8A', '#B8476F', '#5B6BB8', '#6F8A2E', '#A0522D', '#FF3D9A', '#3BE8FF', '#FFC857', '#7B2FF7'];
const HANDS = ['Right', 'Left', 'Two-handed'];
const TEAM_NAMES = ['Team Marshmallow', 'Team Soggy', 'Team Frosted', 'Team Crunch', 'Team Sugar Rush', 'Team Spoon'];

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});
const fail = (status, error) => json({ error }, status);
const now = () => Date.now();
const keyOf = u => String(u).trim().toLowerCase();
const slug = s => keyOf(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const randHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
// Epoch ms for a wall-clock time in a time zone (handles daylight saving).
function zonedMs(date, hm, tz = 'America/New_York') {
  const guess = Date.parse(`${date}T${hm}:00Z`);
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(guess)).map(x => [x.type, x.value]));
  return guess - (Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`) - guess);
}
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PICK_KEY = /^(top|low|h200|m:[a-z0-9-]{1,30}~[a-z0-9-]{1,30})$/;
const nyDate = t => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(t));

async function hashSecret(secret, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256);
  return hex(bits);
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// "pin": exactly 4 digits. "pattern": 4-9 distinct dots on a 3x3 grid, numbered 1-9, joined by '-'.
function checkSecret(method, secret) {
  if (method === 'pin') return /^\d{4}$/.test(secret) ? null : 'Your code has to be exactly 4 digits.';
  if (method === 'pattern') {
    if (!/^[1-9](-[1-9]){3,8}$/.test(secret)) return 'Connect at least 4 dots.';
    const dots = secret.split('-');
    return new Set(dots).size === dots.length ? null : 'Each dot can only be used once.';
  }
  return 'Pick a code or a pattern.';
}
function checkUsername(u) {
  if (typeof u !== 'string') return 'Pick a username.';
  const t = u.trim();
  if (t.length < 2 || t.length > 20) return 'Usernames are 2 to 20 characters.';
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(t)) return 'Use letters, numbers, spaces, dots, dashes or underscores.';
  if (!slug(t)) return 'Use at least one letter or number.';
  return null;
}
const clean = (v, max) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

function cleanProfile(p = {}) {
  const out = {
    name: clean(p.name, 24),
    nickname: clean(p.nickname, 28),
    hand: HANDS.includes(p.hand) ? p.hand : '',
    color: COLORS.includes(p.color) ? p.color : '',
    bio: clean(p.bio, 160),
    cereal: clean(p.cereal, 40),
    ball: Number.isInteger(+p.ball) && +p.ball >= 6 && +p.ball <= 16 ? +p.ball : null,
    song: clean(p.song, 60),
    showcase: Array.isArray(p.showcase) ? [...new Set(p.showcase.filter(k => typeof k === 'string' && /^[A-Za-z0-9]{1,24}$/.test(k)))].slice(0, 2) : [],
  };
  return out;
}

/* ------------------------------------------------------------------ */
export class Accounts extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        ukey TEXT PRIMARY KEY, username TEXT NOT NULL, player_id TEXT NOT NULL UNIQUE,
        method TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, cred_set_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL, fails INTEGER NOT NULL DEFAULT 0, lockouts INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER NOT NULL DEFAULT 0, profile TEXT NOT NULL DEFAULT '{}',
        photo BLOB, photo_v INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, ukey TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS signups (ip TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS picks (date TEXT NOT NULL, ukey TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (date, ukey, k));
      CREATE TABLE IF NOT EXISTS callouts (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, from_ukey TEXT NOT NULL, to_pid TEXT NOT NULL, msg TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, ukey TEXT NOT NULL, to_pid TEXT, msg TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS seen (ukey TEXT PRIMARY KEY, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS attendance (date TEXT NOT NULL, ukey TEXT NOT NULL, going INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (date, ukey));
      CREATE TABLE IF NOT EXISTS teamdraws (date TEXT PRIMARY KEY, teams TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sheets (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, lane INTEGER NOT NULL, game INTEGER NOT NULL, pids TEXT NOT NULL DEFAULT '[]', ukey TEXT NOT NULL, img BLOB NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, decided_at INTEGER);
      CREATE TABLE IF NOT EXISTS poll_votes (poll TEXT NOT NULL, ukey TEXT NOT NULL, qid TEXT NOT NULL, v TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (poll, ukey, qid, v));
      CREATE TABLE IF NOT EXISTS likes (kind TEXT NOT NULL, item INTEGER NOT NULL, ukey TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (kind, item, ukey));
      CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, item INTEGER NOT NULL, ukey TEXT NOT NULL, msg TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS bets (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, from_ukey TEXT NOT NULL, to_pid TEXT NOT NULL, stakes TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, answered_at INTEGER);
    `);
    // Betcha dollar amount (Nick, Oct 24 2026): whole dollars, 0 = nothing for the purse
    if (!this.sql.exec('PRAGMA table_info(bets)').toArray().some(c => c.name === 'amount')) this.sql.exec('ALTER TABLE bets ADD COLUMN amount INTEGER NOT NULL DEFAULT 0');
    if (!this.sql.exec('PRAGMA table_info(sheets)').toArray().some(c => c.name === 'test')) this.sql.exec('ALTER TABLE sheets ADD COLUMN test INTEGER NOT NULL DEFAULT 0');
    // Live scoreboard (Nick, Oct 28 2026): the uploader types each tagged bowler's score for that game.
    if (!this.sql.exec('PRAGMA table_info(sheets)').toArray().some(c => c.name === 'scores')) this.sql.exec("ALTER TABLE sheets ADD COLUMN scores TEXT NOT NULL DEFAULT '{}'");
    // Test run over (Nick, Oct 27 2026): wipe any test uploads left behind.
    this.sql.exec('DELETE FROM sheets WHERE test = 1');
    // Settling up (Nick, Oct 25 2026): the loser confirms they paid, the winner confirms they got it.
    // Dollars only reach the purse once both have confirmed.
    const cols = this.sql.exec('PRAGMA table_info(bets)').toArray().map(c => c.name);
    if (!cols.includes('paid_at')) this.sql.exec('ALTER TABLE bets ADD COLUMN paid_at INTEGER');
    if (!cols.includes('got_at')) this.sql.exec('ALTER TABLE bets ADD COLUMN got_at INTEGER');
  }

  /* ---------- helpers ---------- */
  async league(origin) {
    const r = await this.env.ASSETS.fetch(new Request(origin + '/data/league.json'));
    if (!r.ok) throw new Error('league.json missing');
    const L = await r.json();
    this.remapIds(L);
    this.rejectSheets(L);
    return L;
  }
  // Nick's test photos (Oct 28 2026): ids in league.json scoresheets.reject get marked rejected, which
  // pulls them (and their typed live scores) off the public site. They stay in Nick's queue, restorable.
  rejectSheets(L) {
    for (const id of L.scoresheets?.reject || []) {
      if ((this.rejected ??= new Set()).has(+id)) continue;
      this.sql.exec("UPDATE sheets SET status = 'rejected', decided_at = ? WHERE id = ? AND status != 'rejected'", now(), +id);
      this.rejected.add(+id);
    }
  }
  // Old bowler ids (Nick, Oct 28 2026): a placeholder renamed in league.json (players[].formerIds,
  // e.g. scooter -> n8) takes its call-outs, betchas, posts, picks, scoresheet tags and teams with it.
  remapIds(L) {
    for (const p of L.players || []) for (const old of p.formerIds || []) {
      const key = old + '>' + p.id;
      if ((this.remapped ??= new Set()).has(key)) continue;
      for (const t of ['callouts', 'bets', 'posts']) this.sql.exec(`UPDATE ${t} SET to_pid = ? WHERE to_pid = ?`, p.id, old);
      this.sql.exec('UPDATE picks SET v = ? WHERE v = ?', p.id, old);
      this.sql.exec('UPDATE accounts SET player_id = ? WHERE player_id = ? AND NOT EXISTS (SELECT 1 FROM accounts WHERE player_id = ?)', p.id, old, p.id);
      const q = JSON.stringify(old), n = JSON.stringify(p.id);
      this.sql.exec('UPDATE sheets SET pids = REPLACE(pids, ?, ?) WHERE pids LIKE ?', q, n, `%${q}%`);
      this.sql.exec('UPDATE teamdraws SET teams = REPLACE(teams, ?, ?) WHERE teams LIKE ?', q, n, `%${q}%`);
      this.remapped.add(key);
    }
  }
  admin(L) { const a = L.accounts || {}; return { hidden: new Set((a.hidden || []).map(keyOf)), resets: Object.fromEntries(Object.entries(a.resets || {}).map(([k, v]) => [keyOf(k), v])) }; }
  account(ukey) { return this.sql.exec('SELECT * FROM accounts WHERE ukey = ?', ukey).toArray()[0] || null; }
  all() { return this.sql.exec('SELECT ukey, username, player_id, created_at, profile, photo_v FROM accounts ORDER BY created_at').toArray(); }
  hasScores(L, pid) { return (L.events || []).some(e => e.scores && Object.prototype.hasOwnProperty.call(e.scores, pid)); }

  async me(request) {
    const m = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
    if (!m) return null;
    const s = this.sql.exec('SELECT ukey FROM sessions WHERE token_hash = ?', await sha256(m[1])).toArray()[0];
    return s ? this.account(s.ukey) : null;
  }
  async startSession(ukey, secure) {
    const token = randHex(32);
    this.sql.exec('INSERT INTO sessions (token_hash, ukey, created_at) VALUES (?, ?, ?)', await sha256(token), ukey, now());
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
  }
  publicMe(a) {
    if (!a) return { user: null };
    return { user: { username: a.username, playerId: a.player_id, method: a.method, profile: JSON.parse(a.profile), photo: a.photo_v ? `/api/photo/${a.player_id}?v=${a.photo_v}` : null } };
  }

  // The roster the site uses: league.json bowlers, with each account's profile laid over its bowler.
  merged(L) {
    const { hidden } = this.admin(L);
    // sheetName keeps the scoresheet (lane-screen) name so profiles can list it as a known alias.
    const players = (L.players || []).map(p => ({ ...p, sheetName: p.name }));
    const byId = Object.fromEntries(players.map(p => [p.id, p]));
    for (const a of this.all()) {
      if (hidden.has(a.ukey)) continue;
      const pr = JSON.parse(a.profile);
      const fields = {
        name: pr.name || a.username, nickname: pr.nickname || '', hand: pr.hand || '',
        account: a.username, claimed: true,
        ...(pr.color && { color: pr.color }), ...(pr.bio && { bio: pr.bio }), ...(pr.cereal && { cereal: pr.cereal }),
        ...(pr.ball && { ball: pr.ball }), ...(pr.song && { song: pr.song }), ...(pr.showcase?.length && { showcase: pr.showcase }),
        ...(a.photo_v && { photo: `/api/photo/${a.player_id}?v=${a.photo_v}` }),
      };
      const base = byId[a.player_id];
      if (base) Object.assign(base, fields);
      else players.push({ id: a.player_id, joined: nyDate(a.created_at), active: true, ...fields });
    }
    return players;
  }

  /* ---------- routes ---------- */
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api/, '');
    const method = request.method;
    try {
      if (method === 'POST' || method === 'DELETE') {
        const origin = request.headers.get('origin');
        if (origin && origin !== url.origin) return fail(403, 'Wrong site.');
      }
      if (method === 'GET' && path === '/league.json') {
        const L = await this.league(url.origin);
        return json({ ...L, players: this.merged(L) });
      }
      if (method === 'GET' && path === '/roster') {
        const L = await this.league(url.origin); const { hidden } = this.admin(L);
        return json(this.all().filter(a => !hidden.has(a.ukey)).map(a => ({ username: a.username, playerId: a.player_id, name: JSON.parse(a.profile).name || a.username, joined: nyDate(a.created_at) })));
      }
      if (method === 'GET' && path.startsWith('/photo/')) return this.photo(decodeURIComponent(path.slice(7)));
      // Scoresheet photos: approved ones (and test uploads, so the fetch workflow can read them) are public;
      // pending/duplicate/rejected only for the uploader and the commissioner.
      if (method === 'GET' && /^\/sheet\/\d+\.jpg$/.test(path)) {
        const r = this.sql.exec('SELECT img, status, ukey, test FROM sheets WHERE id = ?', +path.match(/\d+/)[0]).toArray()[0];
        if (!r) return new Response('Not found', { status: 404 });
        if (r.status !== 'approved' && !r.test) {
          const viewer = await this.me(request), L = await this.league(url.origin);
          if (!viewer || (viewer.ukey !== r.ukey && viewer.player_id !== L.league?.commissioner)) return new Response('Not found', { status: 404 });
          return new Response(r.img, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, no-store' } });
        }
        return new Response(r.img, { headers: { 'content-type': 'image/jpeg', 'cache-control': r.test ? 'no-store' : 'public, max-age=86400' } });
      }
      // For the Fetch scoresheets workflow: approved sheets for a night, or every test upload (?date=test)
      if (method === 'GET' && path === '/sheets') {
        const d = url.searchParams.get('date') || '';
        const rows = d === 'test'
          ? this.sql.exec('SELECT id, date, lane, game, pids, status FROM sheets WHERE test = 1 ORDER BY lane, game, id').toArray()
          : this.sql.exec("SELECT id, date, lane, game, pids, status FROM sheets WHERE test = 0 AND status = 'approved' AND date = ? ORDER BY lane, game", d).toArray();
        return json(rows.map(r => ({ ...r, pids: JSON.parse(r.pids) })));
      }
      if (method === 'GET' && path === '/me') return json(this.publicMe(await this.me(request)));
      if (method === 'GET' && path === '/method') {
        const a = this.account(keyOf(url.searchParams.get('u') || ''));
        if (!a) return fail(404, 'No account with that username.');
        const r = this.admin(await this.league(url.origin)).resets[a.ukey];
        return json({ method: a.method, username: a.username, reset: !!(r && Date.parse(r + 'T00:00:00-05:00') > a.cred_set_at) });
      }
      if (method === 'GET' && path === '/claimable') {
        const L = await this.league(url.origin);
        const taken = new Set(this.all().map(a => a.player_id));
        return json((L.players || []).filter(p => !taken.has(p.id) && p.active !== false).map(p => ({ id: p.id, name: p.name })));
      }

      if (method === 'POST' && path === '/signup') return this.signup(request, url);
      if (method === 'POST' && path === '/login') return this.login(request, url);
      if (method === 'POST' && path === '/logout') {
        const m = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
        if (m) this.sql.exec('DELETE FROM sessions WHERE token_hash = ?', await sha256(m[1]));
        return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
      }

      if (method === 'GET' && path === '/games') {
        const L = await this.league(url.origin);
        await this.drawDue(L);
        return json(this.games(L, await this.me(request)));
      }

      const me = await this.me(request);
      if (!me) return fail(401, 'Sign in first.');
      if (method === 'POST' && path === '/pick') {
        const { date, key, value } = await request.json();
        const L = await this.league(url.origin);
        const bad = this.openNight(L, date); if (bad) return fail(400, bad);
        if (!PICK_KEY.test(key || '')) return fail(400, 'That’s not a pick.');
        if (value == null || value === '') this.sql.exec('DELETE FROM picks WHERE date = ? AND ukey = ? AND k = ?', date, me.ukey, key);
        else {
          const v = String(value);
          if (key === 'h200' ? !['yes', 'no'].includes(v) : !this.merged(L).some(p => p.id === v)) return fail(400, 'That’s not one of the choices.');
          if (key.startsWith('m:') && !key.slice(2).split('~').includes(v)) return fail(400, 'Pick one of the two bowlers.');
          this.sql.exec('INSERT INTO picks (date, ukey, k, v, at) VALUES (?,?,?,?,?) ON CONFLICT(date, ukey, k) DO UPDATE SET v = excluded.v, at = excluded.at', date, me.ukey, key, v, now());
        }
        return json(this.games(L, me));
      }
      if (method === 'POST' && path === '/callout') {
        const { date, to, msg } = await request.json();
        const L = await this.league(url.origin);
        const bad = this.openNight(L, date); if (bad) return fail(400, bad);
        if (to === me.player_id) return fail(400, 'You can’t call yourself out.');
        if (!this.merged(L).some(p => p.id === to && p.active !== false)) return fail(404, 'No bowler by that name.');
        if (this.sql.exec('SELECT 1 FROM callouts WHERE date = ? AND from_ukey = ? AND to_pid = ?', date, me.ukey, to).toArray().length) return fail(409, 'You already called them out for that night.');
        if (this.sql.exec('SELECT COUNT(*) AS n FROM callouts WHERE date = ? AND from_ukey = ?', date, me.ukey).one().n >= 3) return fail(429, 'Three call-outs a night. Pick your battles.');
        this.sql.exec('INSERT INTO callouts (date, from_ukey, to_pid, msg, created_at) VALUES (?,?,?,?,?)', date, me.ukey, to, clean(msg, 100), now());
        return json(this.games(L, me), 201);
      }
      if (method === 'DELETE' && path.startsWith('/callout/')) {
        const c = this.sql.exec('SELECT * FROM callouts WHERE id = ?', +path.slice(9)).toArray()[0];
        if (!c || c.from_ukey !== me.ukey) return fail(404, 'Not your call-out.');
        const L = await this.league(url.origin);
        if (now() >= this.lockAt(L, c.date)) return fail(400, 'Too late to back down now.');
        this.sql.exec('DELETE FROM callouts WHERE id = ?', c.id);
        return json(this.games(L, me));
      }
      if (method === 'POST' && path === '/bet') {
        const { date, to, stakes, amount } = await request.json();
        const L = await this.league(url.origin);
        const bad = this.openNight(L, date); if (bad) return fail(400, bad.replace('Picks', 'Betchas'));
        if (to === me.player_id) return fail(400, 'You can’t bet yourself.');
        if (!this.merged(L).some(p => p.id === to && p.active !== false)) return fail(404, 'No bowler by that name.');
        const s = clean(stakes, 80);
        if (s.length < 2) return fail(400, 'Say what’s on the line.');
        const amt = amount == null || amount === '' ? 0 : Number(amount);
        if (!Number.isInteger(amt) || amt < 0 || amt > 100) return fail(400, 'Bet a whole dollar amount from $0 to $100.');
        if (this.sql.exec("SELECT 1 FROM bets WHERE date = ? AND from_ukey = ? AND to_pid = ? AND status != 'declined'", date, me.ukey, to).toArray().length) return fail(409, 'You already have a betcha with them that night.');
        if (this.sql.exec("SELECT COUNT(*) AS n FROM bets WHERE date = ? AND from_ukey = ? AND status != 'declined'", date, me.ukey).one().n >= 3) return fail(429, 'Three betchas a night. Don’t go broke.');
        this.sql.exec('INSERT INTO bets (date, from_ukey, to_pid, stakes, amount, created_at) VALUES (?,?,?,?,?,?)', date, me.ukey, to, s, amt, now());
        return json(this.games(L, me), 201);
      }
      if (method === 'POST' && /^\/bet\/\d+\/(accept|decline)$/.test(path)) {
        const [, , id, act] = path.split('/');
        const b = this.sql.exec('SELECT * FROM bets WHERE id = ?', +id).toArray()[0];
        if (!b || b.to_pid !== me.player_id) return fail(404, 'That betcha isn’t yours to answer.');
        if (b.status !== 'open') return fail(409, 'You already answered that one.');
        const L = await this.league(url.origin);
        if (now() >= this.lockAt(L, b.date)) return fail(400, 'Too late. Betchas lock at first ball.');
        this.sql.exec('UPDATE bets SET status = ?, answered_at = ? WHERE id = ?', act === 'accept' ? 'accepted' : 'declined', now(), b.id);
        return json(this.games(L, me));
      }
      if (method === 'POST' && /^\/bet\/\d+\/(paid|got)$/.test(path)) {
        const [, , id, act] = path.split('/');
        const b = this.sql.exec('SELECT * FROM bets WHERE id = ?', +id).toArray()[0];
        if (!b || b.status !== 'accepted') return fail(404, 'No bet to settle.');
        const L = await this.league(url.origin);
        const pidOf = Object.fromEntries(this.all().map(a => [a.ukey, a.player_id]));
        const res = this.betWinner(L, { from: pidOf[b.from_ukey], to: b.to_pid, date: b.date });
        if (!res) return fail(400, 'Nobody’s won this one yet.');
        if (act === 'paid') {
          if (me.player_id !== res.loser) return fail(403, 'Only the loser can say they paid.');
          if (!b.paid_at) this.sql.exec('UPDATE bets SET paid_at = ? WHERE id = ?', now(), b.id);
        } else {
          if (me.player_id !== res.winner) return fail(403, 'Only the winner can confirm they got paid.');
          if (!b.got_at) this.sql.exec('UPDATE bets SET got_at = ? WHERE id = ?', now(), b.id);
        }
        return json(this.games(L, me));
      }
      if (method === 'DELETE' && path.startsWith('/bet/')) {
        const b = this.sql.exec('SELECT * FROM bets WHERE id = ?', +path.slice(5)).toArray()[0];
        if (!b || b.from_ukey !== me.ukey) return fail(404, 'Not your betcha.');
        if (b.status === 'accepted') return fail(400, 'They took the bet. No backing out now.');
        const L = await this.league(url.origin);
        if (now() >= this.lockAt(L, b.date)) return fail(400, 'Too late to back down now.');
        this.sql.exec('DELETE FROM bets WHERE id = ?', b.id);
        return json(this.games(L, me));
      }
      // Attendance (Nick, Oct 25 2026): Yes puts you on that Wednesday's lineup (and the team queue on a
      // team night); Nick gets a notification either way. Changeable until first ball.
      if (method === 'POST' && path === '/attend') {
        const { date, going } = await request.json();
        const L = await this.league(url.origin);
        const bad = this.openNight(L, date); if (bad) return fail(400, bad.replace('Picks lock', 'Attendance locks').replace('Picks open', 'Attendance opens'));
        if (typeof going !== 'boolean') return fail(400, 'Yes or no?');
        const prev = this.sql.exec('SELECT going FROM attendance WHERE date = ? AND ukey = ?', date, me.ukey).toArray()[0];
        this.sql.exec('INSERT INTO attendance (date, ukey, going, at) VALUES (?,?,?,?) ON CONFLICT(date, ukey) DO UPDATE SET going = excluded.going, at = excluded.at', date, me.ukey, going ? 1 : 0, now());
        await this.ctx.storage.put('origin', url.origin);
        if (L.teamNights?.[date]) await this.armAlarm(L);
        if (!prev || !!prev.going !== going) {
          const name = this.merged(L).find(p => p.id === me.player_id)?.name || me.username;
          const day = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
          const yes = this.sql.exec('SELECT COUNT(*) AS n FROM attendance WHERE date = ? AND going = 1', date).one().n;
          this.ctx.waitUntil(this.push(L, going ? `${name} is IN for ${day}` : `${name} is OUT for ${day}`,
            `${prev ? 'Changed their answer. ' : ''}${yes} confirmed so far${L.teamNights?.[date] ? ' (team night queue)' : ''}.`, going ? 'white_check_mark' : 'x'));
        }
        return json(this.games(L, me));
      }
      if (method === 'POST' && path === '/post') {
        const { msg, to } = await request.json();
        const m = clean(msg, 200);
        if (!m) return fail(400, 'Say something.');
        const L = await this.league(url.origin);
        let target = null;
        if (to) {
          if (to === me.player_id) return fail(400, 'Talking to yourself?');
          if (!this.merged(L).some(p => p.id === to && p.active !== false)) return fail(404, 'No bowler by that name.');
          target = to;
        }
        const last = this.sql.exec('SELECT created_at FROM posts WHERE ukey = ? ORDER BY created_at DESC LIMIT 1', me.ukey).toArray()[0];
        if (last && now() - last.created_at < 10e3) return fail(429, 'Easy. Wait a few seconds between posts.');
        this.sql.exec('INSERT INTO posts (ukey, to_pid, msg, created_at) VALUES (?,?,?,?)', me.ukey, target, m, now());
        return json(this.games(L, me), 201);
      }
      // Likes + comments on shit talk, betchas and call-outs (Nick, Oct 28 2026)
      if (method === 'POST' && (path === '/like' || path === '/comment')) {
        const { kind, id, msg } = await request.json().catch(() => ({}));
        const table = { post: 'posts', bet: 'bets', callout: 'callouts' }[kind];
        if (!table || !this.sql.exec(`SELECT 1 FROM ${table} WHERE id = ?`, +id).toArray().length) return fail(404, 'That’s gone.');
        if (path === '/like') {
          const had = this.sql.exec('SELECT 1 FROM likes WHERE kind = ? AND item = ? AND ukey = ?', kind, +id, me.ukey).toArray().length;
          if (had) this.sql.exec('DELETE FROM likes WHERE kind = ? AND item = ? AND ukey = ?', kind, +id, me.ukey);
          else this.sql.exec('INSERT INTO likes (kind, item, ukey, at) VALUES (?,?,?,?)', kind, +id, me.ukey, now());
        } else {
          const m = clean(msg, 200);
          if (!m) return fail(400, 'Say something first.');
          const last = this.sql.exec('SELECT at FROM comments WHERE ukey = ? ORDER BY at DESC LIMIT 1', me.ukey).toArray()[0];
          if (last && now() - last.at < 5e3) return fail(429, 'Easy. Wait a few seconds.');
          this.sql.exec('INSERT INTO comments (kind, item, ukey, msg, at) VALUES (?,?,?,?,?)', kind, +id, me.ukey, m, now());
        }
        return json(this.games(await this.league(url.origin), me));
      }
      if (method === 'DELETE' && path.startsWith('/comment/')) {
        const L = await this.league(url.origin);
        const cm = this.sql.exec('SELECT id, ukey FROM comments WHERE id = ?', +path.slice(9)).toArray()[0];
        if (!cm || (cm.ukey !== me.ukey && me.player_id !== L.league?.commissioner)) return fail(404, 'Not your comment.');
        this.sql.exec('DELETE FROM comments WHERE id = ?', cm.id);
        return json(this.games(L, me));
      }
      if (method === 'DELETE' && path.startsWith('/post/')) {
        const pst = this.sql.exec('SELECT * FROM posts WHERE id = ?', +path.slice(6)).toArray()[0];
        if (!pst || pst.ukey !== me.ukey) return fail(404, 'Not your post.');
        this.sql.exec('DELETE FROM posts WHERE id = ?', pst.id);
        return json(this.games(await this.league(url.origin), me));
      }
      // Scoresheet photos (Nick, Oct 27 2026): a bowler snaps the lane screen, tags night + lane (typed) + game
      // (+ optionally who's on the lane). Nick approves or rejects. Nothing is ever replaced automatically:
      // two photos for the same night/lane/game land in Nick's duplicate queue so he can compare them.
      // `test` uploads (commissioner only) never show publicly and can be cleared in one go.
      if (method === 'POST' && path === '/sheet') {
        const L = await this.league(url.origin);
        const lanes = L.scoresheets?.lanes || 24, q = url.searchParams;
        const boss = me.player_id === L.league?.commissioner, test = false; // test area retired Oct 27 2026
        const date = q.get('date') || '', lane = +q.get('lane'), game = +q.get('game');
        const today = nyDate(now()), oldest = nyDate(now() - 14 * 864e5);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (!test && (date > today || date < oldest))) return fail(400, 'Pick tonight or a recent league night.');
        if (!Number.isInteger(lane) || lane < 1 || lane > lanes) return fail(400, `Type a lane number from 1 to ${lanes}.`);
        if (![1, 2, 3].includes(game)) return fail(400, 'Pick game 1, 2 or 3.');
        const roster = new Set(this.merged(L).map(p => p.id));
        const pids = [...new Set((q.get('pids') || '').split(',').filter(Boolean))].filter(id => roster.has(id)).slice(0, 8);
        let typed = {}; try { typed = JSON.parse(q.get('scores') || '{}') || {}; } catch { typed = {}; }
        const scores = Object.fromEntries(pids.filter(id => Number.isInteger(+typed[id]) && typed[id] !== '' && +typed[id] >= 0 && +typed[id] <= 300).map(id => [id, +typed[id]]));
        const buf = new Uint8Array(await request.arrayBuffer());
        if (!buf.length || buf.length > SHEET_MAX) return fail(413, 'That photo is too big.');
        if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) return fail(415, 'Photos have to be JPEGs.');
        const recent = this.sql.exec('SELECT COUNT(*) AS n FROM sheets WHERE ukey = ? AND created_at > ?', me.ukey, now() - 36e5).one().n;
        if (recent >= 30) return fail(429, 'Easy there. Try again in a bit.');
        this.sql.exec('INSERT INTO sheets (date, lane, game, pids, ukey, img, status, created_at, test, scores) VALUES (?,?,?,?,?,?,?,?,?,?)',
          date, lane, game, JSON.stringify(pids), me.ukey, buf, 'pending', now(), test ? 1 : 0, JSON.stringify(scores));
        const dup = this.sql.exec("SELECT COUNT(*) AS n FROM sheets WHERE date = ? AND lane = ? AND game = ? AND test = ? AND status IN ('pending','approved')", date, lane, game, test ? 1 : 0).one().n > 1;
        const name = this.merged(L).find(p => p.id === me.player_id)?.name || me.username;
        if (!boss) this.ctx.waitUntil(this.push(L, `Scoresheet to ${dup ? 'check (possible duplicate)' : 'approve'}: lane ${lane}, game ${game}`, `${name} sent a photo. Open the site to ${dup ? 'compare them' : 'approve it'}.`, 'camera'));
        return json(this.games(L, me), 201);
      }
      if (method === 'POST' && /^\/sheet\/\d+\/(approve|reject|duplicate|restore|move|scores)$/.test(path)) {
        const L = await this.league(url.origin);
        if (me.player_id !== L.league?.commissioner) return fail(403, 'Only the commissioner can do that.');
        const [, id, act] = path.match(/^\/sheet\/(\d+)\/(\w+)$/);
        const sh = this.sql.exec('SELECT id, date, lane, game, test FROM sheets WHERE id = ?', +id).toArray()[0];
        if (!sh) return fail(404, 'That photo is gone.');
        const set = st => this.sql.exec('UPDATE sheets SET status = ?, decided_at = ? WHERE id = ?', st, st === 'pending' ? null : now(), sh.id);
        if (act === 'approve') {
          // the slot keeps one approved photo; any other approved one there becomes a duplicate (kept, not deleted)
          this.sql.exec("UPDATE sheets SET status = 'duplicate', decided_at = ? WHERE date = ? AND lane = ? AND game = ? AND test = ? AND id != ? AND status = 'approved'", now(), sh.date, sh.lane, sh.game, sh.test, sh.id);
          set('approved');
        } else if (act === 'reject') set('rejected');
        else if (act === 'duplicate') set('duplicate');
        else if (act === 'restore') set('pending');
        else if (act === 'scores') {
          // Nick fixes a typed score, or adds who's on the lane + their scores (Oct 28 2026)
          const body = await request.json().catch(() => ({}));
          const roster = new Set(this.merged(L).map(p => p.id));
          const sc = Object.fromEntries(Object.entries(body.scores || {}).filter(([pid, v]) => roster.has(pid) && v !== '' && v != null && Number.isInteger(+v) && +v >= 0 && +v <= 300).map(([pid, v]) => [pid, +v]));
          const cur = JSON.parse(this.sql.exec('SELECT pids FROM sheets WHERE id = ?', sh.id).one().pids || '[]');
          const pids = [...new Set([...cur, ...Object.keys(sc)])].slice(0, 8);
          this.sql.exec('UPDATE sheets SET scores = ?, pids = ? WHERE id = ?', JSON.stringify(sc), JSON.stringify(pids), sh.id);
        }
        else {
          // Not a duplicate after all: fix the lane/game the uploader typed
          const { lane, game } = await request.json().catch(() => ({}));
          const lanes = L.scoresheets?.lanes || 24;
          if (!Number.isInteger(+lane) || +lane < 1 || +lane > lanes || ![1, 2, 3].includes(+game)) return fail(400, `Lane 1-${lanes}, game 1-3.`);
          this.sql.exec("UPDATE sheets SET lane = ?, game = ?, status = 'pending', decided_at = NULL WHERE id = ?", +lane, +game, sh.id);
        }
        return json(this.games(L, me));
      }
      if (method === 'DELETE' && path === '/sheets/test') {
        const L = await this.league(url.origin);
        if (me.player_id !== L.league?.commissioner) return fail(403, 'Only the commissioner can do that.');
        this.sql.exec('DELETE FROM sheets WHERE test = 1');
        return json(this.games(L, me));
      }
      if (method === 'DELETE' && path.startsWith('/sheet/')) {
        const L = await this.league(url.origin);
        const sh = this.sql.exec('SELECT id, ukey, status, test FROM sheets WHERE id = ?', +path.slice(7)).toArray()[0];
        if (!sh || !((sh.ukey === me.ukey && sh.status === 'pending') || (sh.test && me.player_id === L.league?.commissioner))) return fail(404, 'Not yours to delete.');
        this.sql.exec('DELETE FROM sheets WHERE id = ?', sh.id);
        return json(this.games(L, me));
      }
      // League poll (Nick, Oct 27 2026): questions live in league.json `poll`; one set of answers per
      // account, changeable while the poll is open. Results are live for everyone.
      if (method === 'POST' && path === '/poll') {
        const L = await this.league(url.origin);
        const P = L.poll;
        const { poll, answers } = await request.json();
        if (!P || P.id !== poll) return fail(404, 'That poll is gone.');
        if (P.open === false) return fail(400, 'This poll is closed.');
        if (!answers || typeof answers !== 'object') return fail(400, 'Answer at least one question.');
        const rows = [];
        for (const q of P.questions || []) {
          const a = answers[q.id];
          if (a == null || a === '' || (Array.isArray(a) && !a.length)) continue;
          const ok = new Set((q.options || []).map(o => o.v));
          if (q.type === 'text') { const t = clean(a, 300); if (t) rows.push([q.id, t]); }
          else if (q.type === 'many') {
            if (!Array.isArray(a) || a.some(v => !ok.has(v))) return fail(400, `“${q.q}” has an answer that isn’t a choice.`);
            [...new Set(a)].forEach(v => rows.push([q.id, v]));
          } else {
            if (!ok.has(a)) return fail(400, `“${q.q}” has an answer that isn’t a choice.`);
            rows.push([q.id, a]);
          }
        }
        if (!rows.length) return fail(400, 'Answer at least one question.');
        const first = !this.sql.exec('SELECT 1 FROM poll_votes WHERE poll = ? AND ukey = ? LIMIT 1', P.id, me.ukey).toArray().length;
        this.sql.exec('DELETE FROM poll_votes WHERE poll = ? AND ukey = ?', P.id, me.ukey);
        const t = now();
        for (const [qid, v] of rows) this.sql.exec('INSERT OR IGNORE INTO poll_votes (poll, ukey, qid, v, at) VALUES (?,?,?,?,?)', P.id, me.ukey, qid, v, t);
        if (first) {
          const name = this.merged(L).find(p => p.id === me.player_id)?.name || me.username;
          const n = this.sql.exec('SELECT COUNT(DISTINCT ukey) AS n FROM poll_votes WHERE poll = ?', P.id).one().n;
          this.ctx.waitUntil(this.push(L, `${name} took the league poll`, `${n} ${n === 1 ? 'bowler has' : 'bowlers have'} voted so far.`, 'ballot_box'));
        }
        return json(this.games(L, me));
      }
      if (method === 'POST' && path === '/seen') {
        this.sql.exec('INSERT INTO seen (ukey, at) VALUES (?, ?) ON CONFLICT(ukey) DO UPDATE SET at = excluded.at', me.ukey, now());
        return json({ ok: true, seenAt: now() });
      }
      if (method === 'POST' && path === '/profile') {
        const body = await request.json();
        this.sql.exec('UPDATE accounts SET profile = ? WHERE ukey = ?', JSON.stringify(cleanProfile(body)), me.ukey);
        return json(this.publicMe(this.account(me.ukey)));
      }
      if (method === 'POST' && path === '/photo') {
        const buf = new Uint8Array(await request.arrayBuffer());
        if (!buf.length || buf.length > PHOTO_MAX) return fail(413, 'That photo is too big.');
        if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) return fail(415, 'Photos have to be JPEGs.');
        this.sql.exec('UPDATE accounts SET photo = ?, photo_v = ? WHERE ukey = ?', buf, now(), me.ukey);
        return json(this.publicMe(this.account(me.ukey)));
      }
      if (method === 'DELETE' && path === '/photo') {
        this.sql.exec('UPDATE accounts SET photo = NULL, photo_v = 0 WHERE ukey = ?', me.ukey);
        return json(this.publicMe(this.account(me.ukey)));
      }
      if (method === 'POST' && path === '/claim') {
        const { playerId } = await request.json();
        const L = await this.league(url.origin);
        const target = (L.players || []).find(p => p.id === playerId);
        if (!target) return fail(404, 'That bowler isn’t on the scoresheet.');
        if (this.sql.exec('SELECT 1 FROM accounts WHERE player_id = ?', playerId).toArray().length) return fail(409, 'Someone already claimed that bowler. Tell Nick if it’s you.');
        if (this.hasScores(L, me.player_id) && me.player_id !== playerId) return fail(409, 'Your account already has scores. Ask Nick to merge them.');
        this.sql.exec('UPDATE accounts SET player_id = ? WHERE ukey = ?', playerId, me.ukey);
        return json(this.publicMe(this.account(me.ukey)));
      }
      if (method === 'POST' && path === '/code') {
        const { current, method: m, secret } = await request.json();
        if (!(await this.verify(me, String(current || '')))) return fail(403, 'Your current code or pattern doesn’t match.');
        const err = checkSecret(m, String(secret || '')); if (err) return fail(400, err);
        const salt = randHex(16);
        this.sql.exec('UPDATE accounts SET method = ?, salt = ?, hash = ?, cred_set_at = ? WHERE ukey = ?', m, salt, await hashSecret(String(secret), salt), now(), me.ukey);
        return json(this.publicMe(this.account(me.ukey)));
      }
      return fail(404, 'Not found.');
    } catch (e) {
      console.error(e);
      return fail(500, 'Something broke. Try again.');
    }
  }

  // A league night that is still open for picks and call-outs. Returns an error string or null.
  openNight(L, date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return 'Pick a league night.';
    const lg = L.league || {};
    if (WEEKDAYS[new Date(date + 'T12:00:00Z').getUTCDay()] !== (lg.weekday || 'Wednesday')) return 'That isn’t a league night.';
    if ((lg.skipDates || []).includes(date)) return 'No bowling that night.';
    if ((L.events || []).some(e => e.date === date && e.status === 'completed')) return 'That night is already scored.';
    const lock = zonedMs(date, lg.startTime || '19:15', lg.timezone);
    if (now() >= lock) return 'Too late. Picks lock at first ball.';
    if (lock - now() > 8 * 86400e3) return 'Too early. Picks open the week of.';
    return null;
  }
  // Who won a settled betcha: higher series that night (same rule as the site). Null if not scored, tie or no-show.
  betWinner(L, b) {
    const e = (L.events || []).find(x => x.date === b.date && x.status === 'completed' && x.scores);
    if (!e) return null;
    const ids = new Set((L.players || []).map(p => p.id));
    const series = pid => {
      if (!ids.has(pid)) return null;
      const got = [0, 1, 2].map(k => e.scores[pid]?.[k]).filter(Number.isFinite);
      return got.length ? got.reduce((a, v) => a + v, 0) : null;
    };
    const a = series(b.from), c = series(b.to);
    if (a == null || c == null || a === c) return null;
    return a > c ? { winner: b.from, loser: b.to } : { winner: b.to, loser: b.from };
  }
  /* ---------- attendance + team nights ---------- */
  // Phone push to Nick through ntfy (free app, no account). Topic: env NTFY_TOPIC, else league.notify.ntfy.
  async push(L, title, body, tag) {
    const topic = this.env.NTFY_TOPIC || L.notify?.ntfy;
    if (!topic) return;
    try {
      await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, { method: 'POST', body,
        headers: { Title: title.replace(/[^\x20-\x7e]/g, ''), Tags: tag || 'bowling', Click: 'https://cerealbowlers.org/' } });
    } catch (e) { console.error('push failed', e); }
  }
  // Wake up at the next team night's first ball to draw the teams even if nobody has the site open.
  async armAlarm(L) {
    const due = Object.keys(L.teamNights || {}).map(d => this.lockAt(L, d)).filter(t => t > now()).sort((a, b) => a - b)[0];
    if (!due) return;
    const cur = await this.ctx.storage.getAlarm();
    if (!cur || cur > due || cur < now()) await this.ctx.storage.setAlarm(due + 5e3);
  }
  async alarm() {
    const origin = (await this.ctx.storage.get('origin')) || 'https://cerealbowlers.org';
    const L = await this.league(origin);
    await this.drawDue(L, true);
    await this.armAlarm(L);
  }
  // Draw any team night whose first ball has passed and isn't drawn yet. The draw is stored, so it never changes.
  async drawDue(L, announce = true) {
    const drawn = new Set(this.sql.exec('SELECT date FROM teamdraws').toArray().map(r => r.date));
    for (const date of Object.keys(L.teamNights || {})) {
      if (drawn.has(date) || now() < this.lockAt(L, date)) continue;
      if (now() - this.lockAt(L, date) > 2 * 86400e3) continue;     // don't redraw old nights
      const teams = this.drawTeams(L, date);
      if (!teams) continue;
      this.sql.exec('INSERT OR IGNORE INTO teamdraws (date, teams, at) VALUES (?,?,?)', date, JSON.stringify(teams), now());
      if (announce) {
        const P = Object.fromEntries(this.merged(L).map(p => [p.id, p.name]));
        await this.push(L, 'Teams are set', teams.map(t => `${t.name}: ${t.pids.map(id => P[id] || id).join(', ')}`).join('\n'), 'bowling');
      }
    }
  }
  // Even teams from the queue: thousands of random splits, keep the most even ones (team average of
  // each bowler's average), then pick one of those at random. New bowlers count as the league average.
  drawTeams(L, date) {
    const { hidden } = this.admin(L);
    const pidOf = Object.fromEntries(this.all().filter(a => !hidden.has(a.ukey)).map(a => [a.ukey, a.player_id]));
    const pool = this.sql.exec('SELECT ukey FROM attendance WHERE date = ? AND going = 1 ORDER BY at', date).toArray().map(r => pidOf[r.ukey]).filter(Boolean);
    const n = pool.length; if (n < 2) return null;
    const cfg = L.teamNights[date] || {};
    let k = Number.isInteger(cfg.teams) ? cfg.teams : n >= 12 ? 4 : n >= 6 ? 3 : 2;
    k = Math.max(2, Math.min(k, Math.floor(n / 2)));
    const games = {}, win = L.league?.handicap?.games || 0;
    for (const e of [...(L.events || [])].filter(e => e.status === 'completed' && e.date < date && e.scores).sort((a, b) => a.date.localeCompare(b.date)))
      for (const [pid, arr] of Object.entries(e.scores)) (games[pid] ??= []).push(...arr.filter(Number.isFinite));
    const avgOf = pid => { const g = games[pid]; if (!g?.length) return null; const r = win ? g.slice(-win) : g; return r.reduce((a, b) => a + b, 0) / r.length; };
    const known = pool.map(avgOf).filter(v => v != null);
    const fill = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 140;
    const avg = Object.fromEntries(pool.map(p => [p, avgOf(p) ?? fill]));
    const rnd = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const tries = [];
    for (let t = 0; t < 4000; t++) {
      const order = shuffle([...pool]), split = Array.from({ length: k }, () => []);
      order.forEach((p, i) => split[i % k].push(p));
      const means = split.map(s => s.reduce((a, p) => a + avg[p], 0) / s.length);
      tries.push({ split, spread: Math.max(...means) - Math.min(...means) });
    }
    const best = Math.min(...tries.map(t => t.spread));
    const close = tries.filter(t => t.spread <= best + 2);
    const pick = close[rnd(close.length)].split;
    const names = shuffle([...TEAM_NAMES]);
    return pick.map((pids, i) => ({ name: names[i % names.length], pids }));
  }

  lockAt(L, date) { const lg = L.league || {}; return zonedMs(date, lg.startTime || '19:15', lg.timezone); }

  games(L, me) {
    const { hidden } = this.admin(L);
    const pidOf = Object.fromEntries(this.all().map(a => [a.ukey, a.player_id]));
    const live = ukey => !hidden.has(ukey) && pidOf[ukey];
    const nights = {};
    for (const r of this.sql.exec('SELECT date, ukey, k, v FROM picks ORDER BY date').toArray()) {
      if (!live(r.ukey)) continue;
      const n = nights[r.date] ??= { lockAt: this.lockAt(L, r.date), counts: {}, byPlayer: {}, mine: {} };
      ((n.counts[r.k] ??= {})[r.v] = ((n.counts[r.k] ?? {})[r.v] || 0) + 1);
      if (now() >= n.lockAt) (n.byPlayer[pidOf[r.ukey]] ??= {})[r.k] = r.v;
      if (me && r.ukey === me.ukey) n.mine[r.k] = r.v;
    }
    for (const n of Object.values(nights)) if (now() < n.lockAt) delete n.byPlayer;
    const callouts = this.sql.exec('SELECT id, date, from_ukey, to_pid, msg, created_at FROM callouts ORDER BY created_at').toArray()
      .filter(c => live(c.from_ukey)).map(c => ({ id: c.id, date: c.date, from: pidOf[c.from_ukey], to: c.to_pid, msg: c.msg, at: c.created_at }));
    const bets = this.sql.exec('SELECT id, date, from_ukey, to_pid, stakes, amount, status, created_at, answered_at, paid_at, got_at FROM bets ORDER BY created_at').toArray()
      .filter(b => live(b.from_ukey)).map(b => ({ id: b.id, date: b.date, from: pidOf[b.from_ukey], to: b.to_pid, stakes: b.stakes, amount: b.amount || 0, status: b.status, at: b.created_at, answeredAt: b.answered_at || null, paidAt: b.paid_at || null, gotAt: b.got_at || null }));
    const hiddenPosts = new Set((L.talk?.hidden || []).map(Number));
    const posts = this.sql.exec('SELECT id, ukey, to_pid, msg, created_at FROM posts ORDER BY created_at DESC LIMIT 200').toArray()
      .filter(x => live(x.ukey) && !hiddenPosts.has(x.id)).map(x => ({ id: x.id, from: pidOf[x.ukey], to: x.to_pid || null, msg: x.msg, at: x.created_at }));
    const seenAt = me ? (this.sql.exec('SELECT at FROM seen WHERE ukey = ?', me.ukey).toArray()[0]?.at || 0) : 0;
    const attendance = {};
    for (const r of this.sql.exec('SELECT date, ukey, going, at FROM attendance ORDER BY at').toArray()) {
      if (!live(r.ukey)) continue;
      const a = attendance[r.date] ??= { lockAt: this.lockAt(L, r.date), yes: [], no: [], mine: null };
      a[r.going ? 'yes' : 'no'].push({ pid: pidOf[r.ukey], at: r.at });
      if (me && r.ukey === me.ukey) a.mine = !!r.going;
    }
    const teams = Object.fromEntries(this.sql.exec('SELECT date, teams, at FROM teamdraws').toArray().map(r => [r.date, { teams: JSON.parse(r.teams), at: r.at }]));
    let poll = null;
    if (L.poll?.id) {
      const types = Object.fromEntries((L.poll.questions || []).map(q => [q.id, q.type]));
      poll = { id: L.poll.id, voters: 0, counts: {}, texts: {}, mine: null };
      const who = new Set();
      for (const r of this.sql.exec('SELECT ukey, qid, v, at FROM poll_votes WHERE poll = ? ORDER BY at DESC', L.poll.id).toArray()) {
        if (!live(r.ukey) || !types[r.qid]) continue;
        who.add(r.ukey);
        if (types[r.qid] === 'text') (poll.texts[r.qid] ??= []).push({ msg: r.v, at: r.at });
        else (poll.counts[r.qid] ??= {})[r.v] = ((poll.counts[r.qid] || {})[r.v] || 0) + 1;
        if (me && r.ukey === me.ukey) {
          const m = poll.mine ??= {};
          if (types[r.qid] === 'many') (m[r.qid] ??= []).push(r.v); else m[r.qid] = r.v;
        }
      }
      poll.voters = who.size;
    }
    const boss = me && me.player_id === L.league?.commissioner;
    // Live scoreboard: every typed score on a pending or approved photo is public (the photo itself may not be).
    // One score per bowler per game: an approved photo beats a pending one, then the newest wins.
    const liveBest = {};
    for (const x of this.sql.exec("SELECT id, date, lane, game, ukey, status, scores, created_at FROM sheets WHERE test = 0 AND status IN ('pending','approved') AND date >= ? ORDER BY created_at", nyDate(now() - 14 * 864e5)).toArray()) {
      if (!live(x.ukey)) continue;
      let sc = {}; try { sc = JSON.parse(x.scores || '{}'); } catch { sc = {}; }
      for (const [pid, score] of Object.entries(sc)) {
        const k = `${x.date}|${pid}|${x.game}`, cur = liveBest[k], ok = x.status === 'approved';
        if (!cur || (ok && !cur.ok) || (ok === cur.ok && x.created_at >= cur.at)) liveBest[k] = { date: x.date, pid, game: x.game, lane: x.lane, score, ok, at: x.created_at, sheet: x.id };
      }
    }
    const liveScores = Object.values(liveBest);
    const sheets = this.sql.exec('SELECT id, date, lane, game, pids, scores, ukey, status, test, created_at, decided_at FROM sheets ORDER BY date DESC, lane, game, created_at DESC LIMIT 400').toArray()
      .filter(x => x.test ? boss : (x.status === 'approved' || (me && (boss || x.ukey === me.ukey))))
      .filter(x => boss || x.status !== 'rejected' || (x.decided_at > now() - 7 * 864e5))
      .map(x => ({ id: x.id, date: x.date, lane: x.lane, game: x.game, pids: JSON.parse(x.pids), scores: JSON.parse(x.scores || '{}'), from: pidOf[x.ukey] || null, status: x.status, test: !!x.test, at: x.created_at, decidedAt: x.decided_at || null, mine: !!me && x.ukey === me.ukey }));
    const likes = {}, comments = {};
    for (const r of this.sql.exec('SELECT kind, item, ukey FROM likes ORDER BY at').toArray()) {
      if (!live(r.ukey)) continue;
      const l = likes[`${r.kind}:${r.item}`] ??= { n: 0, who: [], mine: false };
      l.n++; l.who.push(pidOf[r.ukey]); if (me && r.ukey === me.ukey) l.mine = true;
    }
    const hiddenComments = new Set((L.talk?.hiddenComments || []).map(Number));
    for (const r of this.sql.exec('SELECT id, kind, item, ukey, msg, at FROM comments ORDER BY at').toArray())
      if (live(r.ukey) && !hiddenComments.has(r.id)) (comments[`${r.kind}:${r.item}`] ??= []).push({ id: r.id, from: pidOf[r.ukey], msg: r.msg, at: r.at });
    return { now: now(), picks: nights, callouts, bets, posts, seenAt, attendance, teams, poll, sheets, live: liveScores, likes, comments };
  }

  async verify(a, secret) { return timingSafeEqual(await hashSecret(secret, a.salt), a.hash); }

  photo(pid) {
    const r = this.sql.exec('SELECT photo FROM accounts WHERE player_id = ? AND photo IS NOT NULL', pid).toArray()[0];
    if (!r) return new Response('Not found', { status: 404 });
    return new Response(r.photo, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' } });
  }

  async signup(request, url) {
    const body = await request.json().catch(() => ({}));
    const { username, method, secret, claim } = body;
    let err = checkUsername(username) || checkSecret(method, String(secret || ''));
    if (err) return fail(400, err);
    const ukey = keyOf(username);
    if (this.account(ukey)) return fail(409, 'That username is taken.');
    const L = await this.league(url.origin);
    if (this.admin(L).hidden.has(ukey)) return fail(409, 'That username is taken.');

    const ip = request.headers.get('cf-connecting-ip') || 'local';
    this.sql.exec('DELETE FROM signups WHERE at < ?', now() - 3600e3);
    if (this.sql.exec('SELECT COUNT(*) AS n FROM signups WHERE ip = ?', ip).one().n >= SIGNUPS_PER_IP_HOUR) return fail(429, 'Too many new accounts from here. Try again in an hour.');

    const taken = new Set(this.all().map(a => a.player_id));
    let pid;
    if (claim) {
      if (!(L.players || []).some(p => p.id === claim)) return fail(404, 'That bowler isn’t on the scoresheet.');
      if (taken.has(claim)) return fail(409, 'Someone already claimed that bowler.');
      pid = claim;
    } else {
      const used = new Set([...taken, ...(L.players || []).map(p => p.id)]);
      const base = slug(username); pid = base;
      for (let i = 2; used.has(pid); i++) pid = `${base}-${i}`;
    }
    const salt = randHex(16), t = now();
    const profile = cleanProfile({ name: claim ? (L.players.find(p => p.id === claim).name) : username.trim() });
    this.sql.exec('INSERT INTO accounts (ukey, username, player_id, method, salt, hash, cred_set_at, created_at, profile) VALUES (?,?,?,?,?,?,?,?,?)',
      ukey, username.trim(), pid, method, salt, await hashSecret(String(secret), salt), t, t, JSON.stringify(profile));
    this.sql.exec('INSERT INTO signups (ip, at) VALUES (?, ?)', ip, t);
    const cookie = await this.startSession(ukey, url.protocol === 'https:');
    return json(this.publicMe(this.account(ukey)), 201, { 'set-cookie': cookie });
  }

  async login(request, url) {
    const { username, secret, method: newMethod } = await request.json().catch(() => ({}));
    const a = this.account(keyOf(username || ''));
    if (!a) return fail(404, 'No account with that username.');
    const L = await this.league(url.origin);
    const { hidden, resets } = this.admin(L);
    if (hidden.has(a.ukey)) return fail(403, 'This account was removed. Talk to Nick.');

    // Nick reset this login: whatever they enter now becomes the new code or pattern.
    const reset = resets[a.ukey];
    if (reset && Date.parse(reset + 'T00:00:00-05:00') > a.cred_set_at) {
      const m = newMethod || a.method;
      const err = checkSecret(m, String(secret || '')); if (err) return fail(400, err);
      const salt = randHex(16);
      this.sql.exec('UPDATE accounts SET method = ?, salt = ?, hash = ?, cred_set_at = ?, fails = 0, lockouts = 0, locked_until = 0 WHERE ukey = ?', m, salt, await hashSecret(String(secret), salt), now(), a.ukey);
      const cookie = await this.startSession(a.ukey, url.protocol === 'https:');
      return json({ ...this.publicMe(this.account(a.ukey)), reset: true }, 200, { 'set-cookie': cookie });
    }

    if (a.locked_until > now()) return fail(429, `Too many wrong tries. Try again in ${Math.ceil((a.locked_until - now()) / 60000)} min, or ask Nick to reset it.`);
    if (!(await this.verify(a, String(secret || '')))) {
      const fails = a.fails + 1;
      if (fails >= MAX_FAILS) {
        const until = now() + Math.min(LOCK_MINUTES * 2 ** a.lockouts, LOCK_MAX_MINUTES) * 60e3;
        this.sql.exec('UPDATE accounts SET fails = 0, lockouts = lockouts + 1, locked_until = ? WHERE ukey = ?', until, a.ukey);
        return fail(429, `Too many wrong tries. Locked for ${Math.round((until - now()) / 60000)} min.`);
      }
      this.sql.exec('UPDATE accounts SET fails = ? WHERE ukey = ?', fails, a.ukey);
      return fail(403, `That’s not it. ${MAX_FAILS - fails} ${MAX_FAILS - fails === 1 ? 'try' : 'tries'} left.`);
    }
    this.sql.exec('UPDATE accounts SET fails = 0, lockouts = 0, locked_until = 0 WHERE ukey = ?', a.ukey);
    const cookie = await this.startSession(a.ukey, url.protocol === 'https:');
    return json(this.publicMe(this.account(a.ukey)), 200, { 'set-cookie': cookie });
  }
}
