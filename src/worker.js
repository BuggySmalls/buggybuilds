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
const MAX_FAILS = 5;            // wrong codes before a lockout
const LOCK_MINUTES = 15;        // doubles with each further lockout
const SIGNUPS_PER_IP_HOUR = 8;
const PHOTO_MAX = 200 * 1024;
const COLORS = ['#B83A3A', '#3C6FB8', '#2E8A64', '#8A55B8', '#B87A2E', '#2E8A8A', '#B8476F', '#5B6BB8', '#6F8A2E', '#A0522D', '#FF3D9A', '#3BE8FF', '#FFC857', '#7B2FF7'];
const HANDS = ['Right', 'Left', 'Two-handed'];

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
    `);
  }

  /* ---------- helpers ---------- */
  async league(origin) {
    const r = await this.env.ASSETS.fetch(new Request(origin + '/data/league.json'));
    if (!r.ok) throw new Error('league.json missing');
    return r.json();
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
    return { now: now(), picks: nights, callouts };
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
        const until = now() + LOCK_MINUTES * 60e3 * 2 ** Math.min(a.lockouts, 6);
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
