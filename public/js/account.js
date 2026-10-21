// Bowler accounts: sign up, sign in, edit your profile.
// A username plus a 4-digit code or a swipe pattern. No email, no phone number.
// Browsing the site never needs an account.

const COLORS = ['#B83A3A', '#3C6FB8', '#2E8A64', '#8A55B8', '#B87A2E', '#2E8A8A', '#B8476F', '#5B6BB8', '#6F8A2E', '#A0522D', '#FF3D9A', '#3BE8FF', '#FFC857', '#7B2FF7'];
const HANDS = ['Right', 'Left', 'Two-handed'];

let C; // context from app.js: { S, pages, esc, avatar, empty, reload, colorOf }

export async function api(path, { method = 'GET', body, raw } = {}) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    if (raw) { init.body = body; init.headers['content-type'] = 'image/jpeg'; }
    else { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
  }
  const r = await fetch('api' + path, init);
  let data = null; try { data = await r.json(); } catch { /* not json */ }
  if (!r.ok) throw new Error(data?.error || 'Couldn’t reach the league server. Try again.');
  return data;
}

export async function fetchMe() {
  try { return (await api('/me')).user; } catch { return null; }
}

/* ------------------------------------------------------------------ *
 * Code and pattern pads
 * ------------------------------------------------------------------ */
