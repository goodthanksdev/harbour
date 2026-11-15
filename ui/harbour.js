// Harbour UI: console tabs on top, one big picture (art, then video), a cover row along the bottom.
// Rules: nothing animates unless you are using it, and everything stops while Harbour is in the
// background or a game is running.
'use strict';
const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const S = {
  config: null, games: [], tabs: [], tab: 'all', list: [], sel: 0, recomp: {}, running: false,
  focused: document.hasFocus(), ambient: false, lastInput: Date.now(), menuOpen: false, artBusy: false,
};

// ---------- toast ----------
let toastTimer;
// Activity chips (top right): set() while a download/update runs, done() shows a tick, fail() a cross, then they fade away.
const Activity = {
  els: {},
  el(id) {
    let e = this.els[id];
    if (!e) { e = this.els[id] = document.createElement('div'); e.className = 'act in'; e.innerHTML = '<span class="ico"></span><span class="txt"></span><span class="bar"></span>'; $('#activity').append(e); }
    clearTimeout(e._t); e.classList.remove('out'); return e;
  },
  set(id, text, pct) {
    const e = this.el(id); e.classList.add('busy'); e.classList.remove('ok', 'bad');
    e.querySelector('.ico').textContent = ''; e.querySelector('.txt').textContent = text;
    e.querySelector('.bar').style.width = pct > 0 && pct < 1 ? `${Math.round(pct * 100)}%` : '0';
  },
  end(id, text, cls, mark, ms) {
    const e = this.el(id); e.classList.remove('busy', 'ok', 'bad'); e.classList.add(cls);
    e.querySelector('.ico').textContent = mark; e.querySelector('.txt').textContent = text; e.querySelector('.bar').style.width = '0';
    e._t = setTimeout(() => { e.classList.add('out'); e._t = setTimeout(() => { e.remove(); delete this.els[id]; }, 450); }, ms);
  },
  done(id, text) { this.end(id, text, 'ok', '✓', 2600); },
  fail(id, text) { this.end(id, text, 'bad', '!', 6000); },
};
function toast(msg, ms = 3200) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ms); }

// ---------- library ----------
const sysOf = id => S.config.systems.find(s => s.id === id) || { id, name: id, color: '#2a4a6a' };
const visible = g => !g.hidden;
function buildTabs() {
  const counts = {};
  for (const g of S.games.filter(visible)) counts[g.system] = (counts[g.system] || 0) + 1;
  const fav = S.games.filter(g => g.favorite && visible(g)).length;
  // Favourites first, the consoles in release order, everything ("All") last.
  S.tabs = [...(fav ? [{ id: 'favorites', name: '★ Favourites', n: fav }] : []),
    ...S.config.systems.filter(s => counts[s.id]).sort(byRelease).map(s => ({ id: s.id, name: shortName(s.name), n: counts[s.id] })),
    { id: 'all', name: 'All', n: S.games.filter(visible).length }];
  if (!S.tabs.some(t => t.id === S.tab)) S.tab = 'all';
  const nav = $('#tabs'); nav.replaceChildren();
  for (const t of S.tabs) {
    const b = el('button', 'tab' + (t.id === S.tab ? ' on' : ''), t.name);
    b.append(el('span', 'n', String(t.n)));
    b.onclick = () => { setTab(t.id); };
    nav.append(b);
  }
}
// Consoles in the order they came out (first release anywhere, by month), oldest on the left.
// Consoles you add yourself go after these; the Recomp and PC shelves go last.
const RELEASE = ['a2600', 'arcade', 'nes', 'genesis', 'gb', 'snes', 'ps1', 'n64', 'gbc', 'dreamcast', 'ps2', 'gba', 'gc', 'xbox',
  'nds', 'psp', 'x360', 'ps3', 'wii', '3ds', 'wiiu', 'ps4', 'switch', 'switch2'];
const releaseRank = id => { const i = RELEASE.indexOf(id); return i >= 0 ? i : id === 'recomp' ? 900 : id === 'pc' ? 901 : 800; };
const byRelease = (a, b) => releaseRank(a.id) - releaseRank(b.id);
const shortName = n => n.replace(/^Nintendo 64$/, 'N64').replace(/^Nintendo (?=Switch|DS|3DS)/, '').replace(/^PlayStation /, 'PS').replace(/^Sony /, '').replace(/^Microsoft /, '').replace(/^Super Nintendo$/, 'SNES').replace(/^Nintendo$/, 'NES');
function setTab(id, keepSel = false) {
  const prevId = S.list[S.sel]?.id;
  if (id !== S.tab && S.list.length) UISound.play('tab');
  S.tab = id;
  S.list = S.games.filter(visible).filter(g => id === 'all' || (id === 'favorites' ? g.favorite : g.system === id));
  [...$('#tabs').children].forEach((b, i) => b.classList.toggle('on', S.tabs[i]?.id === id));
  centerTab();
  const remembered = S.uiState?.perSystem?.[id];
  const i = S.list.findIndex(g => g.id === (keepSel ? prevId : remembered));
  renderRow();
  select(i >= 0 ? i : 0, true);
  api.saveLibraryUi({ system: id }).catch(() => {});
}

// Slide the tab strip so the selected console sits in the middle of the screen.
function centerTab(instant = false) {
  const on = $('#tabs .on'); if (!on) return;
  const view = $('#tabsView').getBoundingClientRect();
  const x = innerWidth / 2 - view.left - (on.offsetLeft + on.offsetWidth / 2);
  $('#tabs').style.transition = instant ? 'none' : '';
  $('#tabs').style.setProperty('--tx', `${x}px`);
}
addEventListener('resize', () => { centerTab(true); select(S.sel, true); });

// ---------- emulator badge ----------
// On every game that runs through an emulator: grey = you don't have the emulator (or none is set),
// yellow = the emulator has an update, Harbour teal = it's there and up to date.
const EMU_ICON = 'M7 6h10a5 5 0 0 1 4.9 6l-.9 4.6a2.8 2.8 0 0 1-4.9 1.3L14.3 16H9.7l-1.8 1.9A2.8 2.8 0 0 1 3 16.6L2.1 12A5 5 0 0 1 7 6Zm.5 3v2h-2v1.6h2v2h1.6v-2h2V11h-2V9H7.5Zm8.8.6a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Zm-2.2 2.3a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z';
function emuInfo(g) {
  if (!g || g.recomp) return null;
  const sys = S.config.systems.find(s => s.id === g.system);
  if (!sys || sys.direct) return null;
  const emu = (S.emus || []).find(e => e.id === sys.emulator);
  if (!emu) return { state: 'missing', text: 'No emulator yet' };
  if (!emu.exe) return { state: 'missing', text: `${emu.name} not found (Settings → Emulators)` };
  const st = S.emuStatus?.[emu.id];
  if (st?.updateAvailable) return { state: 'update', text: `${emu.name}: ${st.latest.tag} available` };
  return { state: 'ok', text: `via ${emu.name}` };
}
// A game whose console has no emulator set: the well-known one Harbour can install for it (else null).
function emuOffer(g) {
  if (!g || g.recomp) return null;
  const sys = S.config.systems.find(s => s.id === g.system);
  if (!sys || sys.direct || (S.emus || []).some(e => e.id === sys.emulator)) return null;
  return (S.catalog || []).find(c => c.consoles.includes(g.system)) || null;
}
function emuBadge(info, cls, text) {
  const b = el('span', `${cls} ${info.state}`); b.title = info.text;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', EMU_ICON); p.setAttribute('fill', 'currentColor');
  svg.append(p); b.append(svg); if (text) b.append(text);
  return b;
}
async function loadEmulators(force = false) {
  S.emus = await api.emuList().catch(() => []);
  S.catalog = await api.emulatorCatalog().catch(() => S.catalog || []);
  S.emuStatus = await api.checkEmulators(force).catch(() => S.emuStatus || {});
}

