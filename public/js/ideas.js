// Suggestion box (Nick, Oct 29 2026): a small strip at the top of every page.
// "Got ideas for the site? We'd love to hear them!" Anyone can send one (no account needed);
// Nick gets each idea as a phone push, and as commissioner he can read them all here.
import { api } from './account.js';

let C; // { S, esc }
let open = false, sent = false, list = null;
const $ = s => document.querySelector(s);

export function renderIdeas(force) {
  const el = $('#ideasBar'); if (!el) return;
  const { S, esc } = C;
  if (S.apiDown) { el.hidden = true; return; }
  if (open && el.querySelector('[data-idea-form]') && !force) return; // don't wipe a half-typed idea on the 45s refresh
  const boss = S.me && S.me.playerId === S.data.league?.commissioner;
  let html;
  if (sent && !open) html = `<span class="id-msg"><b>Thanks!</b> Your idea went straight to Nick.</span><button type="button" class="id-link" data-idea="open">Send another</button>`;
  else if (!open) html = `<span class="id-msg">💡 <b>Got ideas for the site?</b> We’d love to hear them!</span><button type="button" class="id-btn" data-idea="open">Share an idea</button>`;
  else html = `<form class="id-form" data-idea-form>
      <textarea name="msg" maxlength="500" rows="2" placeholder="What should the site have? What’s bugging you?" required></textarea>
      ${S.me ? '' : '<input name="name" maxlength="40" placeholder="Your name (optional)" autocomplete="off">'}
      <div class="id-row"><button type="submit" class="id-btn">Send</button><button type="button" class="id-link" data-idea="close">Cancel</button><span class="id-err" role="alert"></span></div>
    </form>`;
  if (boss) html += `<button type="button" class="id-link id-boss" data-idea="list">${list ? 'Hide ideas' : 'See all ideas'}</button>`;
  const items = boss && list ? `<div class="id-list">${list.length ? list.map(i => `<div class="id-item"><p>${esc(i.msg)}</p><span>${esc(i.name || 'Anonymous')} · ${new Date(i.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></div>`).join('') : '<p class="id-msg">No ideas yet.</p>'}</div>` : '';
  el.innerHTML = `<div class="wrap">${html}${items}</div>`;
  el.hidden = false;
  if (open && force) el.querySelector('textarea')?.focus();
}

export function installIdeas(ctx) {
  C = ctx;
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-idea]'); if (!b) return;
    const a = b.dataset.idea;
    if (a === 'open') { open = true; sent = false; }
    else if (a === 'close') open = false;
    else if (a === 'list') {
      if (list) list = null;
      else { try { list = await api('/ideas'); } catch (err) { list = null; alertLine(err.message); return; } }
    }
    renderIdeas(true);
  });
  document.addEventListener('submit', async e => {
    const f = e.target.closest('[data-idea-form]'); if (!f) return;
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      await api('/idea', { method: 'POST', body: { msg: f.elements.namedItem('msg').value, name: f.elements.namedItem('name')?.value || '' } });
      open = false; sent = true; if (list) list = await api('/ideas').catch(() => list);
      renderIdeas(true);
    } catch (err) { btn.disabled = false; f.querySelector('.id-err').textContent = err.message; }
  });
}
function alertLine(msg) { const m = $('#ideasBar .id-msg'); if (m) m.textContent = msg; }