// Each pad lives in an element with [data-pad] and reports its value through onDone.
function pinPadHTML(label) {
  return `<div class="pad pin-pad" data-pad="pin" tabindex="0" aria-label="${C.esc(label)}">
    <div class="pin-dots" aria-live="polite">${'<i></i>'.repeat(4)}</div>
    <div class="pin-keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" data-k="${n}">${n}</button>`).join('')}<span></span><button type="button" data-k="0">0</button><button type="button" data-k="del" aria-label="Delete">⌫</button></div>
  </div>`;
}
function patternPadHTML(label) {
  const pts = [0, 1, 2].flatMap(r => [0, 1, 2].map(c => ({ n: r * 3 + c + 1, x: 50 + c * 100, y: 50 + r * 100 })));
  return `<div class="pad pattern-pad" data-pad="pattern" aria-label="${C.esc(label)}">
    <svg viewBox="0 0 300 300" class="pattern-svg"><polyline class="pat-line" points="" /><line class="pat-tail" x1="0" y1="0" x2="0" y2="0" />
    ${pts.map(p => `<g class="pat-dot" data-n="${p.n}"><circle cx="${p.x}" cy="${p.y}" r="34" class="hit"/><circle cx="${p.x}" cy="${p.y}" r="13" class="dot"/></g>`).join('')}</svg>
  </div>`;
}

function bindPin(el, onDone) {
  let v = '';
  const dots = [...el.querySelectorAll('.pin-dots i')];
  const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < v.length));
  const press = k => {
    if (k === 'del') v = v.slice(0, -1);
    else if (v.length < 4) v += k;
    paint();
    if (v.length === 4) { const done = v; setTimeout(() => { v = ''; paint(); onDone(done); }, 140); }
  };
  el.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k); });
  el.addEventListener('keydown', e => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del'); });
  return { reset() { v = ''; paint(); } };
}

function bindPattern(el, onDone) {
  const svg = el.querySelector('svg'), line = el.querySelector('.pat-line'), tail = el.querySelector('.pat-tail');
  const dots = [...el.querySelectorAll('.pat-dot')].map(g => ({ g, n: +g.dataset.n, x: +g.querySelector('.dot').getAttribute('cx'), y: +g.querySelector('.dot').getAttribute('cy') }));
  let seq = [], on = false;
  const pt = e => { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left) * 300 / r.width, y: (e.clientY - r.top) * 300 / r.height }; };
  const draw = (p) => {
    line.setAttribute('points', seq.map(n => { const d = dots[n - 1]; return `${d.x},${d.y}`; }).join(' '));
    dots.forEach(d => d.g.classList.toggle('on', seq.includes(d.n)));
    if (p && seq.length) { const d = dots[seq.at(-1) - 1]; tail.setAttribute('x1', d.x); tail.setAttribute('y1', d.y); tail.setAttribute('x2', p.x); tail.setAttribute('y2', p.y); tail.style.opacity = 1; }
    else tail.style.opacity = 0;
  };
  const hit = p => {
    const d = dots.find(d => Math.hypot(d.x - p.x, d.y - p.y) < 36 && !seq.includes(d.n));
    if (!d) return;
    // passing straight over a middle dot picks it up, like a phone lock screen
    if (seq.length) {
      const a = dots[seq.at(-1) - 1], mx = (a.x + d.x) / 2, my = (a.y + d.y) / 2;
      const mid = dots.find(m => m.x === mx && m.y === my && !seq.includes(m.n));
      if (mid) seq.push(mid.n);
    }
    seq.push(d.n); navigator.vibrate?.(8);
  };
  svg.addEventListener('pointerdown', e => { e.preventDefault(); svg.setPointerCapture(e.pointerId); on = true; seq = []; el.classList.remove('bad'); const p = pt(e); hit(p); draw(p); });
  svg.addEventListener('pointermove', e => { if (!on) return; const p = pt(e); hit(p); draw(p); });
  const end = () => { if (!on) return; on = false; draw(); const s = seq.join('-'); if (seq.length) setTimeout(() => { seq = []; draw(); onDone(s); }, 220); };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  return { reset() { seq = []; draw(); } };
}

function bindPad(el, onDone) { return el.dataset.pad === 'pin' ? bindPin(el, onDone) : bindPattern(el, onDone); }
const padHTML = (m, label) => m === 'pin' ? pinPadHTML(label) : patternPadHTML(label);

function shake(el) { el.classList.remove('bad'); void el.offsetWidth; el.classList.add('bad'); navigator.vibrate?.([30, 40, 30]); }
function msg(text, tone = 'err') { const m = document.getElementById('acctMsg'); if (m) { m.textContent = text; m.className = `acct-msg ${tone}`; m.hidden = !text; } }

/* ------------------------------------------------------------------ *
 * "Set a code" flow shared by sign-up, reset and change: pick type, enter, confirm.
 * ------------------------------------------------------------------ */
function setCodeFlow(host, { initial = 'pin', onSet }) {
  let method = initial, first = null;
  const render = () => {
    host.innerHTML = `
      <div class="seg" role="group" aria-label="Login type">
        <button type="button" data-m="pin" aria-pressed="${method === 'pin'}">4-digit code</button>
        <button type="button" data-m="pattern" aria-pressed="${method === 'pattern'}">Swipe pattern</button>
      </div>
      <p class="pad-prompt">${first ? (method === 'pin' ? 'Enter it again to confirm' : 'Draw it again to confirm') : (method === 'pin' ? 'Pick a 4-digit code' : 'Draw a pattern: connect at least 4 dots')}</p>
      ${padHTML(method, 'Set your ' + (method === 'pin' ? 'code' : 'pattern'))}
      ${first ? '<button type="button" class="linkish" data-restart>Start over</button>' : ''}`;
    host.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { method = b.dataset.m; first = null; msg(''); render(); });
    host.querySelector('[data-restart]')?.addEventListener('click', () => { first = null; msg(''); render(); });
    const pad = host.querySelector('[data-pad]');
    bindPad(pad, v => {
      if (method === 'pattern' && v.split('-').length < 4) { msg('Connect at least 4 dots.'); shake(pad); return; }
      if (!first) { first = v; msg(''); render(); return; }
      if (v !== first) { first = null; msg('Those didn’t match. Try again.'); render(); shake(host.querySelector('[data-pad]')); return; }
      onSet(method, v);
    });
    if (method === 'pin') pad.focus({ preventScroll: true });
  };
  render();
}

/* ------------------------------------------------------------------ *
 * Pages
 * ------------------------------------------------------------------ */
function shell(title, intro, inner) {
  return `<div><h1 class="page-title">${title}</h1>${intro ? `<p class="page-intro">${intro}</p>` : ''}</div>
  <section class="panel acct-panel">${inner}<p class="acct-msg" id="acctMsg" role="alert" hidden></p></section>`;
}
function qparams() { const [, query = ''] = location.hash.split('?'); return Object.fromEntries(new URLSearchParams(query)); }
function offline() { return C.S.apiDown ? C.empty('Sign-in is offline right now', 'The rest of the site works. Try again in a bit.') : ''; }

function joinPage() {
  const { S, esc } = C;
  if (S.apiDown) return offline();
  if (S.me) { location.replace('#/me'); return ''; }
  return shell('Join the league', 'Make your bowler profile. Pick a username and a code or pattern. No email, no phone number.', `
    <form class="acct-form" id="joinForm" autocomplete="off">
      <label class="field">Username<input class="txt" name="username" maxlength="20" autocapitalize="off" autocorrect="off" spellcheck="false" required placeholder="What you go by"></label>
      <div id="claimBox" hidden>
        <p class="small muted">Already bowled with us? Pick yourself so your scores come with you.</p>
        <div class="chip-list" id="claimList"></div>
      </div>
      <button class="btn primary" type="submit">Next</button>
      <p class="small muted">Already have one? <a href="#/login">Sign in</a></p>
    </form>
    <div id="codeStep" hidden></div>`);
}
function afterJoin() {
  const f = document.getElementById('joinForm'); if (!f) return;
  let claim = qparams().claim || '';
  api('/claimable').then(list => {
    if (!list.length) return;
    document.getElementById('claimBox').hidden = false;
    const box = document.getElementById('claimList');
    const paint = () => box.innerHTML = list.map(p => `<button type="button" class="chip" data-claim="${C.esc(p.id)}" aria-pressed="${p.id === claim}"><i></i>${C.esc(p.name)}</button>`).join('') + `<button type="button" class="chip" data-claim="" aria-pressed="${!claim}">I’m new</button>`;
    paint();
    box.onclick = e => { const b = e.target.closest('[data-claim]'); if (!b) return; claim = b.dataset.claim; paint(); };
  }).catch(() => { });
  f.username.focus();
  f.onsubmit = e => {
    e.preventDefault();
    const username = f.username.value.trim();
    if (username.length < 2) { msg('Usernames are at least 2 characters.'); return; }
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(username)) { msg('Use letters, numbers, spaces, dots, dashes or underscores.'); return; }
    msg('');
    f.hidden = true;
    const step = document.getElementById('codeStep'); step.hidden = false;
    const head = document.createElement('div');
    head.innerHTML = `<p class="acct-who">Signing up as <b>${C.esc(username)}</b> · <button type="button" class="linkish">change</button></p>`;
    head.querySelector('button').onclick = () => { step.hidden = true; f.hidden = false; msg(''); };
    const pads = document.createElement('div');
    step.replaceChildren(head, pads);
    const onSet = async (method, secret) => {
      try {
        const r = await api('/signup', { method: 'POST', body: { username, method, secret, claim: claim || undefined } });
        try { localStorage.setItem('cb_user', r.user.username); } catch { }
        C.S.me = r.user; await C.reload(); location.hash = '#/me?welcome=1';
      } catch (err) {
        if (/username/i.test(err.message)) { step.hidden = true; f.hidden = false; }
        else setCodeFlow(pads, { initial: method, onSet });
        msg(err.message);
      }
    };
    setCodeFlow(pads, { onSet });
  };
}

function loginPage() {
  if (C.S.apiDown) return offline();
  if (C.S.me) { location.replace(`#/player/${encodeURIComponent(C.S.me.playerId)}`); return ''; }
  return shell('Sign in', 'Your username, then your code or pattern.', `
    <form class="acct-form" id="loginForm" autocomplete="off">
      <label class="field">Username<input class="txt" name="username" maxlength="20" autocapitalize="off" autocorrect="off" spellcheck="false" required></label>
      <button class="btn primary" type="submit">Next</button>
      <p class="small muted">New here? <a href="#/join">Make your profile</a></p>
    </form>
    <div id="codeStep" hidden></div>`);
}
function afterLogin() {
  const f = document.getElementById('loginForm'); if (!f) return;
  const last = (() => { try { return localStorage.getItem('cb_user') || ''; } catch { return ''; } })();
  f.username.value = last; f.username.focus();
  f.onsubmit = async e => {
    e.preventDefault();
    const username = f.username.value.trim(); if (!username) return;
    let info; try { info = await api('/method?u=' + encodeURIComponent(username)); } catch (err) { msg(err.message); return; }
    msg(''); f.hidden = true;
    const step = document.getElementById('codeStep'); step.hidden = false;
    const back = () => { step.hidden = true; f.hidden = false; msg(''); };
    const done = r => { try { localStorage.setItem('cb_user', info.username); } catch { } C.S.me = r.user; C.reload().then(() => location.hash = r.reset ? '#/me?reset=1' : `#/player/${encodeURIComponent(r.user.playerId)}`); };
    if (info.reset) {
      step.innerHTML = `<p class="acct-who"><b>${C.esc(info.username)}</b> · Nick reset your login. Set a new one. · <button type="button" class="linkish">back</button></p><div></div>`;
      step.querySelector('button').onclick = back;
      setCodeFlow(step.lastElementChild, { initial: info.method, onSet: async (method, secret) => { try { done(await api('/login', { method: 'POST', body: { username, secret, method } })); } catch (err) { msg(err.message); } } });
      return;
    }
    step.innerHTML = `<p class="acct-who"><b>${C.esc(info.username)}</b> · <button type="button" class="linkish">not you?</button></p>
      <p class="pad-prompt">${info.method === 'pin' ? 'Enter your 4-digit code' : 'Draw your pattern'}</p>${padHTML(info.method, 'Your ' + (info.method === 'pin' ? 'code' : 'pattern'))}
      <p class="small muted">Forgot it? Text Nick and he’ll reset it.</p>`;
    step.querySelector('button').onclick = back;
    const pad = step.querySelector('[data-pad]');
    bindPad(pad, async secret => {
      try { done(await api('/login', { method: 'POST', body: { username, secret } })); }
      catch (err) { msg(err.message); shake(pad); }
    });
    if (info.method === 'pin') pad.focus({ preventScroll: true });
  };
}

