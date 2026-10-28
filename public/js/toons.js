// Cartoon profile pictures (Nick, Oct 28 2026): silly bowling characters a bowler can pick and
// customize on #/me instead of uploading a photo. Drawn as SVG, saved as a normal JPEG profile photo.

export const OPTIONS = {
  base: [['pin', 'Pin'], ['ball', 'Ball'], ['shoe', 'Shoe'], ['box', 'Cereal box'], ['bowl', 'Cereal bowl']],
  color: ['#FFFFFF', '#E8173A', '#FF7A1A', '#FFC857', '#2ECC71', '#3BE8FF', '#3C6FB8', '#7B2FF7', '#FF3D9A', '#2A2A2E'],
  eyes: [['googly', 'Googly'], ['happy', 'Happy'], ['sleepy', 'Sleepy'], ['angry', 'Fired up'], ['shades', 'Shades'], ['stars', 'Starstruck']],
  mouth: [['grin', 'Grin'], ['tongue', 'Tongue out'], ['oh', 'Shocked'], ['smirk', 'Smirk'], ['stache', 'Mustache'], ['teeth', 'Buck teeth']],
  top: [['none', 'Nothing'], ['headband', 'Headband'], ['cap', 'Backwards cap'], ['derby', 'Bowler hat'], ['party', 'Party hat'], ['spiky', 'Spiky hair'], ['afro', 'Afro']],
  bg: ['#3BE8FF', '#FFC857', '#FF3D9A', '#7B2FF7', '#2ECC71', '#FF7A1A', '#14112A', '#F6E7CF'],
};

export const PRESETS = [
  { name: 'Pin Pal', base: 'pin', color: '#FFFFFF', eyes: 'googly', mouth: 'grin', top: 'none', bg: '#3BE8FF' },
  { name: 'Gutter Gus', base: 'ball', color: '#7B2FF7', eyes: 'sleepy', mouth: 'tongue', top: 'cap', bg: '#FFC857' },
  { name: 'Sir Spares-a-Lot', base: 'pin', color: '#FFFFFF', eyes: 'shades', mouth: 'smirk', top: 'derby', bg: '#FF3D9A' },
  { name: 'Stinky Shoe', base: 'shoe', color: '#E8173A', eyes: 'angry', mouth: 'teeth', top: 'none', bg: '#2ECC71' },
  { name: 'Captain Crunchtime', base: 'box', color: '#FFC857', eyes: 'stars', mouth: 'grin', top: 'headband', bg: '#7B2FF7' },
  { name: 'Soggy Sam', base: 'bowl', color: '#3BE8FF', eyes: 'happy', mouth: 'oh', top: 'party', bg: '#FF3D9A' },
  { name: 'Turkey Tony', base: 'ball', color: '#FF7A1A', eyes: 'angry', mouth: 'stache', top: 'spiky', bg: '#14112A' },
  { name: 'Lane Queen', base: 'pin', color: '#FF3D9A', eyes: 'happy', mouth: 'grin', top: 'afro', bg: '#FFC857' },
];

const DARK = new Set(['#2A2A2E', '#3C6FB8', '#7B2FF7', '#14112A', '#E8173A']);
const K = '#111';
const pick = a => a[Math.floor(Math.random() * a.length)];
export function randomToon() {
  const v = x => (Array.isArray(x[0]) ? pick(x)[0] : pick(x));
  return { base: v(OPTIONS.base), color: v(OPTIONS.color), eyes: v(OPTIONS.eyes), mouth: v(OPTIONS.mouth), top: v(OPTIONS.top), bg: v(OPTIONS.bg) };
}

