// Cartoon profile pictures (Nick, Oct 28 2026): pick a bowling pin, bowling ball or cereal bowl, then dress it
// up — color, eyes, smile, haircut + hair color, hat, glasses, mustache, background. Drawn as SVG and
// saved as a normal JPEG profile photo.

export const OPTIONS = {
  base: [['pin', 'Bowling pin'], ['ball', 'Bowling ball'], ['bowl', 'Cereal bowl']],
  color: ['#FFFFFF', '#E8173A', '#FF7A1A', '#FFC857', '#2ECC71', '#3BE8FF', '#3C6FB8', '#7B2FF7', '#FF3D9A', '#2A2A2E'],
  eyes: [['googly', 'Googly'], ['happy', 'Happy'], ['sleepy', 'Sleepy'], ['angry', 'Fired up'], ['stars', 'Starstruck'], ['wink', 'Wink']],
  mouth: [['grin', 'Grin'], ['toothy', 'Big cheesy grin'], ['smirk', 'Smirk'], ['tongue', 'Tongue out'], ['oh', 'Shocked'], ['teeth', 'Buck teeth'], ['gap', 'Gap tooth']],
  hair: [['none', 'Bald'], ['spiky', 'Spiky'], ['mohawk', 'Mohawk'], ['mullet', 'Mullet'], ['afro', 'Afro'], ['curly', 'Curly'], ['combover', 'Comb-over'], ['pigtails', 'Pigtails']],
  hairColor: ['#2A1A10', '#6B3E1E', '#FFD43B', '#E8592A', '#C9CED8', '#FF3D9A', '#3BE8FF'],
  hat: [['none', 'No hat'], ['cap', 'Backwards cap'], ['derby', 'Bowler hat'], ['cowboy', 'Cowboy hat'], ['beanie', 'Beanie'], ['party', 'Party hat'], ['headband', 'Headband']],
  glasses: [['none', 'No glasses'], ['shades', 'Shades'], ['specs', 'Round specs'], ['hearts', 'Heart shades']],
  stache: [['none', 'No mustache'], ['stache', 'Classic'], ['handlebar', 'Handlebar'], ['pencil', 'Pencil'], ['goatee', 'Goatee']],
  bg: ['#3BE8FF', '#FFC857', '#FF3D9A', '#7B2FF7', '#2ECC71', '#FF7A1A', '#14112A', '#F6E7CF'],
};
const DEFAULTS = { base: 'pin', color: '#FFFFFF', eyes: 'googly', mouth: 'grin', hair: 'none', hairColor: '#2A1A10', hat: 'none', glasses: 'none', stache: 'none', bg: '#3BE8FF' };

export const PRESETS = [
  { name: 'Pin Pal', base: 'pin', color: '#FFFFFF', eyes: 'googly', mouth: 'grin', bg: '#3BE8FF' },
  { name: 'Gutter Gus', base: 'ball', color: '#7B2FF7', eyes: 'sleepy', mouth: 'tongue', hat: 'cap', bg: '#FFC857' },
  { name: 'Sir Spares-a-Lot', base: 'pin', color: '#FFFFFF', eyes: 'happy', mouth: 'smirk', hat: 'derby', glasses: 'shades', stache: 'handlebar', bg: '#FF3D9A' },
  { name: 'Mullet Mike', base: 'pin', color: '#FFFFFF', eyes: 'wink', mouth: 'toothy', hair: 'mullet', hairColor: '#6B3E1E', stache: 'stache', bg: '#2ECC71' },
  { name: 'Soggy Sam', base: 'bowl', color: '#3BE8FF', eyes: 'happy', mouth: 'oh', hat: 'party', bg: '#FF3D9A' },
  { name: 'Turkey Tony', base: 'ball', color: '#FF7A1A', eyes: 'angry', mouth: 'teeth', hair: 'spiky', hairColor: '#FFD43B', stache: 'stache', bg: '#14112A' },
  { name: 'Lane Queen', base: 'pin', color: '#FF3D9A', eyes: 'stars', mouth: 'grin', hair: 'afro', glasses: 'hearts', bg: '#FFC857' },
  { name: 'Cowboy Crunch', base: 'bowl', color: '#E8173A', eyes: 'angry', mouth: 'gap', hat: 'cowboy', stache: 'goatee', bg: '#F6E7CF' },
  { name: 'Punk Pin', base: 'pin', color: '#2A2A2E', eyes: 'angry', mouth: 'smirk', hair: 'mohawk', hairColor: '#FF3D9A', glasses: 'specs', bg: '#3BE8FF' },
].map(p => ({ ...DEFAULTS, ...p }));