// A picture's address, reloaded from disk after "Change artwork" (same file name, new picture).
const pic = u => !u || !S.artBust ? u : `${u}${u.includes('?') ? '&' : '?'}a=${S.artBust}`;
// ---------- cover row ----------
function renderRow() {
  const row = $('#row'); row.replaceChildren();
  $('#empty').hidden = S.list.length > 0;
  S.list.forEach((g, i) => {
    const it = el('div', 'item'); it.dataset.i = i;
    const front = pic(g.media?.frontHQ || g.media?.front);
    if (front) {
      it.style.backgroundImage = `url("${front}")`;
      const probe = new Image(); probe.onload = () => { it.style.setProperty('--ar', Math.max(.62, Math.min(1.45, probe.naturalWidth / probe.naturalHeight))); recenterSoon(); }; probe.src = front;
    } else {
      const card = el('div', 'card', g.title); card.append(el('small', '', sysOf(g.system).name));
      it.style.setProperty('--c', sysOf(g.system).color || '#2a4a6a'); it.append(card);
    }
    if (g.favorite) it.append(el('span', 'fav', '★'));
    const emu = emuInfo(g);
    if (emu) it.append(emuBadge(emu, 'emu-badge'));
    it.onclick = () => select(i);
    it.ondblclick = () => play();
    row.append(it);
  });
  refreshBadges();
}
// ---------- updates: recomps and emulators in one list ----------
function pendingUpdates() {
  const games = Object.entries(S.recomp).filter(([, s]) => s.updateAvailable).map(([id, s]) => ({ kind: 'game', id, s, g: S.games.find(g => g.id === id) }))
    .filter(u => u.g).map(u => ({ ...u, name: u.g.title, from: u.s.installed?.tag, to: u.s.latest?.tag, auto: !!u.s.auto }));
  const emus = Object.entries(S.emuStatus || {}).filter(([, s]) => s.updateAvailable)
    .map(([id, s]) => ({ kind: 'emu', id, s, name: (S.emus || []).find(e => e.id === id)?.name || id, from: s.installed, to: s.latest?.tag, auto: !!s.canInstall }));
  // Ones Harbour can install first, "update in app" ones last (sort keeps the order within each group).
  const self = S.self?.updateAvailable ? [{ kind: 'harbour', id: 'harbour', name: 'Harbour', from: S.self.current, to: S.self.latest?.tag, auto: true }] : [];
  return [...self, ...games, ...emus].sort((a, b) => Number(b.auto) - Number(a.auto));
}
function openUpdates() { UISound.play('open'); renderUpdates(); if (!$('#updatesDlg').open) $('#updatesDlg').showModal(); }
function renderUpdates() {
  const list = pendingUpdates();
  $('#updAll').hidden = !list.some(u => u.auto);
  $('#updAll').textContent = `Update all (${list.filter(u => u.auto).length})`;
  $('#updAll').disabled = !list.some(u => u.auto && !jobState(`update:${u.kind}:${u.id}`));
  $('#updList').replaceChildren(...(list.length ? list.map(u => {
    const row = el('div', 'upd-row');
    const name = el('div', 'upd-name'); name.append(el('b', '', u.name), el('small', '', `${u.kind === 'emu' ? 'Emulator' : 'Game'} · ${u.from || '?'} → ${u.to || '?'}`));
    const btns = el('div', 'emu-btns');
    const b = (text, fn, cls = '') => { const x = el('button', cls, text); x.type = 'button'; x.onclick = fn; btns.append(x); return x; };
    if (u.auto) {
      // Its button shows when it's waiting in the queue, and how far it is while it runs.
      const key = `update:${u.kind}:${u.id}`, st = jobState(key), pct = st === 'running' ? Q.cur.pct : 0;
      const x = b('Update', () => updateOne(u), 'primary');
      x.dataset.key = key;
      if (st) spinnerButton(x, st === 'running' ? 'Updating' : 'Queued', pct);
    } else {
      // Harbour can't install this one: say where to update it. It notices by itself once it's done.
      name.append(el('small', 'upd-how', 'Update in app'));
      b('Release page', () => (u.kind === 'emu' ? api.openEmulatorPage(u.id) : api.recompOpenPage(u.id)).catch(e => toast(e.message)));
    }
    row.append(name, btns); return row;
  }) : [el('p', 'note', 'Everything is up to date.')]));
}
function afterUpdates() { refreshBadges(); renderRow(); select(S.sel, true); if ($('#updatesDlg').open) renderUpdates(); }
function updateOne(u) {
  return enqueue(`update:${u.kind}:${u.id}`, `Updating ${u.name}`, async () => {
    try {
      if (u.kind === 'harbour') { await api.selfUpdate(); jobProgress('Harbour updated: restarting…', 1); return { done: 'Harbour updated: restarting…' }; }  // restarts itself
      if (u.kind === 'emu') S.emuStatus[u.id] = await api.emuUpdate(u.id);
      else S.recomp[u.id] = await api.recompUpdate(u.id);
      UISound.play('select');
      return { done: `${u.name} updated to ${u.to}` };
    } finally { afterUpdates(); }
  });
}
// Each one downloads, checks and backs up on its own, in turn.
$('#updAll').onclick = () => { for (const u of pendingUpdates().filter(u => u.auto)) updateOne(u); };
$('#updClose').onclick = () => { UISound.play('back'); $('#updatesDlg').close(); };
$('#updatePill').onclick = openUpdates;

function refreshBadges() {
  [...$('#row').children].forEach((it, i) => {
    const g = S.list[i]; it.querySelector('.badge')?.remove();
    if (S.recomp[g?.id]?.updateAvailable) it.append(el('span', 'badge', 'UPDATE'));
  });
  const n = pendingUpdates().length;
  const pill = $('#updatePill'); pill.hidden = !n; pill.textContent = `${n} update${n === 1 ? '' : 's'}`;
}
let videoTimer = null, saveTimer = null;
// The selected cover sits in the middle of the screen; the row slides under it. Positions are worked
// out from the covers' final sizes, so the slide doesn't wobble while the old and new selection resize.
function centerRow(instant = false) {
  const row = $('#row'), items = [...row.children];
  if (!items.length) return;
  const cs = getComputedStyle(row), rowH = parseFloat(cs.height), gap = parseFloat(cs.columnGap) || 0;
  let x = 0;
  items.forEach((it, k) => {
    const w = (k === S.sel ? 1 : .78) * rowH * (parseFloat(it.style.getPropertyValue('--ar')) || .7);
    if (k < S.sel) x += w + gap; else if (k === S.sel) x += w / 2;
  });
  row.style.transition = instant ? 'none' : '';
  row.style.transform = `translateX(${innerWidth / 2 - row.offsetLeft - x}px)`;
}
let recenterTimer = null;
const recenterSoon = () => { clearTimeout(recenterTimer); recenterTimer = setTimeout(() => centerRow(), 60); };
function select(i, instant = false) {
  if (!S.list.length) { showGame(null); return; }
  const prev = S.sel;
  S.sel = Math.max(0, Math.min(S.list.length - 1, i));
  const items = [...$('#row').children];
  items.forEach((it, k) => it.classList.toggle('sel', k === S.sel));
  const it = items[S.sel];
  if (it) centerRow(instant);
  if (!instant && prev !== S.sel) UISound.play('move');
  showGame(S.list[S.sel]);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api.saveLibraryUi({ perSystem: { ...(S.uiState?.perSystem || {}), [S.tab]: S.list[S.sel]?.id } }).then(() => {
    S.uiState = { ...(S.uiState || {}), perSystem: { ...(S.uiState?.perSystem || {}), [S.tab]: S.list[S.sel]?.id } };
  }).catch(() => {}), 600);
}

// ---------- big picture ----------
let heroFlip = false, heroUrl = '';
function setHero(g) {
  const big = g && (g.media?.fanart || g.media?.screenshot);
  const url = pic(big || (g && (g.media?.frontHQ || g.media?.front)) || '');
  if (url === heroUrl) return;
  heroUrl = url;
  heroFlip = !heroFlip;
  const on = heroFlip ? $('#heroA') : $('#heroB'), off = heroFlip ? $('#heroB') : $('#heroA');
  on.style.backgroundImage = url ? `url("${url}")` : 'none';
  on.classList.toggle('soft', !big);
  on.classList.add('on'); off.classList.remove('on');
}
function stopVideo() {
  clearTimeout(videoTimer);
  const v = $('#heroVideo'); v.classList.remove('on'); v.pause();
  if (v.getAttribute('src')) { v.removeAttribute('src'); v.load(); } // frees the decoder
}
// Game videos can be switched off (Settings): then only the cover art shows, and no clips are downloaded.
const videosOn = () => S.config?.harbourVideos !== false;
function startVideoSoon(g) {
  stopVideo();
  if (!videosOn()) return;
  // While clips are being fetched for a game, its old clip isn't played (it's about to be replaced).
  if (!g?.media?.video || S.running || !S.focused || S.videoJob === 'library' || S.videoJob === g.id) return;
  videoTimer = setTimeout(() => {
    const v = $('#heroVideo');
    v.src = `${g.media.video}?v=${S.videoBust || 0}`; v.muted = !S.config.harbourVideoSound; // ?v= so a rerolled clip isn't served from cache
    v.volume = (S.config.harbourVideoVolume ?? 50) / 100;
    v.play().then(() => v.classList.add('on')).catch(() => {});
  }, 1600);
}
function showGame(g) {
  setHero(g);
  startVideoSoon(g);
  $('#gActions').style.visibility = g ? '' : 'hidden';
  if (!g) { $('#gTitle').textContent = ''; $('#gLogo').hidden = true; $('#gMeta').replaceChildren(); $('#gDesc').textContent = ''; return; }
  const logo = $('#gLogo');
  if (g.media?.logo) { logo.src = pic(g.media.logo); logo.alt = g.title; logo.hidden = false; $('#gTitle').textContent = ''; }
  else { logo.hidden = true; logo.removeAttribute('src'); $('#gTitle').textContent = g.title; }
  const meta = $('#gMeta'); meta.replaceChildren(el('span', 'sys', sysOf(g.system).name));
  const st = S.recomp[g.id];
  for (const x of [g.info?.year, g.info?.developer, g.info?.genre, playTime(g),
    st?.installed?.tag && `Installed ${st.installed.tag}`]) if (x) meta.append(el('span', '', x));
  if (st?.updateAvailable) meta.append(el('span', 'upd', `${st.latest.tag} available`));
  // Games that run through an emulator say which one, coloured by how it's doing.
  const emu = emuInfo(g);
  if (emu) meta.append(emuBadge(emu, 'emu-chip', emu.text));
  $('#gDesc').textContent = g.info?.description || '';
  // No emulator for this console yet: the Play button installs one instead.
  const offer = emuOffer(g), playBtn = $('#btnPlay');
  if (!S.installingFor) playBtn.replaceChildren(...(offer ? [`Install ${offer.name}`] : [el('span', 'tri'), 'Play']));
  const hint = $('#hints span'); if (hint?.lastChild) hint.lastChild.textContent = offer ? 'Install' : 'Play';
  const up = $('#btnUpdate');
  up.hidden = !st?.updateAvailable; up.className = 'new';
  up.textContent = st?.updateAvailable ? (st.auto ? `⬆ Update to ${st.latest.tag}` : `${st.latest.tag}: update in app`) : '';
}
function playTime(g) {
  if (!g.playMs) return '';
  const h = g.playMs / 3600000;
  return h >= 1 ? `${h.toFixed(h < 10 ? 1 : 0)} h played` : `${Math.max(1, Math.round(g.playMs / 60000))} min played`;
}