// Each character: body art, where the face goes (x, y, scale) and where a hat sits (x, top y, width).
function body(t) {
  const c = t.color, acc = c === '#E8173A' ? '#3BE8FF' : '#E8173A';
  const S = `stroke="${K}" stroke-width="5" stroke-linejoin="round"`;
  switch (t.base) {
    case 'ball': return {
      art: `<circle cx="100" cy="116" r="72" fill="${c}" ${S}/>
        <ellipse cx="72" cy="80" rx="20" ry="11" fill="#fff" opacity=".35" transform="rotate(-30 72 80)"/>
        <circle cx="146" cy="122" r="8" fill="${K}"/><circle cx="158" cy="100" r="8" fill="${K}"/><circle cx="138" cy="148" r="9" fill="${K}"/>`,
      face: [90, 120, 1.05], head: [96, 46, 110] };
    case 'shoe': return {
      art: `<path d="M22 152 Q18 120 52 112 L92 102 Q100 70 118 58 L168 58 Q182 58 182 72 L182 162 L22 162 Z" fill="${c}" ${S}/>
        <path d="M134 58 L168 58 Q182 58 182 72 L182 162 L134 162 Q120 120 134 58 Z" fill="#F4EFE6" ${S}/>
        <path d="M98 104 L120 96 M102 92 L124 84 M108 80 L128 72" stroke="${K}" stroke-width="5" stroke-linecap="round"/>
        <rect x="16" y="160" width="172" height="18" rx="9" fill="#3A2A20" ${S}/>`,
      face: [72, 134, .8], head: [150, 58, 60] };
    case 'box': return {
      art: `<rect x="48" y="40" width="104" height="152" rx="6" fill="${c}" ${S}/>
        <path d="M48 40 L60 22 L140 22 L152 40 Z" fill="${c}" ${S}/><path d="M48 40 L60 22 L140 22 L152 40 Z" fill="${K}" opacity=".18"/>
        <circle cx="70" cy="174" r="7" fill="none" stroke="${acc}" stroke-width="5"/><circle cx="92" cy="178" r="7" fill="none" stroke="#FFC857" stroke-width="5"/>
        <circle cx="114" cy="173" r="7" fill="none" stroke="#2ECC71" stroke-width="5"/><circle cx="134" cy="178" r="7" fill="none" stroke="#3BE8FF" stroke-width="5"/>
        <path d="M60 58 L140 58" stroke="${K}" stroke-width="4" opacity=".25"/>`,
      face: [100, 112, 1], head: [100, 22, 92] };
    case 'bowl': return {
      art: `<path d="M150 96 L184 40" stroke="#C9CED8" stroke-width="12" stroke-linecap="round"/><path d="M150 96 L184 40" stroke="${K}" stroke-width="3" opacity=".4"/>
        ${[[56, 100, '#FFC857'], [76, 92, '#E8173A'], [98, 96, '#2ECC71'], [120, 90, '#FF7A1A'], [140, 98, '#3BE8FF'], [88, 104, '#FF3D9A'], [112, 104, '#FFC857']].map(([x, y, col]) => `<circle cx="${x}" cy="${y}" r="9" fill="none" stroke="${col}" stroke-width="6"/>`).join('')}
        <path d="M26 108 L174 108 Q172 182 100 186 Q28 182 26 108 Z" fill="${c}" ${S}/>
        <ellipse cx="100" cy="108" rx="74" ry="9" fill="#fff" opacity=".35"/>`,
      face: [100, 140, .85], head: [100, 84, 100] };
    default: { // pin
      const d = 'M100 20 C124 20 134 40 132 60 C130 78 117 87 118 99 C119 113 148 128 148 160 C148 184 136 202 136 202 L64 202 C64 202 52 184 52 160 C52 128 81 113 82 99 C83 87 70 78 68 60 C66 40 76 20 100 20 Z';
      return {
        art: `<defs><clipPath id="pinclip"><path d="${d}"/></clipPath></defs><path d="${d}" fill="${c}"/>
          <g clip-path="url(#pinclip)"><rect x="40" y="94" width="120" height="7" fill="${acc}"/><rect x="40" y="106" width="120" height="7" fill="${acc}"/></g>
          <path d="${d}" fill="none" ${S}/>`,
        face: [100, 58, .82], head: [100, 20, 64] };
    }
  }
}

function eyes(kind, ink) {
  const W = `fill="#fff" stroke="${K}" stroke-width="3.5"`;
  const star = (x, y) => `<path transform="translate(${x} ${y})" d="M0 -14 L4 -4 L14 -4 L6 3 L9 13 L0 7 L-9 13 L-6 3 L-14 -4 L-4 -4 Z" fill="#FFD43B" stroke="${K}" stroke-width="3" stroke-linejoin="round"/>`;
  switch (kind) {
    case 'happy': return `<path d="M-30 4 Q-19 -12 -8 4 M8 4 Q19 -12 30 4" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round"/>`;
    case 'sleepy': return `<circle cx="-19" cy="0" r="12" ${W}/><circle cx="19" cy="0" r="12" ${W}/>
      <path d="M-31 0 A12 12 0 0 1 -7 0 Z M7 0 A12 12 0 0 1 31 0 Z" fill="#6B5B8A" stroke="${K}" stroke-width="3.5"/>
      <circle cx="-19" cy="5" r="3.5" fill="${K}"/><circle cx="19" cy="5" r="3.5" fill="${K}"/>`;
    case 'angry': return `<circle cx="-19" cy="2" r="11" ${W}/><circle cx="19" cy="2" r="11" ${W}/><circle cx="-16" cy="4" r="5" fill="${K}"/><circle cx="16" cy="4" r="5" fill="${K}"/>
      <path d="M-33 -16 L-7 -7 M33 -16 L7 -7" stroke="${ink}" stroke-width="6" stroke-linecap="round"/>`;
    case 'shades': return `<path d="M-36 -10 L36 -10" stroke="${K}" stroke-width="5"/><rect x="-36" y="-10" width="30" height="20" rx="7" fill="${K}"/><rect x="6" y="-10" width="30" height="20" rx="7" fill="${K}"/>
      <path d="M-30 -5 L-22 -5 M12 -5 L20 -5" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".8"/>`;
    case 'stars': return star(-19, 0) + star(19, 0);
    default: return `<circle cx="-19" cy="0" r="13" ${W}/><circle cx="19" cy="0" r="13" ${W}/><circle cx="-15" cy="5" r="6" fill="${K}"/><circle cx="14" cy="-4" r="6" fill="${K}"/>`;
  }
}