const DARK = new Set(['#2A2A2E', '#3C6FB8', '#7B2FF7', '#14112A', '#E8173A']);
const K = '#111';
const pick = a => a[Math.floor(Math.random() * a.length)];
const val = x => (Array.isArray(x[0]) ? pick(x)[0] : pick(x));
export function randomToon() {
  const t = Object.fromEntries(Object.entries(OPTIONS).map(([k, list]) => [k, val(list)]));
  // keep surprises readable: not everything at once
  if (Math.random() < .5) t.glasses = 'none';
  if (Math.random() < .5) t.stache = 'none';
  if (t.hat !== 'none' && Math.random() < .5) t.hair = 'none';
  return t;
}
export function normalize(t) { return { ...DEFAULTS, ...t }; }

// Each base: body art, face spot (x, y, scale) and head (center x, top y, width) for hair and hats.
function body(t) {
  const c = t.color, acc = c === '#E8173A' ? '#3BE8FF' : '#E8173A';
  const S = `stroke="${K}" stroke-width="5" stroke-linejoin="round"`;
  if (t.base === 'ball') return {
    art: `<circle cx="100" cy="116" r="72" fill="${c}" ${S}/>
      <ellipse cx="66" cy="84" rx="18" ry="10" fill="#fff" opacity=".35" transform="rotate(-35 66 84)"/>
      <circle cx="148" cy="124" r="8" fill="${K}"/><circle cx="160" cy="102" r="8" fill="${K}"/><circle cx="140" cy="150" r="9" fill="${K}"/>`,
    face: [92, 118, 1.05], head: [98, 46, 96] };
  if (t.base === 'bowl') return {
    art: `<path d="M150 96 L184 40" stroke="#C9CED8" stroke-width="12" stroke-linecap="round"/><path d="M150 96 L184 40" stroke="${K}" stroke-width="3" opacity=".4"/>
      ${[[56, 100, '#FFC857'], [76, 92, '#E8173A'], [98, 96, '#2ECC71'], [120, 90, '#FF7A1A'], [140, 98, '#3BE8FF'], [88, 104, '#FF3D9A'], [112, 104, '#FFC857']].map(([x, y, col]) => `<circle cx="${x}" cy="${y}" r="9" fill="none" stroke="${col}" stroke-width="6"/>`).join('')}
      <path d="M26 108 L174 108 Q172 182 100 186 Q28 182 26 108 Z" fill="${c}" ${S}/>
      <ellipse cx="100" cy="108" rx="74" ry="9" fill="#fff" opacity=".35"/>`,
    face: [100, 140, .85], head: [100, 88, 116] };
  const d = 'M100 20 C124 20 134 40 132 60 C130 78 117 87 118 99 C119 113 148 128 148 160 C148 184 136 202 136 202 L64 202 C64 202 52 184 52 160 C52 128 81 113 82 99 C83 87 70 78 68 60 C66 40 76 20 100 20 Z';
  return {
    art: `<defs><clipPath id="pinclip"><path d="${d}"/></clipPath></defs><path d="${d}" fill="${c}"/>
      <g clip-path="url(#pinclip)"><rect x="40" y="94" width="120" height="7" fill="${acc}"/><rect x="40" y="106" width="120" height="7" fill="${acc}"/></g>
      <path d="${d}" fill="none" ${S}/>`,
    face: [100, 58, .82], head: [100, 20, 64] };
}