// ---------- actions ----------
async function play(g = S.list[S.sel]) {
  if (!g || S.running) return;
  // No emulator for this console yet: the button says Install, and installs it.
  if (emuOffer(g)) {
    const btn = $('#btnPlay');
    S.installingFor = true; btn.disabled = true; btn.replaceChildren('Installing…');
    try { await installFor([g.system]); } finally { S.installingFor = false; btn.disabled = false; showGame(S.list[S.sel]); }
    return;
  }
  UISound.play('launch');
  try { await api.launch(g.id); toast(`Starting ${g.title}…`, 2500); }
  catch (e) { UISound.play('error'); toast(e.message, 6000); }
}
function update(g = S.list[S.sel]) {
  const st = g && S.recomp[g.id];
  if (!st?.updateAvailable) return;
  if (!st.auto) { api.recompOpenPage(g.id).then(() => toast('Update in app.', 4000)).catch(e => toast(e.message)); return; }
  updateOne({ kind: 'game', id: g.id, name: g.title, to: st.latest.tag });
}
async function checkUpdates(force = false) {
  if (force) Activity.set('check', 'Checking for updates…');
  try { Object.assign(S.recomp, await api.recompCheckAll(force)); } catch (e) { if (force) Activity.fail('check', `Update check failed: ${e.message}`); return; }
  S.self = await api.selfStatus(force).catch(() => S.self);  // Harbour itself (only in a release)
  refreshBadges(); showGame(S.list[S.sel]);
  if (force) { const n = pendingUpdates().length; Activity.done('check', n ? `${n} update${n === 1 ? '' : 's'} available` : 'Everything is up to date'); }
}

// ---------- ••• menu ----------
function openMenu(anchor) {
  const g = S.list[S.sel]; if (!g) return;
  const m = $('#menu'); m.replaceChildren();
  const add = (label, fn) => { const b = el('button', '', label); b.onclick = () => { closeMenu(); fn(); }; m.append(b); };
  add(g.favorite ? '★ Remove from Favourites' : '☆ Add to Favourites', async () => { await api.setFavorite({ gameId: g.id, favorite: !g.favorite }); g.favorite = !g.favorite; buildTabs(); setTab(S.tab, true); });
  if (g.recomp) {
    add('Platform & updates…', () => openRecompDialog(g));
    add('Check for update', async () => { S.recomp[g.id] = await api.recompCheck(g.id, true).catch(e => ({ error: e.message })); refreshBadges(); showGame(g); const s = S.recomp[g.id]; toast(s.error || (s.updateAvailable ? `${s.latest.tag} is out.` : s.updateAvailable === false ? 'Up to date.' : `Newest is ${s.latest?.tag || '?'}. Set your version in Platform & updates.`)); });
    if (S.recomp[g.id]?.repo) add('Open release page', () => api.recompOpenPage(g.id).catch(e => toast(e.message)));
    add('Choose game .exe…', () => api.chooseGameExecutable(g.id).then(r => r && toast('Saved.')).catch(e => toast(e.message)));
  }
  add('Rename…', () => openRename(g));
  add('Open game folder', () => api.openGameFolder(g.id).catch(e => toast(e.message)));
  // 🎲: cover art = the next of the database's backgrounds (the big picture behind the game; the box cover stays);
  // clip = another part of the same video; video = a different video.
  add('🎲 Change cover art', () => downloadArt('game', g.id, [g.media?.fanart || !g.media?.screenshot ? 'fanart' : 'screenshot']));
  if (videosOn() && g.media?.video) {
    add('🎲 Different clip', () => downloadVideos('game', g.id, 'reroll'));
    add('🎲 Change video', () => downloadVideos('game', g.id, 'new'));
  } else if (videosOn()) add('Get a video for this game', () => downloadVideos('game', g.id, 'missing'));
  // A PC port you added can be taken out again (its files stay); a game from a games folder can be hidden.
  if (g.recomp) add('Remove from Harbour', async () => {
    if (!confirm(`Remove ${g.title} from Harbour? Its files stay where they are.`)) return;
    try { await api.gameRemove(g.added); await reload(); toast(`${g.title} removed.`); } catch (e) { toast(e.message); }
  });
  else add('Hide from Harbour', async () => { await api.setHidden({ gameId: g.id, hidden: true }); g.hidden = true; buildTabs(); setTab(S.tab); toast(`${g.title} hidden. Settings can show it again.`, 4000); });
  const r = anchor.getBoundingClientRect();
  m.hidden = false; S.menuOpen = true;
  m.style.left = Math.min(r.left, innerWidth - m.offsetWidth - 16) + 'px';
  m.style.top = Math.max(16, r.top - m.offsetHeight - 10) + 'px';
  menuFocus(0);
}
function closeMenu() { $('#menu').hidden = true; S.menuOpen = false; }
function menuFocus(i) { const bs = [...$('#menu').children]; bs.forEach((b, k) => b.classList.toggle('focus', k === i)); S.menuIdx = i; }
document.addEventListener('pointerdown', e => { if (S.menuOpen && !e.target.closest('#menu') && !e.target.closest('#btnMore')) closeMenu(); });

// ---------- recomp dialog ----------
let editing = null;
async function openRecompDialog(g) {
  const cur = await api.recompGet(g.id).catch(e => { toast(e.message); return null; }); if (!cur) return;
  editing = g; const f = $('#rdForm');
  f.platform.replaceChildren(...[{ id: '', name: 'Recomp shelf' }, ...consoles()].map(s => { const o = el('option', '', s.name); o.value = s.id; return o; }));
  f.platform.value = cur.platform || ''; f.repo.value = cur.source?.repo || ''; f.prerelease.checked = !!cur.source?.prerelease;
  f.auto.checked = !cur.source || cur.source.auto !== false; f.asset.value = cur.source?.asset || ''; f.installedTag.value = cur.installed?.tag || '';
  $('#rdGame').textContent = g.title; const st = S.recomp[g.id];
  $('#rdStatus').textContent = st?.latest ? `Newest release: ${st.latest.tag}` : '';
  $('#recompDlg').showModal();
}
$('#rdCancel').onclick = () => $('#recompDlg').close();
$('#rdForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = $('#rdForm'), g = editing;
  try { await api.recompSet({ gameId: g.id, platform: f.platform.value, repo: f.repo.value, prerelease: f.prerelease.checked, auto: f.auto.checked, asset: f.asset.value, installedTag: f.installedTag.value }); }
  catch (err) { $('#rdStatus').textContent = err.message; return; }
  $('#recompDlg').close();
  await reload(); const again = S.games.find(x => x.added === g.added);
  if (again) { S.recomp[again.id] = await api.recompCheck(again.id, true).catch(() => S.recomp[again.id]); setTab(again.system); select(S.list.findIndex(x => x.id === again.id)); }
  toast('Saved.');
});

