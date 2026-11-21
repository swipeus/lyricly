/* Lyricly — şarkılarla İngilizce çalışma uygulaması
 * Vanilla JS, derleme gerektirmez. Veriler tarayıcıda (localStorage) saklanır.
 * Dış servisler: YouTube IFrame API, LRCLIB (senkron sözler), MyMemory (çeviri),
 * dictionaryapi.dev (İngilizce tanım). */
'use strict';
const APP_VERSION = 7; // keep in sync with ?v= in index.html and VERSION in sw.js
const isTouch = matchMedia('(hover: none)').matches;
const iosVer = (navigator.userAgent.match(/OS (\d+)_(\d+)/) || []).slice(1).join('.');

// Show unexpected errors on screen (phones have no console) so they can be reported
let lastErr = '';
function showError(msg) {
  msg = String(msg || 'Bilinmeyen hata').slice(0, 160);
  if (msg === lastErr) return; lastErr = msg;
  const box = document.getElementById('toasts'); if (!box) return;
  const t = document.createElement('div'); t.className = 'toast'; t.style.borderColor = '#ff5c6c';
  t.textContent = `⚠️ Hata (s${APP_VERSION}): ${msg}`;
  box.appendChild(t); setTimeout(() => t.remove(), 8000);
}
addEventListener('error', (e) => { if (e.message && e.message !== 'Script error.') showError(e.message); }); // "Script error." = cross-origin (YouTube) noise
addEventListener('unhandledrejection', (e) => showError(e.reason?.message || e.reason));

/* ============================== STORAGE ============================== */
const STORE_KEY = 'lyricly-v1';
const defaultState = () => ({
  songs: {},
  vocab: {},
  stats: { xp: 0, streak: 0, lastDay: null, history: {}, correct: 0, attempts: 0, lines: 0 },
  settings: { dailyGoal: 60, sound: true, slowRate: 0.75, hideVideo: false, blurLyrics: true },
});
let S = load();
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    const d = JSON.parse(raw), def = defaultState();
    return { ...def, ...d, stats: { ...def.stats, ...d.stats }, settings: { ...def.settings, ...d.settings } };
  } catch { return defaultState(); }
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch {} }

/* ============================== HELPERS ============================== */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const dayOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const uid = () => Math.random().toString(36).slice(2, 10);
const fmtTime = (s) => { s = Math.max(0, s); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };

// Normalize a word for comparison: lowercase, unify apostrophes, strip outer punctuation
const norm = (w) => {
  let x = w.toLowerCase().replace(/[’‘`´]/g, "'").replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '').replace(/^'+/, '');
  if (!/in'$/.test(x)) x = x.replace(/'+$/, ''); // keep "lovin'" style endings
  return x;
};
// Display form of a word (strip surrounding punctuation but keep case + apostrophes)
const clean = (w) => w.replace(/[’‘`´]/g, "'").replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');
const tokens = (text) => text.split(/\s+/).map(clean).filter((w) => norm(w));

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const wordMatch = (typed, target) => {
  if (typed === target) return 'ok';
  const alt = (x) => x.replace(/in'$/, 'ing').replace(/'/g, '');
  if (alt(typed) === alt(target)) return 'ok';
  if (target.length >= 5 && lev(typed, target) <= 1) return 'near';
  return null;
};

// LCS-based alignment of typed vs target word arrays
function align(typed, target) {
  const tn = typed.map(norm), gn = target.map(norm);
  const m = tn.length, n = gn.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--)
    dp[i][j] = wordMatch(tn[i], gn[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && wordMatch(tn[i], gn[j]) && dp[i][j] === dp[i + 1][j + 1] + 1) { out.push({ type: wordMatch(tn[i], gn[j]), word: target[j], typed: typed[i] }); i++; j++; }
    else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) { out.push({ type: 'miss', word: target[j] }); j++; }
    else { out.push({ type: 'extra', word: typed[i] }); i++; }
  }
  return out;
}

const STOP = new Set('a an the i you he she it we they me him her us them my your his its our their is am are was were be been to of in on at for and or but so if as do does did not no yes oh ooh yeah la na hey uh ah ha mm hmm'.split(' '));

/* ============================== SOUND ============================== */
let actx;
function tone(freqs, dur = 0.12, type = 'sine', vol = 0.12, gap = 0.08) {
  if (!S.settings.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    freqs.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * gap;
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
    });
  } catch {}
}
const sfx = {
  click: () => tone([520], 0.05, 'triangle', 0.06),
  pop: () => tone([380], 0.05, 'triangle', 0.05),
  good: () => tone([660, 880, 1320], 0.18, 'sine', 0.12, 0.07),
  bad: () => tone([220, 180], 0.2, 'sawtooth', 0.05, 0.1),
  level: () => tone([523, 659, 784, 1047, 1319], 0.25, 'triangle', 0.1, 0.09),
  save: () => tone([880, 1175], 0.12, 'sine', 0.08, 0.06),
};

/* ============================== UI FX ============================== */
function toast(msg, ms = 2600) {
  const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}
function xpFloat(amount, el) {
  const r = (el || document.body).getBoundingClientRect();
  const f = document.createElement('div'); f.className = 'xp-float'; f.textContent = `+${amount} XP`;
  f.style.left = `${r.left + r.width / 2 - 40}px`; f.style.top = `${r.top + 10}px`;
  document.body.appendChild(f); setTimeout(() => f.remove(), 1200);
}
function shake(el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }

function confetti(n = 140) {
  const c = $('#confetti'), ctx = c.getContext('2d');
  c.width = innerWidth; c.height = innerHeight;
  const colors = ['#7c5cff', '#ff5ca8', '#2ee59d', '#ffc85c', '#5cc8ff'];
  const ps = Array.from({ length: n }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 200, y: innerHeight / 2,
    vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 16 - 4, s: Math.random() * 7 + 4,
    r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: colors[(Math.random() * colors.length) | 0],
  }));
  let frame = 0;
  (function tick() {
    ctx.clearRect(0, 0, c.width, c.height);
    ps.forEach((p) => { p.vy += 0.4; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vx *= 0.99;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); });
    if (++frame < 160) requestAnimationFrame(tick); else ctx.clearRect(0, 0, c.width, c.height);
  })();
}

/* ============================== PROGRESS / XP ============================== */
const levelOf = (xp) => { let lvl = 1, need = 100, acc = 0; while (xp >= acc + need) { acc += need; lvl++; need = Math.round(need * 1.25); } return { lvl, into: xp - acc, need }; };
function addXP(n, el) {
  const before = levelOf(S.stats.xp).lvl;
  const d = today();
  if (S.stats.lastDay !== d) {
    S.stats.streak = S.stats.lastDay === dayOffset(-1) ? S.stats.streak + 1 : 1;
    S.stats.lastDay = d;
    if (S.stats.streak > 1) toast(`🔥 ${S.stats.streak} günlük seri! Devam!`);
  }
  const prevToday = S.stats.history[d] || 0;
  S.stats.xp += n; S.stats.history[d] = prevToday + n;
  if (prevToday < S.settings.dailyGoal && prevToday + n >= S.settings.dailyGoal) { setTimeout(() => { toast('🎯 Günlük hedef tamamlandı!'); confetti(80); sfx.level(); }, 500); }
  save(); xpFloat(n, el); renderHud(true);
  const after = levelOf(S.stats.xp).lvl;
  if (after > before) setTimeout(() => { toast(`⭐ Seviye atladın! Seviye ${after}`); confetti(); sfx.level(); }, 300);
}
function renderHud(pulse) {
  const l = levelOf(S.stats.xp);
  $('#hudLevel').textContent = l.lvl;
  $('#hudXpFill').style.width = `${(l.into / l.need) * 100}%`;
  const streakAlive = S.stats.lastDay === today() || S.stats.lastDay === dayOffset(-1);
  $('#hudStreak').textContent = streakAlive ? S.stats.streak : 0;
  const due = dueCards().length, b = $('#dueBadge');
  b.textContent = due; b.classList.toggle('hidden', !due);
  if (pulse) $$('.hud-item').forEach((h) => { h.classList.remove('pulse'); void h.offsetWidth; h.classList.add('pulse'); });
}