function eyes(kind, ink) {
  const W = `fill="#fff" stroke="${K}" stroke-width="3.5"`;
  const star = (x, y) => `<path transform="translate(${x} ${y})" d="M0 -14 L4 -4 L14 -4 L6 3 L9 13 L0 7 L-9 13 L-6 3 L-14 -4 L-4 -4 Z" fill="#FFD43B" stroke="${K}" stroke-width="3" stroke-linejoin="round"/>`;
  switch (kind) {
    case 'happy': return `<path d="M-30 4 Q-19 -12 -8 4 M8 4 Q19 -12 30 4" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round"/>`;
    case 'wink': return `<circle cx="-19" cy="0" r="12" ${W}/><circle cx="-16" cy="3" r="5.5" fill="${K}"/><path d="M8 2 Q19 -8 30 2" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round"/>`;
    case 'sleepy': return `<circle cx="-19" cy="0" r="12" ${W}/><circle cx="19" cy="0" r="12" ${W}/>
      <path d="M-31 0 A12 12 0 0 1 -7 0 Z M7 0 A12 12 0 0 1 31 0 Z" fill="#6B5B8A" stroke="${K}" stroke-width="3.5"/>
      <circle cx="-19" cy="5" r="3.5" fill="${K}"/><circle cx="19" cy="5" r="3.5" fill="${K}"/>`;
    case 'angry': return `<circle cx="-19" cy="2" r="11" ${W}/><circle cx="19" cy="2" r="11" ${W}/><circle cx="-16" cy="4" r="5" fill="${K}"/><circle cx="16" cy="4" r="5" fill="${K}"/>
      <path d="M-33 -16 L-7 -7 M33 -16 L7 -7" stroke="${ink}" stroke-width="6" stroke-linecap="round"/>`;
    case 'stars': return star(-19, 0) + star(19, 0);
    default: return `<circle cx="-19" cy="0" r="13" ${W}/><circle cx="19" cy="0" r="13" ${W}/><circle cx="-15" cy="5" r="6" fill="${K}"/><circle cx="14" cy="-4" r="6" fill="${K}"/>`;
  }
}