// ---------- add a game / emulator ----------
const consoles = () => S.config.systems.filter(s => s.id !== 'recomp' && s.id !== 'pc' && !s.hidden).sort(byRelease);
const option = (value, text) => { const o = el('option', '', text); o.value = value; return o; };
async function emulatorsFor(sysId) {
  const list = await api.emuList().catch(() => []);
  // Emulators set up for this console first, then any other one you have.
  const fits = e => (e.systems || []).includes(sysId);
  return [...list.filter(e => fits(e) && (e.exe || e.custom)), ...list.filter(e => !fits(e) && e.exe)];
}
function showAddStep(step) {
  for (const id of ['addPick', 'addPort', 'addEmuPick', 'addEmu']) $('#' + id).hidden = id !== step;
  $('#' + step).querySelector('select, input, button')?.focus();
}
async function openAdd() {
  UISound.play('open');
  $('#addPort').platform.replaceChildren(option('', 'No console (Recomp shelf)'), ...consoles().map(s => option(s.id, s.name)));
  $('#emuSystems').replaceChildren(...consoles().map(s => { const l = el('label', 'check'); const c = el('input'); c.type = 'checkbox'; c.value = s.id; l.append(c, s.name); return l; }));
  for (const f of [$('#addPort'), $('#addEmu')]) f.querySelectorAll('input[type=text], input:not([type])').forEach(i => { if (i.name !== 'args') i.value = ''; });
  showAddStep('addPick');
  $('#addDlg').showModal();
}
// PC port: pick its folder; Harbour finds the program, its GitHub project and version, its name and console.
async function pickPort() {
  $('#addDlg').close();
  let found;
  try {
    Activity.set('addport', 'Looking up the game…');
    found = await api.pickPort();
    if (!found) { Activity.end('addport', 'Cancelled', 'ok', '', 1); return; }
    Activity.done('addport', 'Found it');
  } catch (e) { UISound.play('error'); Activity.fail('addport', e.message); return; }
  S.portFound = found;
  const f = $('#addPort');
  f.title.value = found.title || '';
  f.platform.value = found.platform || '';
  f.repo.value = found.repo || '';
  $('#portFound').textContent = `${found.exeName}` + (found.repo ? ` · ${found.installed ? `you have ${found.installed.tag}` : 'version unknown'}` : '');
  showAddStep('addPort');
  $('#addDlg').showModal();
}
$('#btnAdd').onclick = openAdd;
for (const b of document.querySelectorAll('#addDlg .choice')) b.onclick = () => { UISound.play('select'); if (b.dataset.kind === 'port') pickPort(); else showEmuCatalog(); };
for (const b of document.querySelectorAll('#addDlg .addBack')) b.onclick = () => { UISound.play('back'); showAddStep('addPick'); };
for (const b of document.querySelectorAll('#addDlg .addCancel')) b.onclick = () => { UISound.play('back'); $('#addDlg').close(); };
// After adding: show it, then fetch its artwork and a gameplay clip without being asked.
async function afterAdd(match, what) {
  $('#addDlg').close();
  await reload();
  const g = S.games.find(match);
  if (!g) { toast(`${what} added.`); return; }
  setTab(g.system); select(S.list.findIndex(x => x.id === g.id));
  UISound.play('select');
  toast(`Added ${g.title}.`, 4000);
  downloadArt('game', g.id);
  downloadVideos('game', g.id, 'missing');
}
$('#addPort').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, found = S.portFound;
  if (!found) return;
  try {
    // A changed GitHub link means the version Harbour matched no longer applies.
    const sameRepo = f.repo.value.trim() === (found.repo || '');
    const entry = await api.addPort({ folder: found.folder, executable: found.executable, platform: f.platform.value, title: f.title.value,
      repo: f.repo.value, prerelease: sameRepo && found.prerelease, installed: sameRepo ? found.installed : null });
    if (entry) afterAdd(g => g.added === entry.id, entry.title);
  } catch (err) { UISound.play('error'); toast(err.message, 6000); }
});
$('#addEmu').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target;
  const systems = [...document.querySelectorAll('#emuSystems input:checked')].map(c => c.value);
  try {
    const r = await api.addEmulator({ name: f.name.value, systems, args: f.args.value, makeDefault: f.makeDefault.checked });
    if (!r) return;
    S.config = await api.getConfig();
    $('#addDlg').close(); UISound.play('select');
    toast(`${r.name} added.`, 4000);
  } catch (err) { UISound.play('error'); toast(err.message, 6000); }
});

// ---------- emulators: see, change, remove ----------
const sysName = id => shortName(S.config.systems.find(s => s.id === id)?.name || id);
async function openEmulators() {
  UISound.play('open');
  await renderEmulators();
  if (!$('#emusDlg').open) $('#emusDlg').showModal();
}
async function renderEmulators() {
  S.config = await api.getConfig();
  const all = await api.emuList().catch(() => []);
  S.emus = all;
  const mine = all;
  // Consoles worth listing: ones with games, or ones an emulator is set up for.
  const counts = {}; for (const g of S.games) counts[g.system] = (counts[g.system] || 0) + 1;
  const pending = installsPending();
  const listed = consoles().filter(s => counts[s.id] || mine.some(e => (e.systems || []).includes(s.id)) || pending.some(c => c.consoles.includes(s.id)));
  const catalog = await api.emulatorCatalog().catch(() => []);
  const rows = listed.map(s => {
    const row = el('div', 'emu-console');
    const label = el('span', '', s.name); if (counts[s.id]) label.append(el('small', '', ` · ${counts[s.id]} game${counts[s.id] === 1 ? '' : 's'}`));
    const pick = el('select');
    // Only emulators that play this console (plus the current choice, so it never silently disappears).
    const fits = mine.filter(e => (e.systems || []).includes(s.id) || e.id === s.emulator);
    pick.append(option('', s.direct ? 'Runs by itself' : 'None'), ...fits.map(e => option(e.id, e.name)));
    pick.value = fits.some(e => e.id === s.emulator) ? s.emulator : '';
    pick.onchange = async () => {
      try { await api.setSystemEmulator({ system: s.id, emulator: pick.value }); UISound.play('select'); toast(`${shortName(s.name)} games now start with ${pick.selectedOptions[0].textContent}.`); }
      catch (e) { UISound.play('error'); toast(e.message); }
    };
    row.append(label, pick);
    // Games that need an emulator but none is set: offer the well-known one for this console.
    const needOne = S.games.some(g => g.system === s.id && !g.recomp);
    const busy = !pick.value && pending.find(c => c.consoles.includes(s.id));
    const offer = !busy && needOne && !pick.value && catalog.find(c => c.consoles.includes(s.id) && !c.installed);
    if (busy) {
      // Being installed (or waiting its turn): it leaves the list again if the install fails and there are no games.
      const b = el('button'); b.type = 'button';
      spinnerButton(b, installState(busy.id) === 'installing' ? `Installing ${busy.name}` : `${busy.name}: queued`, installState(busy.id) === 'installing' ? Q.cur?.pct : 0);
      row.append(b);
    }
    if (offer) {
      // Say why the button is there: these games can't start until it's installed.
      label.querySelector('small')?.remove();
      label.append(el('small', 'need', ` · ${counts[s.id]} game${counts[s.id] === 1 ? '' : 's'}, no emulator`));
      const b = el('button', 'primary', `Install ${offer.name}`); b.type = 'button';
      b.onclick = () => installEmulator(offer);
      row.append(b);
    }
    return row;
  });
  $('#emuConsoles').replaceChildren(...(rows.length ? rows : [el('p', 'note', 'No consoles yet.')]));
  const cards = mine.map(e => {
    const card = el('div', 'emu-card');
    const head = el('div', 'emu-head'); head.append(el('b', '', e.name), el('small', '', e.exe ? e.exe : 'Program not found: choose it again'));
    const chips = el('div', 'chips');
    const used = S.config.systems.filter(s => s.emulator === e.id).map(s => s.id);
    for (const id of e.systems || []) chips.append(el('span', 'chip' + (used.includes(id) ? ' on' : ''), sysName(id)));
    if (!(e.systems || []).length) chips.append(el('span', 'note', 'No consoles chosen'));
    // Updates: where they come from, the version you have, the newest one.
    const st = S.emuStatus?.[e.id] || {};
    const info = !e.exe ? { state: 'missing' } : st.updateAvailable ? { state: 'update' } : { state: 'ok' };
    const where = sourceText(st.source);
    const line = !where ? 'Updates: no source set, so Harbour can\'t tell when there\'s a new version.'
      : `Updates from ${where} · you have ${st.installed || '?'} · newest ${st.latest?.tag || '?'}` + (st.error ? ' (couldn\'t check)' : '');
    const upd = el('div', 'emu-update'); upd.append(emuBadge(info, 'emu-chip', st.updateAvailable ? `${st.latest.tag} available` : !e.exe ? 'Program missing' : where && st.installed ? 'Up to date' : 'Version unknown'), el('small', '', line));
    const btns = el('div', 'emu-btns');
    const b = (text, fn, cls = '') => { const x = el('button', cls, text); x.type = 'button'; x.onclick = fn; btns.append(x); };
    if (e.custom) b('Consoles…', () => editEmuConsoles(e, card));
    if (st.updateAvailable && st.canInstall) b(`Update to ${st.latest.tag}`, () => updateOne({ kind: 'emu', id: e.id, name: e.name, to: st.latest.tag }).then(() => renderEmulators()), 'primary');
    b('Updates…', () => editEmuSource(e, st, card));
    if (where) b('Release page', () => api.openEmulatorPage(e.id).catch(err => toast(err.message)));
    b('Change program…', async () => { const r = await api.emuPickExe(e.id).catch(err => toast(err.message)); if (r) { toast(`${e.name} now uses ${r.exe.split(/[\\/]/).pop()}.`); renderEmulators(); } });
    if (e.exe) b('Open (settings)', () => api.emuOpen(e.id).catch(err => toast(err.message)));
    b('Open folder', () => api.emuOpenFolder(e.id).catch(err => toast(err.message)));
    if (e.custom) b('Remove', async () => {
      if (!confirm(`Remove ${e.name} from Harbour? Its files stay where they are; consoles that used it will have no emulator.`)) return;
      try { await api.emuRemove(e.id); UISound.play('back'); toast(`${e.name} removed.`); renderEmulators(); } catch (err) { toast(err.message); }
    }, 'danger');
    card.append(head, chips, upd, btns); return card;
  });
  $('#emuCards').replaceChildren(...(cards.length ? cards : [el('p', 'note', 'No emulators yet.')]));
  renderGameFolders();
}
const sourceText = src => !src ? null : src.type === 'dolphin' ? 'dolphin-emu.org' : src.type === 'github' ? src.repo : `${src.host}/${src.repo}`;
// Where an emulator's updates come from, and which version you have.
function editEmuSource(e, st, card) {
  const form = el('div', 'emu-source');
  const src = el('input'); src.placeholder = 'owner/name on GitHub, or a link to the project page';
  src.value = sourceText(st.source) || '';
  const tag = el('input'); tag.placeholder = 'the version you have, e.g. v0.2.1'; tag.value = st.installed || '';
  const pre = el('input'); pre.type = 'checkbox'; pre.checked = !!st.source?.prerelease;
  const preLabel = el('label', 'check'); preLabel.append(pre, 'Include test versions');
  const save = el('button', 'primary', 'Save'); save.type = 'button';
  save.onclick = async () => {
    try { S.emuStatus[e.id] = await api.setEmulatorSource({ id: e.id, source: src.value, prerelease: pre.checked, installedTag: tag.value }); UISound.play('select'); renderEmulators(); }
    catch (err) { UISound.play('error'); toast(err.message, 6000); }
  };
  const l1 = el('label', '', 'Updates come from'), l2 = el('label', '', 'Version you have');
  l1.append(src); l2.append(tag);
  form.append(l1, l2, preLabel, save);
  card.querySelector('.emu-btns').replaceWith(form);
  src.focus();
}
// Game folders: one row per folder, with the console it feeds.
function renderGameFolders() {
  const rows = [];
  for (const s of S.config.systems) for (const dir of String(s.romDir || '').split('|').map(d => d.trim()).filter(Boolean)) {
    const row = el('div', 'folder-row');
    const x = el('button', 'danger', 'Remove'); x.type = 'button';
    x.onclick = async () => {
      try { await api.removeGameFolder({ system: s.id, folder: dir }); UISound.play('back'); await reload(); renderEmulators(); toast(`${sysName(s.id)} folder removed. Its games are no longer listed (the files are untouched).`, 6000); }
      catch (e) { toast(e.message); }
    };
    row.append(el('b', '', sysName(s.id)), el('span', '', dir), x);
    rows.push(row);
  }
  $('#gameFolders').replaceChildren(...(rows.length ? rows : [el('p', 'note', 'No game folders yet.')]));
  const pick = $('#folderConsole');
  if (!pick.options.length) pick.replaceChildren(...consoles().map(s => option(s.id, s.name)));
}
async function addGameFolder(system) {
  try {
    const r = await api.addGameFolder({ system });
    if (!r) return;
    if (!r.added.length) return toast('That folder is already there.');
    UISound.play('select');
    toast(`Added ${r.added.map(a => sysName(a.system)).join(', ')}. Finding games…`, 5000);
    S.config = await api.getConfig();
    await reload(); renderEmulators();
    // Consoles with games but no emulator get the well-known one, installed in the background.
    const missing = [...new Set(r.added.map(a => a.system))].filter(id => S.games.some(g => g.system === id) && !S.config.systems.find(s => s.id === id)?.emulator);
    if (missing.length) installFor(missing).then(() => renderEmulators());
    const fresh = S.games.filter(g => r.added.some(a => a.system === g.system) && !g.media?.front && !g.recomp);
    // New games get their artwork, then a gameplay clip each, without being asked.
    if (fresh.length) { downloadArt('library'); downloadVideos('library', '', 'missing'); }
  } catch (e) { UISound.play('error'); toast(e.message, 7000); }
}
$('#addGamesRoot').onclick = () => addGameFolder('');
$('#addConsoleFolder').onclick = () => addGameFolder($('#folderConsole').value);

