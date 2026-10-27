// League poll (Nick, Oct 27 2026).
// Questions live in league.json `poll`. The home page shows a box (in place of the old celebration banner)
// and #/poll has the full form with live results under every question. Voting needs an account;
// results are visible to everyone.
import { api } from './account.js';

let C; // { S, esc, pages, empty, route }

const poll = () => { const p = C.S.data.poll; return p && p.id && (p.questions || []).length ? p : null; };
const res = () => (C.S.games?.poll?.id === poll()?.id ? C.S.games.poll : null);
const answered = () => !!res()?.mine;

/* Home page box */
export function homePoll() {
  const p = poll(); if (!p) return '';
  const { esc, S } = C, r = res(), n = r?.voters || 0;
  const cta = p.open === false ? 'See the results' : !S.me ? 'See results · sign in to vote' : answered() ? 'Change my answers' : 'Take the poll';
  return `<a class="poll-box" href="#/poll">
    <span class="poll-tag">${p.open === false ? 'Poll closed' : 'Vote now'}</span>
    <div class="poll-copy"><h2>${esc(p.title || 'League Poll')}</h2>
      <p>${esc(p.intro || '')}</p>
      <span class="poll-meta">${p.questions.length} questions · ${n} ${n === 1 ? 'bowler has' : 'bowlers have'} voted${answered() ? ' · you’re in' : ''}</span></div>
    <span class="btn primary poll-cta">${cta} →</span>
  </a>`;
}

function bars(q, r) {
  const counts = r?.counts?.[q.id] || {};
  const total = q.type === 'many' ? (r?.voters || 0) : Object.values(counts).reduce((a, b) => a + b, 0);
  const top = Math.max(0, ...Object.values(counts));
  return `<ul class="poll-bars">${q.options.map(o => {
    const c = counts[o.v] || 0, pct = total ? Math.round(c / total * 100) : 0;
    return `<li class="${c && c === top ? 'lead' : ''}"><span class="pb-label">${C.esc(o.label)}</span><span class="pb-track"><span class="pb-fill" style="width:${pct}%"></span></span><span class="pb-num">${c} · ${pct}%</span></li>`;
  }).join('')}</ul>`;
}

function question(q, i, mine, canVote) {
  const { esc } = C, r = res();
  let input = '';
  if (canVote) {
    if (q.type === 'text') input = `<textarea name="${q.id}" maxlength="300" rows="2" placeholder="Type your answer">${esc(mine?.[q.id] || '')}</textarea>`;
    else input = `<div class="poll-opts">${q.options.map(o => {
      const on = q.type === 'many' ? (mine?.[q.id] || []).includes(o.v) : mine?.[q.id] === o.v;
      return `<label class="poll-opt"><input type="${q.type === 'many' ? 'checkbox' : 'radio'}" name="${q.id}" value="${esc(o.v)}"${on ? ' checked' : ''}><span><b>${esc(o.label)}</b>${o.desc ? `<small>${esc(o.desc)}</small>` : ''}</span></label>`;
    }).join('')}</div>`;
  } else if (q.type !== 'text' && q.options.some(o => o.desc)) {
    input = `<dl class="poll-descs">${q.options.filter(o => o.desc).map(o => `<dt>${esc(o.label)}</dt><dd>${esc(o.desc)}</dd>`).join('')}</dl>`;
  }
  const texts = r?.texts?.[q.id] || [];
  const live = q.type === 'text'
    ? (texts.length ? `<ul class="poll-texts">${texts.map(t => `<li>${C.linkNames(t.msg)}</li>`).join('')}</ul>` : '<p class="small faint">No answers yet.</p>')
    : bars(q, r);
  return `<fieldset class="poll-q"><legend><span class="pq-n">${i + 1}</span>${esc(q.q)}</legend>${input}
    <div class="poll-live"><span class="lbl">Live results</span>${live}</div></fieldset>`;
}

function page() {
  const p = poll(), { S, esc, empty } = C;
  if (!p) return empty('No poll right now', 'Check back later.');
  const r = res(), canVote = !!S.me && p.open !== false && !S.apiDown;
  let n = 0;
  const groups = {};
  p.questions.forEach(q => (groups[q.section || ''] ??= []).push(q));
  const body = Object.entries(groups).map(([sec, qs]) => `<section class="panel poll-sec">
    ${sec ? `<div class="panel-head"><h2>${esc(p.sections?.[sec] || sec)}</h2></div>` : ''}
    ${qs.map(q => question(q, n++, r?.mine, canVote)).join('')}</section>`).join('');
  const note = S.apiDown ? '<p class="muted">The league server is down right now, so results and voting are unavailable.</p>'
    : p.open === false ? '<p class="muted">This poll is closed. Final results are below.</p>'
    : !S.me ? '<p class="poll-signin">Results are live for everyone. <a href="#/login">Sign in</a> or <a href="#/join">join</a> to vote.</p>'
    : answered() ? '<p class="muted">Your answers are in. Change anything and hit save again.</p>' : '';
  return `<div><h1 class="page-title">${esc(p.title || 'League Poll')}</h1>
    <p class="page-intro">${esc(p.intro || '')} <b>${r?.voters || 0}</b> ${(r?.voters || 0) === 1 ? 'bowler has' : 'bowlers have'} voted.</p>${note}</div>
    <form id="pollForm">${body}
    ${canVote ? `<div class="poll-save"><button type="submit" class="btn primary">${answered() ? 'Save my answers' : 'Submit my answers'}</button><span class="small muted" id="pollMsg"></span></div>` : ''}
    </form>`;
}

async function submit(form) {
  const p = poll(); if (!p) return;
  const fd = new FormData(form), answers = {};
  for (const q of p.questions) {
    if (q.type === 'many') answers[q.id] = fd.getAll(q.id);
    else answers[q.id] = (fd.get(q.id) || '').toString().trim() || null;
  }
  const btn = form.querySelector('button[type=submit]'), msg = document.getElementById('pollMsg');
  btn.disabled = true; if (msg) msg.textContent = 'Saving…';
  try {
    C.S.games = await api('/poll', { method: 'POST', body: { poll: p.id, answers } });
    const y = scrollY; C.route(); scrollTo(0, y);
    const m = document.getElementById('pollMsg'); if (m) m.textContent = 'Saved. Thanks for voting!';
  } catch (e) {
    btn.disabled = false; if (msg) msg.textContent = e.message;
  }
}

export function installPoll(ctx) {
  C = ctx;
  C.pages.poll = page;
  document.addEventListener('submit', e => {
    if (e.target.id !== 'pollForm') return;
    e.preventDefault(); submit(e.target);
  });
}