function mouth(kind, ink) {
  switch (kind) {
    case 'tongue': return `<path d="M-18 22 Q0 40 18 22 Z" fill="${K}"/><path d="M-8 30 Q-9 46 1 46 Q10 46 9 31 Z" fill="#FF6FA3" stroke="${K}" stroke-width="3"/>`;
    case 'oh': return `<ellipse cx="0" cy="30" rx="8" ry="11" fill="${K}"/>`;
    case 'smirk': return `<path d="M-14 28 Q4 34 18 20" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round"/>`;
    case 'stache': return `<path d="M-12 32 Q0 38 12 32" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>
      <path d="M0 20 Q-10 14 -22 20 Q-32 26 -36 16 Q-34 30 -20 30 Q-8 30 0 24 Q8 30 20 30 Q34 30 36 16 Q32 26 22 20 Q10 14 0 20 Z" fill="#5A3A22" stroke="${K}" stroke-width="3" stroke-linejoin="round"/>`;
    case 'teeth': return `<path d="M-18 22 Q0 32 18 22" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round"/><rect x="-8" y="26" width="8" height="11" fill="#fff" stroke="${K}" stroke-width="2.5"/><rect x="0" y="26" width="8" height="11" fill="#fff" stroke="${K}" stroke-width="2.5"/>`;
    default: return `<path d="M-20 20 Q0 44 20 20 Z" fill="${K}" stroke="${K}" stroke-width="3" stroke-linejoin="round"/><path d="M-15 22 L15 22 L13 27 L-13 27 Z" fill="#fff"/>`;
  }
}

function top(kind, [hx, hy, w], face) {
  const k = Math.min(w / 64, 1.5);
  const g = s => `<g transform="translate(${hx} ${hy}) scale(${k})">${s}</g>`;
  const S = `stroke="${K}" stroke-width="${(4 / k).toFixed(1)}" stroke-linejoin="round"`;
  switch (kind) {
    case 'headband': { const [x, y, s] = face; return `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-40" y="-36" width="80" height="13" rx="4" fill="#E8173A" stroke="${K}" stroke-width="4"/><rect x="-40" y="-31" width="80" height="3" fill="#fff"/><path d="M38 -30 L54 -40 L52 -24 Z M38 -30 L56 -26 L46 -14 Z" fill="#E8173A" stroke="${K}" stroke-width="3" stroke-linejoin="round"/></g>`; }
    case 'cap': return g(`<path d="M-28 8 Q-30 -26 0 -26 Q30 -26 28 8 Z" fill="#3C6FB8" ${S}/><path d="M18 2 L46 -2 Q50 6 44 10 L22 10 Z" fill="#2B5596" ${S}/><circle cx="0" cy="-26" r="4" fill="#3C6FB8" ${S}/>`);
    case 'derby': return g(`<ellipse cx="0" cy="6" rx="42" ry="9" fill="#2A2A2E" ${S}/><path d="M-26 6 Q-28 -34 0 -34 Q28 -34 26 6 Z" fill="#2A2A2E" ${S}/><path d="M-26 -2 L26 -2" stroke="#E8173A" stroke-width="${(7 / k).toFixed(1)}"/>`);
    case 'party': return g(`<path d="M-20 8 L0 -52 L20 8 Z" fill="#FFC857" ${S}/><path d="M-13 -12 L13 -12 M-7 -30 L7 -30" stroke="#FF3D9A" stroke-width="${(6 / k).toFixed(1)}"/><circle cx="0" cy="-54" r="8" fill="#FF3D9A" ${S}/>`);
    case 'spiky': return g(`<path d="M-30 10 L-34 -14 L-18 -6 L-14 -34 L-2 -10 L8 -38 L14 -8 L30 -26 L28 2 L40 -6 L30 12 Z" fill="#FFD43B" ${S}/>`);
    case 'afro': return g(`${[[-30, -2], [-20, -24], [0, -32], [20, -24], [30, -2], [-12, -8], [12, -8]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="18" fill="#3A2416" ${S}/>`).join('')}${[[-20, -24], [0, -32], [20, -24]].map(([x, y]) => `<circle cx="${x}" cy="${y + 4}" r="15" fill="#3A2416"/>`).join('')}`);
    default: return '';
  }
}

export function toonSVG(t, size = 200) {
  const b = body(t);
  const ink = DARK.has(t.color) ? '#fff' : K;
  const [fx, fy, fs] = b.face;
  // a tall hat needs headroom: shrink the character toward the bottom of the picture
  const shrink = ['none', 'headband'].includes(t.top) ? '' : 'translate(100 200) scale(.8) translate(-100 -200)';
  const rays = Array.from({ length: 12 }, (_, i) => { const a = i * Math.PI / 6, a2 = a + Math.PI / 12; return `M100 100 L${100 + 160 * Math.cos(a)} ${100 + 160 * Math.sin(a)} L${100 + 160 * Math.cos(a2)} ${100 + 160 * Math.sin(a2)} Z`; }).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${size}" height="${size}">
    <rect width="200" height="200" fill="${t.bg}"/><path d="${rays}" fill="#fff" opacity=".14"/>
    <g transform="${shrink}">${b.art}
    <g transform="translate(${fx} ${fy}) scale(${fs})">${eyes(t.eyes, ink)}${mouth(t.mouth, ink)}</g>
    ${top(t.top, b.head, b.face)}</g>
  </svg>`;
}