function editEmuConsoles(e, card) {
  const box = el('div', 'sys-grid');
  for (const s of consoles()) { const l = el('label', 'check'); const c = el('input'); c.type = 'checkbox'; c.value = s.id; c.checked = (e.systems || []).includes(s.id); l.append(c, s.name); box.append(l); }
  const args = el('input'); args.value = e.args || '{rom}'; args.title = 'Launch options: {rom} is the game file';
  const argsRow = el('label', 'emu-args', 'Launch options '); argsRow.append(args);
  const save = el('button', 'primary', 'Save'); save.type = 'button';
  save.onclick = async () => {
    try { await api.setEmulator({ id: e.id, systems: [...box.querySelectorAll('input:checked')].map(c => c.value), args: args.value }); UISound.play('select'); renderEmulators(); }
    catch (err) { toast(err.message); }
  };
  card.querySelector('.emu-btns').replaceWith(el('div'));
  card.append(box, argsRow, save);
}
$('#setEmus').onclick = () => { $('#settings').close(); openEmulators(); };
$('#emusClose').onclick = () => { UISound.play('back'); $('#emusDlg').close(); };
// Changes made in there (emulators, versions) show on the covers' badges as soon as it closes.
$('#emusDlg').addEventListener('close', () => { const id = S.list[S.sel]?.id; renderRow(); const i = S.list.findIndex(g => g.id === id); select(i >= 0 ? i : 0, true); });
$('#emusAdd').onclick = async () => { $('#emusDlg').close(); await openAdd(); showEmuCatalog(); };

// ---------- rename ----------
let renaming = null;
function openRename(g) { renaming = g; $('#renameForm').title.value = g.title; $('#renameDlg').showModal(); $('#renameForm').title.select(); }
$('#renameCancel').onclick = () => $('#renameDlg').close();
$('#renameForm').addEventListener('submit', async e => {
  e.preventDefault(); const g = renaming, title = $('#renameForm').title.value.trim();
  $('#renameDlg').close(); if (!g || !title || title === g.title) return;
  try { await api.setTitle({ gameId: g.id, title }); g.title = title; renderRow(); select(S.sel, true); toast('Renamed. Use ••• → Download artwork if its pictures were wrong.', 5000); }
  catch (err) { toast(err.message, 5000); }
});

