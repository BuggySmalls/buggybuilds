// Suggestion box (Nick, Oct 29 2026): a small strip at the top of every page.
// "Got ideas for the site? We'd love to hear them!" Anyone can send one (no account needed);
// Nick gets each idea as a phone push, and as commissioner he can read them all here.
import { api } from './account.js';

let C; // { S, esc }
let open = false, sent = false, list = null, editing = null;
const STATUSES = ['Got it', 'On the list', 'Working on it', 'Live on the site', 'Not right now'];
const when = t => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const $ = s => document.querySelector(s);

export function renderIdeas(force) {
  const el = $('#ideasBar'); if (!el) return;
  const { S, esc } = C;
  if (S.apiDown) { el.hidden = true; return; }
  if (!force && el.querySelector('[data-idea-form] textarea, [data-idea-upd]')) return; // don't wipe half-typed text on the 45s refresh
  const boss = S.me && S.me.playerId === S.data.league?.commissioner;
  let html;
  if (sent && !open) html = `<span class="id-msg"><b>Thanks!</b> Your idea went straight to Nick.</span><button type="button" class="id-link" data-idea="open">Send another</button>`;
  else if (!open) html = `<span class="id-msg">💡 <b>Got ideas for the site?</b> We’d love to hear them!</span><button type="button" class="id-btn" data-idea="open">Share an idea</button>`;
  else html = `<form class="id-form" data-idea-form>
      <textarea name="msg" maxlength="500" rows="2" placeholder="What should the site have? What’s bugging you?" required></textarea>
      ${S.me ? '' : '<input name="name" maxlength="40" placeholder="Your name (optional)" autocomplete="off">'}
      <div class="id-row"><button type="submit" class="id-btn">Send</button><button type="button" class="id-link" data-idea="close">Cancel</button><span class="id-err" role="alert"></span></div>
    </form>`;
  const mine = (S.games?.myIdeas || []).length;
  if (mine && !open) html += `<a class="id-link" href="#/ideas">Your ideas (${mine})</a>`;
  if (boss) html += `<button type="button" class="id-link id-boss" data-idea="list">${list ? 'Hide ideas' : 'See all ideas'}</button>`;
  const items = boss && list ? `<div class="id-list">${list.length ? list.map(i => ideaItem(i)).join('') : '<p class="id-msg">No ideas yet.</p>'}</div>` : '';
  el.innerHTML = `<div class="wrap">${html}${items}</div>`;
  el.hidden = false;
  if (open && force) el.querySelector('textarea')?.focus();
}

// Nick's view of one idea: status + reply, and "Update" to change them and optionally ping the sender (Nick, Nov 4 2026)
function ideaItem(i) {
  const { esc } = C;
  const st = i.status ? `<b class="id-st">${esc(i.status)}</b>` : '';
  const rp = i.reply ? `<p class="id-reply">Nick: ${esc(i.reply)}</p>` : '';
  const ping = i.upd_at ? ` · they were notified ${when(i.upd_at)}` : '';
  if (editing !== i.id) return `<div class="id-item"><p>${esc(i.msg)}</p><span>${esc(i.name || 'Anonymous')} · ${when(i.at)}${ping}</span>${st || rp ? `<div class="id-upd-show">${st}${rp}</div>` : ''}<button type="button" class="id-link" data-idea-edit="${i.id}">Update</button></div>`;
  return `<div class="id-item"><p>${esc(i.msg)}</p><span>${esc(i.name || 'Anonymous')} · ${when(i.at)}${ping}</span>
    <form class="id-upd" data-idea-upd="${i.id}">
      <select name="status"><option value="">No status</option>${STATUSES.map(x => `<option${x === i.status ? ' selected' : ''}>${x}</option>`).join('')}</select>
      <textarea name="reply" maxlength="300" rows="2" placeholder="Reply to them (optional)">${esc(i.reply || '')}</textarea>
      ${i.canNotify ? `<label class="id-chk"><input type="checkbox" name="notify" checked> Notify ${esc(i.name || 'them')}</label>` : '<span class="id-note">Sent signed out, so they can’t be notified.</span>'}
      <div class="id-row"><button type="submit" class="id-btn">Save</button><button type="button" class="id-link" data-idea-edit="">Cancel</button><span class="id-err" role="alert"></span></div>
    </form></div>`;
}

// #/ideas: a bowler's own ideas with Nick's status + reply
function myIdeasPage() {
  const { S, esc } = C;
  const head = '<div><h1 class="page-title">Your ideas</h1><p class="page-intro">What you sent through “Got ideas for the site?” and where Nick’s at with each one.</p></div>';
  if (!S.me) return head + C.empty('Sign in to see your ideas', 'Ideas sent while signed out can’t be tracked.');
  const list = S.games?.myIdeas || [];
  if (!list.length) return head + C.empty('No ideas yet', 'Tap “Share an idea” at the top of any page.');
  return head + `<div class="id-mine">${list.map(i => `<div class="id-item${i.upd_at ? ' upd' : ''}"><p>${esc(i.msg)}</p><span>Sent ${when(i.at)}</span>
    <div class="id-upd-show">${i.status ? `<b class="id-st">${esc(i.status)}</b>` : '<b class="id-st wait">Not looked at yet</b>'}${i.reply ? `<p class="id-reply">Nick: ${esc(i.reply)}</p>` : ''}</div></div>`).join('')}</div>`;
}

export function installIdeas(ctx) {
  C = ctx;
  if (C.pages) C.pages.ideas = myIdeasPage;
  document.addEventListener('click', e => {
    const ed = e.target.closest('[data-idea-edit]'); if (!ed) return;
    editing = ed.dataset.ideaEdit ? +ed.dataset.ideaEdit : null; renderIdeas(true);
  });
  document.addEventListener('submit', async e => {
    const f = e.target.closest('[data-idea-upd]'); if (!f) return;
    e.preventDefault(); const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      list = await api('/idea/' + f.dataset.ideaUpd, { method: 'POST', body: { status: f.elements.namedItem('status').value, reply: f.elements.namedItem('reply').value, notify: !!f.elements.namedItem('notify')?.checked } });
      editing = null; renderIdeas(true);
    } catch (err) { btn.disabled = false; f.querySelector('.id-err').textContent = err.message; }
  });
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
