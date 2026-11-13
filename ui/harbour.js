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
function toast(msg, ms = 3200) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ms); }

// ---------- library ----------
const sysOf = id => S.config.systems.find(s => s.id === id) || { id, name: id, color: '#2a4a6a' };
const visible = g => !g.hidden;
function buildTabs() {
  const counts = {};
  for (const g of S.games.filter(visible)) counts[g.system] = (counts[g.system] || 0) + 1;
  const fav = S.games.filter(g => g.favorite && visible(g)).length;
  S.tabs = [{ id: 'all', name: 'All', n: S.games.filter(visible).length },
    ...(fav ? [{ id: 'favorites', name: '★ Favourites', n: fav }] : []),
    ...S.config.systems.filter(s => counts[s.id]).sort(byRelease).map(s => ({ id: s.id, name: shortName(s.name), n: counts[s.id] }))];
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

// ---------- cover row ----------
function renderRow() {
  const row = $('#row'); row.replaceChildren();
  $('#empty').hidden = S.list.length > 0;
  S.list.forEach((g, i) => {
    const it = el('div', 'item'); it.dataset.i = i;
    const front = g.media?.frontHQ || g.media?.front;
    if (front) {
      it.style.backgroundImage = `url("${front}")`;
      const probe = new Image(); probe.onload = () => { it.style.setProperty('--ar', Math.max(.62, Math.min(1.45, probe.naturalWidth / probe.naturalHeight))); recenterSoon(); }; probe.src = front;
    } else {
      const card = el('div', 'card', g.title); card.append(el('small', '', sysOf(g.system).name));
      it.style.setProperty('--c', sysOf(g.system).color || '#2a4a6a'); it.append(card);
    }
    if (g.favorite) it.append(el('span', 'fav', '★'));
    it.onclick = () => select(i);
    it.ondblclick = () => play();
    row.append(it);
  });
  refreshBadges();
}
function refreshBadges() {
  [...$('#row').children].forEach((it, i) => {
    const g = S.list[i]; it.querySelector('.badge')?.remove();
    if (S.recomp[g?.id]?.updateAvailable) it.append(el('span', 'badge', 'UPDATE'));
  });
  const n = Object.entries(S.recomp).filter(([id, s]) => s.updateAvailable && S.games.some(g => g.id === id)).length;
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
  const url = big || (g && (g.media?.frontHQ || g.media?.front)) || '';
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
function startVideoSoon(g) {
  stopVideo();
  // While clips are being fetched for a game, its old clip isn't played (it's about to be replaced).
  if (!g?.media?.video || S.running || !S.focused || S.videoJob === 'library' || S.videoJob === g.id) return;
  videoTimer = setTimeout(() => {
    const v = $('#heroVideo');
    v.src = `${g.media.video}?v=${S.videoBust || 0}`; v.muted = !S.config.harbourVideoSound; // ?v= so a rerolled clip isn't served from cache
    v.play().then(() => v.classList.add('on')).catch(() => {});
  }, 1600);
}
function showGame(g) {
  setHero(g);
  startVideoSoon(g);
  $('#gActions').style.visibility = g ? '' : 'hidden';
  if (!g) { $('#gTitle').textContent = ''; $('#gLogo').hidden = true; $('#gMeta').replaceChildren(); $('#gDesc').textContent = ''; return; }
  const logo = $('#gLogo');
  if (g.media?.logo) { logo.src = g.media.logo; logo.alt = g.title; logo.hidden = false; $('#gTitle').textContent = ''; }
  else { logo.hidden = true; logo.removeAttribute('src'); $('#gTitle').textContent = g.title; }
  const meta = $('#gMeta'); meta.replaceChildren(el('span', 'sys', sysOf(g.system).name));
  const st = S.recomp[g.id];
  for (const x of [g.info?.year, g.info?.developer, g.info?.genre, playTime(g),
    st?.installed?.tag && `Installed ${st.installed.tag}`]) if (x) meta.append(el('span', '', x));
  if (st?.updateAvailable) meta.append(el('span', 'upd', `${st.latest.tag} available`));
  // A game file whose console has no emulator yet can't start: say so before Play is pressed.
  const sys = S.config.systems.find(s => s.id === g.system);
  if (!g.recomp && !sys?.direct && !sys?.emulator) meta.append(el('span', 'upd', 'Needs an emulator: Settings → Emulators'));
  $('#gDesc').textContent = g.info?.description || '';
  const up = $('#btnUpdate');
  up.hidden = !st?.updateAvailable; up.className = 'new';
  up.textContent = st?.updateAvailable ? (st.auto ? `⬆ Update to ${st.latest.tag}` : `⬆ ${st.latest.tag}: release page`) : '';
}
function playTime(g) {
  if (!g.playMs) return '';
  const h = g.playMs / 3600000;
  return h >= 1 ? `${h.toFixed(h < 10 ? 1 : 0)} h played` : `${Math.max(1, Math.round(g.playMs / 60000))} min played`;
}

// ---------- actions ----------
async function play(g = S.list[S.sel]) {
  if (!g || S.running) return;
  UISound.play('launch');
  try { await api.launch(g.id); toast(`Starting ${g.title}…`, 2500); }
  catch (e) { UISound.play('error'); toast(e.message, 6000); }
}
let updating = false;
async function update(g = S.list[S.sel]) {
  const st = g && S.recomp[g.id];
  if (!st?.updateAvailable) return;
  if (!st.auto) { api.recompOpenPage(g.id).then(() => toast("Release page opened. After updating, choose \"I've updated it\" in •••.", 6000)).catch(e => toast(e.message)); return; }
  if (updating) return toast('An update is already running.');
  updating = true;
  try {
    const r = await api.recompUpdate(g.id);
    S.recomp[g.id] = r; refreshBadges(); showGame(S.list[S.sel]);
    toast(`${g.title} updated to ${r.latest.tag}.` + (r.kept?.length ? ` Kept ${r.kept.length} settings file${r.kept.length === 1 ? '' : 's'}.` : ''), 7000);
  } catch (e) { toast(e.message, 7000); }
  finally { updating = false; }
}
async function checkUpdates(force = false) {
  try { Object.assign(S.recomp, await api.recompCheckAll(force)); } catch { return; }
  refreshBadges(); showGame(S.list[S.sel]);
  if (force) { const n = Object.values(S.recomp).filter(x => x.updateAvailable).length; toast(n ? `${n} update${n === 1 ? '' : 's'} available.` : 'Everything is up to date.'); }
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
    if (S.recomp[g.id]?.updateAvailable) add("I've updated it myself", async () => { S.recomp[g.id] = await api.recompMarkCurrent(g.id); refreshBadges(); showGame(g); });
    if (S.recomp[g.id]?.repo) add('Open release page', () => api.recompOpenPage(g.id).catch(e => toast(e.message)));
    add('Choose game .exe…', () => api.chooseGameExecutable(g.id).then(r => r && toast('Saved.')).catch(e => toast(e.message)));
  }
  add('Rename…', () => openRename(g));
  add('Open game folder', () => api.openGameFolder(g.id).catch(e => toast(e.message)));
  add('Download artwork for this game', () => downloadArt('game', g.id));
  if (g.media?.video) {
    add('🎲 Reroll clip (another bit of the same longplay)', () => downloadVideos('game', g.id, 'reroll'));
    add('Find a different longplay', () => downloadVideos('game', g.id, 'new'));
  } else add('Get a video for this game', () => downloadVideos('game', g.id, 'missing'));
  add('Hide from Harbour', async () => { await api.setHidden({ gameId: g.id, hidden: true }); g.hidden = true; buildTabs(); setTab(S.tab); toast(`${g.title} hidden.`); });
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
  f.auto.checked = !!cur.source?.auto; f.asset.value = cur.source?.asset || ''; f.installedTag.value = cur.installed?.tag || '';
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
  for (const id of ['addPick', 'addPort', 'addRom', 'addEmu']) $('#' + id).hidden = id !== step;
  $('#' + step).querySelector('select, input, button')?.focus();
}
async function openAdd() {
  UISound.play('open');
  const port = $('#addPort'), rom = $('#addRom');
  port.platform.replaceChildren(option('', 'No console (Recomp shelf)'), ...consoles().map(s => option(s.id, s.name)));
  port.platform.value = S.tab !== 'all' && S.tab !== 'favorites' ? S.tab : '';
  rom.platform.replaceChildren(...consoles().map(s => option(s.id, s.name)));
  rom.platform.value = consoles().some(s => s.id === S.tab) ? S.tab : 'n64';
  await fillRomEmulators();
  $('#emuSystems').replaceChildren(...consoles().map(s => { const l = el('label', 'check'); const c = el('input'); c.type = 'checkbox'; c.value = s.id; l.append(c, s.name); return l; }));
  for (const f of [port, rom, $('#addEmu')]) f.querySelectorAll('input[type=text], input:not([type])').forEach(i => { if (i.name !== 'args') i.value = ''; });
  showAddStep('addPick');
  $('#addDlg').showModal();
}
async function fillRomEmulators() {
  const rom = $('#addRom'), sys = S.config.systems.find(s => s.id === rom.platform.value);
  const emus = await emulatorsFor(rom.platform.value);
  const fitting = emus.filter(e => (e.systems || []).includes(rom.platform.value));
  rom.emulator.replaceChildren(...emus.map(e => option(e.id, e.name + (fitting.includes(e) ? '' : ' (not set up for this console)'))),
    option('', fitting.length ? 'None for now' : 'None yet: add one with ＋ → Emulator first'));
  // Only suggest an emulator that's actually meant for this console.
  rom.emulator.value = emus.some(e => e.id === sys?.emulator) ? sys.emulator : fitting[0]?.id || '';
}
$('#addRom').platform.onchange = fillRomEmulators;
$('#btnAdd').onclick = openAdd;
for (const b of document.querySelectorAll('#addDlg .choice')) b.onclick = () => { UISound.play('select'); showAddStep({ port: 'addPort', rom: 'addRom', emu: 'addEmu' }[b.dataset.kind]); };
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
  toast(`Added ${g.title}. Getting its artwork and a gameplay clip… (rename it in ••• if the name's wrong)`, 7000);
  await downloadArt('game', g.id);
  const waitArt = setInterval(async () => { if (!S.artBusy) { clearInterval(waitArt); downloadVideos('game', g.id, 'missing'); } }, 1500);
}
$('#addPort').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target;
  try {
    const entry = await api.addPort({ platform: f.platform.value, title: f.title.value, repo: f.repo.value, auto: f.auto.checked });
    if (entry) afterAdd(g => g.added === entry.id, entry.title);
  } catch (err) { UISound.play('error'); toast(err.message, 6000); }
});
$('#addRom').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, system = f.platform.value;
  try {
    const sys = S.config.systems.find(s => s.id === system);
    if (f.emulator.value && f.emulator.value !== sys?.emulator) { await api.setSystemEmulator({ system, emulator: f.emulator.value }); S.config = await api.getConfig(); }
    const entry = await api.gameAdd({ system, title: f.title.value });
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
    toast(`${r.name} added${systems.length ? ` for ${systems.map(id => shortName(S.config.systems.find(s => s.id === id)?.name || id)).join(', ')}` : ''}. Add games for it with ＋ → Game for an emulator.`, 7000);
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
  // Only emulators you have: ones you added, and downloadable ones that are actually installed.
  const mine = all.filter(e => e.custom || e.exe);
  // Consoles worth listing: ones with games, or ones an emulator is set up for.
  const counts = {}; for (const g of S.games) counts[g.system] = (counts[g.system] || 0) + 1;
  const listed = consoles().filter(s => counts[s.id] || mine.some(e => (e.systems || []).includes(s.id)));
  const rows = listed.map(s => {
    const row = el('div', 'emu-console');
    const label = el('span', '', s.name); if (counts[s.id]) label.append(el('small', '', ` · ${counts[s.id]} game${counts[s.id] === 1 ? '' : 's'}`));
    const pick = el('select');
    const fits = mine.filter(e => (e.systems || []).includes(s.id)), others = mine.filter(e => !fits.includes(e));
    pick.append(option('', s.direct ? 'Runs by itself' : 'None'), ...fits.map(e => option(e.id, e.name)), ...others.map(e => option(e.id, `${e.name} (not set up for ${shortName(s.name)})`)));
    pick.value = mine.some(e => e.id === s.emulator) ? s.emulator : '';
    pick.onchange = async () => {
      try { await api.setSystemEmulator({ system: s.id, emulator: pick.value }); UISound.play('select'); toast(`${shortName(s.name)} games now start with ${pick.selectedOptions[0].textContent.replace(/ \(not set up.*$/, '')}.`); }
      catch (e) { UISound.play('error'); toast(e.message); }
    };
    // Recomps run themselves, so a console whose games are all PC ports doesn't need an emulator.
    const recomps = S.games.filter(g => g.system === s.id && g.recomp).length;
    if (recomps && recomps === counts[s.id] && !pick.value) { pick.options[0].textContent = 'Not needed (PC ports run by themselves)'; pick.classList.add('quiet'); }
    row.append(label, pick); return row;
  });
  $('#emuConsoles').replaceChildren(...(rows.length ? rows : [el('p', 'note', 'No consoles yet.')]));
  const cards = mine.map(e => {
    const card = el('div', 'emu-card');
    const head = el('div', 'emu-head'); head.append(el('b', '', e.name), el('small', '', e.exe ? e.exe : 'Program not found: choose it again'));
    const chips = el('div', 'chips');
    const used = S.config.systems.filter(s => s.emulator === e.id).map(s => s.id);
    for (const id of e.systems || []) chips.append(el('span', 'chip' + (used.includes(id) ? ' on' : ''), sysName(id)));
    if (!(e.systems || []).length) chips.append(el('span', 'note', 'No consoles chosen'));
    const btns = el('div', 'emu-btns');
    const b = (text, fn, cls = '') => { const x = el('button', cls, text); x.type = 'button'; x.onclick = fn; btns.append(x); };
    if (e.custom) b('Consoles…', () => editEmuConsoles(e, card));
    b('Change program…', async () => { const r = await api.emuPickExe(e.id).catch(err => toast(err.message)); if (r) { toast(`${e.name} now uses ${r.exe.split(/[\\/]/).pop()}.`); renderEmulators(); } });
    b('Open folder', () => api.emuOpenFolder(e.id).catch(err => toast(err.message)));
    if (e.custom) b('Remove', async () => {
      if (!confirm(`Remove ${e.name} from Harbour? Its files stay where they are; consoles that used it will have no emulator.`)) return;
      try { await api.emuRemove(e.id); UISound.play('back'); toast(`${e.name} removed.`); renderEmulators(); } catch (err) { toast(err.message); }
    }, 'danger');
    card.append(head, chips, btns); return card;
  });
  $('#emuCards').replaceChildren(...(cards.length ? cards : [el('p', 'note', 'No emulators yet. Add one below.')]));
  renderGameFolders();
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
    const missing = [...new Set(r.added.map(a => a.system))].filter(id => !S.config.systems.find(s => s.id === id)?.emulator);
    if (missing.length) toast(`Pick an emulator for ${missing.map(sysName).join(', ')} above so those games can start.`, 8000);
    const fresh = S.games.filter(g => r.added.some(a => a.system === g.system) && !g.media?.front && !g.recomp);
    // New games get their artwork, then a gameplay clip each, without being asked.
    if (fresh.length) { S.afterArt = () => downloadVideos('library', '', 'missing'); await downloadArt('library'); }
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
$('#emusAdd').onclick = async () => { $('#emusDlg').close(); await openAdd(); showAddStep('addEmu'); };

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
  $('#setIdle').value = String(S.config.harbourIdle ?? 120);
  $('#setSound').value = S.config.harbourVideoSound ? '1' : '0';
  $('#setUiSound').value = S.config.harbourUiSound === false ? '0' : '1';
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
$('#setSound').onchange = e => { saveSetting({ harbourVideoSound: e.target.value === '1' }); $('#heroVideo').muted = e.target.value !== '1'; };
$('#setCheck').onclick = () => { $('#settings').close(); toast('Checking for updates…'); checkUpdates(true); };
$('#setArt').onclick = () => { $('#settings').close(); downloadArt('library'); };
$('#setVideos').onclick = () => { $('#settings').close(); downloadVideos('library'); };
async function downloadVideos(scope, gameId, mode = 'missing') {
  // Let go of the clip first: Windows won't replace a video file that's still playing.
  if (mode !== 'missing') { S.videoJob = scope === 'game' ? gameId : 'library'; stopVideo(); }
  try {
    await api.videoStart({ scope, gameId, mode });
    toast(mode === 'reroll' ? 'Rerolling the clip…' : mode === 'new' ? 'Looking for a different longplay…' : 'Getting game videos…', 5000);
  } catch (e) { S.videoJob = null; UISound.play('error'); toast(e.message, 5000); startVideoSoon(S.list[S.sel]); }
}
api.onVideoProgress?.(job => {
  if (job && job.status !== 'running') S.videoJob = null; // finished: clips can play again
  if (!job) return;
  if (job.status === 'running') { toast(job.total > 1 && job.done ? `Videos: ${job.done} of ${job.total} · ${job.stage}` : job.stage, 5000); return; }
  if (job.status === 'failed') { toast('Videos stopped: ' + job.stage, 8000); startVideoSoon(S.list[S.sel]); return; }
  toast(job.total === 1 ? (job.saved ? 'New clip ready.' : job.failed ? `Couldn't get a clip: ${job.errors?.[0]?.split(': ').slice(1).join(': ') || 'unknown error'}` : 'No gameplay video found for this game.')
    : `Videos done: ${job.saved} saved` + (job.noLink ? `, ${job.noLink} had no video link` : '') + (job.failed ? `, ${job.failed} failed` : '') + '.', 8000);
  S.videoBust = Date.now();
  reload().then(() => { if (job.total === 1) startVideoSoon(S.list[S.sel]); });
});
async function downloadArt(scope, gameId) {
  if (S.artBusy) return toast('Artwork is already downloading.');
  try { await api.artStart({ scope, gameId, types: ['front', 'fanart', 'logo', 'screenshot'], retryMissing: true, upgrade: false }); S.artBusy = true; toast('Downloading artwork…'); }
  catch (e) { toast(e.message, 5000); }
}
api.onArtProgress?.(job => {
  if (!job) return;
  if (job.status === 'running') { if (job.total > 1) toast(`Artwork: ${job.completed} of ${job.total} · ${job.lastTitle || ''}`, 4000); return; }
  if (S.artBusy) {
    S.artBusy = false; toast(`Artwork done: ${job.downloaded} new image${job.downloaded === 1 ? '' : 's'}.`, 5000);
    reload().then(() => { const next = S.afterArt; S.afterArt = null; next?.(); });
  }
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
      ok: b(0), back: b(1), more: b(2), update: b(3), tabprev: b(4), tabnext: b(5), pgleft: b(6), pgright: b(7), settings: b(9) };
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
addEventListener('focus', () => { S.focused = true; setFrozen(); });
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
  const h = [['A', 'Play'], ['Y', 'Update'], ['X', 'More'], ['LB RB', 'Console'], ['Start', 'Settings'], ['Back+Start (hold)', 'Close game']];
  $('#hints').replaceChildren(...h.map(([k, t]) => { const s = el('span'); s.append(el('kbd', '', k), t); return s; }));
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
  S.uiState = await api.libraryUi().catch(() => ({}));
  S.tab = S.uiState?.system || 'all';
  renderHints();
  let games = await api.cachedLibrary().catch(() => null);
  if (!games) games = await api.scan(false);
  S.games = games || []; buildTabs(); setTab(S.tab);
  // Rescan behind the cached library; redraw only if something changed.
  api.scan(false, { onlyIfChanged: true }).then(fresh => { if (fresh) { const id = S.list[S.sel]?.id; S.games = fresh; buildTabs(); setTab(S.tab, true); const i = S.list.findIndex(g => g.id === id); if (i >= 0) select(i, true); } }).catch(() => {});
  if (S.games.some(g => g.recomp)) checkUpdates(false);
  if (S.games.length && !S.games.some(g => g.media?.fanart || g.media?.front)) toast('No artwork yet: open Settings (Start) → Download covers, backgrounds and logos.', 8000);
  api.onToast?.(m => toast(m, 5000));
  // Descriptions, years and developers arrive from the LaunchBox database after the library shows.
  api.onLibraryInfo?.(changed => {
    for (const c of changed || []) { const g = S.games.find(x => x.id === c.gameId); if (g) g.info = c.info; }
    showGame(S.list[S.sel]);
  });
  api.onRecompProgress?.(p => toast(p.done ? 'Update installed.' : `${p.stage}${p.pct && p.pct < 1 ? ` ${Math.round(p.pct * 100)}%` : ''}`, 4000));
  setFrozen();
}
init().catch(e => toast('Harbour failed to start: ' + e.message, 10000));