// ---------- settings ----------
function openSettings() {
  const hidden = S.games.filter(g => g.hidden).length;
  $('#setUnhide').textContent = hidden ? `Show them again (${hidden})` : 'None hidden';
  $('#setUnhide').disabled = !hidden;
  $('#setIdle').value = String(S.config.harbourIdle ?? 120);
  $('#setSound').value = S.config.harbourVideoSound ? '1' : '0';
  $('#setVideosOn').value = videosOn() ? '1' : '0'; $('#setVideos').disabled = !videosOn();
  // How much space the clips take, on the Delete button.
  $('#setClearVideos').textContent = 'Delete all'; $('#setClearVideos').disabled = true;
  api.videoUsage().then(bytes => { $('#setClearVideos').textContent = `Delete all (${sizeText(bytes)})`; $('#setClearVideos').disabled = !bytes; }).catch(() => {});
  $('#setUiSound').value = S.config.harbourUiSound === false ? '0' : '1';
  $('#setUiVol').value = uiVolume(); $('#setVidVol').value = videoVolume(); showVolumes();
  $('#settings').showModal();
}
async function saveSetting(patch) {
  Object.assign(S.config, patch);
  try { S.config = await api.setConfig(structuredClone(S.config)); } catch (e) { toast('Could not save: ' + e.message); }
}
$('#btnSettings').onclick = openSettings;
$('#setClose').onclick = () => $('#settings').close();
$('#setQuit').onclick = () => api.quitApp();
$('#setFull').onclick = () => api.isFullscreen().then(on => api.setFullscreen(!on));
$('#setIdle').onchange = e => saveSetting({ harbourIdle: Number(e.target.value) });
$('#setUiSound').onchange = e => { const on = e.target.value === '1'; saveSetting({ harbourUiSound: on }); UISound.configure({ enabled: on }); if (on) UISound.play('select'); };
// Volumes are 0-100 and start at 50: loud enough to hear, never a blast at full.
const uiVolume = () => S.config.harbourUiVolume ?? 50, videoVolume = () => S.config.harbourVideoVolume ?? 50;
// The built-in blips are generated at 0.5 of full scale, so 50 here is the level they were made for.
const applyUiVolume = () => UISound.configure({ volume: uiVolume() / 100 * .5 });
const showVolumes = () => { $('#setUiVolOut').textContent = uiVolume(); $('#setVidVolOut').textContent = videoVolume(); };
$('#setUiVol').oninput = e => { S.config.harbourUiVolume = Number(e.target.value); applyUiVolume(); showVolumes(); };
$('#setUiVol').onchange = e => { saveSetting({ harbourUiVolume: Number(e.target.value) }); UISound.play('select'); };
$('#setVidVol').oninput = e => { S.config.harbourVideoVolume = Number(e.target.value); $('#heroVideo').volume = videoVolume() / 100; showVolumes(); };
$('#setVidVol').onchange = e => saveSetting({ harbourVideoVolume: Number(e.target.value) });
$('#setSound').onchange = e => { saveSetting({ harbourVideoSound: e.target.value === '1' }); $('#heroVideo').muted = e.target.value !== '1'; };
$('#setUnhide').onclick = async () => {
  for (const g of S.games.filter(x => x.hidden)) { await api.setHidden({ gameId: g.id, hidden: false }).catch(() => {}); g.hidden = false; }
  $('#settings').close(); buildTabs(); setTab(S.tab, true); toast('Hidden games are back.');
};
$('#setCheck').onclick = () => { $('#settings').close(); checkUpdates(true); };
$('#setArt').onclick = () => { $('#settings').close(); downloadArt('library'); };
$('#setVideos').onclick = () => { $('#settings').close(); downloadVideos('library'); };
const sizeText = b => b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1048576))} MB`;
$('#setVideosOn').onchange = e => {
  const on = e.target.value === '1';
  saveSetting({ harbourVideos: on }); $('#setVideos').disabled = !on;
  if (on) startVideoSoon(S.list[S.sel]); else stopVideo();
};
// Deleting them also switches videos off: otherwise Harbour would just download them all again.
$('#setClearVideos').onclick = async () => {
  if (!confirm('Delete every game clip? Game videos will be switched off too, so they aren\'t downloaded again. Turn them back on any time.')) return;
  stopVideo(); S.videoJob = 'library';
  try {
    const freed = await api.videoClearAll();
    await saveSetting({ harbourVideos: false });
    $('#setVideosOn').value = '0'; $('#setVideos').disabled = true;
    $('#setClearVideos').textContent = 'Delete all'; $('#setClearVideos').disabled = true;
    toast(`Clips deleted: ${sizeText(freed)} freed.`, 5000);
    await reload();
  } catch (err) { toast(err.message, 6000); }
  finally { S.videoJob = null; }
};
// Artwork and clips are made by the main process; their queue jobs wait for it to say it's finished.
const mainJob = { art: null, video: null };
function downloadVideos(scope, gameId, mode = 'missing') {
  if (!videosOn()) return Promise.resolve(false);
  const label = mode === 'reroll' ? 'Rerolling the clip' : mode === 'new' ? 'Finding a different longplay' : 'Game videos';
  return enqueue(`video:${scope}:${gameId || ''}:${mode}`, label, () => new Promise((resolve, reject) => {
    if (!videosOn()) return resolve({ quiet: true });  // switched off while it waited
    // Let go of the clip first: Windows won't replace a video file that's still playing.
    if (mode !== 'missing') { S.videoJob = scope === 'game' ? gameId : 'library'; stopVideo(); }
    mainJob.video = resolve;
    api.videoStart({ scope, gameId, mode }).catch(e => {
      S.videoJob = null; mainJob.video = null; startVideoSoon(S.list[S.sel]);
      if (/already has a video/i.test(e.message)) resolve({ quiet: true }); else reject(e);  // nothing to do isn't a failure
    });
  }));
}
api.onVideoProgress?.(job => {
  if (job && job.status !== 'running') S.videoJob = null; // finished: clips can play again
  if (!job) return;
  if (job.status === 'running') { jobProgress(job.total > 1 ? `Videos ${job.done || 0} of ${job.total} · ${job.stage}` : job.stage, job.total > 1 ? (job.done || 0) / job.total : 0); return; }
  let result;
  if (job.status === 'failed') result = { fail: 'Videos stopped: ' + job.stage };
  else if (job.total === 1) result = job.saved ? { done: 'New clip ready' } : { fail: job.failed ? `Couldn't get a clip: ${job.errors?.[0]?.split(': ').slice(1).join(': ') || 'unknown error'}` : 'No gameplay video found' };
  else {
    const msg = `Videos done: ${job.saved} saved` + (job.noLink ? `, ${job.noLink} had no link` : '') + (job.failed ? `, ${job.failed} failed` : '');
    result = job.failed && !job.saved ? { fail: msg } : { done: msg };
  }
  S.videoBust = Date.now();
  const finish = mainJob.video; mainJob.video = null;
  reload().then(() => { startVideoSoon(S.list[S.sel]); finish?.(result); });
});
// reroll: the kinds to swap for the next of the database's pictures (else missing pictures are downloaded).
function downloadArt(scope, gameId, reroll = null) {
  return enqueue(`art:${scope}:${gameId || ''}${reroll ? ':next' : ''}`, reroll ? 'Changing cover art' : 'Artwork', () => new Promise((resolve, reject) => {
    S.artBusy = true; S.artReroll = !!reroll; mainJob.art = resolve;
    api.artStart({ scope, gameId, types: reroll || ['front', 'fanart', 'logo', 'screenshot'], retryMissing: true, upgrade: false, reroll: !!reroll })
      .catch(e => { S.artBusy = false; mainJob.art = null; reject(e); });
  }));
}
api.onArtProgress?.(job => {
  if (!job) return;
  if (job.status === 'running') { jobProgress(job.total > 1 ? `Artwork ${job.completed} of ${job.total}` + (job.lastTitle ? ` · ${job.lastTitle}` : '') : `Artwork · ${job.lastTitle || ''}`, job.total > 1 ? job.completed / job.total : 0); return; }
  const finish = mainJob.art; mainJob.art = null; S.artBusy = false;
  // Changed pictures keep their file names: a new ?v= makes the window load them again instead of its cached copies.
  if (S.artReroll) S.artBust = Date.now();
  const msg = S.artReroll ? (job.downloaded ? 'New cover art' : 'No other cover art for this game') : `Artwork done: ${job.downloaded} new image${job.downloaded === 1 ? '' : 's'}`;
  reload().then(() => finish?.(S.artReroll && !job.downloaded ? { fail: msg } : { done: msg }));
});

// ---------- input: keyboard, mouse, controller ----------
function poke() {
  S.lastInput = Date.now();
  if (S.ambient) { S.ambient = false; document.body.classList.remove('ambient'); return true; } // the first input only wakes it
  return false;
}
// Windows (Settings, Add, Emulators, Platform & updates, Rename) with a controller: up/down move
// between the controls, left/right change a dropdown, A presses or ticks, B closes.
function dialogAct(dlg, a) {
  const controls = [...dlg.querySelectorAll('button, select, input')].filter(e => !e.disabled && e.offsetParent !== null && e.type !== 'hidden');
  if (!controls.length) { if (a === 'back') dlg.close(); return; }
  const cur = controls.indexOf(document.activeElement), el2 = controls[cur];
  const focusAt = i => { const t = controls[(i + controls.length) % controls.length]; t.focus({ focusVisible: true }); t.scrollIntoView({ block: 'nearest' }); UISound.play('move'); };
  if (a === 'back') { UISound.play('back'); dlg.close(); return; }
  if (a === 'up' || a === 'tabprev') return focusAt(cur < 0 ? 0 : cur - 1);
  if (a === 'down' || a === 'tabnext') return focusAt(cur + 1);
  if ((a === 'left' || a === 'right') && el2?.type === 'range') { // sliders: left/right move them
    const step = Number(el2.step) || 1, v = Math.max(Number(el2.min), Math.min(Number(el2.max), Number(el2.value) + (a === 'right' ? step : -step)));
    if (v !== Number(el2.value)) { el2.value = v; el2.dispatchEvent(new Event('input', { bubbles: true })); el2.dispatchEvent(new Event('change', { bubbles: true })); }
    return;
  }
  if ((a === 'left' || a === 'right') && el2?.tagName === 'SELECT') {
    const n = el2.options.length, i = Math.max(0, Math.min(n - 1, el2.selectedIndex + (a === 'right' ? 1 : -1)));
    if (i !== el2.selectedIndex) { el2.selectedIndex = i; el2.dispatchEvent(new Event('change', { bubbles: true })); UISound.play('move'); }
    return;
  }
  if (a === 'left') return focusAt(cur < 0 ? 0 : cur - 1);
  if (a === 'right') return focusAt(cur + 1);
  if (a === 'ok') {
    if (cur < 0) return focusAt(0);
    if (el2.tagName === 'BUTTON' || el2.type === 'checkbox') { UISound.play('select'); el2.click(); }
    else if (el2.tagName === 'SELECT') { el2.selectedIndex = (el2.selectedIndex + 1) % el2.options.length; el2.dispatchEvent(new Event('change', { bubbles: true })); }
    // Text boxes need a keyboard (on a Steam Controller: Steam + X shows one).
  }
}
function act(a) {
  if (S.running) return;
  if (poke()) return;
  const dlg = document.querySelector('dialog[open]');
  if (dlg) { dialogAct(dlg, a); return; }
  if (S.menuOpen) {
    const bs = [...$('#menu').children];
    if (a === 'up') { UISound.play('move'); menuFocus((S.menuIdx - 1 + bs.length) % bs.length); }
    else if (a === 'down') { UISound.play('move'); menuFocus((S.menuIdx + 1) % bs.length); }
    else if (a === 'ok') { UISound.play('select'); bs[S.menuIdx]?.click(); }
    else if (a === 'back' || a === 'more') { UISound.play('back'); closeMenu(); }
    return;
  }
  const tabIdx = S.tabs.findIndex(t => t.id === S.tab);
  switch (a) {
    case 'left': select(S.sel - 1); break;
    case 'right': select(S.sel + 1); break;
    case 'pgleft': select(S.sel - 6); break;
    case 'pgright': select(S.sel + 6); break;
    case 'tabprev': setTab(S.tabs[(tabIdx - 1 + S.tabs.length) % S.tabs.length].id); break;
    case 'tabnext': setTab(S.tabs[(tabIdx + 1) % S.tabs.length].id); break;
    case 'ok': play(); break;
    case 'update': update(); break;
    case 'more': UISound.play('open'); openMenu($('#btnMore')); break;
    case 'settings': UISound.play('open'); openSettings(); break;
    case 'updates': openUpdates(); break;
  }
}
addEventListener('keydown', e => {
  if (e.target.closest('dialog') && !['Escape'].includes(e.key)) { poke(); return; }
  const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: S.menuOpen ? 'up' : 'tabprev', ArrowDown: S.menuOpen ? 'down' : 'tabnext',
    Enter: 'ok', ' ': 'ok', Escape: 'back', PageUp: 'pgleft', PageDown: 'pgright', q: 'tabprev', e: 'tabnext', u: 'update', x: 'more', F1: 'settings' };
  const a = map[e.key]; if (!a) { poke(); return; }
  e.preventDefault(); act(a);
});
addEventListener('mousemove', () => poke(), { passive: true });
addEventListener('wheel', e => { if (poke()) return; if (e.target.closest('#rowWrap')) select(S.sel + (e.deltaY > 0 || e.deltaX > 0 ? 1 : -1)); }, { passive: true });
$('#btnPlay').onclick = () => play();
$('#btnUpdate').onclick = () => update();
$('#btnMore').onclick = e => S.menuOpen ? closeMenu() : openMenu(e.currentTarget);