function mePage() {
  const { S, esc } = C;
  if (S.apiDown) return offline();
  if (!S.me) { location.replace('#/login'); return ''; }
  const pr = S.me.profile || {}, qp = qparams();
  const p = S.players[S.me.playerId] || { id: S.me.playerId, name: pr.name || S.me.username };
  const color = pr.color || C.colorOf({ id: S.me.playerId });
  const opt = (v, cur) => `<option value="${v}"${String(v) === String(cur ?? '') ? ' selected' : ''}>${v ? v + ' lb' : '—'}</option>`;
  return `
  <div><h1 class="page-title">Edit profile</h1><p class="page-intro">${qp.welcome ? 'You’re in! Dress up your profile. Everything here is optional.' : qp.reset ? 'New login saved.' : `Signed in as <b>${esc(S.me.username)}</b>.`}</p></div>
  <section class="panel acct-panel">
    <form class="acct-form" id="meForm" autocomplete="off">
      <div class="photo-row">
        <span id="mePhoto">${C.avatar({ ...p, photo: S.me.photo, color }, 92)}</span>
        <div class="photo-btns">
          <label class="btn">${S.me.photo ? 'Change photo' : 'Add a photo'}<input type="file" accept="image/*" id="photoIn" hidden></label>
          ${S.me.photo ? '<button type="button" class="linkish" id="photoDel">Remove photo</button>' : ''}
        </div>
      </div>
      <div class="form-grid">
        <label class="field">Name on the scoresheet<input class="txt" name="name" maxlength="24" value="${esc(pr.name || '')}" placeholder="${esc(S.me.username)}"></label>
        <label class="field">Nickname<input class="txt" name="nickname" maxlength="28" value="${esc(pr.nickname || '')}" placeholder="The Gutter Gourmet"></label>
        <label class="field">Favorite cereal<input class="txt" name="cereal" maxlength="40" value="${esc(pr.cereal || '')}" placeholder="Cap’n Crunch"></label>
        <label class="field">Walk-up song<input class="txt" name="song" maxlength="60" value="${esc(pr.song || '')}" placeholder="Song · Artist"></label>
        <label class="field">Ball weight<select name="ball">${opt('', pr.ball)}${[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map(n => opt(n, pr.ball)).join('')}</select></label>
      </div>
      <div class="field"><span>How you bowl</span><div class="seg" role="group" id="handSeg">${['', ...HANDS].map(h => `<button type="button" data-hand="${h}" aria-pressed="${(pr.hand || '') === h}">${h || 'Not saying'}</button>`).join('')}</div></div>
      <div class="field"><span>Your color</span><div class="swatches" id="swatches">${COLORS.map(c => `<button type="button" data-color="${c}" style="--c:${c}" aria-label="Color ${c}" aria-pressed="${c === pr.color}"></button>`).join('')}</div></div>
      <label class="field">Bio<textarea class="txt" name="bio" maxlength="160" rows="3" placeholder="Trash talk goes here">${esc(pr.bio || '')}</textarea></label>
      <div class="controls"><button class="btn primary" type="submit">Save profile</button><a class="btn" href="#/player/${esc(S.me.playerId)}">Done</a></div>
    </form>
    <p class="acct-msg" id="acctMsg" role="alert" hidden></p>
  </section>
  <div id="claimPanel"></div>
  <section class="panel acct-panel">
    <div class="panel-head"><h2>Login</h2></div>
    <p class="small muted">You sign in with a ${S.me.method === 'pin' ? '4-digit code' : 'swipe pattern'}.</p>
    <div id="changeCode"><div class="controls"><button type="button" class="btn" id="changeBtn">Change code or pattern</button><button type="button" class="btn" id="logoutBtn">Sign out</button></div></div>
  </section>`;
}
function afterMe() {
  const f = document.getElementById('meForm'); if (!f) return;
  const { S } = C;
  let hand = S.me.profile?.hand || '', color = S.me.profile?.color || '';
  document.getElementById('handSeg').onclick = e => { const b = e.target.closest('[data-hand]'); if (!b) return; hand = b.dataset.hand; e.currentTarget.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); };
  document.getElementById('swatches').onclick = e => { const b = e.target.closest('[data-color]'); if (!b) return; color = b.getAttribute('aria-pressed') === 'true' ? '' : b.dataset.color; e.currentTarget.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x.dataset.color === color)); };
  f.onsubmit = async e => {
    e.preventDefault();
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    try {
      const r = await api('/profile', { method: 'POST', body: { name: f.name.value, nickname: f.nickname.value, cereal: f.cereal.value, song: f.song.value, ball: f.ball.value || null, bio: f.bio.value, hand, color } });
      S.me = r.user; await C.reload({ keep: true }); msg('Saved. It’s live on your profile.', 'ok');
    } catch (err) { msg(err.message); }
    btn.disabled = false;
  };
  document.getElementById('photoIn').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    msg('Uploading…', 'ok');
    try { const blob = await squareJpeg(file, 360); const r = await api('/photo', { method: 'POST', body: blob, raw: true }); S.me = r.user; await C.reload(); }
    catch (err) { msg(err.message || 'That photo didn’t work. Try another one.'); }
  };
  document.getElementById('photoDel')?.addEventListener('click', async () => { try { const r = await api('/photo', { method: 'DELETE' }); S.me = r.user; await C.reload(); } catch (err) { msg(err.message); } });
  document.getElementById('logoutBtn').onclick = async () => { await api('/logout', { method: 'POST' }).catch(() => { }); S.me = null; await C.reload(); location.hash = '#/'; };
  document.getElementById('changeBtn').onclick = () => {
    const host = document.getElementById('changeCode');
    host.innerHTML = `<p class="pad-prompt">First, your current ${S.me.method === 'pin' ? 'code' : 'pattern'}</p>${padHTML(S.me.method, 'Current login')}<div id="newCode"></div>`;
    const pad = host.querySelector('[data-pad]');
    bindPad(pad, current => {
      pad.remove(); host.querySelector('.pad-prompt').remove();
      setCodeFlow(host.querySelector('#newCode'), { initial: S.me.method, onSet: async (method, secret) => {
        try { const r = await api('/code', { method: 'POST', body: { current, method, secret } }); S.me = r.user; C.reload().then(() => msg('New login saved.', 'ok')); }
        catch (err) { msg(err.message); }
      } });
    });
    if (S.me.method === 'pin') pad.focus();
  };
  // Scores logged before you signed up live under your scoresheet name. Claim them.
  const hasScores = id => C.S.data.events.some(ev => ev.scores && id in ev.scores);
  if (!hasScores(S.me.playerId)) api('/claimable').then(list => {
    if (!list.length) return;
    const host = document.getElementById('claimPanel');
    host.innerHTML = `<section class="panel acct-panel"><div class="panel-head"><h2>Bowled before you signed up?</h2></div>
      <p class="small muted">Pick your name from the scoresheet and your games move to your profile.</p>
      <div class="chip-list">${list.map(p => `<button type="button" class="chip" data-claim="${C.esc(p.id)}"><i></i>${C.esc(p.name)}</button>`).join('')}</div></section>`;
    host.onclick = async e => {
      const b = e.target.closest('[data-claim]'); if (!b) return;
      if (!confirm(`Claim ${b.textContent.trim()}'s scores as yours?`)) return;
      try { const r = await api('/claim', { method: 'POST', body: { playerId: b.dataset.claim } }); S.me = r.user; await C.reload(); }
      catch (err) { msg(err.message); }
    };
  }).catch(() => { });
}

// Crop to a centered square and shrink, so photos stay small.
function squareJpeg(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement('canvas'); c.width = c.height = size;
      c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      const tryQ = q => c.toBlob(b => b && b.size > 190 * 1024 && q > 0.4 ? tryQ(q - 0.15) : b ? resolve(b) : reject(new Error('That photo didn’t work. Try another one.')), 'image/jpeg', q);
      tryQ(0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file isn’t a photo the browser can read. Try a JPEG or PNG.')); };
    img.src = url;
  });
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */
export function installAccount(ctx) {
  C = ctx;
  C.pages.join = joinPage;
  C.pages.login = loginPage;
  C.pages.me = mePage;
  return {
    after(key) { ({ join: afterJoin, login: afterLogin, me: afterMe })[key]?.(); },
    headerHTML() {
      const { S } = C;
      if (S.apiDown) return '';
      if (!S.me) return `<a class="acct-btn" href="#/login">Sign in</a>`;
      const p = S.players[S.me.playerId] || { id: S.me.playerId, name: S.me.username };
      return `<a class="acct-btn me" href="#/player/${C.esc(S.me.playerId)}" aria-label="My profile">${C.avatar(p, 26)}<span>${C.esc(p.name)}</span></a>`;
    },
  };
}