function glasses(kind) {
  switch (kind) {
    case 'shades': return `<path d="M-38 -8 L38 -8" stroke="${K}" stroke-width="5"/><rect x="-36" y="-10" width="30" height="20" rx="7" fill="${K}"/><rect x="6" y="-10" width="30" height="20" rx="7" fill="${K}"/>
      <path d="M-30 -5 L-22 -5 M12 -5 L20 -5" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".8"/>`;
    case 'specs': return `<circle cx="-19" cy="0" r="15" fill="#fff" fill-opacity=".18" stroke="${K}" stroke-width="4"/><circle cx="19" cy="0" r="15" fill="#fff" fill-opacity=".18" stroke="${K}" stroke-width="4"/>
      <path d="M-4 -2 Q0 -6 4 -2 M-34 -2 L-40 -6 M34 -2 L40 -6" stroke="${K}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    case 'hearts': { const h = x => `<path transform="translate(${x} 0)" d="M0 12 C-20 0 -18 -14 -8 -14 C-4 -14 -1 -11 0 -8 C1 -11 4 -14 8 -14 C18 -14 20 0 0 12 Z" fill="#FF3D9A" stroke="${K}" stroke-width="3.5" stroke-linejoin="round"/>`;
      return `<path d="M-38 -6 L38 -6" stroke="${K}" stroke-width="4"/>${h(-19)}${h(19)}<path d="M-26 -8 L-22 -10 M12 -8 L16 -10" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".8"/>`; }
    default: return '';
  }
}

function mouth(kind, ink) {
  switch (kind) {
    case 'toothy': return `<path d="M-24 22 Q0 52 24 22 Z" fill="${K}" stroke="${K}" stroke-width="3" stroke-linejoin="round"/><path d="M-20 24 L20 24 L17 31 L-17 31 Z" fill="#fff"/><path d="M-8 24 L-8 31 M0 24 L0 31 M8 24 L8 31" stroke="${K}" stroke-width="1.5"/><path d="M-9 38 Q0 44 9 38" fill="#FF6FA3"/>`;
    case 'tongue': return `<path d="M-18 22 Q0 40 18 22 Z" fill="${K}"/><path d="M-8 30 Q-9 46 1 46 Q10 46 9 31 Z" fill="#FF6FA3" stroke="${K}" stroke-width="3"/>`;
    case 'oh': return `<ellipse cx="0" cy="31" rx="8" ry="11" fill="${K}"/>`;
    case 'smirk': return `<path d="M-14 30 Q4 36 18 22" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round"/>`;
    case 'teeth': return `<path d="M-18 24 Q0 34 18 24" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round"/><rect x="-8" y="28" width="8" height="11" fill="#fff" stroke="${K}" stroke-width="2.5"/><rect x="0" y="28" width="8" height="11" fill="#fff" stroke="${K}" stroke-width="2.5"/>`;
    case 'gap': return `<path d="M-20 22 Q0 44 20 22 Z" fill="${K}" stroke="${K}" stroke-width="3" stroke-linejoin="round"/><path d="M-15 24 L-3 24 L-3 29 L-13 29 Z M3 24 L15 24 L13 29 L3 29 Z" fill="#fff"/>`;
    default: return `<path d="M-20 22 Q0 46 20 22 Z" fill="${K}" stroke="${K}" stroke-width="3" stroke-linejoin="round"/><path d="M-15 24 L15 24 L13 29 L-13 29 Z" fill="#fff"/>`;
  }
}

function stache(kind) {
  const B = `fill="#3A2416" stroke="${K}" stroke-width="3" stroke-linejoin="round"`;
  switch (kind) {
    case 'stache': return `<path d="M0 18 Q-12 10 -26 16 Q-30 26 -16 25 Q-6 24 0 20 Q6 24 16 25 Q30 26 26 16 Q12 10 0 18 Z" ${B}/>`;
    case 'handlebar': return `<path d="M0 18 Q-10 12 -22 18 Q-32 24 -36 14 Q-40 8 -34 6 Q-38 14 -30 16 Q-22 10 -10 12 Q-4 13 0 16 Q4 13 10 12 Q22 10 30 16 Q38 14 34 6 Q40 8 36 14 Q32 24 22 18 Q10 12 0 18 Z" ${B}/>`;
    case 'pencil': return `<path d="M-18 18 Q0 13 18 18" fill="none" stroke="#3A2416" stroke-width="4" stroke-linecap="round"/>`;
    case 'goatee': return `<path d="M-8 44 Q0 42 8 44 Q8 58 0 62 Q-8 58 -8 44 Z" ${B}/>`;
    default: return '';
  }
}