// Controller (XInput layout; Steam Input presents the Steam Controller as one). Polled only while needed.
const held = new Map(); let pollTimer = null, rafId = null, quitHoldSince = 0;
function pollPads() {
  for (const p of navigator.getGamepads?.() || []) {
    if (!p) continue;
    const b = i => !!p.buttons[i]?.pressed, ax = (i, s) => (p.axes[i] || 0) * s > .6;
    if (S.running) { // only "hold Back + Start" to close the game
      if (b(8) && b(9)) { quitHoldSince ||= Date.now(); if (Date.now() - quitHoldSince > 1500) { quitHoldSince = 0; api.quitGame().catch(() => {}); } }
      else quitHoldSince = 0;
      continue;
    }
    const keys = { left: b(14) || ax(0, -1), right: b(15) || ax(0, 1), up: b(12) || ax(1, -1), down: b(13) || ax(1, 1),
      ok: b(0), back: b(1), more: b(2), update: b(3), tabprev: b(4), tabnext: b(5), pgleft: b(6), pgright: b(7), settings: b(9), updates: b(8) };
    for (const [k, down] of Object.entries(keys)) {
      const key = p.index + k, t = held.get(key);
      if (!down) { held.delete(key); continue; }
      const now = performance.now(), repeat = ['left', 'right', 'up', 'down'].includes(k);
      if (!t) { held.set(key, now + 380); dispatchPad(k); }
      else if (repeat && now >= t) { held.set(key, now + 90); dispatchPad(k); }
    }
  }
}
function dispatchPad(k) {
  if (k === 'up') return act(S.menuOpen ? 'up' : 'tabprev');
  if (k === 'down') return act(S.menuOpen ? 'down' : 'tabnext');
  act(k);
}
function padLoop() { pollPads(); rafId = requestAnimationFrame(padLoop); }
function setPolling() {
  cancelAnimationFrame(rafId); clearInterval(pollTimer); rafId = pollTimer = null;
  if (!navigator.getGamepads?.().some(Boolean)) return;
  if (S.focused && !S.running) padLoop();               // smooth while you're using it
  else pollTimer = setInterval(pollPads, 250);          // background: 4 checks a second, nothing drawn
}
addEventListener('gamepadconnected', setPolling);
addEventListener('gamepaddisconnected', setPolling);

// ---------- freeze in the background / while a game runs ----------
function setFrozen() {
  const frozen = S.running || !S.focused || document.hidden;
  document.body.classList.toggle('frozen', frozen);
  UISound.suspend(frozen);
  if (frozen) { stopVideo(); if (S.ambient) { S.ambient = false; document.body.classList.remove('ambient'); } }
  else { S.lastInput = Date.now(); startVideoSoon(S.list[S.sel]); }
  setPolling();
}
addEventListener('focus', () => { S.focused = true; setFrozen(); noticeOwnUpdates(); rescanOnReturn(); });
// Coming back to Harbour: games added to the folders meanwhile show up (and get their artwork), at most every 20 s.
let lastRescan = Date.now();
async function rescanOnReturn() {
  if (S.running || Date.now() - lastRescan < 20000) return;
  lastRescan = Date.now();
  const fresh = await api.scan(false, { onlyIfChanged: true }).catch(() => null);
  if (fresh) {
    const id = S.list[S.sel]?.id, before = S.games.length;
    S.games = fresh; buildTabs(); setTab(S.tab, true);
    const i = S.list.findIndex(g => g.id === id); if (i >= 0) select(i, true);
    if (fresh.length > before) toast(`${fresh.length - before} new game${fresh.length - before === 1 ? '' : 's'} found.`);
  }
  autoMedia();
}
// Coming back to Harbour (e.g. after updating an emulator yourself): look again, without asking the internet.
async function noticeOwnUpdates() {
  if (!pendingUpdates().length) return;
  const before = pendingUpdates().length;
  await loadEmulators(false);
  if (S.games.some(g => g.recomp)) try { Object.assign(S.recomp, await api.recompCheckAll(false)); } catch {}
  const after = pendingUpdates().length;
  if (after !== before) { afterUpdates(); Activity.done('noticed', after < before ? 'Update noticed: you\'re on the newest version' : 'Updates changed'); }
}
addEventListener('blur', () => { S.focused = false; setFrozen(); });
document.addEventListener('visibilitychange', setFrozen);
api.onGameStarted(() => { S.running = true; setFrozen(); });
api.onGameEnded(p => {
  S.running = (p?.running || 0) > 0; const g = S.games.find(x => x.id === p?.gameId);
  if (g) { Object.assign(g, { playMs: p.playMs, lastPlayed: p.lastPlayed, plays: p.plays }); if (g === S.list[S.sel]) showGame(g); }
  setFrozen();
});

// ---------- screensaver + clock (one cheap timer, only while in front) ----------
setInterval(() => {
  if (document.body.classList.contains('frozen')) return;
  const d = new Date(); $('#clock').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const idle = S.config?.harbourIdle ?? 120;
  if (idle && !S.ambient && !S.menuOpen && !document.querySelector('dialog[open]') && Date.now() - S.lastInput > idle * 1000) {
    S.ambient = true; document.body.classList.add('ambient');
    const v = $('#heroVideo'); if (S.list[S.sel]?.media?.video && !v.getAttribute('src')) startVideoSoon(S.list[S.sel]);
  }
}, 1000);

// ---------- hints ----------
function renderHints() {
  const h = [['A', 'Play'], ['Y', 'Update'], ['X', 'More'], ['LB RB', 'Console'], ['Start', 'Settings'], ['Back', 'Updates'],['Back+Start (hold)', 'Close game']];
  $('#hints').replaceChildren(...h.map(([k, t]) => { const s = el('span'); s.append(el('kbd', '', k), t); return s; }));
}

// New games (dropped into a game folder, added any way) get artwork, then a gameplay clip, by themselves.
// A game tried without luck waits a week before the next try, so hopeless ones aren't searched every start.
const AUTO_RETRY_MS = 7 * 864e5;
function autoMedia() {
  let tried = {};
  try { tried = JSON.parse(localStorage.getItem('harbourAutoTried') || '{}'); } catch {}
  const now = Date.now();
  const fresh = S.games.filter(g => !g.demo && (!g.media?.front || !g.media?.video) && !(now - (tried[g.id] || 0) < AUTO_RETRY_MS));
  if (!fresh.length) return;
  for (const g of fresh) tried[g.id] = now;
  try { localStorage.setItem('harbourAutoTried', JSON.stringify(tried)); } catch {}
  // Artwork first, then clips: the queue keeps that order.
  if (fresh.some(g => !g.media?.front)) downloadArt('library');
  if (fresh.some(g => !g.media?.video)) downloadVideos('library', '', 'missing');
}

// ---------- start ----------
async function reload() {
  const games = await api.scan(false).catch(e => { toast('Scan failed: ' + e.message); return null; });
  if (!games) return;
  const id = S.list[S.sel]?.id;
  S.games = games; buildTabs(); setTab(S.tab, true);
  const i = S.list.findIndex(g => g.id === id); if (i >= 0) select(i, true);
}
async function init() {
  S.config = await api.getConfig();
  UISound.configure({ enabled: S.config.harbourUiSound !== false });
  applyUiVolume();
  S.uiState = await api.libraryUi().catch(() => ({}));
  S.tab = S.uiState?.system || 'all';
  renderHints();
  let games = await api.cachedLibrary().catch(() => null);
  if (!games) games = await api.scan(false);
  S.games = games || []; buildTabs(); setTab(S.tab);
  // Rescan behind the cached library; redraw only if something changed.
  api.scan(false, { onlyIfChanged: true }).then(fresh => { if (fresh) { const id = S.list[S.sel]?.id; S.games = fresh; buildTabs(); setTab(S.tab, true); const i = S.list.findIndex(g => g.id === id); if (i >= 0) select(i, true); } })
    .catch(() => {}).then(autoMedia);
  checkUpdates(false);
  // Nothing to show yet: say hello and offer the two ways in.
  if (!S.games.length) { UISound.play('open'); $('#welcomeDlg').showModal(); }
  // Emulator badges: draw them once the emulators' update checks are in.
  loadEmulators().then(() => { const id = S.list[S.sel]?.id; renderRow(); const i = S.list.findIndex(g => g.id === id); select(i >= 0 ? i : 0, true); });
  api.onToast?.(m => toast(m, 5000));
  // Descriptions, years and developers arrive from the LaunchBox database after the library shows.
  api.onLibraryInfo?.(changed => {
    for (const c of changed || []) { const g = S.games.find(x => x.id === c.gameId); if (g) g.info = c.info; }
    showGame(S.list[S.sel]);
  });
  api.onRecompProgress?.(p => {
    if (p.done) return;
    // Installs and updates run one at a time, so this is the running queue job's progress.
    // The stage is left out when it only repeats the job ("Installing X" · "Installing…") or is the download itself.
    const first = s => String(s).toLowerCase().split(/[^a-z]/)[0];
    if (Q.cur) jobProgress(!p.stage || /download/i.test(p.stage) || first(p.stage) === first(Q.cur.label) ? Q.cur.label : `${Q.cur.label} · ${p.stage}`, p.pct);
  });
  setFrozen();
}
init().catch(e => toast('Harbour failed to start: ' + e.message, 10000));