/* ============================== EXTERNAL APIS ============================== */
async function lrcSearch(q) {
  const r = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error('LRCLIB hata ' + r.status);
  return r.json();
}
function parseLRC(lrc) {
  const out = [];
  lrc.split(/\r?\n/).forEach((row) => {
    const stamps = [...row.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) return;
    const text = row.replace(/\[[^\]]*\]/g, '').trim();
    stamps.forEach((m) => out.push({ t: +m[1] * 60 + +m[2], text }));
  });
  return out.sort((a, b) => a.t - b.t);
}
const trCache = new Map();
// Returns { text, alts: [{ pos, terms }] }. Google's public endpoint first, MyMemory as fallback.
async function translateFull(text) {
  const key = text.toLowerCase();
  if (trCache.has(key)) return trCache.get(key);
  let res;
  try {
    const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=tr&dt=t&dt=bd&q=${encodeURIComponent(text)}`);
    if (!r.ok) throw 0;
    const d = await r.json();
    res = { text: (d[0] || []).map((s) => s[0]).join(''), alts: (d[1] || []).map((b) => ({ pos: b[0], terms: b[1].slice(0, 5) })) };
  } catch {
    res = { text: await translateMM(text), alts: [] };
  }
  trCache.set(key, res); return res;
}
const translate = async (text) => (await translateFull(text)).text;
async function translateMM(text) {
  const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|tr`);
  const d = await r.json();
  let best = d?.responseData?.translatedText || '';
  // MyMemory sometimes returns an uppercased / weird match; prefer a human match when available
  const m = (d.matches || []).filter((x) => x.translation && x.quality >= 70).sort((a, b) => b.match - a.match)[0];
  if (m && /[A-ZÇĞİÖŞÜ]{4,}/.test(best)) best = m.translation;
  return best.replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}
const defCache = new Map();
async function define(word) {
  if (defCache.has(word)) return defCache.get(word);
  try {
    const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (!r.ok) throw 0;
    const d = (await r.json())[0];
    const res = {
      phonetic: d.phonetic || d.phonetics?.find((p) => p.text)?.text || '',
      defs: d.meanings.slice(0, 3).map((m) => ({ pos: m.partOfSpeech, def: m.definitions[0]?.definition, ex: m.definitions[0]?.example })),
    };
    defCache.set(word, res); return res;
  } catch { defCache.set(word, null); return null; }
}
function speak(text, rate = 0.9) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = rate;
    const v = speechSynthesis.getVoices().find((v) => /en[-_]US/i.test(v.lang)); if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch {}
}
function ytId(input) {
  input = (input || '').trim();
  if (/^[\w-]{11}$/.test(input)) return input;
  const m = input.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([\w-]{11})/);
  return m ? m[1] : null;
}
const ytThumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

/* ============================== YOUTUBE PLAYER ============================== */
let ytReady = null;
function loadYT() {
  if (ytReady) return ytReady;
  ytReady = new Promise((res) => {
    if (window.YT?.Player) return res();
    window.onYouTubeIframeAPIReady = res;
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
  });
  return ytReady;
}

/* ============================== WORD POPOVER ============================== */
let popCtx = null;
async function openWord(word, ctxLine, songId, anchor) {
  word = norm(word); if (!word) return;
  sfx.pop();
  const pop = $('#wordPop');
  popCtx = { word, ctxLine, songId };
  const saved = !!S.vocab[word];
  pop.innerHTML = `
    <div class="sheet-grip"></div>
    <div class="wp-word">${esc(word)} <button class="btn icon sm ghost" data-a="say" title="Dinle">🔊</button><span class="wp-ph" id="wpPh"></span></div>
    <div class="wp-tr" id="wpTr"><span class="spinner"></span></div>
    <div class="wp-def" id="wpDef"></div>
    <div class="row">
      <button class="btn sm ${saved ? '' : 'primary'}" data-a="save">${saved ? '✓ Defterde' : '＋ Deftere ekle'}</button>
      <span class="spacer"></span><button class="btn sm ghost" data-a="close">Kapat</button>
    </div>`;
  pop.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  const x = Math.min(innerWidth - 336, Math.max(16, r.left + r.width / 2 - 160));
  const below = r.bottom + 10 + 260 < innerHeight;
  pop.style.left = `${x}px`; pop.style.top = below ? `${r.bottom + 10}px` : `${Math.max(16, r.top - 270)}px`;
  speak(word);
  const [trf, def] = await Promise.all([translateFull(word).catch(() => ({ text: '—', alts: [] })), define(word)]);
  if (popCtx?.word !== word) return;
  const tr = trf.text;
  popCtx.tr = tr; popCtx.def = def;
  $('#wpTr').innerHTML = esc(tr || '—') + (trf.alts.length ? `<div class="small muted" style="font-weight:500;margin-top:4px">${trf.alts.map((a) => `<i style="color:#b9a9ff;font-style:normal">${esc(a.pos)}:</i> ${esc(a.terms.join(', '))}`).join('<br>')}</div>` : '');
  if (def) {
    $('#wpPh').textContent = def.phonetic;
    $('#wpDef').innerHTML = def.defs.map((d) => `<div><i>${esc(d.pos)}</i> ${esc(d.def)}</div>`).join('');
  }
}
$('#wordPop').addEventListener('click', (e) => {
  const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
  if (a === 'close') closeWord();
  if (a === 'say') speak(popCtx.word);
  if (a === 'save' && popCtx && !S.vocab[popCtx.word]) {
    S.vocab[popCtx.word] = {
      word: popCtx.word, tr: popCtx.tr || '', def: popCtx.def?.defs?.[0]?.def || '', ctx: popCtx.ctxLine || '',
      song: S.songs[popCtx.songId] ? `${S.songs[popCtx.songId].artist} – ${S.songs[popCtx.songId].title}` : '',
      box: 0, due: Date.now(), added: Date.now(),
    };
    save(); sfx.save(); renderHud();
    e.target.textContent = '✓ Defterde'; e.target.classList.remove('primary');
    toast(`📒 <b>${esc(popCtx.word)}</b> deftere eklendi`);
  }
});
function closeWord() { $('#wordPop').classList.add('hidden'); popCtx = null; }
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#wordPop') && !e.target.closest('.w')) closeWord(); });
// Delegated: any .w span opens the popover
document.addEventListener('click', (e) => {
  const w = e.target.closest('.w'); if (!w) return;
  e.stopPropagation();
  openWord(w.textContent, w.dataset.ctx || w.closest('[data-line]')?.dataset.line || '', current.song?.id, w);
});
const wordsHTML = (text) => esc(text).split(/(\s+)/).map((p) => (/\S/.test(p) && norm(p) ? `<span class="w">${p}</span>` : p)).join('');

/* ============================== ROUTER ============================== */
const app = $('#app');
let current = { view: null, song: null, cleanup: null };
function route() {
  closeWord();
  current.cleanup?.(); current.cleanup = null;
  const [, view = '', arg] = location.hash.split('/');
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === (view || 'home')));
  document.body.classList.toggle('playing', view === 'play');
  window.scrollTo(0, 0);
  if (view === 'add') return viewAdd();
  if (view === 'vocab') return viewVocab();
  if (view === 'play' && S.songs[arg]) return viewPlay(S.songs[arg]);
  return viewHome();
}
addEventListener('hashchange', route);