// SVG -> 360px JPEG, ready for the regular profile photo upload.
export function toonJpeg(t, size = 360) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      c.getContext('2d').drawImage(img, 0, 0, size, size);
      c.toBlob(b => b ? resolve(b) : reject(new Error('Couldn’t make that picture. Try again.')), 'image/jpeg', .92);
    };
    img.onerror = () => reject(new Error('Couldn’t make that picture. Try again.'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(toonSVG(t, size));
  });
}

export function builderHTML(t, esc) {
  const chips = (key, list) => `<div class="seg toon-seg" data-key="${key}">${list.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${t[key] === v}">${esc(l)}</button>`).join('')}</div>`;
  const sw = (key, list) => `<div class="swatches" data-key="${key}">${list.map(c => `<button type="button" data-v="${c}" style="--c:${c}" aria-label="Color ${c}" aria-pressed="${t[key] === c}"></button>`).join('')}</div>`;
  return `<div class="toon-wrap">
    <div class="toon-preview" id="toonPreview">${toonSVG(t, 180)}</div>
    <div class="field"><span>Start from a character</span><div class="toon-presets">${PRESETS.map((p, i) => `<button type="button" data-preset="${i}" title="${esc(p.name)}">${toonSVG(p, 64)}<small>${esc(p.name)}</small></button>`).join('')}</div></div>
    <div class="field"><span>Character</span>${chips('base', OPTIONS.base)}</div>
    <div class="field"><span>Color</span>${sw('color', OPTIONS.color)}</div>
    <div class="field"><span>Eyes</span>${chips('eyes', OPTIONS.eyes)}</div>
    <div class="field"><span>Mouth</span>${chips('mouth', OPTIONS.mouth)}</div>
    <div class="field"><span>On top</span>${chips('top', OPTIONS.top)}</div>
    <div class="field"><span>Background</span>${sw('bg', OPTIONS.bg)}</div>
    <div class="controls"><button type="button" class="btn primary" id="toonUse">Use this picture</button><button type="button" class="btn" id="toonRandom">🎲 Surprise me</button></div>
  </div>`;
}

export function bindBuilder(host, t, onUse) {
  const paint = () => {
    host.querySelector('#toonPreview').innerHTML = toonSVG(t, 180);
    host.querySelectorAll('[data-key]').forEach(g => g.querySelectorAll('[data-v]').forEach(b => b.setAttribute('aria-pressed', t[g.dataset.key] === b.dataset.v)));
  };
  host.onclick = e => {
    const pr = e.target.closest('[data-preset]');
    if (pr) { const { name, ...p } = PRESETS[+pr.dataset.preset]; Object.assign(t, p); return paint(); }
    const b = e.target.closest('[data-v]');
    if (b) { t[b.closest('[data-key]').dataset.key] = b.dataset.v; return paint(); }
    if (e.target.closest('#toonRandom')) { Object.assign(t, randomToon()); return paint(); }
    if (e.target.closest('#toonUse')) onUse({ ...t }, e.target.closest('#toonUse'));
  };
}