// ---------- first start ----------
$('#welcomeFolder').onclick = async () => { UISound.play('select'); $('#welcomeDlg').close(); await addGameFolder(''); };
$('#welcomePort').onclick = async () => { UISound.play('select'); $('#welcomeDlg').close(); await pickPort(); };
$('#welcomeLater').onclick = () => { UISound.play('back'); $('#welcomeDlg').close(); };

// ---------- installing well-known emulators ----------
// The catalogue step of ＋ → Emulator: each one with an Install button (or "Set up" once it's there).
async function showEmuCatalog() {
  showAddStep('addEmuPick');
  const list = await api.emulatorCatalog().catch(() => []);
  const counts = {};
  for (const g of S.games) counts[g.system] = (counts[g.system] || 0) + 1;
  // Emulators for consoles you have games for come first.
  list.sort((a, b) => Number(b.consoles.some(c => counts[c])) - Number(a.consoles.some(c => counts[c])));
  $('#emuCatalog').replaceChildren(...list.map(c => {
    const card = el('div', 'emu-cat');
    const info = el('div', 'emu-cat-info');
    info.append(el('b', '', c.name), el('small', '', c.consoles.map(sysName).join(', ') + (c.note ? ` · ${c.note}` : '')));
    const btn = el('button'); btn.type = 'button'; btn.dataset.id = c.id; btn.dataset.installed = c.installed ? '1' : '';
    btn.onclick = () => installEmulator(c);
    catalogButton(btn);
    card.append(info, btn);
    return card;
  }));
  $('#emuCatalog').querySelector('button:not([disabled])')?.focus();
}
// Installs the catalogue's emulator for each of these consoles that has none. True when they all have one after.
async function installFor(systems) {
  const catalog = await api.emulatorCatalog().catch(() => []);
  const picks = [...new Set(systems.map(id => catalog.find(c => c.consoles.includes(id))).filter(Boolean))];
  if (!picks.length) { toast(`No emulator Harbour knows plays ${systems.map(sysName).join(', ')}. Add one with ＋ → Emulator.`, 6000); return false; }
  try {
    for (const c of picks) {
      // Installed already but not set for this console: just use it.
      if (c.installed) { for (const id of systems.filter(id => c.consoles.includes(id))) await api.setSystemEmulator({ system: id, emulator: c.installed }).catch(() => {}); S.config = await api.getConfig(); await loadEmulators(false); continue; }
      if (!(await installEmulator(c))) return false;
    }
    const ok = systems.every(id => emuDef(id));
    if (!ok) toast("The emulator is set up but its program wasn't found. Fix it in Settings → Emulators.", 6000);
    return ok;
  } finally { renderRow(); select(S.sel, true); }
}
const emuDef = sysId => (S.emus || []).some(e => e.id === S.config.systems.find(s => s.id === sysId)?.emulator && e.exe);
// ---------- the download queue ----------
// Everything Harbour downloads (emulator installs, updates, artwork, game clips) waits its turn and runs one at a
// time, in the order asked for. One quiet badge shows what's running and how many are waiting; a failure gets a
// badge of its own and the queue carries on. Asking for something already waiting just waits for that one.
const Q = { list: [], cur: null, finished: 0, lastDone: '' };
const jobState = key => Q.cur?.key === key ? 'running' : Q.list.some(j => j.key === key) ? 'queued' : null;
// run(job) does the work and returns { done: 'message' } (or { fail: 'message' }, or { quiet: true } when there
// was nothing to do). Resolves true when it worked.
function enqueue(key, label, run, extra = {}) {
  const known = [Q.cur, ...Q.list].find(j => j?.key === key);
  if (known) return known.promise;
  const job = { key, label, run, text: label, pct: 0, ...extra };
  job.promise = new Promise(resolve => { job.resolve = resolve; });
  Q.list.push(job);
  queueChanged(); pumpQueue();
  return job.promise;
}
async function pumpQueue() {
  if (Q.cur || !Q.list.length) return;
  const job = Q.cur = Q.list.shift();
  queueChanged();
  let ok = false;
  try {
    const r = (await job.run(job)) || {};
    if (r.fail) { UISound.play('error'); Activity.fail('fail-' + job.key, r.fail); }
    else if (!r.quiet) { ok = true; Q.finished++; Q.lastDone = r.done || `${job.label}: done`; }
  } catch (e) { UISound.play('error'); Activity.fail('fail-' + job.key, `${job.label}: ${e.message}`); }
  Q.cur = null; job.resolve(ok);
  if (!Q.list.length) {
    if (Q.finished) Activity.done('queue', Q.finished > 1 ? `All done: ${Q.finished} downloads` : Q.lastDone);
    else Activity.end('queue', '', 'ok', '', 1);
    Q.finished = 0;
  }
  queueChanged(); pumpQueue();
}
// A button whose job is waiting or running: a spinning circle in place of its words (and how far, once it's going).
function spinnerButton(btn, label, pct = 0) {
  btn.classList.add('waiting'); btn.disabled = true; btn.title = label; btn.setAttribute('aria-label', label);
  btn.replaceChildren(el('span', 'spinner'), ...(pct > 0 && pct < 1 ? [`${Math.round(pct * 100)}%`] : []));
}
// How far the running job is: the badge, and its button in the Updates window.
function jobProgress(text, pct = 0) {
  if (!Q.cur) return;
  Q.cur.text = text; Q.cur.pct = pct;
  showQueueBadge();
  const btn = document.querySelector(`#updList button[data-key="${Q.cur.key}"]`);
  if (btn) spinnerButton(btn, 'Updating', pct);
  if (Q.cur.c) document.querySelectorAll(`#emuCatalog button[data-id="${Q.cur.c.id}"]`).forEach(catalogButton);
}
function showQueueBadge() {
  const j = Q.cur; if (!j) return;
  const pct = j.pct > 0 && j.pct < 1 ? ` ${Math.round(j.pct * 100)}%` : '';
  // The waiting count goes first so a long status line can't cut it off.
  Activity.set('queue', (Q.list.length ? `${Q.list.length} queued · ` : '') + j.text + pct, j.pct);
}
// Everything that shows the queue: the badge, the install list's buttons, Manage and the Updates window.
function queueChanged() {
  showQueueBadge();
  document.querySelectorAll('#emuCatalog button[data-id]').forEach(catalogButton);
  if ($('#emusDlg').open) renderEmulators();
  if ($('#updatesDlg').open) renderUpdates();
}
// The badges and toasts stay in front of open windows: windows sit in the browser's top layer, so these join it
// (as popovers) and step back in front each time a window opens.
const raiseNotices = () => { for (const n of [$('#activity'), $('#toast')]) try { if (n.matches(':popover-open')) n.hidePopover(); n.showPopover(); } catch {} };
{
  const showModal = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function () { showModal.call(this); raiseNotices(); };
  raiseNotices();
}

// Emulator installs (＋ → Emulator, Manage, the Install button on a game).
function installEmulator(c) {
  return enqueue('install:' + c.id, `Installing ${c.name}`, async () => {
    const r = await api.installEmulator(c.id);
    UISound.play('select');
    document.querySelectorAll(`#emuCatalog button[data-id="${c.id}"]`).forEach(b => { b.dataset.installed = '1'; });
    if (r.note) toast(`${c.name}: ${r.note}`, 6000);
    S.config = await api.getConfig();
    await loadEmulators(false); renderRow(); select(S.sel, true);
    return { done: `${c.name} installed` };
  }, { c });
}
const installState = id => ({ running: 'installing', queued: 'queued' })[jobState('install:' + id)] || null;
const installsPending = () => [Q.cur, ...Q.list].filter(j => j?.c).map(j => j.c);
function catalogButton(btn) {
  const st = btn.dataset.installed ? 'installed' : installState(btn.dataset.id);
  btn.className = st ? '' : 'primary'; btn.removeAttribute('title');
  if (st === 'installing' || st === 'queued') return spinnerButton(btn, st === 'installing' ? 'Installing' : 'Queued', st === 'installing' ? Q.cur?.pct : 0);
  btn.textContent = st === 'installed' ? 'Installed' : 'Install';
  btn.disabled = !!st;
}
// From the install list back to your emulators (Manage), and the other way with "＋ Add emulators".
$('#emuManage').onclick = () => { UISound.play('select'); $('#addDlg').close(); openEmulators(); };
$('#emuOwn').onclick = () => { UISound.play('select'); showAddStep('addEmu'); };