/* ============================== HOME ============================== */
function songProgress(song) {
  const n = practiceIdx(song).length || 1;
  const done = new Set([...(song.done?.pick || []), ...(song.done?.type || []), ...(song.done?.gap || [])]);
  return Math.round(Math.min(1, done.size / n) * 100);
}
function viewHome() {
  const st = S.stats, todayXp = st.history[today()] || 0;
  const goalP = Math.min(100, Math.round((todayXp / S.settings.dailyGoal) * 100));
  const week = Array.from({ length: 7 }, (_, i) => { const d = dayOffset(i - 6); return { d, xp: st.history[d] || 0 }; });
  const maxW = Math.max(S.settings.dailyGoal, ...week.map((w) => w.xp));
  const songs = Object.values(S.songs).sort((a, b) => (b.lastPlayed || b.created) - (a.lastPlayed || a.created));
  const acc = st.attempts ? Math.round((st.correct / st.attempts) * 100) : 0;
  const dayNames = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
  app.innerHTML = `
  <div class="view">
    <div class="hero">
      <div class="card hero-main">
        <h1>Şarkılarla İngilizce 🎶</h1>
        <p>Sevdiğin şarkıyı YouTube'dan aç; her satırdan sonra şarkı durur, sen de kelimeleri seçerek ya da yazarak cümleyi tamamla. Bilmediğin kelimeye tıkla, çevirisini gör, deftere ekle ve kartlarla tekrar et.</p>
        <div class="row" style="margin-top:16px">
          <a class="btn primary" href="#/add">＋ Şarkı ekle</a>
          <a class="btn" href="#/vocab">📒 Kelime tekrarı ${dueCards().length ? `<span class="badge">${dueCards().length}</span>` : ''}</a>
        </div>
      </div>
      <div class="card">
        <div class="goal">
          <div class="ring" style="--p:${goalP}"><div>${todayXp}/${S.settings.dailyGoal}</div></div>
          <div><h3>Günlük hedef</h3><div class="muted small">${goalP >= 100 ? 'Bugünkü hedef tamam! 🎉' : `Hedefe ${S.settings.dailyGoal - todayXp} XP kaldı`}</div>
            <div class="row small" style="margin-top:6px"><span class="muted">Hedef:</span>
              <select id="goalSel" class="input" style="width:auto;padding:4px 8px">${[30, 60, 100, 150, 250].map((g) => `<option ${g === S.settings.dailyGoal ? 'selected' : ''}>${g}</option>`).join('')}</select> XP</div>
          </div>
        </div>
        <div class="week">${week.map((w) => `<div class="bar" title="${w.d}: ${w.xp} XP"><i style="height:${(w.xp / maxW) * 100}%"></i><span>${dayNames[new Date(w.d).getDay()]}</span></div>`).join('')}</div>
        <div class="stats" style="margin-top:14px">
          <div class="stat"><b>${st.lines}</b><span>Tamamlanan satır</span></div>
          <div class="stat"><b>%${acc}</b><span>İlk denemede doğruluk</span></div>
          <div class="stat"><b>${Object.keys(S.vocab).length}</b><span>Defterdeki kelime</span></div>
          <div class="stat"><b>${st.xp}</b><span>Toplam XP</span></div>
        </div>
      </div>
    </div>
    <div class="row" style="margin-bottom:14px"><h2 style="margin:0">Şarkılarım</h2><span class="spacer"></span>
      <label class="toggle"><input type="checkbox" id="sndTog" ${S.settings.sound ? 'checked' : ''}><span class="sw"></span>Ses efektleri</label></div>
    ${songs.length ? `<div class="songs">${songs.map((s) => `
      <div class="card song" data-id="${s.id}">
        <div class="thumb" style="background-image:url('${s.videoId ? ytThumb(s.videoId) : ''}')"><div class="play">▶</div><button class="del" data-del="${s.id}">Sil</button></div>
        <div class="body"><div class="title">${esc(s.title)}</div><div class="artist">${esc(s.artist)}</div>
          <div class="prog"><div style="width:${songProgress(s)}%"></div></div>
          <div class="small muted" style="margin-top:6px">%${songProgress(s)} tamamlandı · ${practiceIdx(s).length} satır</div></div>
      </div>`).join('')}</div>`
    : `<div class="card empty"><div class="big">🎤</div><h3>Henüz şarkı yok</h3><p>İlk şarkını ekleyerek başla.</p><a class="btn primary" href="#/add">＋ Şarkı ekle</a></div>`}
    <div class="card backup" style="margin-top:24px">
      <h2>💾 Yedekle / Geri yükle</h2>
      <p class="muted small" style="margin-top:-6px">Şarkıların, kelimelerin ve XP'n sadece bu cihazda duruyor. Başka cihaza (ör. bilgisayar ↔ iPhone) aktarmak için yedek al, öbür cihazda yükle. Yükleme mevcut verilerle <b>birleştirir</b>, hiçbir şey silinmez.</p>
      <div class="row">
        <button class="btn primary" id="bkExport">📤 Yedeği dışa aktar</button>
        <label class="btn" for="bkFile">📥 Yedek dosyası yükle</label><input type="file" id="bkFile" accept=".json,application/json" hidden>
        <button class="btn" id="bkCopy">📋 Yedek kodunu kopyala</button>
      </div>
      <details style="margin-top:12px"><summary class="muted small" style="cursor:pointer">Yedek kodunu yapıştırarak yükle</summary>
        <textarea class="input" id="bkText" style="min-height:90px;margin-top:10px" placeholder="Kopyaladığın yedek kodunu buraya yapıştır"></textarea>
        <button class="btn" id="bkPaste" style="margin-top:8px">Yükle</button>
      </details>
    </div>
    <div class="row small muted" style="justify-content:center;margin-top:18px">
      <span>Lyricly · Sürüm ${APP_VERSION}${iosVer ? ` · iOS ${iosVer}` : ''}</span><button class="btn sm ghost" id="hardRefresh">🔄 Uygulamayı güncelle</button>
    </div>
  </div>`;
  bindBackup();
  $('#hardRefresh').onclick = hardRefresh;
  $('#goalSel').onchange = (e) => { S.settings.dailyGoal = +e.target.value; save(); viewHome(); };
  $('#sndTog').onchange = (e) => { S.settings.sound = e.target.checked; save(); sfx.click(); };
  $$('.song').forEach((el) => el.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { e.stopPropagation(); if (confirm('Bu şarkı silinsin mi?')) { delete S.songs[del.dataset.del]; save(); viewHome(); } return; }
    sfx.click(); location.hash = `#/play/${el.dataset.id}`;
  }));
}