// head-relative pieces: drawn in a 64-wide head box (x -32..32, top at y 0), scaled to the head
function hair(kind, col) {
  const S = `fill="${col}" stroke="${K}" stroke-width="3.5" stroke-linejoin="round"`;
  switch (kind) {
    case 'spiky': return `<path d="M-30 12 L-34 -12 L-18 -4 L-14 -32 L-2 -8 L8 -36 L14 -6 L30 -24 L28 4 L40 -4 L30 14 Q0 2 -30 12 Z" ${S}/>`;
    case 'mohawk': return `<path d="M-9 10 L-14 -14 L-6 -8 L-6 -32 L0 -16 L6 -32 L6 -8 L14 -14 L9 10 Q0 6 -9 10 Z" ${S}/>`;
    case 'mullet': return `<path d="M-31 24 Q-46 54 -36 76 Q-30 56 -26 40 Z M31 24 Q46 54 36 76 Q30 56 26 40 Z" ${S}/>
      <path d="M-32 24 Q-34 -4 0 -4 Q34 -4 32 24 Q22 8 8 12 L4 6 L-2 12 Q-18 6 -32 24 Z" ${S}/>`;
    case 'afro': return `${[[-30, 4], [-24, -18], [-6, -30], [12, -30], [27, -18], [32, 4]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="17" ${S}/>`).join('')}<path d="M-38 6 Q-40 -30 0 -30 Q40 -30 38 6 Z" fill="${col}"/>`;
    case 'curly': return `${[-24, -12, 0, 12, 24].map((x, i) => `<circle cx="${x}" cy="${i % 2 ? -2 : 2}" r="10" ${S}/>`).join('')}${[-18, -6, 6, 18].map(x => `<circle cx="${x}" cy="-8" r="9" ${S}/>`).join('')}`;
    case 'combover': return `<path d="M-30 14 Q-26 -6 6 -2 Q26 0 30 10 Q10 2 -30 14 Z" ${S}/><path d="M-20 8 Q2 -2 26 6 M-12 4 Q8 -1 22 2" fill="none" stroke="${K}" stroke-width="2"/>`;
    case 'pigtails': return `<path d="M-30 18 Q-30 -4 0 -4 Q30 -4 30 18 Q14 4 0 8 Q-14 4 -30 18 Z" ${S}/>
      <path d="M-30 16 Q-56 10 -54 34 Q-46 26 -32 26 Z M30 16 Q56 10 54 34 Q46 26 32 26 Z" ${S}/>
      <circle cx="-31" cy="18" r="4" fill="#FF3D9A" stroke="${K}" stroke-width="2"/><circle cx="31" cy="18" r="4" fill="#FF3D9A" stroke="${K}" stroke-width="2"/>`;
    default: return '';
  }
}

function hat(kind) {
  const S = `stroke="${K}" stroke-width="3.5" stroke-linejoin="round"`;
  switch (kind) {
    case 'cap': return `<path d="M-30 10 Q-32 -24 0 -24 Q32 -24 30 10 Z" fill="#3C6FB8" ${S}/><path d="M20 4 L50 0 Q54 8 48 12 L24 12 Z" fill="#2B5596" ${S}/><circle cx="0" cy="-24" r="4" fill="#3C6FB8" ${S}/>`;
    case 'derby': return `<ellipse cx="0" cy="8" rx="44" ry="9" fill="#2A2A2E" ${S}/><path d="M-27 8 Q-29 -34 0 -34 Q29 -34 27 8 Z" fill="#2A2A2E" ${S}/><path d="M-27 0 L27 0" stroke="#E8173A" stroke-width="7"/>`;
    case 'cowboy': return `<path d="M-56 2 Q-50 14 0 14 Q50 14 56 2 Q44 8 26 4 L24 -24 Q12 -30 0 -22 Q-12 -30 -24 -24 L-26 4 Q-44 8 -56 2 Z" fill="#B87A2E" ${S}/><path d="M-25 -2 L25 -2" stroke="#5A3A22" stroke-width="6"/>`;
    case 'beanie': return `<path d="M-32 10 Q-34 -30 0 -30 Q34 -30 32 10 Z" fill="#2ECC71" ${S}/><rect x="-35" y="0" width="70" height="14" rx="5" fill="#1F9E57" ${S}/><circle cx="0" cy="-32" r="8" fill="#fff" ${S}/>`;
    case 'party': return `<path d="M-20 8 L0 -52 L20 8 Z" fill="#FFC857" ${S}/><path d="M-13 -12 L13 -12 M-7 -30 L7 -30" stroke="#FF3D9A" stroke-width="6"/><circle cx="0" cy="-54" r="8" fill="#FF3D9A" ${S}/>`;
    case 'headband': return `<rect x="-34" y="12" width="68" height="12" rx="4" fill="#E8173A" ${S}/><rect x="-34" y="16.5" width="68" height="3" fill="#fff"/><path d="M32 16 L48 6 L46 22 Z M32 16 L50 20 L40 32 Z" fill="#E8173A" ${S}/>`;
    default: return '';
  }
}

export function toonSVG(raw, size = 200) {
  const t = normalize(raw);
  const b = body(t);
  const ink = DARK.has(t.color) ? '#fff' : K;
  const [fx, fy, fs] = b.face, [hx, hy, hw] = b.head, k = hw / 64;
  const tall = !['none', 'headband'].includes(t.hat) || ['spiky', 'mohawk', 'afro', 'curly'].includes(t.hair);
  // tall hair or a hat needs headroom: shrink the character toward the bottom of the picture
  const shrink = tall ? 'translate(100 200) scale(.8) translate(-100 -200)' : '';
  const rays = Array.from({ length: 12 }, (_, i) => { const a = i * Math.PI / 6, a2 = a + Math.PI / 12; return `M100 100 L${100 + 160 * Math.cos(a)} ${100 + 160 * Math.sin(a)} L${100 + 160 * Math.cos(a2)} ${100 + 160 * Math.sin(a2)} Z`; }).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${size}" height="${size}">
    <rect width="200" height="200" fill="${t.bg}"/><path d="${rays}" fill="#fff" opacity=".14"/>
    <g transform="${shrink}">${b.art}
      <g transform="translate(${hx} ${hy}) scale(${k})">${hair(t.hair, t.hairColor)}</g>
      <g transform="translate(${fx} ${fy}) scale(${fs})">${eyes(t.eyes, ink)}${glasses(t.glasses)}${mouth(t.mouth, ink)}${stache(t.stache)}</g>
      <g transform="translate(${hx} ${hy}) scale(${k})">${hat(t.hat)}</g>
    </g>
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

export function builderHTML(raw, esc) {
  const t = normalize(raw);
  const chips = (key, list) => `<div class="seg toon-seg" data-key="${key}">${list.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${t[key] === v}">${esc(l)}</button>`).join('')}</div>`;
  const sw = (key, list) => `<div class="swatches" data-key="${key}">${list.map(c => `<button type="button" data-v="${c}" style="--c:${c}" aria-label="Color ${c}" aria-pressed="${t[key] === c}"></button>`).join('')}</div>`;
  const row = (label, html) => `<div class="field"><span>${label}</span>${html}</div>`;
  return `<div class="toon-wrap">
    <div class="toon-preview" id="toonPreview">${toonSVG(t, 180)}</div>
    <div class="toon-bases" data-key="base">${OPTIONS.base.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${t.base === v}">${toonSVG({ base: v, bg: '#F6E7CF' }, 56)}<small>${esc(l)}</small></button>`).join('')}</div>
    ${row('Color', sw('color', OPTIONS.color))}
    ${row('Eyes', chips('eyes', OPTIONS.eyes))}
    ${row('Smile', chips('mouth', OPTIONS.mouth))}
    ${row('Haircut', chips('hair', OPTIONS.hair))}
    ${row('Hair color', sw('hairColor', OPTIONS.hairColor))}
    ${row('Hat', chips('hat', OPTIONS.hat))}
    ${row('Glasses', chips('glasses', OPTIONS.glasses))}
    ${row('Mustache', chips('stache', OPTIONS.stache))}
    ${row('Background', sw('bg', OPTIONS.bg))}
    <details class="toon-ideas"><summary>Need ideas? Start from a ready-made character</summary><div class="toon-presets">${PRESETS.map((p, i) => `<button type="button" data-preset="${i}" title="${esc(p.name)}">${toonSVG(p, 64)}<small>${esc(p.name)}</small></button>`).join('')}</div></details>
    <div class="controls"><button type="button" class="btn primary" id="toonUse">Use this picture</button><button type="button" class="btn" id="toonRandom">🎲 Surprise me</button></div>
  </div>`;
}

export function bindBuilder(host, raw, onUse) {
  const t = normalize(raw);
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
