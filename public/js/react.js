// Likes + comments on shit talk, betchas and call-outs (Nick, Oct 28 2026).
// reactBar(kind, id) goes under any post / betcha / call-out row. Stored by the account server
// (`likes`, `comments` tables); /api/games returns likes["kind:id"] = {n, who, mine} and comments["kind:id"] = [...].
import { api } from './account.js';

let C; // { S, esc, pl, linkNames, route }
const open = new Set(); // threads the viewer has opened, kept across re-renders

function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'now'; if (m < 60) return m + 'm';
  const h = Math.round(m / 60); return h < 24 ? h + 'h' : Math.round(h / 24) + 'd';
}

export function reactBar(kind, id) {
  const g = C.S.games; if (!g || id == null) return '';
  const k = `${kind}:${id}`, l = g.likes?.[k] || { n: 0, who: [], mine: false }, cs = g.comments?.[k] || [];
  const me = C.S.me?.playerId, boss = me && me === C.S.data.league.commissioner, isOpen = open.has(k);
  const likedBy = l.who.length ? l.who.map(p => C.P(p).name).join(', ') : '';
  return `<div class="rx" data-rx="${k}">
    <div class="rx-bar">
      <button type="button" class="rx-btn${l.mine ? ' on' : ''}" data-like="${k}" aria-pressed="${l.mine}" ${me ? '' : 'disabled'} title="${C.esc(likedBy || 'Like')}"><span aria-hidden="true">${l.mine ? '♥' : '♡'}</span> ${l.n || ''}<span class="sr">${l.n === 1 ? 'like' : 'likes'}</span></button>
      <button type="button" class="rx-btn" data-thread="${k}" aria-expanded="${isOpen}"><span aria-hidden="true">💬</span> ${cs.length || ''}<span class="sr">comments</span></button>
      ${dislikeBtn(k, me)}
      ${l.n ? `<span class="rx-who">${C.esc(likedBy)}</span>` : ''}
    </div>
    ${isOpen ? `<div class="rx-thread">
      ${cs.map(c => `<div class="rx-c"><b>${C.pl(c.from)}</b> ${C.linkNames(c.msg)} <span class="rx-when">${ago(c.at)}</span> ${likeBtn(`comment:${c.id}`, me, true)}${dislikeBtn(`comment:${c.id}`, me, true)}${c.from === me || boss ? ` <button type="button" class="linkish small" data-uncomment="${c.id}">delete</button>` : ''}</div>`).join('') || '<p class="small muted">No comments yet.</p>'}
      ${me ? `<form class="rx-form" data-comment="${k}"><input class="txt" name="msg" maxlength="200" placeholder="Add a comment…" aria-label="Add a comment" required><button class="btn small primary" type="submit">Send</button></form>` : '<p class="small muted"><a href="#/login">Sign in</a> to comment.</p>'}
    </div>` : ''}
  </div>`;
}

// Dislikes (Nick, Oct 28 2026): 👎 next to the like on every post, betcha, call-out and comment.
function dislikeBtn(k, me, small = false) {
  const d = C.S.games?.dislikes?.[k] || { n: 0, who: [], mine: false };
  const by = d.who.map(p => C.P(p).name).join(', ');
  return `<button type="button" class="rx-btn${small ? ' rx-sm' : ''}${d.mine ? ' on no' : ''}" data-dislike="${k}" aria-pressed="${d.mine}" ${me ? '' : 'disabled'} title="${C.esc(by || 'Dislike')}"><span aria-hidden="true">👎</span> ${d.n || ''}<span class="sr">${d.n === 1 ? 'dislike' : 'dislikes'}</span></button>`;
}
function likeBtn(k, me, small = false) {
  const l = C.S.games?.likes?.[k] || { n: 0, who: [], mine: false };
  const by = l.who.map(p => C.P(p).name).join(', ');
  return `<button type="button" class="rx-btn${small ? ' rx-sm' : ''}${l.mine ? ' on' : ''}" data-like="${k}" aria-pressed="${l.mine}" ${me ? '' : 'disabled'} title="${C.esc(by || 'Like')}"><span aria-hidden="true">${l.mine ? '♥' : '♡'}</span> ${l.n || ''}<span class="sr">${l.n === 1 ? 'like' : 'likes'}</span></button>`;
}

const rerender = () => { const y = scrollY; C.route(); scrollTo(0, y); };

export function installReact(ctx) {
  C = ctx;
  document.addEventListener('click', async e => {
    const dis = e.target.closest('[data-dislike]');
    if (dis) {
      const [kind, id] = dis.dataset.dislike.split(':'); dis.disabled = true;
      try { C.S.games = await api('/dislike', { method: 'POST', body: { kind, id: +id } }); rerender(); } catch (err) { alert(err.message); dis.disabled = false; }
      return;
    }
    const like = e.target.closest('[data-like]'), th = e.target.closest('[data-thread]'), del = e.target.closest('[data-uncomment]');
    if (th) { const k = th.dataset.thread; open.has(k) ? open.delete(k) : open.add(k); rerender(); if (open.has(k)) document.querySelector(`[data-comment="${k}"] input`)?.focus(); return; }
    if (like) {
      const [kind, id] = like.dataset.like.split(':'); like.disabled = true;
      try { C.S.games = await api('/like', { method: 'POST', body: { kind, id: +id } }); rerender(); } catch (err) { alert(err.message); like.disabled = false; }
      return;
    }
    if (del) { try { C.S.games = await api('/comment/' + del.dataset.uncomment, { method: 'DELETE' }); rerender(); } catch (err) { alert(err.message); } }
  });
  document.addEventListener('submit', async e => {
    const f = e.target.closest('[data-comment]'); if (!f) return;
    e.preventDefault();
    const [kind, id] = f.dataset.comment.split(':'), msg = f.elements.msg.value.trim(); if (!msg) return;
    const btn = f.querySelector('button'); btn.disabled = true;
    try { C.S.games = await api('/comment', { method: 'POST', body: { kind, id: +id, msg } }); open.add(f.dataset.comment); rerender(); }
    catch (err) { alert(err.message); btn.disabled = false; }
  });
}