/* ============================== ADD SONG ============================== */
function viewAdd() {
  let picked = null; // { title, artist, lines, synced, duration }
  app.innerHTML = `
  <div class="view" style="max-width:860px;margin:0 auto">
    <h1>Şarkı ekle</h1><p class="muted">Önce sözleri bul, sonra şarkının YouTube linkini yapıştır.</p>
    <div class="steps"><div class="st on" id="st1">1 · Sözleri bul</div><div class="st" id="st2">2 · YouTube videosu</div></div>
    <div class="card" id="step1">
      <div class="row"><input class="input" id="q" placeholder="Şarkı adı ve/veya sanatçı… ör. Coldplay Yellow" style="flex:1"><button class="btn primary" id="searchBtn">Ara</button></div>
      <div class="small muted" style="margin-top:8px">Sözler <b>LRCLIB</b> veritabanından gelir. <span class="tag sync">senkronlu</span> olanlar satır satır otomatik durdurmayı destekler.</div>
      <div class="results" id="results"></div>
      <details style="margin-top:16px"><summary class="muted" style="cursor:pointer">Bulamadın mı? Sözleri kendin yapıştır</summary>
        <div class="grid" style="margin-top:12px">
          <div class="row"><input class="input" id="mTitle" placeholder="Şarkı adı" style="flex:1"><input class="input" id="mArtist" placeholder="Sanatçı" style="flex:1"></div>
          <textarea class="input" id="mLyrics" placeholder="Her satıra bir cümle gelecek şekilde sözleri yapıştır. (LRC formatı [00:12.34] da desteklenir.)"></textarea>
          <div class="small muted">Zaman bilgisi yoksa, şarkıyı dinlerken her satırın başladığı anda tuşa basarak senkronlayacaksın (bir kerelik, ~3 dk).</div>
          <div><button class="btn" id="manualBtn">Devam →</button></div>
        </div>
      </details>
    </div>
    <div class="card hidden" id="step2">
      <div id="pickedInfo"></div>
      <div class="row" style="margin-top:14px"><input class="input" id="yt" placeholder="YouTube linki (https://www.youtube.com/watch?v=...)" style="flex:1">
        <a class="btn" id="ytSearch" target="_blank" rel="noopener">🔎 YouTube'da ara</a></div>
      <div class="small muted" style="margin-top:8px">İpucu: Resmî klip gömülmeye kapalıysa "audio" veya "lyrics" sürümünü dene. Lyrics videolarında sözleri gizlemek için oynatıcıda <b>“Videoyu gizle”</b> seçeneği var.</div>
      <div id="ytPrev"></div>
      <div class="row" style="margin-top:16px"><button class="btn" id="back">← Geri</button><span class="spacer"></span><button class="btn primary" id="saveSong" disabled>Kaydet ve başla ▶</button></div>
    </div>
  </div>`;
  const doSearch = async () => {
    const q = $('#q').value.trim(); if (!q) return;
    const box = $('#results'); box.innerHTML = '<div class="muted"><span class="spinner"></span> Aranıyor…</div>';
    try {
      const res = (await lrcSearch(q)).filter((r) => !r.instrumental && (r.syncedLyrics || r.plainLyrics))
        .sort((a, b) => (!!b.syncedLyrics - !!a.syncedLyrics)).slice(0, 25);
      if (!res.length) { box.innerHTML = '<div class="muted">Sonuç yok. Farklı yazmayı dene veya sözleri kendin yapıştır.</div>'; return; }
      box.innerHTML = res.map((r, i) => `<button class="result" data-i="${i}"><div class="meta"><b>${esc(r.trackName)}</b><span class="small muted">${esc(r.artistName)} · ${esc(r.albumName || '')} · ${fmtTime(r.duration || 0)}</span></div>
        <span class="tag ${r.syncedLyrics ? 'sync' : 'plain'}">${r.syncedLyrics ? 'senkronlu' : 'düz metin'}</span></button>`).join('');
      $$('.result', box).forEach((b) => b.onclick = () => {
        const r = res[b.dataset.i]; sfx.click();
        const lines = r.syncedLyrics ? parseLRC(r.syncedLyrics) : r.plainLyrics.split(/\r?\n/).map((t) => t.trim()).filter(Boolean).map((text) => ({ t: null, text }));
        goStep2({ title: r.trackName, artist: r.artistName, lines, synced: !!r.syncedLyrics });
      });
    } catch (e) { box.innerHTML = `<div class="muted">Arama başarısız: ${esc(e.message)}. İnternet bağlantını kontrol et.</div>`; }
  };
  $('#searchBtn').onclick = doSearch;
  // NB: must not return false for other keys — an on* handler returning false cancels the keystroke
  $('#q').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#q').blur(); doSearch(); } };
  if (!isTouch) $('#q').focus(); // iPhone: programmatic focus without a tap can leave the field dead
  $('#manualBtn').onclick = () => {
    const raw = $('#mLyrics').value.trim(), title = $('#mTitle').value.trim() || 'Adsız şarkı', artist = $('#mArtist').value.trim() || '';
    if (!raw) return toast('Önce sözleri yapıştır');
    const isLrc = /\[\d+:\d+/.test(raw);
    const lines = isLrc ? parseLRC(raw) : raw.split(/\r?\n/).map((t) => t.trim()).filter(Boolean).map((text) => ({ t: null, text }));
    goStep2({ title, artist, lines, synced: isLrc });
  };
  function goStep2(p) {
    picked = p;
    $('#step1').classList.add('hidden'); $('#step2').classList.remove('hidden');
    $('#st1').classList.remove('on'); $('#st2').classList.add('on');
    const sample = p.lines.filter((l) => l.text).slice(0, 8).map((l) => l.text).join('\n');
    $('#pickedInfo').innerHTML = `<h2>${esc(p.title)} <span class="muted" style="font-weight:500">— ${esc(p.artist)}</span></h2>
      <span class="tag ${p.synced ? 'sync' : 'plain'}">${p.synced ? 'senkronlu sözler ✓' : 'düz metin — ilk açılışta senkronlayacaksın'}</span>
      <div class="preview-lyrics" style="margin-top:10px">${esc(sample)}\n…</div>`;
    $('#ytSearch').href = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${p.artist} ${p.title} lyrics`)}`;
    if (!isTouch) $('#yt').focus();
  }
  $('#yt').oninput = () => {
    const id = ytId($('#yt').value);
    $('#saveSong').disabled = !id;
    $('#ytPrev').innerHTML = id ? `<div class="yt-preview" style="background-image:url('${ytThumb(id)}')"></div>` : '';
  };
  $('#back').onclick = () => { $('#step2').classList.add('hidden'); $('#step1').classList.remove('hidden'); $('#st2').classList.remove('on'); $('#st1').classList.add('on'); };
  $('#saveSong').onclick = () => {
    const id = uid();
    S.songs[id] = { id, title: picked.title, artist: picked.artist, videoId: ytId($('#yt').value), lines: picked.lines, synced: picked.synced, offset: 0, done: { pick: [], type: [], gap: [] }, pos: { pick: 0, type: 0, gap: 0 }, created: Date.now() };
    save(); sfx.save(); toast('🎵 Şarkı kaydedildi');
    location.hash = `#/play/${id}`;
  };
}

/* ============================== PLAYER / PRACTICE ============================== */
const practiceIdx = (song) => song.lines.map((l, i) => (l.text && tokens(l.text).length ? i : -1)).filter((i) => i >= 0);
const MODES = [
  { id: 'listen', label: '🎧 Dinle & Oku' },
  { id: 'pick', label: '🧩 Kelime Seç' },
  { id: 'type', label: '⌨️ Dinle & Yaz' },
  { id: 'gap', label: '✏️ Boşluk Doldur' },
];
const XP = { pick: 10, type: 15, gap: 8 };

function viewPlay(song) {
  song.lastPlayed = Date.now(); song.done = song.done || { pick: [], type: [], gap: [] }; song.pos = song.pos || { pick: 0, type: 0, gap: 0 }; save();
  const P = { song, player: null, ready: false, mode: song.synced ? (song.lastMode || 'pick') : 'sync', stopAt: null, onStop: null, slow: false, curLine: -1, timer: null, idxs: practiceIdx(song), attempt: 0 };
  current.song = song;
  app.innerHTML = `
  <div class="view">
    <div class="player-head"><a class="btn icon ghost" href="#/">←</a><div><h1>${esc(song.title)}</h1><div class="muted small">${esc(song.artist)}</div></div></div>
    <div class="player-layout">
      <div>
        <div class="video-wrap"><div id="yt"></div>
          <div class="video-cover ${S.settings.hideVideo ? '' : 'hidden'}" id="cover"><div><div class="eq"><i></i><i></i><i></i><i></i></div>Video gizli — sadece dinle 🎧</div></div>
        </div>
        <div class="modes" id="modes"></div>
        <div class="card exercise" id="ex"></div>
      </div>
      <div class="side">
        <div class="card">
          <div class="row" style="margin-bottom:10px"><h3 style="margin:0">Sözler</h3><span class="spacer"></span>
            <label class="toggle" title="Henüz çözmediğin satırları bulanıklaştırır"><input type="checkbox" id="blurTog" ${S.settings.blurLyrics ? 'checked' : ''}><span class="sw"></span>Gizle</label></div>
          <div class="lyrics" id="lyrics"></div>
        </div>
        <div class="card sync-panel">
          <div class="row" style="margin-bottom:8px">
            <label class="toggle"><input type="checkbox" id="hideTog" ${S.settings.hideVideo ? 'checked' : ''}><span class="sw"></span>Videoyu gizle</label><span class="spacer"></span>
            <label class="toggle"><input type="checkbox" id="slowTog"><span class="sw"></span>Yavaş (0.75x)</label>
          </div>
          <div class="small muted" style="margin:10px 0 6px">Senkron ayarı — sözler erken/geç kalıyorsa düzelt:</div>
          <div class="row"><button class="btn sm" data-off="-0.5">-0.5</button><button class="btn sm" data-off="-0.1">-0.1</button>
            <span class="offset-val" id="offVal"></span><button class="btn sm" data-off="0.1">+0.1</button><button class="btn sm" data-off="0.5">+0.5</button></div>
          <div class="row" style="margin-top:8px"><button class="btn sm" id="alignBtn" title="Şarkıyı baştan çal, ilk satır söylendiği anda bas">🎯 İlk satırı yakala</button>
            <button class="btn sm ghost" id="resync">⟲ Elle yeniden senkronla</button></div>
        </div>
      </div>
    </div>
  </div>`;

  /* ---------- player ---------- */
  loadYT().then(() => {
    if (current.song !== song) return;
    P.player = new YT.Player('yt', {
      videoId: song.videoId,
      playerVars: { rel: 0, modestbranding: 1, playsinline: 1, cc_load_policy: 0, iv_load_policy: 3, origin: location.origin },
      events: {
        onReady: () => { P.ready = true; renderMode(); },
        onStateChange: (e) => {
          // YouTube's own subtitles would give the answer away — turn them off
          if (e.data === 1 && P.mode !== 'listen') { try { P.player.unloadModule('captions'); P.player.unloadModule('cc'); } catch {} }
          $('#cover')?.classList.toggle('paused', e.data !== 1); if (P.mode === 'listen' || P.mode === 'sync') renderMode.tick?.(); },
        onError: (e) => {
          const msg = { 2: 'Geçersiz video linki.', 5: 'Video oynatılamadı.', 100: 'Video bulunamadı veya kaldırılmış.', 101: 'Bu video başka sitelerde oynatılmaya izin vermiyor.', 150: 'Bu video başka sitelerde oynatılmaya izin vermiyor.', 153: 'Video oynatıcısı yapılandırma hatası (sayfayı http://localhost üzerinden aç).' }[e.data] || 'Video hatası: ' + e.data;
          const err = document.createElement('div'); err.className = 'yt-error';
          err.innerHTML = `<div><b>⚠️ ${msg}</b><br><span class="muted small">Aynı şarkının "lyrics" ya da "audio" videosunu dene.</span>
            <div class="row" style="justify-content:center;margin-top:12px"><input class="input" id="newYt" placeholder="Yeni YouTube linki" style="max-width:320px"><button class="btn primary" id="newYtBtn">Değiştir</button></div></div>`;
          $('.video-wrap').appendChild(err);
          $('#newYtBtn').onclick = () => { const id = ytId($('#newYt').value); if (!id) return; song.videoId = id; save(); route(); };
        },
      },
    });
  });
  const now = () => (P.ready ? P.player.getCurrentTime() : 0);
  const lineStart = (i) => song.lines[i].t + song.offset;
  function lineEnd(i) {
    const st = song.lines[i].t; let nx = song.lines[i + 1]?.t;
    const est = st + Math.max(2.5, tokens(song.lines[i].text).length * 0.55 + 1.5);
    if (nx == null || nx - st > 12) nx = Math.min(nx ?? Infinity, est + 2);
    return nx + song.offset - 0.08;
  }
  function playLine(i, onStop) {
    if (!P.ready) return toast('Video yükleniyor…');
    P.player.setPlaybackRate(P.slow ? S.settings.slowRate : 1);
    P.player.seekTo(Math.max(0, lineStart(i) - 0.25), true);
    P.player.playVideo();
    P.stopAt = lineEnd(i); P.onStop = onStop || null; P.wantPlay = Date.now();
    setListening(true);
  }
  function setListening(on) { const d = $('#listenDot'); if (d) { d.classList.toggle('live', on); $('#listenTxt').textContent = on ? 'Dinleniyor…' : 'Durdu'; } }
  P.timer = setInterval(() => {
    if (!P.ready) return;
    const t = now();
    // Mobile browsers block programmatic playback until the user taps the video once
    const st = P.player.getPlayerState?.();
    if (st === 1) { P.wantPlay = null; $('.tap-start')?.remove(); }
    else if (P.wantPlay && st !== 3 && Date.now() - P.wantPlay > 1500 && !$('.tap-start')) {
      $('.video-wrap')?.insertAdjacentHTML('beforeend', '<div class="tap-start"><div>▶ Başlatmak için videoya dokun</div></div>');
      $('.video-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (P.stopAt != null && t >= P.stopAt) {
      P.player.pauseVideo(); P.stopAt = null; setListening(false);
      const cb = P.onStop; P.onStop = null; cb?.();
    }
    // highlight current sung line in the side panel
    if (P.player.getPlayerState?.() === 1 && song.synced) {
      let cur = -1; for (let i = 0; i < song.lines.length; i++) if (lineStart(i) <= t + 0.05) cur = i; else break;
      if (cur !== P.curLine) { P.curLine = cur; highlightLine(cur); renderMode.onLine?.(cur); }
    }
  }, 40);
  current.cleanup = () => { clearInterval(P.timer); try { P.player?.destroy(); } catch {} document.removeEventListener('keydown', onKey); current.song = null; };

  /* ---------- side panel ---------- */
  function renderLyrics() {
    const doneAll = new Set([...song.done.pick, ...song.done.type, ...song.done.gap]);
    $('#lyrics').innerHTML = song.lines.map((l, i) => l.text ? `<div class="ln ${doneAll.has(i) ? 'done-line' : ''}" data-i="${i}" data-line="${esc(l.text)}"><span class="chk">${doneAll.has(i) ? '✓' : ''}</span><span class="txt">${wordsHTML(l.text)}</span></div>` : '').join('');
    $('#lyrics').classList.toggle('blurred', S.settings.blurLyrics && P.mode !== 'listen');
    $$('#lyrics .ln').forEach((el) => el.addEventListener('click', (e) => {
      if (e.target.closest('.w')) return;
      const i = +el.dataset.i;
      if (P.mode === 'listen') { playFrom(i); return; }
      if (['pick', 'type', 'gap'].includes(P.mode)) { const k = P.idxs.indexOf(i); if (k >= 0) { song.pos[P.mode] = k; save(); renderMode(); } }
    }));
  }
  function highlightLine(i) {
    $$('#lyrics .ln').forEach((el) => el.classList.toggle('cur', +el.dataset.i === i));
    const el = $(`#lyrics .ln[data-i="${i}"]`);
    if (el) { const box = $('#lyrics'); box.scrollTop = el.offsetTop - box.offsetTop - box.clientHeight / 3; }
  }
  function playFrom(i) { if (!P.ready) return; P.stopAt = null; P.player.setPlaybackRate(P.slow ? S.settings.slowRate : 1); P.player.seekTo(Math.max(0, lineStart(i) - 0.2), true); P.player.playVideo(); }

  $('#blurTog').onchange = (e) => { S.settings.blurLyrics = e.target.checked; save(); renderLyrics(); };
  $('#hideTog').onchange = (e) => { S.settings.hideVideo = e.target.checked; save(); $('#cover').classList.toggle('hidden', !e.target.checked); };
  $('#slowTog').onchange = (e) => { P.slow = e.target.checked; if (P.ready) P.player.setPlaybackRate(P.slow ? S.settings.slowRate : 1); sfx.click(); };
  const showOff = () => ($('#offVal').textContent = `${song.offset >= 0 ? '+' : ''}${song.offset.toFixed(1)} sn`);
  showOff();
  $$('[data-off]').forEach((b) => b.onclick = () => { song.offset = Math.round((song.offset + +b.dataset.off) * 10) / 10; save(); showOff(); sfx.click(); });
  $('#alignBtn').onclick = () => {
    if (!P.ready || !song.synced) return;
    const first = P.idxs[0];
    if (P.alignArmed) {
      song.offset = Math.round((now() - song.lines[first].t) * 10) / 10; P.alignArmed = false; save(); showOff();
      $('#alignBtn').textContent = '🎯 İlk satırı yakala'; toast(`Senkron ayarlandı: ${song.offset.toFixed(1)} sn`); sfx.good();
    } else {
      P.alignArmed = true; P.stopAt = null; P.player.seekTo(Math.max(0, song.lines[first].t + song.offset - 8), true); P.player.playVideo();
      $('#alignBtn').textContent = '👉 Şimdi söylendi! (bas)';
      toast(`İlk satır söylendiği an butona bas: “${esc(song.lines[first].text)}”`, 5000);
    }
  };
  $('#resync').onclick = () => { if (confirm('Satır zamanlarını baştan elle kaydetmek ister misin?')) { P.mode = 'sync'; renderModes(); renderMode(); } };

  /* ---------- modes ---------- */
  function renderModes() {
    const list = song.synced ? MODES : [{ id: 'sync', label: '⏱️ Senkronla' }];
    $('#modes').innerHTML = list.map((m) => `<button data-m="${m.id}" class="${m.id === P.mode ? 'on' : ''}">${m.label}</button>`).join('') +
      (song.synced && P.mode === 'sync' ? `<button data-m="sync" class="on">⏱️ Senkronla</button>` : '');
    $$('#modes button').forEach((b) => b.onclick = () => { if (b.dataset.m === P.mode) return; sfx.click(); P.mode = b.dataset.m; if (P.mode !== 'sync') song.lastMode = P.mode; save(); P.stopAt = null; if (P.ready) P.player.pauseVideo(); renderModes(); renderMode(); });
  }
  function renderMode() {
    renderMode.onLine = null; renderMode.tick = null; P.attempt = 0;
    renderLyrics();
    if (!P.ready) { $('#ex').innerHTML = '<div class="empty"><span class="spinner"></span><p>Video yükleniyor…</p></div>'; return; }
    ({ listen: modeListen, pick: modePick, type: modeType, gap: modeGap, sync: modeSync })[P.mode]();
  }

  // ---- shared exercise chrome
  function exFrame(k, prompt, inner) {
    const total = P.idxs.length;
    return `<div class="ex-top"><span class="line-count">Satır ${k + 1} / ${total}</span>
        <div class="prog" style="flex:1"><div style="width:${(song.done[P.mode].length / total) * 100}%"></div></div>
        <div class="listen-state"><span class="dot" id="listenDot"></span><span id="listenTxt">Durdu</span></div></div>
      <div class="ex-prompt">${prompt}</div>${inner}
      <div class="feedback" id="fb"></div>
      <div class="ex-actions" id="acts">
        <button class="btn" id="replay" title="Tekrar dinle">🔁<span class="btn-label"> Tekrar dinle</span> <span class="kbd">Tab</span></button>
        <button class="btn ghost" id="prevL" ${k === 0 ? 'disabled' : ''} title="Önceki satır">←<span class="btn-label"> Önceki</span></button>
        <button class="btn ghost" id="skipL" title="Atla"><span class="btn-label">Atla </span>→</button>
        <span class="spacer"></span>
        <button class="btn primary" id="check">Kontrol et <span class="kbd">Enter</span></button>
      </div>`;
  }
  function bindCommon(k, i, checkFn) {
    $('#replay').onclick = () => { sfx.click(); playLine(i); };
    $('#prevL').onclick = () => { song.pos[P.mode] = Math.max(0, k - 1); save(); renderMode(); };
    $('#skipL').onclick = () => nextLine(k);
    $('#check').onclick = checkFn;
    playLine(i);
  }
  function nextLine(k) {
    if (k + 1 >= P.idxs.length) { song.pos[P.mode] = 0; save(); return showDone(); }
    song.pos[P.mode] = k + 1; save(); renderMode();
  }
  function curK() { let k = song.pos[P.mode] || 0; if (k >= P.idxs.length) k = 0; return k; }
  function succeed(k, i, el) {
    const first = P.attempt === 1;
    if (first) { S.stats.attempts++; S.stats.correct++; } S.stats.lines++;
    if (!song.done[P.mode].includes(i)) song.done[P.mode].push(i);
    const gain = Math.round(XP[P.mode] * (first ? 1.5 : 1));
    save(); sfx.good(); addXP(gain, el);
    const fb = $('#fb'); fb.className = 'feedback show ok';
    fb.innerHTML = `<b>${first ? '🎉 Mükemmel, ilk denemede!' : '✅ Doğru!'}</b><div class="full">${wordsHTML(song.lines[i].text)}</div><div class="tr" id="lineTr"></div>`;
    $('#acts').innerHTML = `<button class="btn" id="replay2" title="Dinle">🔁<span class="btn-label"> Dinle</span></button><button class="btn ghost" id="trBtn">TR Türkçesi</button><span class="spacer"></span><button class="btn good" id="next">Sonraki satır → <span class="kbd">Enter</span></button>`;
    $('#replay2').onclick = () => playLine(i);
    $('#trBtn').onclick = async () => { $('#lineTr').innerHTML = '<span class="spinner"></span>'; $('#lineTr').textContent = await translate(song.lines[i].text).catch(() => 'Çeviri alınamadı'); };
    $('#next').onclick = () => nextLine(k);
    P.awaitNext = () => nextLine(k);
    renderLyrics(); highlightLine(i);
  }
  function fail(el, html) {
    S.stats.attempts += P.attempt === 1 ? 1 : 0; save();
    sfx.bad(); shake(el);
    const fb = $('#fb'); fb.className = 'feedback show no'; fb.innerHTML = html;
  }
  function showDone() {
    confetti(); sfx.level();
    $('#ex').innerHTML = `<div class="done-card"><div class="big">🏆</div><h2>Şarkıyı bitirdin!</h2>
      <p class="muted">Bu modda ${song.done[P.mode].length}/${P.idxs.length} satırı doğru tamamladın.</p>
      <div class="row" style="justify-content:center"><button class="btn primary" id="again">Baştan başla</button>
      ${MODES.filter((m) => m.id !== P.mode && m.id !== 'listen').map((m) => `<button class="btn" data-go="${m.id}">${m.label}</button>`).join('')}</div></div>`;
    $('#again').onclick = () => renderMode();
    $$('[data-go]').forEach((b) => b.onclick = () => { P.mode = b.dataset.go; song.lastMode = P.mode; save(); renderModes(); renderMode(); });
  }

  // ---- 🎧 Listen & read (karaoke)
  function modeListen() {
    $('#ex').innerHTML = `<div class="karaoke"><div class="prev" id="kPrev"></div><div class="now" id="kNow">▶ Oynat'a bas ve şarkıyla birlikte oku</div><div class="next" id="kNext"></div></div>
      <div class="ex-actions" style="justify-content:center">
        <button class="btn primary" id="kPlay">▶ Oynat / Duraklat <span class="kbd">Space</span></button>
        <button class="btn" id="kBack">⏪ 5 sn</button><button class="btn" id="kRestart">⏮ Baştan</button>
      </div><p class="small muted" style="text-align:center;margin-top:16px">Bilmediğin kelimeye tıkla → anlamını gör, deftere ekle. Sağdaki bir satıra tıklayınca oraya atlar.</p>`;
    renderMode.onLine = (cur) => {
      const L = (j) => song.lines[j]?.text || '';
      const prevI = (() => { for (let j = cur - 1; j >= 0; j--) if (L(j)) return j; return -1; })();
      const nextI = (() => { for (let j = cur + 1; j < song.lines.length; j++) if (L(j)) return j; return -1; })();
      $('#kPrev').textContent = prevI >= 0 ? L(prevI) : '';
      const nowEl = $('#kNow'); nowEl.innerHTML = cur >= 0 && L(cur) ? wordsHTML(L(cur)) : '♪'; nowEl.dataset.line = L(cur);
      nowEl.style.animation = 'none'; void nowEl.offsetWidth; nowEl.style.animation = '';
      $('#kNext').textContent = nextI >= 0 ? L(nextI) : '';
    };
    $('#kPlay').onclick = () => { const st = P.player.getPlayerState(); st === 1 ? P.player.pauseVideo() : P.player.playVideo(); };
    $('#kBack').onclick = () => P.player.seekTo(Math.max(0, now() - 5), true);
    $('#kRestart').onclick = () => { P.player.seekTo(0, true); P.player.playVideo(); };
    P.stopAt = null;
  }

  // ---- 🧩 Word bank
  function modePick() {
    const k = curK(), i = P.idxs[k], target = tokens(song.lines[i].text);
    const targetSet = new Set(target.map(norm));
    const pool = [...new Set(P.idxs.flatMap((j) => tokens(song.lines[j].text)).filter((w) => !targetSet.has(norm(w))))];
    const nDis = Math.min(pool.length, target.length <= 3 ? 2 : target.length <= 7 ? 3 : 4);
    const chips = shuffle([...target.map((w) => ({ w, real: true })), ...shuffle(pool).slice(0, nDis).map((w) => ({ w, real: false }))]).map((c, n) => ({ ...c, id: n }));
    let chosen = [];
    $('#ex').innerHTML = exFrame(k, 'Dinle ve duyduğun kelimeleri doğru sırayla seç. <span class="muted">(Fazladan kelimeler de var!)</span>',
      `<div class="answer-zone" id="zone"></div><div class="bank" id="bank">${chips.map((c, n) => `<button class="chip" data-id="${c.id}" style="animation-delay:${n * 25}ms">${esc(c.w)}</button>`).join('')}</div>`);
    const draw = () => {
      $('#zone').innerHTML = chosen.map((c) => `<button class="chip" data-back="${c.id}">${esc(c.w)}</button>`).join('') || '<span class="muted small" style="padding:8px">Kelimelere tıklayarak cümleyi kur…</span>';
      $$('#bank .chip').forEach((b) => b.classList.toggle('used', chosen.some((c) => c.id === +b.dataset.id)));
      $$('#zone [data-back]').forEach((b) => b.onclick = () => { sfx.pop(); chosen = chosen.filter((c) => c.id !== +b.dataset.back); $('#zone').className = 'answer-zone'; draw(); });
    };
    $$('#bank .chip').forEach((b) => b.onclick = () => { sfx.click(); chosen.push(chips.find((c) => c.id === +b.dataset.id)); $('#zone').className = 'answer-zone'; draw(); });
    draw();
    P.backspace = () => { if (chosen.length) { chosen.pop(); sfx.pop(); draw(); } };
    bindCommon(k, i, () => {
      if (!chosen.length) return;
      P.attempt++;
      const ok = chosen.length === target.length && chosen.every((c, n) => norm(c.w) === norm(target[n]));
      if (ok) { $('#zone').className = 'answer-zone ok'; $('#bank').innerHTML = ''; P.backspace = null; return succeed(k, i, $('#zone')); }
      $('#zone').className = 'answer-zone no';
      // mark correct prefix
      $$('#zone .chip').forEach((el, n) => el.classList.add(norm(chosen[n].w) === norm(target[n] || '') ? 'c-ok' : 'c-no'));
      const hint = P.attempt >= 2 ? `<div class="small muted" style="margin-top:6px">İpucu: cümle <b>“${esc(target.slice(0, Math.min(target.length - 1, P.attempt)).join(' '))} …”</b> diye başlıyor.</div>` : '';
      fail($('#zone'), `<b>Tam değil.</b> Yeşiller doğru yerde. Tekrar dinleyip düzelt. ${hint}
        ${P.attempt >= 3 ? `<div class="row" style="margin-top:8px"><button class="btn sm" id="reveal">👀 Cevabı göster</button></div>` : ''}`);
      $('#reveal')?.addEventListener('click', () => { $('#fb').innerHTML = `<b>Doğru cevap:</b><div class="full">${wordsHTML(song.lines[i].text)}</div>`; });
    });
  }

  // ---- ⌨️ Dictation
  function modeType() {
    const k = curK(), i = P.idxs[k], target = tokens(song.lines[i].text);
    let hints = 0;
    $('#ex').innerHTML = exFrame(k, `Dinle ve duyduğun cümleyi yaz. <span class="muted">(${target.length} kelime · büyük/küçük harf ve noktalama önemsiz)</span>`,
      `<input class="input type-input" id="ans" enterkeyhint="go" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false" placeholder="Duyduğunu yaz…"><div class="diff" id="diff"></div>
       <div class="row" style="margin-top:10px"><button class="btn sm ghost" id="hintBtn">💡 Bir kelime ipucu</button></div>`);
    const inp = $('#ans'); if (!isTouch) setTimeout(() => inp.focus(), 50);
    $('#hintBtn').onclick = () => {
      const typed = tokens(inp.value), al = align(typed, target);
      // reveal the first missing/incorrect word in place
      const ok = []; for (const a of al) { if (a.type === 'ok' || a.type === 'near') ok.push(a.word); else if (a.type === 'miss') { ok.push(a.word); break; } }
      if (ok.length >= target.length && al.every((a) => a.type !== 'miss')) return;
      hints++; inp.value = ok.join(' ') + ' '; inp.focus(); sfx.pop();
    };
    bindCommon(k, i, () => {
      const typed = tokens(inp.value); if (!typed.length) return;
      P.attempt++;
      const al = align(typed, target);
      const ok = al.every((a) => a.type === 'ok' || a.type === 'near');
      $('#diff').innerHTML = al.map((a) => `<span class="${a.type}">${esc(a.type === 'miss' ? a.word : a.type === 'extra' ? a.word : a.typed)}</span>`).join('');
      if (ok) {
        inp.disabled = true; const nears = al.filter((a) => a.type === 'near');
        if (hints) P.attempt = 2; // hints cancel first-try bonus
        succeed(k, i, inp);
        if (nears.length) $('#fb').insertAdjacentHTML('afterbegin', `<div class="small" style="color:var(--warn);margin-bottom:6px">Küçük yazım hataları: ${nears.map((n) => `${esc(n.typed)} → <b>${esc(n.word)}</b>`).join(', ')}</div>`);
      } else {
        const hit = al.filter((a) => a.type === 'ok' || a.type === 'near').length;
        fail(inp, `<b>${hit}/${target.length} kelime doğru.</b> <span class="muted">Kırmızı kesikli olanlar eksik, üstü çizili olanlar fazla.</span>
          ${P.attempt >= 3 ? `<div class="row" style="margin-top:8px"><button class="btn sm" id="reveal">👀 Cevabı göster</button></div>` : ''}`);
        $('#reveal')?.addEventListener('click', () => { $('#fb').innerHTML = `<b>Doğru cevap:</b><div class="full">${wordsHTML(song.lines[i].text)}</div><div class="small muted">Şimdi kendin yazıp geç.</div>`; });
      }
    });
  }

  // ---- ✏️ Gap fill
  function modeGap() {
    const k = curK(), i = P.idxs[k], parts = song.lines[i].text.split(/(\s+)/);
    const cand = parts.map((p, n) => ({ n, w: clean(p) })).filter((x) => /\S/.test(parts[x.n]) && norm(x.w).length >= 3 && !STOP.has(norm(x.w)));
    const pool = cand.length ? cand : parts.map((p, n) => ({ n, w: clean(p) })).filter((x) => norm(x.w));
    const nGap = Math.max(1, Math.min(3, Math.round(pool.length / 3)));
    const gaps = new Set(shuffle(pool).slice(0, nGap).map((x) => x.n));
    const html = parts.map((p, n) => {
      if (!gaps.has(n)) return /\S/.test(p) ? wordsHTML(p) : p;
      const w = clean(p), pre = p.slice(0, p.indexOf(w)), post = p.slice(p.indexOf(w) + w.length);
      return `${esc(pre)}<input data-ans="${esc(w)}" style="width:${Math.max(3, w.length + 1)}ch" autocomplete="off" spellcheck="false">${esc(post)}`;
    }).join('');
    $('#ex').innerHTML = exFrame(k, 'Dinle ve boşlukları doldur. <span class="muted">(Boşluk kutusunun uzunluğu kelimenin uzunluğu kadar)</span>',
      `<div class="gap-line" data-line="${esc(song.lines[i].text)}">${html}</div>`);
    const ins = $$('.gap-line input'); if (!isTouch) setTimeout(() => ins[0]?.focus(), 50);
    ins.forEach((inp, n) => inp.addEventListener('keydown', (e) => { if (e.key === ' ' && ins[n + 1]) { e.preventDefault(); ins[n + 1].focus(); } }));
    bindCommon(k, i, () => {
      if (ins.every((x) => !x.value.trim())) return;
      P.attempt++;
      let all = true;
      ins.forEach((x) => { const ok = !!wordMatch(norm(x.value.trim()), norm(x.dataset.ans)); x.className = ok ? 'ok' : 'no'; if (ok) x.value = x.dataset.ans; all = all && ok; });
      if (all) { ins.forEach((x) => (x.disabled = true)); return succeed(k, i, $('.gap-line')); }
      fail($('.gap-line'), `<b>Kırmızı kutuları tekrar dene.</b> ${P.attempt >= 2 ? `<span class="muted">İpucu: ${ins.filter((x) => x.className === 'no').map((x) => `<b>${esc(x.dataset.ans[0])}${'_'.repeat(x.dataset.ans.length - 1)}</b>`).join(', ')}</span>` : ''}
        ${P.attempt >= 3 ? `<div class="row" style="margin-top:8px"><button class="btn sm" id="reveal">👀 Cevabı göster</button></div>` : ''}`);
      $('#reveal')?.addEventListener('click', () => ins.forEach((x) => { x.placeholder = x.dataset.ans; x.value = ''; x.className = ''; }));
      ins.find((x) => x.className === 'no')?.focus();
    });
  }

  // ---- ⏱️ Tap-to-sync
  function modeSync() {
    const textIdx = song.lines.map((l, n) => (l.text ? n : -1)).filter((n) => n >= 0);
    const lines = textIdx.map((n) => song.lines[n].text);
    let pos = 0; const times = [];
    $('#ex').innerHTML = `<h2>⏱️ Sözleri senkronla</h2>
      <p class="muted small">Şarkıyı baştan çal. Aşağıdaki satır <b>söylenmeye başladığı anda</b> <span class="kbd">Space</span>'e (veya büyük butona) bas. Yanlış basarsan <span class="kbd">Backspace</span> ile geri al. Bir kez yapınca şarkı tüm modlarda satır satır durur.</p>
      <div class="tap-next small" id="tPrev"></div><div class="tap-line" id="tLine"></div><div class="tap-next" id="tNext"></div>
      <div class="ex-actions sync-acts" style="justify-content:center">
        <button class="btn" id="tStart">▶ Baştan çal</button>
        <button class="btn primary" id="tTap" style="padding:16px 34px;font-size:16px">👆 Bu satır başladı <span class="kbd">Space</span></button>
        <button class="btn ghost" id="tUndo">↶ Geri al</button>
      </div><div class="prog" style="margin-top:14px"><div id="tProg" style="width:0"></div></div>`;
    const draw = () => {
      $('#tPrev').textContent = pos > 0 ? `✓ ${lines[pos - 1]}` : '';
      $('#tLine').textContent = lines[pos] ?? '🎉 Bitti!';
      $('#tNext').textContent = lines[pos + 1] ?? '';
      $('#tProg').style.width = `${(pos / lines.length) * 100}%`;
    };
    draw();
    $('#tStart').onclick = () => { pos = 0; times.length = 0; draw(); P.player.setPlaybackRate(1); P.player.seekTo(0, true); P.player.playVideo(); };
    const tap = () => {
      if (pos >= lines.length) return;
      if (P.player.getPlayerState() !== 1) return toast('Önce şarkıyı çal ▶');
      times[pos] = Math.max(0, now() - 0.15); pos++; sfx.click(); draw();
      if (pos >= lines.length) finish();
    };
    const undo = () => { if (pos > 0) { pos--; times.length = pos; draw(); sfx.pop(); } };
    function finish() {
      song.lines = textIdx.map((n, j) => ({ t: times[j], text: lines[j] }));
      song.synced = true; song.offset = 0; P.idxs = practiceIdx(song); save();
      P.player.pauseVideo(); confetti(); sfx.level(); toast('✅ Senkron kaydedildi! Artık alıştırmalar hazır.');
      P.mode = 'pick'; song.lastMode = 'pick'; save(); renderModes(); renderMode();
    }
    $('#tTap').onclick = tap; $('#tUndo').onclick = undo;
    P.syncKeys = { tap, undo };
  }

  /* ---------- keyboard ---------- */
  function onKey(e) {
    if (e.target.closest?.('#wordPop')) return;
    const inField = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && !e.target.disabled;
    if (e.key === 'Escape') return closeWord();
    if (P.mode === 'sync' && P.syncKeys && !inField) {
      if (e.code === 'Space') { e.preventDefault(); P.syncKeys.tap(); }
      if (e.key === 'Backspace') { e.preventDefault(); P.syncKeys.undo(); }
      return;
    }
    if (P.mode === 'listen' && e.code === 'Space' && !inField) { e.preventDefault(); $('#kPlay')?.click(); return; }
    if (e.key === 'Tab' && $('#replay, #replay2')) { e.preventDefault(); ($('#replay') || $('#replay2')).click(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if ($('#next')) return $('#next').click();
      $('#check')?.click();
    }
    if (e.key === 'Backspace' && !inField && P.mode === 'pick') { e.preventDefault(); P.backspace?.(); }
  }
  document.addEventListener('keydown', onKey);

  renderModes(); renderMode();
}

/* ============================== VOCAB / SRS ============================== */
const BOX_DAYS = [0, 1, 3, 7, 16, 35];
const dueCards = () => Object.values(S.vocab).filter((v) => v.due <= Date.now()).sort((a, b) => a.due - b.due);
function viewVocab() {
  const all = Object.values(S.vocab).sort((a, b) => b.added - a.added);
  let queue = shuffle(dueCards());
  app.innerHTML = `
  <div class="view">
    <h1>📒 Kelime Defteri</h1><p class="muted">Şarkılarda tıkladığın kelimeler burada. Aralıklı tekrar sistemiyle (Leitner) doğru zamanda karşına çıkar.</p>
    <div class="vocab-layout" style="margin-top:18px">
      <div class="card" id="review"></div>
      <div class="card">
        <div class="row" style="margin-bottom:12px"><h2 style="margin:0">Tüm kelimeler (${all.length})</h2><span class="spacer"></span><input class="input" id="vSearch" placeholder="Ara…" style="width:160px;padding:8px 12px"></div>
        <div class="vlist" id="vlist"></div>
      </div>
    </div>
  </div>`;
  const drawList = (f = '') => {
    const items = all.filter((v) => !f || v.word.includes(f) || (v.tr || '').toLowerCase().includes(f));
    $('#vlist').innerHTML = items.length ? items.map((v) => `<div class="vitem"><button class="btn icon sm ghost" data-say="${esc(v.word)}">🔊</button><span class="vw">${esc(v.word)}</span><span class="vt">${esc(v.tr)}</span>
      <span class="boxdots" title="Öğrenme seviyesi">${[1, 2, 3, 4, 5].map((n) => `<i class="${v.box >= n ? 'on' : ''}"></i>`).join('')}</span><button class="btn icon sm ghost danger" data-rm="${esc(v.word)}" title="Sil">✕</button></div>`).join('')
      : '<div class="empty"><div class="big">📭</div>Henüz kelime yok. Şarkı sözlerinde bir kelimeye tıklayıp “Deftere ekle” de.</div>';
    $$('[data-say]').forEach((b) => b.onclick = () => speak(b.dataset.say));
    $$('[data-rm]').forEach((b) => b.onclick = () => { delete S.vocab[b.dataset.rm]; save(); renderHud(); viewVocab(); });
  };
  drawList();
  $('#vSearch').oninput = (e) => drawList(e.target.value.toLowerCase().trim());

  let reviewed = 0;
  const drawCard = () => {
    const box = $('#review');
    const v = queue[0];
    if (!v) {
      const next = Object.values(S.vocab).sort((a, b) => a.due - b.due)[0];
      box.innerHTML = `<div class="empty"><div class="big">${reviewed ? '🎉' : '✨'}</div><h3>${reviewed ? `${reviewed} kart tekrar edildi!` : 'Şu an tekrar edilecek kart yok'}</h3>
        <p>${next ? `Sıradaki tekrar: ${new Date(next.due).toLocaleString('tr-TR', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}` : 'Şarkılardan kelime ekledikçe kartlar burada belirecek.'}</p>
        ${all.length >= 4 ? '<button class="btn" id="practiceAll">Yine de hepsini çalış</button>' : ''}</div>`;
      $('#practiceAll')?.addEventListener('click', () => { queue = shuffle(Object.values(S.vocab)); drawCard(); });
      if (reviewed) confetti(60);
      return;
    }
    const ctx = v.ctx ? esc(v.ctx).replace(new RegExp(`\\b(${v.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'i'), '<b>$1</b>') : '';
    box.innerHTML = `<div class="row" style="margin-bottom:12px"><h2 style="margin:0">Tekrar</h2><span class="spacer"></span><span class="muted small">${queue.length} kart kaldı</span></div>
      <div class="flash" id="flash"><div class="flash-inner">
        <div class="flash-face"><div class="fw">${esc(v.word)}</div>${ctx ? `<div class="fc">“${ctx}”</div>` : ''}<div class="small muted" style="margin-top:18px">Anlamını düşün, sonra kartı çevir (tıkla / Space)</div></div>
        <div class="flash-face back"><div class="ftr">${esc(v.tr || '—')}</div>${v.def ? `<div class="fdef">${esc(v.def)}</div>` : ''}<div class="small muted" style="margin-top:14px">${esc(v.song)}</div></div>
      </div></div>
      <div class="row" style="margin-top:16px;justify-content:center" id="grade">
        <button class="btn" id="sayBtn">🔊</button>
        <button class="btn danger" data-g="0" disabled>✗ Bilemedim <span class="kbd">1</span></button>
        <button class="btn" data-g="1" disabled>~ Zorlandım <span class="kbd">2</span></button>
        <button class="btn good" data-g="2" disabled>✓ Bildim <span class="kbd">3</span></button>
      </div>`;
    const flip = () => { $('#flash').classList.toggle('flipped'); sfx.pop(); $$('#grade [data-g]').forEach((b) => (b.disabled = false)); };
    $('#flash').onclick = flip; $('#sayBtn').onclick = () => speak(v.word);
    speak(v.word);
    $$('#grade [data-g]').forEach((b) => b.onclick = () => grade(+b.dataset.g));
    function grade(g) {
      if (g === 0) { v.box = 0; v.due = Date.now() + 60 * 1000; queue.push(queue.shift()); sfx.bad(); }
      else {
        v.box = g === 2 ? Math.min(5, v.box + 1) : Math.max(1, v.box);
        v.due = Date.now() + BOX_DAYS[v.box] * 864e5 + (g === 1 ? 0 : 0); if (v.box === 0) v.due = Date.now();
        queue.shift(); reviewed++; sfx.good(); addXP(g === 2 ? 3 : 2, $('#grade'));
      }
      save(); renderHud(); drawCard(); drawList($('#vSearch').value.toLowerCase().trim());
    }
    drawCard.keys = (e) => {
      if (/INPUT/.test(e.target.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); flip(); }
      if (['1', '2', '3'].includes(e.key) && !$('#grade [data-g]').disabled) grade(+e.key - 1);
    };
  };
  const onKey = (e) => drawCard.keys?.(e);
  document.addEventListener('keydown', onKey);
  current.cleanup = () => document.removeEventListener('keydown', onKey);
  drawCard();
}

/* ============================== BACKUP ============================== */
const backupJSON = () => JSON.stringify({ app: 'lyricly', v: 1, at: new Date().toISOString(), data: S });
function mergeBackup(text) {
  let d;
  try { d = JSON.parse(text.trim()); } catch { throw new Error('Yedek okunamadı — dosya/kod bozuk görünüyor.'); }
  if (d?.app !== 'lyricly' || !d.data) throw new Error('Bu bir Lyricly yedeği değil.');
  const B = d.data;
  let songs = 0, words = 0;
  for (const [id, s] of Object.entries(B.songs || {})) {
    const mine = S.songs[id];
    if (!mine) { S.songs[id] = s; songs++; continue; }
    for (const m of ['pick', 'type', 'gap']) mine.done[m] = [...new Set([...(mine.done?.[m] || []), ...(s.done?.[m] || [])])];
  }
  for (const [w, v] of Object.entries(B.vocab || {})) {
    const mine = S.vocab[w];
    if (!mine) { S.vocab[w] = v; words++; } else if ((v.box || 0) > (mine.box || 0)) S.vocab[w] = v;
  }
  const a = S.stats, b = B.stats || {};
  for (const [day, xp] of Object.entries(b.history || {})) a.history[day] = Math.max(a.history[day] || 0, xp);
  for (const k of ['xp', 'correct', 'attempts', 'lines']) a[k] = Math.max(a[k] || 0, b[k] || 0);
  if ((b.lastDay || '') > (a.lastDay || '') || (b.lastDay === a.lastDay && b.streak > a.streak)) { a.lastDay = b.lastDay; a.streak = b.streak; }
  save(); renderHud();
  return { songs, words };
}
function bindBackup() {
  $('#bkExport').onclick = async () => {
    const name = `lyricly-yedek-${today()}.json`, blob = new Blob([backupJSON()], { type: 'application/json' });
    const file = new File([blob], name, { type: 'application/json' });
    // iPhone: share sheet (AirDrop, Dosyalar'a kaydet, WhatsApp…); desktop: normal download
    if (navigator.canShare?.({ files: [file] }) && matchMedia('(hover: none)').matches) {
      try { await navigator.share({ files: [file], title: 'Lyricly yedeği' }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    sfx.save(); toast('📤 Yedek indirildi');
  };
  $('#bkCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(backupJSON()); sfx.save(); toast('📋 Yedek kodu kopyalandı — öbür cihazda yapıştır'); }
    catch { toast('Kopyalanamadı, “dışa aktar”ı kullan'); }
  };
  const apply = (text) => {
    try { const r = mergeBackup(text); sfx.good(); confetti(60); toast(`✅ Yedek yüklendi: ${r.songs} yeni şarkı, ${r.words} yeni kelime`); viewHome(); }
    catch (e) { sfx.bad(); toast('⚠️ ' + esc(e.message), 4000); }
  };
  $('#bkFile').onchange = async (e) => { const f = e.target.files[0]; if (f) apply(await f.text()); e.target.value = ''; };
  $('#bkPaste').onclick = () => { const t = $('#bkText').value; if (t.trim()) apply(t); };
}

/* ============================== BOOT ============================== */
renderHud();
route();
window.speechSynthesis?.getVoices();
window.__lyriclyOK = true;
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    // home-screen apps stay open in the background for days: look for updates whenever reopened
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
  // a new version took over → reload once so the new code runs (not on the very first install)
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    if (!/^#\/play/.test(location.hash)) location.reload();
  });
}
async function hardRefresh() {
  toast('🔄 Güncelleniyor…');
  try {
    for (const r of (await navigator.serviceWorker?.getRegistrations?.()) || []) await r.unregister();
    for (const k of (await window.caches?.keys?.()) || []) await caches.delete(k);
  } catch {}
  location.replace(`${location.pathname}?r=${Date.now()}${location.hash}`);
}
