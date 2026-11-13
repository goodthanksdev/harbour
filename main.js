// Harbour: settings, library scanning, artwork, launching, recomp updates and game videos.
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
if (process.platform === 'win32') app.commandLine.appendSwitch('force-high-performance-gpu');
app.setName('Harbour');
if (process.platform === 'win32') app.setAppUserModelId('local.harbour.launcher');
// Harbour stays open behind a running game. Without this, Windows reports the covered window as
// hidden and Chromium stops reading controllers, so "hold to quit" would never be seen.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const { randomUUID, createHash } = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { pathToFileURL } = require('url');
const { createArtworkService } = require('./artwork');
const { createLaunchBox } = require('./launchbox');
const { createVideoService } = require('./videos');

const ROOT = __dirname;
const APP_VERSION = require('./package.json').version;
// Settings, artwork, videos and logs live in ./data next to Harbour.
const DATA = path.join(ROOT, 'data');
const LOG_PATH = path.join(DATA, 'logs', 'harbour.log');
function log(...parts) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    try { if (fs.statSync(LOG_PATH).size > 512 * 1024) fs.renameSync(LOG_PATH, LOG_PATH + '.old'); } catch {}
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${parts.map(p => typeof p === 'string' ? p : JSON.stringify(p)).join(' ')}\n`);
  } catch {}
}
log(`start ${APP_VERSION}`, { electron: process.versions.electron });
process.on('uncaughtExceptionMonitor', e => log('error', e?.stack || String(e)));
app.on('child-process-gone', (_e, d) => log('child process gone', d));
app.on('render-process-gone', (_e, _w, d) => log('window process gone', d));
app.whenReady().then(() => log('ready')).catch(e => log('not ready', e?.stack || String(e)));
const CONFIG_PATH = path.join(DATA, 'config.json');
const UA = { 'User-Agent': 'Harbour', Accept: 'application/vnd.github+json' };

// ---------- Systems ----------
// Each console: its file types, colour (for cards without art) and libretro name (for artwork).
const DEFAULT_SYSTEMS = [
  // Sony
  { id: 'ps1', name: 'PlayStation', color: '#9aa3ad', extensions: ['.m3u', '.cue', '.chd', '.pbp'], emulator: '', libretro: 'Sony - PlayStation' },
  { id: 'ps2', name: 'PlayStation 2', color: '#1d3f8f', extensions: ['.iso', '.chd', '.cso', '.gz'], emulator: '', libretro: 'Sony - PlayStation 2' },
  { id: 'ps3', name: 'PlayStation 3', color: '#2b2b2b', extensions: ['.iso'], emulator: '', libretro: 'Sony - PlayStation 3' },
  { id: 'ps4', name: 'PlayStation 4', color: '#1a4fb5', extensions: ['.pkg'], emulator: '' },
  { id: 'psp', name: 'PSP', color: '#111111', extensions: ['.iso', '.cso', '.chd'], emulator: '', libretro: 'Sony - PlayStation Portable' },
  // Nintendo
  { id: 'switch', name: 'Nintendo Switch', color: '#e60012', extensions: ['.nsp', '.xci', '.nsz'], emulator: '', artworkProvider: 'gametdb-switch' },
  { id: 'switch2', name: 'Nintendo Switch 2', color: '#d0021b', extensions: ['.nsp', '.xci', '.nsz', '.xcz', '.nup'], emulator: '', artworkProvider: 'gametdb-switch' },
  { id: 'wiiu', name: 'Wii U', color: '#1a9ad6', extensions: ['.wua', '.wud', '.wux', '.rpx'], emulator: '', libretro: 'Nintendo - Wii U' },
  { id: 'wii', name: 'Wii', color: '#e9eef2', extensions: ['.rvz', '.wbfs', '.iso'], emulator: '', libretro: 'Nintendo - Wii' },
  { id: 'gc', name: 'GameCube', color: '#5a4a9c', extensions: ['.rvz', '.iso', '.gcm', '.ciso'], emulator: '', libretro: 'Nintendo - GameCube' },
  { id: 'n64', name: 'Nintendo 64', color: '#2a7d3a', extensions: ['.z64', '.n64', '.v64'], emulator: '', libretro: 'Nintendo - Nintendo 64' },
  { id: 'snes', name: 'Super Nintendo', color: '#7b6fb5', extensions: ['.sfc', '.smc'], emulator: '', libretro: 'Nintendo - Super Nintendo Entertainment System' },
  { id: 'nes', name: 'NES', color: '#c4262e', extensions: ['.nes', '.zip'], emulator: '', libretro: 'Nintendo - Nintendo Entertainment System' },
  { id: '3ds', name: 'Nintendo 3DS', color: '#d41e2a', extensions: ['.3ds', '.cci', '.cxi', '.cia'], emulator: '', libretro: 'Nintendo - Nintendo 3DS' },
  { id: 'nds', name: 'Nintendo DS', color: '#c9c9c9', extensions: ['.nds', '.zip'], emulator: '', libretro: 'Nintendo - Nintendo DS' },
  { id: 'gba', name: 'Game Boy Advance', color: '#4b3a9b', extensions: ['.gba', '.zip'], emulator: '', libretro: 'Nintendo - Game Boy Advance' },
  { id: 'gbc', name: 'Game Boy Color', color: '#7a3fb0', extensions: ['.gbc', '.zip'], emulator: '', libretro: 'Nintendo - Game Boy Color' },
  { id: 'gb', name: 'Game Boy', color: '#8b8f6a', extensions: ['.gb', '.zip'], emulator: '', libretro: 'Nintendo - Game Boy' },
  // Sega / Microsoft / other
  { id: 'dreamcast', name: 'Dreamcast', color: '#e8e8e8', extensions: ['.chd', '.gdi', '.cdi'], emulator: '', libretro: 'Sega - Dreamcast' },
  { id: 'genesis', name: 'Sega Genesis', color: '#1b1b1b', extensions: ['.md', '.gen', '.smd', '.zip'], emulator: '', libretro: 'Sega - Mega Drive - Genesis' },
  { id: 'xbox', name: 'Xbox', color: '#1c8a2e', extensions: ['.iso', '.xiso'], emulator: '', libretro: 'Microsoft - Xbox' },
  { id: 'x360', name: 'Xbox 360', color: '#7cbb00', extensions: ['.iso', '.xex', '.zar'], emulator: '', libretro: 'Microsoft - Xbox 360' },
  // PC: a folder of shortcuts (.lnk, Steam .url) or game programs. Games start directly, no emulator.
  { id: 'recomp', name: 'Recomp', color: '#a685ff', extensions: ['.exe'], emulator: '', direct: true },
  { id: 'pc', name: 'PC Games', color: '#3b82f6', extensions: ['.lnk', '.url', '.exe'], emulator: '', direct: true },
  { id: 'a2600', name: 'Atari 2600', color: '#a0522d', extensions: ['.a26', '.zip'], emulator: '', libretro: 'Atari - 2600' },
  { id: 'arcade', name: 'Arcade', color: '#d4a017', extensions: ['.zip'], emulator: '', libretro: 'MAME' },
];
// Folders inside ROM folders that hold extras rather than games.
const SKIP_DIRS = /^(source archives|_extras|extras|texture packs|saves?|states|bios|cheats|patches|media|images|manuals|downloaded_media|covers|screenshots)$/i;

function defaultConfig() {
  return {
    fullscreen: false,
    systems: DEFAULT_SYSTEMS.map(s => ({ ...s, romDir: '' })),
    emulators: {},        // per emulator: { exe } when its program was moved
    customEmulators: [],  // { id, name, exe, args, systems: [] }
    extraGames: [],       // games added one by one: { id, system, path, title } (+ recomp fields)
  };
}

let configWarning = null;
function loadConfig() {
  let text;
  try { text = fs.readFileSync(CONFIG_PATH, 'utf8'); } catch { return defaultConfig(); } // first run
  try {
    const saved = JSON.parse(text);
    if (!saved || !Array.isArray(saved.systems)) throw new Error('missing systems');
    saved.emulators ||= {};
    saved.customEmulators ||= [];
    saved.extraGames ||= [];
    const def = defaultConfig();
    // Keep new default systems appearing for older configs.
    const ids = new Set(saved.systems.map(s => s.id));
    for (const s of def.systems) if (!ids.has(s.id)) saved.systems.push(s);
    // Fill in fields added in newer versions (libretro name, case shape…).
    saved.systems = saved.systems.map(s => ({ ...(def.systems.find(d => d.id === s.id) || {}), ...s }));
    // File types added to a built-in system after release reach existing settings once; a type the
    // user removes afterwards stays removed.
    const done = new Set(saved.migrations || []);
    for (const [key, sysId, ext] of [['ext-switch2-nup', 'switch2', '.nup']]) {
      if (done.has(key)) continue;
      const sys = saved.systems.find(s => s.id === sysId);
      if (sys && Array.isArray(sys.extensions) && !sys.extensions.includes(ext)) sys.extensions = [...sys.extensions, ext];
      done.add(key);
    }
    saved.migrations = [...done];
    return { ...def, ...saved };
  } catch (e) {
    // Keep the damaged file instead of letting the next save overwrite it with defaults.
    const backup = `${CONFIG_PATH}.broken-${Date.now()}`;
    try { fs.copyFileSync(CONFIG_PATH, backup); } catch {}
    console.error(`config.json could not be read (${e.message}); a copy was kept at ${backup}`);
    configWarning = `Your settings file was damaged, so defaults were loaded. The old file was kept as ${path.basename(backup)} in the data folder.`;
    return defaultConfig();
  }
}
function saveConfig(cfg) {
  fs.mkdirSync(DATA, { recursive: true });
  // Write to a temp file and swap it in, so a crash mid-save can't leave a half-written config.
  const tmp = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, CONFIG_PATH);
}
let config = loadConfig();

// ---------- Library state: favourites, play time, last selection ----------
// Kept apart from config.json: it changes after every game and every selection, and the window's
// "Save & rescan" (which sends a whole config) must never overwrite it.
const STATE_PATH = path.join(DATA, 'library-state.json');
const emptyState = () => ({ favorites: {}, hidden: {}, titles: {}, metadata: {}, order: {}, stats: {}, discs: {}, ui: {} });
function loadState() {
  try { const s = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); return { ...emptyState(), ...(s && typeof s === 'object' ? s : {}) }; }
  catch { return emptyState(); }
}
let libraryState = loadState(), stateTimer = null;
function writeState() {
  clearTimeout(stateTimer); stateTimer = null;
  try {
    fs.mkdirSync(DATA, { recursive: true });
    const tmp = `${STATE_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(libraryState));
    fs.renameSync(tmp, STATE_PATH);
  } catch (e) { console.error(`library-state.json could not be saved: ${e.message}`); }
}
const saveState = () => { clearTimeout(stateTimer); stateTimer = setTimeout(writeState, 800); };
// What the window needs to know about one game: favourite, hidden, play time, last played, chosen disc.
function gameState(id) {
  const st = libraryState.stats[id] || {};
  const metadata = libraryState.metadata?.[id] || {};
  const customTitle = metadata.title || libraryState.titles?.[id] || '';
  return { ...metadata, customTitle, hidden: !!libraryState.hidden?.[id], favorite: !!libraryState.favorites[id], playMs: st.ms || 0, lastPlayed: st.last || 0, plays: st.plays || 0, disc: libraryState.discs[id] || 0 };
}

// ---------- Library scanning ----------
const IMG = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
// For each media kind: names used in per-game folders, and ES-DE / Skraper style folder names.
const KINDS = {
  front:      { names: ['front', 'cover', 'box-front', 'boxfront', 'box'], folders: ['covers', 'box2dfront', 'boxart'], exts: IMG },
  frontHQ:    { names: ['front-hq'], folders: ['cover-hq'], exts: IMG },
  back:       { names: ['back', 'box-back', 'boxback'], folders: ['backcovers', 'box2dback'], exts: IMG },
  spine:      { names: ['spine', 'box-spine', 'side'], folders: ['spines', 'box2dside'], exts: IMG },
  disc:       { names: ['disc', 'cd', 'cart', 'cartridge', 'media', 'physicalmedia'], folders: ['physicalmedia', 'discs', 'support'], exts: IMG },
  manual:     { names: ['manual'], folders: ['manuals'], exts: ['.pdf'] },
  screenshot: { names: ['screenshot', 'snap', 'screen'], folders: ['screenshots', 'snaps', 'images'], exts: IMG },
  title:      { names: ['title', 'titlescreen'], folders: ['titlescreens', 'titles'], exts: IMG },
  fanart:     { names: ['fanart', 'background', 'bg'], folders: ['fanart', 'backgrounds'], exts: IMG },
  logo:       { names: ['logo', 'marquee', 'wheel'], folders: ['marquees', 'wheel', 'logos'], exts: IMG },
  video:      { names: ['video', 'trailer'], folders: ['videos'], exts: ['.mp4', '.webm'] },
};

// During a scan each folder is listed once: the ROM walk, the media index and the per-game media
// lookup all ask for the same folders, and on a hard drive every listing costs a seek.
let scanListings = null;
async function listDir(dir) {
  const cache = scanListings, key = cache && dir.toLowerCase();
  if (cache?.has(key)) return cache.get(key);
  const listing = fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  cache?.set(key, listing);
  return listing;
}
// Runs fn over items with at most `limit` running at once, results in input order. Scans are mostly
// waiting on the disk, so overlapping the waits is where the time goes.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
const SCAN_CONCURRENCY = 16;
const stem = f => path.basename(f, path.extname(f)).toLowerCase();
const fileUrl = p => (p ? pathToFileURL(p).href : null);

function cleanTitle(name) {
  return name.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '')
    .replace(/_/g, ' ')
    .replace(/^\d{3,5}\s*-?\s+(?=\S)/, '')          // release numbers: "0004 - Zelda", "1158 Zelda"
    .replace(/\s*\b(decrypted|encrypted)\b\s*$/i, '')
    .replace(/\s+/g, ' ').trim() || name;
}
// "Legend of Zelda, The - Ocarina" -> "The Legend of Zelda - Ocarina" (display only)
const displayTitle = s => cleanTitle(s).replace(/^(.+?),? (The|A|An)(?= - |$)/, '$2 $1');

// Index a media root once: folder-per-game dirs + ES-DE style kind folders.
// Kind folders (covers, manuals…) are found directly in a root or one level down, so extras kept
// in e.g. "00 Goodies\Manuals" are picked up too. Files are matched by exact name, then loosely by
// title ("Game (USA).pdf" for "Game (USA) (Rev 1).rvz").
async function indexMediaRoot(root) {
  // files: every file seen in a kind folder (lower-case path), so side files such as a disc's
  // .json can be checked without trying to read files that aren't there.
  const idx = { gameDirs: new Map(), kinds: {}, loose: {}, files: new Set() };
  const kindOf = name => Object.entries(KINDS).find(([, k]) => k.folders.includes(name.toLowerCase()));
  async function addKindFolder(dir, [kind, k], entries) {
    const m = (idx.kinds[kind] ||= new Map()), loose = (idx.loose[kind] ||= new Map());
    for (const f of entries ?? await listDir(dir)) {
      if (f.isFile()) idx.files.add(path.join(dir, f.name).toLowerCase());
      if (!f.isFile() || !k.exts.includes(path.extname(f.name).toLowerCase())) continue;
      const file = path.join(dir, f.name);
      if (!m.has(stem(f.name))) m.set(stem(f.name), file);
      const key = looseKey(path.basename(f.name, path.extname(f.name)));
      for (const k of [key, bareKey(path.basename(f.name, path.extname(f.name)))]) if (k && !loose.has(k)) loose.set(k, file);
    }
  }
  // Folders are listed in parallel but added in their listed order, so "first match wins" is unchanged.
  const dirs = (await listDir(root)).filter(e => e.isDirectory());
  const listed = await mapLimit(dirs, SCAN_CONCURRENCY, async e => {
    const kind = kindOf(e.name), dir = path.join(root, e.name);
    if (kind) return { kind, dir, entries: await listDir(dir) };
    const subs = (await listDir(dir)).filter(sub => sub.isDirectory() && kindOf(sub.name));
    return { dir, subs: await Promise.all(subs.map(async sub => ({ kind: kindOf(sub.name), dir: path.join(dir, sub.name), entries: await listDir(path.join(dir, sub.name)) }))) };
  });
  for (const [i, e] of dirs.entries()) {
    const l = listed[i];
    if (l.kind) { await addKindFolder(l.dir, l.kind, l.entries); continue; }
    idx.gameDirs.set(e.name.toLowerCase(), l.dir);
    for (const sub of l.subs) await addKindFolder(sub.dir, sub.kind, sub.entries);
  }
  return idx;
}

async function findMedia(indexes, base) {
  const key = base.toLowerCase();
  const media = {}, seen = new Set();
  let info = null;
  for (const idx of indexes) {
    const dir = idx.gameDirs.get(key) || idx.gameDirs.get(cleanTitle(base).toLowerCase());
    if (dir) {
      const files = (await listDir(dir)).filter(f => f.isFile());
      for (const f of files) seen.add(path.join(dir, f.name).toLowerCase());
      for (const [kind, k] of Object.entries(KINDS)) {
        if (media[kind]) continue;
        const hit = k.names.map(name=>files.filter(f=>stem(f.name)===name&&k.exts.includes(path.extname(f.name).toLowerCase())).sort((a,b)=>(path.extname(a.name).toLowerCase()==='.png'?0:1)-(path.extname(b.name).toLowerCase()==='.png'?0:1))[0]).find(Boolean);
        if (hit) media[kind] = path.join(dir, hit.name);
      }
      const inf = files.find(f => f.name.toLowerCase() === 'info.json');
      if (inf && !info) try { info = JSON.parse(await fsp.readFile(path.join(dir, inf.name), 'utf8')); } catch {}
    }
    for (const [kind, m] of Object.entries(idx.kinds)) if (!media[kind] && m.has(key)) media[kind] = m.get(key);
  }
  const loose = looseKey(base);
  for (const k of [loose, bareKey(base)]) if (k) for (const idx of indexes) for (const [kind, m] of Object.entries(idx.loose || {})) if (!media[kind] && m.has(k)) media[kind] = m.get(k);
  // Whether a file next to the found media exists, from the folder listings already made.
  const has = p => { const lower = p.toLowerCase(); return seen.has(lower) || indexes.some(idx => idx.files?.has(lower)); };
  return { media, info, has };
}

// Minimal EmulationStation gamelist.xml reader.
async function readGamelist(dir) {
  const map = new Map();
  let xml;
  try { xml = await fsp.readFile(path.join(dir, 'gamelist.xml'), 'utf8'); } catch { return map; }
  const tag = (s, t) => { const m = s.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1].trim()) : undefined; };
  const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  for (const g of xml.match(/<game[\s>][\s\S]*?<\/game>/g) || []) {
    const p = tag(g, 'path'); if (!p) continue;
    const rd = tag(g, 'releasedate');
    map.set(stem(p), {
      title: tag(g, 'name'), description: tag(g, 'desc'), developer: tag(g, 'developer'),
      publisher: tag(g, 'publisher'), genre: tag(g, 'genre'), players: tag(g, 'players'),
      year: rd ? rd.slice(0, 4) : undefined,
    });
  }
  return map;
}

// Walk a ROM folder (and its sub-folders) collecting files with matching extensions.
const exists = p => fsp.access(p).then(() => true, () => false);
async function walkRoms(dir, exts, depth = 0, out = [], rootEntries) {
  const entries = rootEntries ?? await listDir(dir);
  // Decrypted Switch / Switch 2 dumps are folders: <game>\base\exefs\main (+ romfs), or <game>\exefs\main.
  // The whole folder counts as one game, launched through its exefs\main. Only folders that
  // actually contain base\ or exefs\ are checked, so normal folders cost no extra disk access.
  if (exts.includes('.nsp') && entries.some(e => e.isDirectory() && /^(base|exefs)$/i.test(e.name))) {
    for (const main of [path.join(dir, 'base', 'exefs', 'main'), path.join(dir, 'exefs', 'main')]) {
      if (!(await exists(main))) continue;
      const label = path.basename(dir).replace(/([a-z])([A-Z])/g, '$1 $2'); // DonkeyKongBananza -> Donkey Kong Bananza
      out.push({ name: label + '.dump', path: main, size: 9e9, dump: true });
      return out;
    }
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 4 && !SKIP_DIRS.test(e.name)) await walkRoms(p, exts, depth + 1, out); }
    else if (exts.includes(path.extname(e.name).toLowerCase())) {
      out.push({ name: e.name, path: p });
    }
  }
  return out;
}

// Loose key for matching names across naming schemes: "Pokémon - Ruby (U) [!]" -> "pokemonruby".
const looseKey = s => cleanTitle(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&|\band\b|\bthe\b/g, '').replace(/[^a-z0-9]/g, '');

// The same key without a leading brand ("Nickelodeon SpongeBob…", "DreamWorks Shrek…"), which
// manual and artwork collections often leave out. Only used as a last resort.
// Works on the original name, where "Nickelodeon's" and "Nickelodeon SpongeBob" can still be told apart.
const BRAND = /^\s*(disney\s*[-•]?\s*pixar|disney|pixar|dreamworks|nickelodeon|nicktoons)('s)?\b[\s:-]*/i;
const bareKey = name => { if (!BRAND.test(cleanTitle(name))) return ''; const b = looseKey(cleanTitle(name).replace(BRAND, '')); return b.length >= 6 ? b : ''; };

// Nintendo Switch dumps write the 16-digit title ID into the file name:
// "Game [0100ABCD12345000][v0].nsp". A game's update ends in …800 and its downloadable content in
// …1000 and up, so clearing the low 13 bits of any of them gives the base game's own ID. Nintendo
// never hands out a base ID inside that range, so two different games can never collide here.
const TITLE_ID = /\[([0-9a-f]{16})\]/i;
function switchTitleId(name) {
  const m = name.match(TITLE_ID);
  if (!m) return null;
  const id = BigInt('0x' + m[1]);
  // part: 0 = the game itself, 0x800 = its update, 0x1000 and up = one of its DLC packs.
  return { base: (id & ~0x1fffn).toString(16).padStart(16, '0'), part: Number(id & 0x1fffn) };
}
// Updates and DLC join the game they belong to instead of each becoming a game of their own.
const switchGroup = name => switchTitleId(name)?.base || '';

// When the same game appears more than once, keep the best copy.
function copyScore(f, titleIds) {
  const n = f.name;
  let s = 0;
  if (/\((u|usa|us|e|eu|europe|world|en)\b|\(usa?,|\[usa?\]|\(ue\)/i.test(n)) s += 4;
  if (/\((j|jp|japan)\)/i.test(n)) s -= 2;
  if (/\[!\]/.test(n)) s += 2;
  if (/\b(update|upd|dlc)\b|\[v[1-9]\d*\]|\(beta|\(proto|\(demo|\(hack|\[(b|h|t|o)\d*\]/i.test(n)) s -= 6;
  if (!/\.zip$/i.test(n)) s += 1;
  // Switch: the game itself is what you launch, so it beats its own update and DLC files.
  if (titleIds) { const id = switchTitleId(n); if (id) s += id.part === 0 ? 8 : -8; }
  return s;
}

// Only tied copies need a size check. Keep the existing 9 GB cap on the tie-break.
// Sizes of tied copies are remembered in the library cache: on a hard drive (and with antivirus
// opening every .zip) reading them is most of a scan. A full rescan from Settings reads them again.
// knownSizes: from the cache; scanSizes: the sizes this scan used, saved for the next one.
let knownSizes = null, scanSizes = null, rereadSizes = false;
async function copySize(file) {
  if (file.size === undefined && !rereadSizes && knownSizes?.has(file.path)) file.size = knownSizes.get(file.path);
  if (file.size === undefined) {
    try { file.size = (await fsp.stat(file.path)).size; } catch { file.size = 0; }
  }
  if (!file.dump) scanSizes?.set(file.path, file.size);
  return Math.min(file.size, 9e9);
}

const romDirsOf = sys => [...new Set(String(sys.romDir || '').split('|')
  .map(folder => folder.trim().replace(/^"(.*)"$/, '$1').trim()).filter(Boolean))];
let libraryGames = [];
async function scanLibrary(folderReport) {
  if (!knownSizes) await readLibraryCache();
  const listings = scanListings = new Map(), sizes = scanSizes = new Map();
  rereadSizes = !!folderReport; // Settings' "Save & rescan" reads every size again
  try {
    const games = await scanFolders(folderReport, listings);
    knownSizes = sizes;
    lastScanChanged = writeLibraryCache(games.raw);
    return games.shown;
  } finally {
    if (scanListings === listings) scanListings = null;
    if (scanSizes === sizes) scanSizes = null;
  }
}
async function scanFolders(folderReport, listings) {
  const games = [];
  for (const sys of config.systems) {
    // A system can have several ROM folders (e.g. games split across two SD cards), separated by "|".
    // Folders that are missing - an SD card that isn't inserted - are skipped.
    const dirs = sys.id === 'recomp' ? [] : romDirsOf(sys);
    // Recomps sit on their original platform's shelf when one is set ("platform"), else on the Recomp shelf.
    const extras = (config.extraGames || []).filter(x => shelfOf(x) === sys.id && fs.existsSync(x.path));
    if (!dirs.length && !extras.length) continue;
    const exts = sys.extensions.map(e => e.toLowerCase());
    const files = [];
    // Direct-launch systems (PC) only look at the folder itself: game folders are full of helper programs.
    const scannedDirs = [];
    for (const [ri, dir] of dirs.entries()) {
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch (error) {
        const reason = error.code === 'ENOENT' ? 'Folder unavailable'
          : error.code === 'ENOTDIR' ? 'Path is not a folder' : 'Could not read folder';
        folderReport?.push({ system: sys.name, folder: dir, problem: reason });
        continue;
      }
      scannedDirs.push(dir);
      listings.set(dir.toLowerCase(), Promise.resolve(entries));
      const matches = (await walkRoms(dir, exts, sys.direct ? 4 : 0, [], entries))
        .filter(file => !/\(track \d+\)/i.test(file.name));
      for (const file of matches) files.push({ ...file, root: dir, rootIndex: ri });
      folderReport?.push({ system: sys.name, folder: dir, count: matches.length, extensions: exts });
    }
    for (const x of extras) {
      files.push({ name: path.basename(x.path), path: x.path, root: path.dirname(x.path), rootIndex: 'added-' + x.id, title: x.title, added: x.id, score: Infinity, recomp: x.system === 'recomp' });
    }
    if (!files.length) continue;
    // Prefer .m3u playlists over their individual discs.
    const m3u = new Set(files.filter(f => /\.m3u$/i.test(f.name)).map(f => looseKey(stem(f.name))));
    // Switch-style libraries group by title ID, so an update or a DLC pack never becomes its own game.
    const titleIds = ['.nsp', '.xci', '.nsz', '.xcz'].some(e => exts.includes(e));
    // Keep every copy that shares the top score; only those ties need their file sizes read,
    // and those reads all run together.
    const tops = new Map();
    for (const f of files) {
      // Games added one by one are named by their title: two Switch folder dumps are both called "main".
      const base = f.recomp ? f.name : f.added && f.title ? f.title.replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim() : path.basename(f.name, path.extname(f.name));
      if (!/\.m3u$/i.test(f.name) && /\(disc \d+\)/i.test(base) && m3u.has(looseKey(base))) continue;
      // Games added one by one are always their own game (two Switch folder dumps are both called "main").
      const key = f.added ? f.added : (titleIds && switchGroup(base)) || looseKey(base) || base.toLowerCase();
      if (f.score !== Infinity) f.score = copyScore(f, titleIds);
      const top = tops.get(key);
      if (!top || top[0].score < f.score) tops.set(key, [f]);
      else if (top[0].score === f.score) top.push(f);
    }
    const tied = [...tops.values()].filter(t => t.length > 1 && t[0].score !== Infinity).flat();
    await mapLimit(tied, SCAN_CONCURRENCY, copySize);
    const best = new Map();
    for (const [key, top] of tops) {
      let pick = top[0];
      // The first copy wins unless a later one is strictly bigger (sizes capped at 9 GB).
      for (const f of top.slice(1)) if (pick.score !== Infinity && await copySize(pick) < await copySize(f)) pick = f;
      // An update or DLC file is never a game of its own: when its base game's file is there it was
      // grouped with it above; when it isn't (or the base file's name has no title ID), it's left out.
      if (titleIds && !pick.added && (switchTitleId(pick.name)?.part || 0) !== 0) continue;
      best.set(key, pick);
    }
    const roots = [...extras.filter(x => x.system === 'recomp').flatMap(x => [path.join(x.path, 'media'), x.path]), config.mediaRoot && path.join(config.mediaRoot, sys.id), ...scannedDirs.flatMap(d => [path.join(d, 'media'), d]), path.join(DATA, 'media', sys.id)].filter(Boolean);
    const indexes = await Promise.all(roots.map(indexMediaRoot));
    const gamelist = new Map();
    for (const d of scannedDirs) for (const [k, v] of await readGamelist(d)) if (!gamelist.has(k)) gamelist.set(k, v);
    // Multi-disc games without an .m3u: "Game (USA) (Disc 1).cue", "(Disc 2).cue"… become one game
    // with a disc list. Only discs of the same copy (same name apart from the disc number) are grouped.
    const discTag = /\s*\(dis[ck]\s*(\d+)[^)]*\)/i;
    for (const [key, chosen] of best) {
      const copy = n => path.basename(n, path.extname(n)).replace(discTag, '').toLowerCase();
      if (chosen.added || !discTag.test(chosen.name)) continue;
      const seen = new Map();
      for (const f of files) {
        if (f.added || /\.m3u$/i.test(f.name) || copy(f.name) !== copy(chosen.name)) continue;
        const n = Number(path.basename(f.name, path.extname(f.name)).match(discTag)?.[1]);
        if (n && !seen.has(n)) seen.set(n, f);
      }
      if (seen.size < 2) continue;
      const discs = [...seen].sort((a, b) => a[0] - b[0]);
      best.set(key, { ...discs[0][1], score: chosen.score, discs: discs.map(([n, f]) => ({ n, path: f.path })) });
    }
    // Games are matched to their media in parallel; results keep the order of `best`.
    games.push(...await mapLimit([...best.values()], SCAN_CONCURRENCY, async f => {
      // Games added one by one are named by their title: two Switch folder dumps are both called "main".
      const base = f.recomp ? f.name : f.added && f.title ? f.title.replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim() : path.basename(f.name, path.extname(f.name));
      const { media, info, has } = await findMedia(indexes, base);
      const meta = { ...(gamelist.get(base.toLowerCase()) || {}), ...(info || {}), ...(f.title ? { title: f.title } : {}) };
      let shell = null;
      const shellFile = media.disc && media.disc.replace(/\.[^.\\/]+$/, '.json');
      if (shellFile && has(shellFile)) try { shell = JSON.parse(await fsp.readFile(shellFile, 'utf8')).shell || null; } catch {}
      return {
        id: `${sys.id}:${f.rootIndex ? f.rootIndex + ':' : ''}${path.relative(f.root, f.path)}`,
        system: sys.id,
        romPath: f.path,
        base,
        title: meta.title || displayTitle(base),
        ...(f.added ? { added: f.added } : {}),
        ...(f.recomp ? { recomp: true } : {}),
        ...(f.discs ? { discs: f.discs.map(d => d.n), discPaths: f.discs.map(d => d.path) } : {}),
        ...(shell && /^#[0-9a-f]{6}$/i.test(shell) ? { shell } : {}),
        info: meta,
        media: Object.fromEntries(Object.entries(media).map(([k, v]) => [k, k === 'manual' ? v : fileUrl(v)])),
      };
    }));
  }
  // The cache copy is taken before presentLibrary lays the player's settings over the games.
  const raw = JSON.stringify(games);
  return { raw, shown: presentLibrary(games) };
}
let lastScanChanged = true;

// ---------- Library cache ----------
// The last scan, so the next start shows the shelf at once and rescans behind it. It holds only
// what the scan found: favourites, play time, custom titles and per-game settings are laid over it
// fresh every time. It is used only while the folders and app version it was made with still match.
const LIBRARY_CACHE_PATH = path.join(DATA, 'library-cache.json');
const libraryCacheKey = () => JSON.stringify({
  version: APP_VERSION, mediaRoot: config.mediaRoot || '', extraGames: config.extraGames || [],
  systems: config.systems.map(s => [s.id, s.romDir || '', s.extensions || [], !!s.direct]),
});
let libraryCacheText = null; // the games part of the last written or read cache, to tell if a rescan changed anything
let libraryCacheSizes = null;
// text: the scanned games as JSON. Returns whether they differ from the cached ones.
function writeLibraryCache(text) {
  const sizes = JSON.stringify(Object.fromEntries(knownSizes || []));
  const changed = text !== libraryCacheText;
  if (!changed && sizes === libraryCacheSizes) return false;
  libraryCacheText = text; libraryCacheSizes = sizes;
  const tmp = `${LIBRARY_CACHE_PATH}.tmp`;
  fsp.mkdir(DATA, { recursive: true })
    .then(() => fsp.writeFile(tmp, `{"key":${JSON.stringify(libraryCacheKey())},"sizes":${sizes},"games":${text}}`))
    .then(() => fsp.rename(tmp, LIBRARY_CACHE_PATH))
    .catch(e => log(`library cache not saved: ${e.message}`));
  return changed;
}
// Returns the cached games when they were scanned with the current folders and app version.
// File sizes are kept whatever the key: they belong to files, not to the settings.
async function readLibraryCache() {
  let cached = null;
  try { cached = JSON.parse(await fsp.readFile(LIBRARY_CACHE_PATH, 'utf8')); } catch {}
  if (!knownSizes) {
    knownSizes = new Map(Object.entries(cached?.sizes && typeof cached.sizes === 'object' ? cached.sizes : {}).filter(([, v]) => Number.isFinite(v)));
    libraryCacheSizes = JSON.stringify(Object.fromEntries(knownSizes));
  }
  if (cached?.key !== libraryCacheKey() || !Array.isArray(cached.games) || !cached.games.length) return null;
  libraryCacheText = JSON.stringify(cached.games);
  return cached.games;
}

// Lays the player's own settings over scanned games and sorts them for the shelf.
function presentLibrary(games) {
  for (const g of games) {
    // A title typed in Rename… wins over the scanned one, so the shelf sorts by it too.
    // The scanned title is kept so "Use the file name" can put it back exactly.
    g.scannedTitle = g.title;
    g.title = gameState(g.id).customTitle || g.scannedTitle;
  }
  // A PC port beats a ROM of the same game on the same shelf: the ROM in a games folder (often the
  // very file the port was built from) stays out of sight.
  const ports = new Set(games.filter(g => g.recomp).map(g => g.system + '|' + looseKey(g.title)));
  games = games.filter(g => g.recomp || !ports.has(g.system + '|' + looseKey(g.title)));
  const compareTitles = new Intl.Collator(undefined, { sensitivity: 'base' }).compare;
  games.sort((a, b) => compareTitles(a.title, b.title));
  libraryGames = games;
  // The window gets the disc numbers and the game's own state, never the other disc paths.
  return games.map(({ discPaths, ...g }) => ({ ...g, ...gameState(g.id) }));
}

// ---------- Artwork download ----------
// WebP (common in newer LaunchBox uploads, often named .jpg) is not readable by nativeImage,
// so it is decoded by Chromium in a hidden sandboxed window and handed back as PNG.
let webpWindow=null,webpQueue=Promise.resolve(),webpIdle=null;
const closeWebpWindow=()=>{clearTimeout(webpIdle);if(webpWindow&&!webpWindow.isDestroyed())webpWindow.destroy();webpWindow=null};
const isWebp=b=>b.length>12&&b.toString('latin1',0,4)==='RIFF'&&b.toString('latin1',8,12)==='WEBP';
function webpToPng(bytes) {
  const run=webpQueue.then(async()=>{
    if(!webpWindow||webpWindow.isDestroyed()) {
      webpWindow=new BrowserWindow({show:false,width:64,height:64,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:true}});
      await webpWindow.loadURL('about:blank');
    }
    const script=`(async()=>{const b=Uint8Array.from(atob("${bytes.toString('base64')}"),c=>c.charCodeAt(0));
      const bmp=await createImageBitmap(new Blob([b],{type:'image/webp'}));
      if(bmp.width>16384||bmp.height>16384||bmp.width*bmp.height>40e6)throw new Error('too large');
      const c=new OffscreenCanvas(bmp.width,bmp.height);c.getContext('2d').drawImage(bmp,0,0);
      const out=new Uint8Array(await (await c.convertToBlob({type:'image/png'})).arrayBuffer());
      let s='';for(let i=0;i<out.length;i+=32768)s+=String.fromCharCode(...out.subarray(i,i+32768));return btoa(s)})()`;
    return Buffer.from(await webpWindow.webContents.executeJavaScript(script),'base64');
  });
  webpQueue=run.catch(()=>{});
  // Close the helper once it has been idle for a while, so it never keeps the app running.
  webpQueue.then(()=>{clearTimeout(webpIdle);webpIdle=setTimeout(closeWebpWindow,15000)});
  return run.catch(()=>{throw new Error('Could not read this WebP image.')});
}
function artworkPng(bytes) {
  if(isWebp(bytes))return webpToPng(bytes);
  const image=nativeImage.createFromBuffer(bytes),size=image.getSize();
  if(image.isEmpty()||size.width>16384||size.height>16384||size.width*size.height>40e6)throw new Error('Choose a valid image smaller than 40 megapixels.');
  return image.toPNG();
}
// Downloaded artwork is kept at a sensible size: full-size scans are scaled to fit these limits
// (longest side, in pixels) and photos are saved as JPEG. Small pixel art and anything with
// transparency (discs, logos) stays PNG so it keeps crisp edges.
const ARTWORK_LIMITS = { front: 1600, frontHQ: 2000, back: 1600, spine: 1600, screenshot: 1920, title: 1920, disc: 1200, logo: 1000, fanart: 1920 };
function hasTransparency(image) {
  const { width, height } = image.getSize(), px = image.toBitmap();
  const step = Math.max(1, Math.floor(width * height / 40000)); // sample ~40k pixels
  for (let i = 0; i < width * height; i += step) if (px[i * 4 + 3] < 250) return true;
  return false;
}
function encodeArtwork(png, type) {
  let image = nativeImage.createFromBuffer(png);
  const { width, height } = image.getSize(), limit = ARTWORK_LIMITS[type] || 1600;
  if (image.isEmpty()) return { bytes: png, ext: 'png' };
  if (Math.max(width, height) > limit) image = image.resize(width >= height ? { width: limit, quality: 'best' } : { height: limit, quality: 'best' });
  const size = image.getSize();
  if (Math.max(size.width, size.height) < 400 || hasTransparency(image)) return { bytes: image.toPNG(), ext: 'png' };
  return { bytes: image.toJPEG(88), ext: 'jpg' };
}

const launchbox = createLaunchBox({
  dataDir: DATA,
  normalize: looseKey,
  download: (url, file, onBytes) => artwork.download(url, file, onBytes),
  onStatus: message => artwork.note(message),
});
const artwork = createArtworkService({
  launchbox,
  encodeImage: encodeArtwork,
  dataDir: DATA,
  getSystems: () => config.systems,
  getGames: () => libraryGames,
  normalize: looseKey,
  decodeImage: artworkPng,
  onProgress: progress => {
    if (win && !win.isDestroyed()) win.webContents.send('art:progress', progress);
    // The first download builds the LaunchBox database; fill in game details right away.
    if (progress.status === 'complete') fillGameDetails(libraryGames).then(changed => {
      if (changed.length && win && !win.isDestroyed()) win.webContents.send('library:info', changed);
    }).catch(() => {});
  },
});

// ---------- Emulators ----------
// Emulators are programs you already have, linked by their .exe. "{rom}" in the launch options is
// replaced with the game's file.
function emuDef(id) {
  const e = config.customEmulators.find(x => x.id === id);
  if (!e) return null;
  return { ...e, exePath: config.emulators[id]?.exe || e.exe, custom: true };
}
function resolveExe(id) {
  const def = emuDef(id);
  return def?.exePath && fs.existsSync(def.exePath) ? def.exePath : null;
}
function emuStatus(id) {
  const def = emuDef(id);
  return { id, name: def.name, systems: def.systems || [], args: def.args, custom: true, exe: resolveExe(id) };
}

// "owner/repo" or a github.com link -> "owner/repo".
function parseRepo(input) {
  const text = String(input || '').trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  const m = text.match(/^(?:https?:\/\/(?:www\.)?github\.com\/)?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})(?:\/.*)?$/);
  if (!m || m[2] === '.' || m[2] === '..') throw new Error('Enter a GitHub repository as owner/name, e.g. eden-emulator/Releases');
  return `${m[1]}/${m[2]}`;
}
function checkPattern(pattern, what) {
  if (!pattern) return '';
  const text = String(pattern).trim().slice(0, 200);
  try { new RegExp(text, 'i'); } catch { throw new Error(`The ${what} pattern is not a valid regular expression.`); }
  return text;
}
// Picks the download for this computer when the repository gives no pattern.
function guessAsset(assets) {
  const win = process.platform === 'win32';
  const score = a => {
    const n = a.name.toLowerCase();
    if (/source|src\b|symbols|pdb|debug|[-_.]dbg[-_.]|libretro|\.sha\d*|\.sig$|\.asc$|\.txt$|\.json$/.test(n)) return -1;
    if (/arm64|aarch64|armv7|x86(?!_64)|i686|32bit|win32(?!-x64)/.test(n)) return -1;
    let v = 0;
    if (win) {
      if (!/\.(zip|7z|exe)$/.test(n)) return -1;
      if (/(macos|mac|osx|darwin|linux|android|ios|appimage|flatpak)/.test(n)) return -1;
      if (/win|windows|msvc|mingw/.test(n)) v += 4;
      if (/x64|x86_64|amd64|win64/.test(n)) v += 2;
      if (/\.zip$|\.7z$/.test(n)) v += 2; // portable archives over installers
      if (/setup|install/.test(n)) v -= 3;
      if (/msvc|clang|mingw|llvm/.test(n)) v -= .5; // when a plain build sits next to compiler variants, take the plain one
    } else if (process.platform === 'darwin') {
      // Mac: archives that hold an .app (disk images can't be unpacked here).
      if (/(windows|win64|win32|\.exe$|linux|appimage|android|\.deb$|\.rpm$|\.dmg$)/.test(n)) return -1;
      if (!/\.(zip|tar\.(gz|xz|zst|bz2)|tgz)$/.test(n)) return -1;
      if (/mac|macos|osx|darwin|apple/.test(n)) v += 5; else return -1;
      if (/universal/.test(n)) v += 2;
      else if (process.arch === 'arm64' ? /arm64|aarch64|apple/.test(n) : /x64|x86_64|intel/.test(n)) v += 2;
    } else {
      if (/(windows|win64|\.exe$|macos|osx|darwin|android)/.test(n)) return -1;
      if (/\.appimage$/.test(n)) v += 6;
      else if (/linux/.test(n) && /\.(tar\.(gz|xz|zst)|zip|7z)$/.test(n)) v += 3;
      else return -1;
      if (/x86_64|amd64|x64/.test(n)) v += 2;
    }
    return v;
  };
  return assets.map(a => [score(a), a]).filter(([v]) => v >= 0).sort((x, y) => y[0] - x[0])[0]?.[1] || null;
}
// Picks the emulator program among unpacked files when the repository gives no pattern.
function guessProgram(dir, repo) {
  const files = [], stack = [dir];
  while (stack.length) {
    const d = stack.shift();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p); else files.push(p);
    }
  }
  const win = process.platform === 'win32';
  const hint = String(repo || '').split('/').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (process.platform === 'darwin') {
    // Mac: the program is an .app bundle; pick the best-named one and start the binary inside.
    const apps = [], walk = [dir];
    while (walk.length) {
      const d = walk.shift();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const p = path.join(d, e.name);
        if (/\.app$/i.test(e.name)) apps.push(p); else walk.push(p);
      }
    }
    const best = apps.sort((a, b) => Number(path.basename(b).toLowerCase().replace(/[^a-z0-9]/g, '').includes(hint)) - Number(path.basename(a).toLowerCase().replace(/[^a-z0-9]/g, '').includes(hint)))[0];
    return best ? macAppBinary(best) : null;
  }
  const candidates = files.filter(f => {
    const n = path.basename(f).toLowerCase();
    if (/unins|uninstall|update|crash|redist|vc_?redist|setup|installer|helper|elevate|dxwebsetup/.test(n)) return false;
    return win ? n.endsWith('.exe') : (n.endsWith('.appimage') || !path.extname(n));
  });
  const rank = f => {
    const n = path.basename(f).toLowerCase().replace(/[^a-z0-9]/g, '');
    let v = fs.statSync(f).size / 1e9; // larger programs first, as a tiebreak
    if (hint && (n.includes(hint) || hint.includes(n.replace(/exe$|appimage$/, '')))) v += 10;
    if (/qt|gui/.test(n)) v += 1;
    if (/cli|cmd|test|bench/.test(n)) v -= 2;
    return v;
  };
  return candidates.sort((a, b) => rank(b) - rank(a))[0] || null;
}
// GitHub allows 60 requests an hour without an account. If the GitHub CLI (gh) is logged in on this
// PC, its token is used instead (5,000 an hour). It is only ever sent to api.github.com.
let ghToken;
function githubToken() {
  if (ghToken !== undefined) return ghToken;
  ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
  if (!ghToken) try {
    const r = spawnSync('gh', ['auth', 'token'], { windowsHide: true, encoding: 'utf8', timeout: 5000 });
    if (r.status === 0 && /^[\w-]{20,}$/.test(r.stdout.trim())) ghToken = r.stdout.trim();
  } catch {}
  return ghToken;
}
async function ghJson(url) {
  const token = /^https:\/\/api\.github\.com\//.test(url) && githubToken();
  const r = await fetch(url, { headers: token ? { ...UA, Authorization: `Bearer ${token}` } : UA });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${r.statusText}${r.status === 403 ? ' (rate limited — try again later)' : ''}`);
  return r.json();
}

async function findRelease(repo, { asset: pattern, prerelease }) {
  const re = pattern ? new RegExp(pattern, 'i') : null;
  let list;
  if (prerelease) list = await ghJson(`https://api.github.com/repos/${repo}/releases?per_page=15`);
  else {
    // Forks often only publish pre-releases, which /releases/latest skips.
    try { list = [await ghJson(`https://api.github.com/repos/${repo}/releases/latest`)]; }
    catch (e) { if (!/GitHub 404/.test(e.message)) throw e; list = (await ghJson(`https://api.github.com/repos/${repo}/releases?per_page=15`)).filter(r => !r.draft); }
    if (!list.length) throw new Error(`${repo} has no releases to download.`);
  }
  for (const rel of list) {
    if (rel.draft) continue;
    const asset = re ? rel.assets.find(a => re.test(a.name)) : guessAsset(rel.assets);
    if (asset) return {
      tag: rel.tag_name, releaseName: rel.name || rel.tag_name, publishedAt: asset.updated_at || rel.published_at,
      assetId: asset.id, assetName: asset.name, size: asset.size, url: asset.browser_download_url, notes: rel.body || '',
      digest: asset.digest || null, page: rel.html_url || `https://github.com/${repo}/releases`,
    };
  }
  const platformName = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
  throw new Error(re ? `No ${platformName} download matching /${pattern}/ found in recent releases of ${repo}.` : `No ${platformName} download found in recent releases of ${repo}. Set a download pattern under Source.`);
}

// Linux programs (AppImages, binaries) usually have no .exe extension.
const PROGRAM_FILTERS = process.platform === 'win32' ? [{ name: 'Programs', extensions: ['exe'] }]
  : process.platform === 'darwin' ? [{ name: 'Applications', extensions: ['app'] }, { name: 'All files', extensions: ['*'] }]
  : [{ name: 'All files', extensions: ['*'] }];
const PROGRAM_START = process.platform === 'darwin' ? { defaultPath: '/Applications' } : {};
const ARCHIVE = /\.(zip|7z|tar|tgz|tar\.(gz|xz|zst|bz2))$/i;
function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', d => (err += d));
    p.on('error', rej);
    p.on('close', c => (c === 0 ? res() : rej(new Error(`Extract failed: ${err.trim() || 'exit ' + c}`))));
  });
}
// Windows has bsdtar built in (handles zip and 7z). On Linux try the usual tools in turn:
// bsdtar (Arch/SteamOS), unzip / 7z, then GNU tar for tarballs.
async function extract(archive, dest) {
  if (process.platform === 'win32') return run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', archive, '-C', dest]);
  const tries = [['bsdtar', ['-xf', archive, '-C', dest]]];
  if (/\.zip$/i.test(archive)) tries.push(['unzip', ['-o', '-q', archive, '-d', dest]], ['7z', ['x', '-y', `-o${dest}`, archive]]);
  else if (/\.7z$/i.test(archive)) tries.push(['7z', ['x', '-y', `-o${dest}`, archive]], ['7za', ['x', '-y', `-o${dest}`, archive]]);
  else tries.push(['tar', ['-xf', archive, '-C', dest]]);
  for (const [cmd, args] of tries) {
    try { return await run(cmd, args); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  throw new Error(`Can't unpack ${path.basename(archive)}: install bsdtar (libarchive) or ${/\.zip$/i.test(archive) ? 'unzip' : '7-Zip'}.`);
}

// Stream a fetch() response to a file, calling onChunk for progress.
async function downloadTo(response, file, onChunk = () => {}) {
  await pipeline(Readable.fromWeb(response.body), async function* (source) {
    for await (const chunk of source) { onChunk(chunk); yield chunk; }
  }, fs.createWriteStream(file));
}

// ---------- Recomp updates ----------
// A recomp can have an update source: { repo, prerelease, asset, auto }. "installed" remembers which
// release is in its folder ({ tag, assetId }); without it the version is unknown until you set it.
function shelfOf(x) { return x.system === 'recomp' && x.platform && config.systems.some(s => s.id === x.platform) ? x.platform : x.system; }
function recompEntry(gameId) {
  const game = libraryGames.find(g => g.id === gameId && g.recomp);
  const entry = game && config.extraGames.find(x => x.id === game.added);
  if (!entry) throw new Error('Select a recomp game first.');
  return { game, entry };
}
// gameId -> { at, latest, repo }. Kept on disk too, so restarting Harbour doesn't re-ask GitHub
// (60 requests an hour without an account) for every game.
const RECOMP_CHECKS_PATH = path.join(DATA, 'recomp-checks.json');
const recompChecks = new Map((() => { try { return Object.entries(JSON.parse(fs.readFileSync(RECOMP_CHECKS_PATH, 'utf8'))); } catch { return []; } })());
let recompSaveTimer = null;
function saveRecompChecks() {
  clearTimeout(recompSaveTimer);
  recompSaveTimer = setTimeout(() => { try { fs.writeFileSync(RECOMP_CHECKS_PATH, JSON.stringify(Object.fromEntries(recompChecks))); } catch {} }, 500);
}
const RECOMP_CHECK_MS = 3 * 3600 * 1000;
function recompStatus(entry, latest) {
  const inst = entry.installed || null;
  const updateAvailable = !latest ? null : inst?.assetId ? inst.assetId !== latest.assetId : inst?.tag ? inst.tag !== latest.tag : null;
  return {
    installed: inst, updateAvailable, auto: !!entry.source?.auto, repo: entry.source?.repo || null,
    latest: latest && { tag: latest.tag, name: latest.releaseName, date: latest.publishedAt, notes: latest.notes, page: latest.page, assetName: latest.assetName, size: latest.size },
  };
}
async function checkRecomp(gameId, force = false) {
  const { entry } = recompEntry(gameId);
  if (!entry.source?.repo) return { repo: null };
  const hit = recompChecks.get(gameId);
  if (!force && hit && Date.now() - hit.at < RECOMP_CHECK_MS && hit.repo === entry.source.repo) return recompStatus(entry, hit.latest);
  try {
    const latest = await findRelease(entry.source.repo, { asset: entry.source.asset, prerelease: entry.source.prerelease });
    recompChecks.set(gameId, { at: Date.now(), latest, repo: entry.source.repo }); saveRecompChecks();
    return recompStatus(entry, latest);
  } catch (e) {
    return { ...recompStatus(entry, null), error: e.message };
  }
}
async function sha256File(file) {
  const h = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}
// Windows Defender scans a download before anything is unpacked. If Defender isn't there, the scan is skipped (and logged).
function defenderScan(file) {
  const exe = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Windows Defender', 'MpCmdRun.exe');
  if (process.platform !== 'win32' || !fs.existsSync(exe)) return Promise.resolve('skipped');
  return new Promise((resolve, reject) => {
    const p = spawn(exe, ['-Scan', '-ScanType', '3', '-File', file, '-DisableRemediation'], { windowsHide: true });
    let out = '';
    p.stdout.on('data', d => (out += d));
    p.on('error', () => resolve('skipped'));
    p.on('close', code => {
      if (code === 0) return resolve('clean');
      if (code === 2 || /threat/i.test(out) && !/no threats/i.test(out)) return reject(new Error('Windows Defender flagged the download. Nothing was installed.'));
      resolve('skipped');
    });
  });
}
// Your settings: files with these endings are never overwritten by an update if they already exist.
const KEEP_FILES = /\.(ini|toml|cfg|conf|ya?ml|sav|save)$/i;
async function copyUpdate(src, dest, backup, kept) {
  for (const e of await fsp.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, e.name), to = path.join(dest, e.name), bak = path.join(backup, e.name);
    if (e.isDirectory()) { await fsp.mkdir(to, { recursive: true }); await copyUpdate(from, to, bak, kept); continue; }
    if (fs.existsSync(to)) {
      if (KEEP_FILES.test(e.name)) { kept.push(to); continue; }
      await fsp.mkdir(backup, { recursive: true });
      await fsp.copyFile(to, bak);
    }
    await fsp.copyFile(from, to);
  }
}
const updatingRecomps = new Set();
async function updateRecomp(gameId, send) {
  const { game, entry } = recompEntry(gameId);
  if (!entry.source?.repo) throw new Error('Set an update source for this game first.');
  if (updatingRecomps.has(gameId)) throw new Error('Already updating');
  if (running.has(gameId)) throw new Error('Close the game before updating it.');
  updatingRecomps.add(gameId);
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'harbour-recomp-'));
  try {
    send({ gameId, stage: 'Checking latest release…', pct: 0 });
    const hit = recompChecks.get(gameId);
    const rel = hit && hit.repo === entry.source.repo && Date.now() - hit.at < 10 * 60 * 1000 && hit.latest?.url ? hit.latest
      : await findRelease(entry.source.repo, { asset: entry.source.asset, prerelease: entry.source.prerelease });
    const archive = path.join(tmp, rel.assetName);
    const r = await fetch(rel.url, { headers: { 'User-Agent': UA['User-Agent'] } });
    if (!r.ok) throw new Error(`Download failed: HTTP ${r.status}`);
    const total = Number(r.headers.get('content-length')) || rel.size || 0;
    let got = 0, last = 0;
    await downloadTo(r, archive, chunk => {
      got += chunk.length;
      if (Date.now() - last > 120) { last = Date.now(); send({ gameId, stage: `Downloading ${rel.assetName}`, pct: total ? got / total : 0 }); }
    });
    send({ gameId, stage: 'Checking the download…', pct: 1 });
    if (rel.digest && /^sha256:/i.test(rel.digest)) {
      const want = rel.digest.slice(7).toLowerCase(), have = await sha256File(archive);
      if (want !== have) throw new Error("The download doesn't match GitHub's checksum. Nothing was installed.");
    }
    const scan = await defenderScan(archive);
    const stage = path.join(tmp, 'x');
    await fsp.mkdir(stage);
    if (ARCHIVE.test(rel.assetName)) { send({ gameId, stage: 'Extracting…', pct: 1 }); await extract(archive, stage); }
    else await fsp.rename(archive, path.join(stage, rel.assetName));
    let src = stage;
    const top = fs.readdirSync(stage, { withFileTypes: true });
    if (top.length === 1 && top[0].isDirectory()) src = path.join(stage, top[0].name);
    send({ gameId, stage: 'Installing…', pct: 1 });
    const label = (entry.installed?.tag || 'before-' + new Date().toISOString().slice(0, 10)).replace(/[^\w.-]+/g, '_');
    const backup = path.join(entry.path, '_harbour-backup', label);
    const kept = [];
    await copyUpdate(src, entry.path, backup, kept);
    if (entry.executable && !fs.existsSync(entry.executable)) {
      const exe = guessProgram(entry.path, entry.source.repo);
      if (exe) entry.executable = exe;
    }
    entry.installed = { tag: rel.tag, assetId: rel.assetId, date: rel.publishedAt, at: new Date().toISOString() };
    saveConfig(config);
    recompChecks.set(gameId, { at: Date.now(), latest: rel, repo: entry.source.repo }); saveRecompChecks();
    send({ gameId, stage: 'Done', pct: 1, done: true });
    log(`recomp update ${game.title} -> ${rel.tag} (defender: ${scan}, kept ${kept.length} settings files)`);
    return { ...recompStatus(entry, rel), backup: fs.existsSync(backup) ? backup : null, kept, scan };
  } finally {
    updatingRecomps.delete(gameId);
    fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- Launching ----------
function splitArgs(s) {
  const out = []; let cur = '', q = false, any = false;
  for (const ch of s || '') {
    if (ch === '"') { q = !q; any = true; }
    else if (/\s/.test(ch) && !q) { if (any) out.push(cur); cur = ''; any = false; }
    else { cur += ch; any = true; }
  }
  if (any) out.push(cur);
  return out;
}

let win;
// On a Mac, emulators are .app bundles (folders). Start the program inside: Contents/MacOS/<CFBundleExecutable>.
function macAppBinary(p) {
  if (process.platform !== 'darwin' || !/\.app\/?$/i.test(p || '')) return p;
  try {
    const plist = fs.readFileSync(path.join(p, 'Contents', 'Info.plist'), 'utf8');
    const name = plist.match(/<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
    if (name && fs.existsSync(path.join(p, 'Contents', 'MacOS', name))) return path.join(p, 'Contents', 'MacOS', name);
    const first = fs.readdirSync(path.join(p, 'Contents', 'MacOS'))[0];
    if (first) return path.join(p, 'Contents', 'MacOS', first);
  } catch {}
  return p;
}
// ---------- Running games: play time and "hold to quit" ----------
// Each started game is tracked until its process exits, so play time and "last played" are counted.
// Shortcuts opened through the system (.lnk, Steam .url) have no process to follow: they only count
// as played.
const running = new Map(); // game id -> { child, start }
const sendWindow = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
function recordPlay(gameId, ms = 0, started = !ms) {
  const st = (libraryState.stats[gameId] ||= { ms: 0, last: 0, plays: 0 });
  st.ms = (st.ms || 0) + Math.max(0, Math.round(ms)); st.last = Date.now(); st.plays = (st.plays || 0) + (started ? 1 : 0);
  saveState();
  const g = libraryGames.find(x => x.id === gameId);
  return { gameId, ...gameState(gameId), title: g?.title };
}
function track(game, child) {
  const start = Date.now();
  running.set(game.id, { child, start });
  sendWindow('game:started', recordPlay(game.id));
  child.once('exit', () => {
    if (running.get(game.id)?.child === child) running.delete(game.id);
    // The game window opened on top of Harbour, so there was nothing to minimize; just come back to the front.
    sendWindow('game:ended', { ...recordPlay(game.id, Date.now() - start, false), running: running.size });
    if (win && !win.isDestroyed()) win.focus();
  });
}
// Ends the newest running game and everything it started (an emulator's helper processes).
function quitGame() {
  const last = [...running.values()].pop();
  if (!last) return false;
  const pid = last.child.pid;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    else process.kill(-pid, 'SIGTERM'); // detached: the game leads its own process group
  } catch { try { last.child.kill(); } catch {} }
  return true;
}

// PC games and other "run the file itself" systems: programs are started in their own folder;
// shortcuts (.lnk, .url) and anything else are opened the way Windows would open them.
async function launchDirect(game) {
  const file = game.recomp ? config.extraGames.find(x => x.id === game.added)?.executable : game.romPath;
  if (!file) throw new Error('Right-click this Recomp game and choose its .exe file first.');
  if (!fs.existsSync(file)) throw new Error(`${path.basename(file)} is missing. Rescan in Settings.`);
  // Programs are started directly; batch files, shortcuts and anything else open the way the system would.
  const program = process.platform === 'win32' ? /\.exe$/i.test(file) : (/\.app$/i.test(file) || (fs.statSync(file).mode & 0o111) !== 0);
  if (!program) {
    const err = await shell.openPath(file);
    if (err) throw new Error(`Couldn't open ${path.basename(file)}: ${err}`);
    sendWindow('game:started', { ...recordPlay(game.id), untracked: true });
    return true;
  }
  const exe = macAppBinary(file);
  return new Promise((resolve, reject) => {
    const child = spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore' });
    child.once('error', e => reject(new Error(`Launch failed: ${e.message}`)));
    child.once('spawn', () => { track(game, child); child.unref(); resolve(true); });
  });
}
// The disc to start a multi-disc game with. Systems whose emulators read .m3u playlists get one
// (written to the data folder, chosen disc first), so the emulator can still swap discs in-game.
function discFile(game, sys, index) {
  if (!game.discPaths?.length) return game.romPath;
  const i = Math.max(0, Math.min(game.discPaths.length - 1, Number(index) || 0));
  if (!(sys.extensions || []).includes('.m3u')) return game.discPaths[i];
  const order = [...game.discPaths.slice(i), ...game.discPaths.slice(0, i)];
  const dir = path.join(DATA, 'playlists', sys.id);
  const file = path.join(dir, `${(looseKey(game.base) || 'game').slice(0, 80)}-disc${game.discs[i]}.m3u`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, order.join('\n') + '\n');
  return file;
}
function launchGame(gameId, options = {}) {
  // The ROM path always comes from the scanned library, never from the renderer.
  const game = libraryGames.find(g => g.id === gameId);
  if (!game) throw new Error('This game is no longer in your library. Rescan in Settings and try again.');
  const sys = config.systems.find(s => s.id === game.system);
  if (!sys) throw new Error('Unknown system');
  let disc = 0;
  if (game.discPaths?.length) {
    disc = Math.max(0, Math.min(game.discPaths.length - 1, Number(options.disc ?? libraryState.discs[game.id] ?? 0) || 0));
    if (disc) libraryState.discs[game.id] = disc; else delete libraryState.discs[game.id];
    saveState();
  }
  // PC ports run themselves; everything else starts with the emulator its console uses.
  if (game.recomp || sys.direct) return launchDirect(game);
  const emuId = sys.emulator;
  if (!emuId || !emuDef(emuId)) throw new Error(`No emulator is set for ${sys.name}. Choose one in Settings → Emulators.`);
  const exe = macAppBinary(resolveExe(emuId));
  if (!exe) throw new Error(`${emuDef(emuId).name}'s program wasn't found. Choose it again in Settings → Emulators.`);
  const tpl = emuDef(emuId).args || '{rom}';
  const rom = discFile(game, sys, disc);
  // split/join instead of replace(): "$&", "$$" etc. in a filename must stay literal.
  const args = splitArgs(tpl).map(a => a.split('{rom}').join(rom));
  return new Promise((resolve, reject) => {
    // detached: the game keeps running if Harbour is closed or restarted while playing.
    const child = spawn(exe, args, { cwd: path.dirname(exe), detached: true, stdio: 'ignore' });
    child.once('error', e => reject(new Error(`Launch failed: ${e.message}`)));
    child.once('spawn', () => { track(game, child); resolve(true); });
  });
}

// ---------- Window & IPC ----------
// Fullscreen is remembered, so Harbour opens the way it was left. --fullscreen and --windowed set
// it from a shortcut or from Steam's launch options; like F11, the choice is then remembered.
const flag = name => process.argv.slice(1).includes('--' + name);
const startFullscreen = flag('fullscreen') || (!!config.fullscreen && !flag('windowed'));
function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 1100, minHeight: 650,
    fullscreen: startFullscreen,
    backgroundColor: '#07080c', autoHideMenuBar: true, title: 'Harbour',
    icon:path.join(ROOT,'ui/assets/brand/harbour-icon-256.png'),
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, sandbox: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  // A --fullscreen / --windowed launch is the same choice as pressing F11, so record it either way.
  if (config.fullscreen !== startFullscreen) { config.fullscreen = startFullscreen; saveConfig(config); }
  win.loadFile(path.join(ROOT, 'ui', 'index.html'));
  win.webContents.once('did-finish-load', () => log('window loaded', { visible: win.isVisible(), bounds: win.getBounds() }));
  win.webContents.on('did-fail-load', (_e, code, desc) => log('window failed to load', code, desc));
  if (configWarning) win.webContents.once('did-finish-load', () => win.webContents.send('toast', configWarning));
  // Consume F11 before Electron's menu can also toggle fullscreen.
  // Ctrl/Cmd+Shift+F also works when F11 is taken by the window manager.
  win.webContents.on('before-input-event', (event, input) => {
    const key = String(input.key || '');
    if (key !== 'F11' && !(key.toLowerCase() === 'f' && input.shift && (input.control || input.meta))) return;
    event.preventDefault();
    if (input.type === 'keyDown' && !input.isAutoRepeat) setFullScreen(!win.isFullScreen());
  });
  // Remember the choice however it was made: the shortcut, the setting, or the title bar.
  for (const [event, on] of [['enter-full-screen', true], ['leave-full-screen', false]])
    win.on(event, () => {
      if (config.fullscreen !== on) { config.fullscreen = on; saveConfig(config); }
      if (!win.isDestroyed()) win.webContents.send('fullscreen', on);
    });
}
function setFullScreen(on) {
  if (!win || win.isDestroyed()) return false;
  win.setFullScreen(!!on);
  // Linux window managers answer asynchronously, so report what was asked for.
  return !!on;
}

const handle = (ch, fn) => ipcMain.handle(ch, async (_e, ...a) => {
  try { return { ok: true, value: await fn(...a) }; } catch (err) { return { ok: false, error: err.message }; }
});

handle('config:get', () => config);
// Emulators, added games and fullscreen are owned by their own handlers, so a window holding an
// older copy of the settings can never overwrite them.
handle('config:set', cfg => {
  if (!cfg || !Array.isArray(cfg.systems)) throw new Error('Invalid settings');
  const next = { ...cfg, emulators: config.emulators, customEmulators: config.customEmulators, extraGames: config.extraGames, fullscreen: config.fullscreen };
  saveConfig(next);
  config = next;
  return config;
});
// Game details (description, year, developer, publisher, genre, players) from the LaunchBox database.
// Only empty fields are filled, so gamelist.xml and info.json always win. Needs no network.
async function fillGameDetails(games) {
  if (!launchbox.available()) return [];
  const changed = [];
  for (const game of games) {
    if (game.demo || (game.info?.description && game.info?.year)) continue;
    let details = null;
    try { details = await launchbox.details(game.system, artwork.titleKeys(game)); } catch { return changed; }
    if (!details) continue;
    const added = {};
    for (const [k, v] of Object.entries(details)) if (!game.info?.[k]) added[k] = v;
    if (!Object.keys(added).length) continue;
    game.info = { ...(game.info || {}), ...added };
    changed.push({ gameId: game.id, info: game.info });
  }
  return changed;
}

// Details are filled in after the library is shown, so a scan never waits on them.
const fillDetailsLater = games => setImmediate(() => fillGameDetails(games).then(changed => {
  if (changed.length && win && !win.isDestroyed()) win.webContents.send('library:info', changed);
}).catch(() => {}));
// The last scan's games, for showing the shelf before the first scan of this start finishes.
handle('library:cached', async () => {
  const cached = await readLibraryCache();
  if (!cached) return null;
  const games = presentLibrary(cached);
  fillDetailsLater(games);
  return games;
});
// onlyIfChanged: the window already shows the cached library, so return null when nothing changed.
handle('library:scan', async (withReport = false, { onlyIfChanged = false } = {}) => {
  const folders = withReport ? [] : undefined;
  const games = await scanLibrary(folders);
  if (onlyIfChanged && !withReport && !lastScanChanged) return null;
  fillDetailsLater(games);
  return withReport ? { games, folders } : games;
});
ipcMain.on('app:quit', event => {
  if (event.sender === win?.webContents && event.senderFrame === event.sender.mainFrame) app.quit();
});
handle('game:launch', (id, options) => launchGame(id, options || {}));
handle('game:quit', () => quitGame());
handle('game:running', () => [...running.keys()]);
function setGameHidden(gameId, hidden) {
  if (!libraryGames.some(g => g.id === gameId)) throw new Error('Select a game in your library first.');
  if (hidden) libraryState.hidden[gameId] = true; else delete libraryState.hidden[gameId];
  writeState();
  return gameState(gameId);
}
handle('game:setHidden', ({ gameId, hidden }) => setGameHidden(gameId, !!hidden));
handle('game:openFolder', async gameId => {
  const game = libraryGames.find(g => g.id === gameId);
  if (!game?.romPath || !fs.existsSync(game.romPath)) throw new Error('The game file is missing. Rescan your library and try again.');
  const folder = fs.statSync(game.romPath).isDirectory() ? game.romPath : path.dirname(game.romPath);
  const error = await shell.openPath(folder);
  if (error) throw new Error(error);
  return true;
});
handle('game:chooseExecutable', async gameId => {
  const game = libraryGames.find(g => g.id === gameId && g.recomp);
  const entry = game && config.extraGames.find(x => x.id === game.added);
  if (!entry) throw new Error('Select a Recomp game first.');
  const result = await dialog.showOpenDialog(win, {title:'Choose the .exe for ' + game.title,defaultPath:entry.path,properties:['openFile'],filters:[{name:'Game executable',extensions:['exe']}]});
  if (result.canceled) return null;
  const file = result.filePaths[0];
  if (!/\.exe$/i.test(file) || !fs.statSync(file).isFile()) throw new Error('Choose a game .exe file.');
  entry.executable = file; saveConfig(config);
  return {gameId, executable:file};
});
handle('game:setFavorite', ({ gameId, favorite }) => {
  if (!libraryGames.some(g => g.id === gameId)) throw new Error('Select a game in your library first.');
  if (favorite) libraryState.favorites[gameId] = true; else delete libraryState.favorites[gameId];
  saveState();
  return gameState(gameId);
});
// Rename a game. Like hiding, this lives in library-state.json; the file on disk keeps its name.
// An empty title clears the override and the scanned file name comes back.
handle('game:setTitle', ({ gameId, title }) => {
  const game = libraryGames.find(g => g.id === gameId);
  if (!game) throw new Error('Select a game in your library first.');
  const wanted = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  libraryState.titles ||= {};
  if (libraryState.metadata?.[gameId]) delete libraryState.metadata[gameId].title;
  if (wanted) libraryState.titles[gameId] = wanted; else delete libraryState.titles[gameId];
  game.title = wanted || game.scannedTitle || displayTitle(game.base);
  saveState();
  return { title: game.title, ...gameState(gameId) };
});
handle('app:fullscreen', () => !!(win && !win.isDestroyed() && win.isFullScreen()));
handle('app:setFullscreen', on => setFullScreen(on));
handle('library:ui', () => libraryState.ui || {});
handle('library:saveUi', patch => {
  if (!patch || typeof patch !== 'object') return false;
  const ui = { ...(libraryState.ui || {}) };
  for (const k of ['system', 'game', 'perSystem', 'sort', 'filter']) if (k in patch) ui[k] = patch[k];
  if (ui.perSystem && typeof ui.perSystem === 'object') ui.perSystem = Object.fromEntries(Object.entries(ui.perSystem).slice(-100).filter(([k, v]) => typeof k === 'string' && typeof v === 'string'));
  libraryState.ui = ui; saveState();
  return true;
});
// ---------- Adding things the easy way ----------
// A PC port / recomp: pick its folder; the game's .exe is found by itself when there's only one real
// candidate (helpers like uninstallers, crash reporters and redistributables don't count).
const HELPER_EXE = /unins|setup|install|crash|report|redist|vcredist|dxsetup|updater|update|ffmpeg|ffprobe|7z|helper|cli\.exe$|dotnet|vc_|createdump/i;
function findGameExe(folder) {
  const found = [];
  const walk = (dir, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 2 && !/^(_harbour-backup|disc|data|saves?|mods|cache|shaders?)$/i.test(e.name)) walk(p, depth + 1);
      else if (e.isFile() && /\.exe$/i.test(e.name) && !HELPER_EXE.test(e.name)) found.push({ p, depth });
    }
  };
  walk(folder, 0);
  const top = found.filter(f => f.depth === 0);
  return (top.length === 1 ? top : found.length === 1 ? found : []).map(f => f.p)[0] || null;
}
// "BanjoKazooie-PC" -> "Banjo Kazooie", "gta-vcs-recomp" -> "Gta Vcs" (a starting point; you can rename it).
const titleFromFolder = name => name.replace(/[-_ .](pc|port|recomp(iled)?|windows|win64|x64)$/i, '').replace(/[-_.]+/g, ' ')
  .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase());
handle('harbour:addPort', async ({ platform, title, repo, auto }) => {
  if (platform && !config.systems.some(s => s.id === platform)) throw new Error('Unknown console.');
  const source = String(repo || '').trim() ? { repo: parseRepo(repo), prerelease: false, auto: !!auto } : undefined;
  const picked = await dialog.showOpenDialog(win, { title: 'Choose the game\'s folder', properties: ['openDirectory'] });
  if (picked.canceled) return null;
  const folder = picked.filePaths[0];
  if (config.extraGames.some(x => x.system === 'recomp' && path.resolve(x.path) === path.resolve(folder))) throw new Error('That game is already in Harbour.');
  let executable = findGameExe(folder);
  if (!executable) {
    const r = await dialog.showOpenDialog(win, { title: 'Which program starts the game?', defaultPath: folder, properties: ['openFile'], filters: [{ name: 'Programs', extensions: ['exe'] }] });
    if (r.canceled) return null;
    executable = r.filePaths[0];
  }
  const entry = { id: randomUUID().slice(0, 8), system: 'recomp', path: folder, title: String(title || '').trim().slice(0, 120) || titleFromFolder(path.basename(folder)),
    executable, platform: platform || undefined, source };
  config.extraGames.push(entry); saveConfig(config);
  return { ...entry, exeName: path.basename(executable) };
});
// An emulator you already have: pick its .exe, say which consoles it plays, and optionally make it
// the one those consoles use. "{rom}" in the arguments is replaced with the game's file.
handle('harbour:addEmulator', async ({ name, systems, args, makeDefault }) => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose the emulator\'s program', filters: PROGRAM_FILTERS, properties: ['openFile'], ...PROGRAM_START });
  if (r.canceled) return null;
  const exe = r.filePaths[0];
  const label = String(name || '').trim().slice(0, 60) || titleFromFolder(path.basename(exe, path.extname(exe)));
  const id = 'custom-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const list = (systems || []).filter(s => config.systems.some(x => x.id === s));
  config.customEmulators = config.customEmulators.filter(e => e.id !== id);
  config.customEmulators.push({ id, name: label, exe, args: String(args || '').trim() || '{rom}', systems: list });
  if (makeDefault) for (const s of config.systems) if (list.includes(s.id)) s.emulator = id;
  saveConfig(config);
  return { id, name: label };
});
// Change the consoles an emulator you added plays (and its launch options).
handle('harbour:setEmulator', ({ id, systems, args, name }) => {
  const e = config.customEmulators.find(x => x.id === id);
  if (!e) throw new Error('Only emulators you added can be changed here.');
  if (Array.isArray(systems)) e.systems = systems.filter(s => config.systems.some(x => x.id === s));
  if (typeof args === 'string') e.args = args.trim() || '{rom}';
  if (typeof name === 'string' && name.trim()) e.name = name.trim().slice(0, 60);
  // A console it no longer plays stops using it.
  for (const s of config.systems) if (s.emulator === id && !e.systems.includes(s.id)) s.emulator = '';
  saveConfig(config);
  return true;
});
// ---------- Game folders ----------
// A folder of game files for a console. Choosing a parent folder ("D:\Games\roms") instead finds the
// consoles' own folders inside it by name: "N64", "PS2", "Switch", "X360", "DS"…
const FOLDER_NAMES = {
  a2600: ['atari 2600', '2600', 'atari'], arcade: ['arcade', 'mame'], nes: ['nes', 'famicom'], genesis: ['genesis', 'mega drive', 'megadrive', 'md'],
  gb: ['gb', 'game boy', 'gameboy'], snes: ['snes', 'super nintendo', 'super famicom', 'sfc'], ps1: ['ps1', 'psx', 'playstation', 'playstation 1'],
  n64: ['n64', 'nintendo 64'], gbc: ['gbc', 'game boy color', 'gameboy color'], dreamcast: ['dreamcast', 'dc'], ps2: ['ps2', 'playstation 2'],
  gba: ['gba', 'game boy advance', 'gameboy advance'], gc: ['gc', 'gamecube', 'ngc', 'gcn'], xbox: ['xbox', 'og xbox', 'xbox original'],
  nds: ['ds', 'nds', 'nintendo ds'], psp: ['psp'], x360: ['x360', 'xbox 360', '360'], ps3: ['ps3', 'playstation 3'], wii: ['wii'],
  '3ds': ['3ds', 'nintendo 3ds'], wiiu: ['wii u', 'wiiu'], ps4: ['ps4', 'playstation 4'], switch: ['switch', 'nintendo switch', 'nsw', 'ns'],
  switch2: ['switch 2', 'switch2', 'nintendo switch 2'],
};
const folderKey = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function consoleForFolder(name) {
  const key = folderKey(name);
  return Object.entries(FOLDER_NAMES).find(([, names]) => names.includes(key))?.[0] || null;
}
function addRomDir(sys, folder) {
  const dirs = romDirsOf(sys);
  if (dirs.some(d => path.resolve(d).toLowerCase() === path.resolve(folder).toLowerCase())) return false;
  sys.romDir = [...dirs, folder].join('|');
  return true;
}
// system: a console id, or '' to find consoles' folders inside the chosen one.
handle('harbour:addGameFolder', async ({ system }) => {
  const picked = await dialog.showOpenDialog(win, { title: system ? 'Choose the folder with your games' : 'Choose the folder that holds your consoles\' game folders', properties: ['openDirectory'] });
  if (picked.canceled) return null;
  const folder = picked.filePaths[0], added = [];
  if (system) {
    const sys = config.systems.find(s => s.id === system);
    if (!sys) throw new Error('Unknown console.');
    if (addRomDir(sys, folder)) added.push({ system, folder });
  } else {
    const own = consoleForFolder(path.basename(folder));
    const subs = own ? [] : (await fsp.readdir(folder, { withFileTypes: true })).filter(e => e.isDirectory());
    const found = own ? [[own, folder]] : subs.map(e => [consoleForFolder(e.name), path.join(folder, e.name)]).filter(([id]) => id);
    if (!found.length) throw new Error('No console folders found in there (folders named like N64, PS2, Switch, X360). Add it for one console instead.');
    for (const [id, dir] of found) { const sys = config.systems.find(s => s.id === id); if (sys && addRomDir(sys, dir)) added.push({ system: id, folder: dir }); }
  }
  saveConfig(config);
  return { added };
});
handle('harbour:removeGameFolder', ({ system, folder }) => {
  const sys = config.systems.find(s => s.id === system);
  if (!sys) throw new Error('Unknown console.');
  sys.romDir = romDirsOf(sys).filter(d => path.resolve(d).toLowerCase() !== path.resolve(folder).toLowerCase()).join('|');
  saveConfig(config);
  return true;
});
// ---------- Emulator updates ----------
// An emulator can have an update source: a GitHub repository ("owner/name") or one on another
// Forgejo/Gitea site ("git.eden-emu.dev/eden-emu/eden"). Harbour only tells you about new versions;
// emulators update with their own updater or by hand, then "I've updated it" records the version.
function parseSource(input) {
  const text = String(input || '').trim().replace(/^https?:\/\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  if (!text) return null;
  const m = text.match(/^(?:(?:www\.)?github\.com\/)?([\w.-]+\/[\w.-]+)$/i);
  if (m) return { type: 'github', repo: parseRepo(m[1]) };
  const f = text.match(/^([a-z0-9.-]+\.[a-z]{2,})\/([\w.-]+\/[\w.-]+)(?:\/.*)?$/i);
  if (f) return { type: 'forgejo', host: f[1].toLowerCase(), repo: f[2] };
  throw new Error('Enter a GitHub repository (owner/name) or a link to the project page.');
}
async function latestEmulatorRelease(source, prerelease) {
  let list, page;
  if (source.type === 'github') {
    page = `https://github.com/${source.repo}/releases`;
    // Stable track: ask GitHub for the latest stable release directly. Busy projects (PCSX2) publish
    // so many test builds that a stable one may not be among the newest few.
    if (!prerelease) {
      try {
        const rel = await ghJson(`https://api.github.com/repos/${source.repo}/releases/latest`);
        return { tag: rel.tag_name, date: (rel.published_at || '').slice(0, 10), page: rel.html_url || page };
      } catch (e) { if (!/GitHub 404/.test(e.message)) throw e; } // only test builds published: fall through
    }
    list = await ghJson(`https://api.github.com/repos/${source.repo}/releases?per_page=10`);
  } else {
    const r = await fetch(`https://${source.host}/api/v1/repos/${source.repo}/releases?limit=10`, { headers: { 'User-Agent': UA['User-Agent'] } });
    if (!r.ok) throw new Error(`${source.host} ${r.status}`);
    list = await r.json();
    page = `https://${source.host}/${source.repo}/releases`;
  }
  const rel = list.find(x => !x.draft && (prerelease || !x.prerelease)) || list.find(x => !x.draft);
  if (!rel) throw new Error(`${source.repo} has no releases.`);
  return { tag: rel.tag_name, date: (rel.published_at || '').slice(0, 10), page: rel.html_url || page };
}
function emulatorUpdateStatus(e, latest, error) {
  const installed = e.installed?.tag || null;
  return { id: e.id, source: e.source || null, installed, latest: latest || null, error: error || null,
    updateAvailable: latest && installed ? latest.tag !== installed : null };
}
async function checkEmulator(id, force = false) {
  const e = config.customEmulators.find(x => x.id === id);
  if (!e) throw new Error('Unknown emulator.');
  if (!e.source) return emulatorUpdateStatus(e);
  const key = 'emu:' + id, hit = recompChecks.get(key), sig = JSON.stringify(e.source);
  if (!force && hit && hit.repo === sig && Date.now() - hit.at < RECOMP_CHECK_MS) return emulatorUpdateStatus(e, hit.latest);
  try {
    const latest = await latestEmulatorRelease(e.source, e.source.prerelease);
    recompChecks.set(key, { at: Date.now(), latest, repo: sig }); saveRecompChecks();
    return emulatorUpdateStatus(e, latest);
  } catch (err) { return emulatorUpdateStatus(e, hit?.latest, err.message); }
}
handle('harbour:setEmulatorSource', ({ id, source, prerelease, installedTag }) => {
  const e = config.customEmulators.find(x => x.id === id);
  if (!e) throw new Error('Unknown emulator.');
  const parsed = parseSource(source);
  e.source = parsed ? { ...parsed, prerelease: !!prerelease } : undefined;
  const tag = String(installedTag || '').trim();
  e.installed = tag ? { tag } : undefined;
  recompChecks.delete('emu:' + id);
  saveConfig(config);
  return checkEmulator(id, true);
});
handle('harbour:checkEmulators', async force => {
  const out = {};
  await mapLimit(config.customEmulators, 4, async e => { out[e.id] = await checkEmulator(e.id, !!force); });
  return out;
});
handle('harbour:markEmulatorCurrent', id => {
  const e = config.customEmulators.find(x => x.id === id);
  const hit = recompChecks.get('emu:' + id);
  if (!e || !hit?.latest) throw new Error('Check for an update first.');
  e.installed = { tag: hit.latest.tag };
  saveConfig(config);
  return emulatorUpdateStatus(e, hit.latest);
});
handle('harbour:openEmulatorPage', async id => {
  const e = config.customEmulators.find(x => x.id === id);
  const page = recompChecks.get('emu:' + id)?.latest?.page || (e?.source && (e.source.type === 'github' ? `https://github.com/${e.source.repo}/releases` : `https://${e.source.host}/${e.source.repo}/releases`));
  if (!page || !/^https:\/\//.test(page)) throw new Error('No update source set for this emulator.');
  await shell.openExternal(page);
  return true;
});
// Which emulator a console uses (an emulator id, or '' for none).
handle('harbour:setSystemEmulator', ({ system, emulator }) => {
  const sys = config.systems.find(s => s.id === system);
  if (!sys) throw new Error('Unknown console.');
  if (emulator && !emuDef(emulator)) throw new Error('That emulator is not set up.');
  sys.emulator = emulator || ''; saveConfig(config);
  return true;
});
handle('game:add', async ({ system, title }) => {
  const sys = config.systems.find(s => s.id === system);
  if (!sys) throw new Error('Choose a system first.');
  if (sys.id === 'recomp') {
    const picked = await dialog.showOpenDialog(win, {title:'Choose the standalone game folder',properties:['openDirectory']});
    if (picked.canceled) return null;
    const folder = picked.filePaths[0];
    if (!fs.statSync(folder).isDirectory()) throw new Error('Choose a game folder.');
    if (config.extraGames.some(x => x.system === 'recomp' && path.resolve(x.path) === path.resolve(folder))) throw new Error('That game folder is already in Recomp.');
    const entry = {id:randomUUID().slice(0,8),system:'recomp',path:folder,title:String(title || '').trim().slice(0,120) || path.basename(folder)};
    config.extraGames.push(entry); saveConfig(config); return entry;
  }
  const exts = (sys.extensions || []).map(e => e.replace(/^\./, '')).filter(Boolean);
  const r = await dialog.showOpenDialog(win, { title: `Add a game to ${sys.name}`, properties: ['openFile'],
    filters: [...(exts.length ? [{ name: `${sys.name} games`, extensions: exts }] : []), { name: 'All files', extensions: ['*'] }],
    ...(sys.direct && process.platform === 'darwin' ? { defaultPath: '/Applications' } : {}) });
  if (r.canceled) return null;
  const file = r.filePaths[0];
  if (config.extraGames.some(x => x.system === sys.id && path.resolve(x.path) === path.resolve(file))) throw new Error('That game is already in your library.');
  // A program inside its own folder ("Hollow Knight\hollow_knight.exe") is named after the folder.
  const guess = /\.(exe|app)$/i.test(file) && path.basename(path.dirname(file)).length > 2 ? path.basename(path.dirname(file)) : displayTitle(path.basename(file, path.extname(file)));
  const entry = { id: randomUUID().slice(0, 8), system: sys.id, path: file, title: String(title || '').trim().slice(0, 120) || guess };
  config.extraGames.push(entry);
  saveConfig(config);
  return entry;
});
handle('game:remove', id => {
  config.extraGames = config.extraGames.filter(x => x.id !== id);
  saveConfig(config);
  return true;
});
// Recomps: platform shelf, update source, checks and updates.
handle('recomp:get', gameId => {
  const { entry } = recompEntry(gameId);
  return { platform: entry.platform || '', source: entry.source || null, installed: entry.installed || null };
});
handle('recomp:set', ({ gameId, platform, repo, prerelease, asset, auto, installedTag }) => {
  const { entry } = recompEntry(gameId);
  if (platform && !config.systems.some(s => s.id === platform)) throw new Error('Unknown platform.');
  entry.platform = platform || undefined;
  const r = String(repo || '').trim();
  if (r) {
    const parsed = parseRepo(r);
    if (!parsed) throw new Error('Enter a GitHub repository like owner/name, or its link.');
    if (asset) checkPattern(asset, 'download');
    if (entry.source?.repo !== parsed) entry.installed = undefined;
    entry.source = { repo: parsed, prerelease: !!prerelease, asset: String(asset || '').trim() || undefined, auto: !!auto };
  } else entry.source = undefined;
  const tag = String(installedTag || '').trim();
  if (tag && tag !== entry.installed?.tag) entry.installed = { tag };
  if (!tag && entry.installed && !entry.installed.assetId) entry.installed = undefined;
  recompChecks.delete(gameId);
  saveConfig(config);
  return true;
});
handle('recomp:check', (gameId, force) => checkRecomp(gameId, !!force));
handle('recomp:checkAll', async force => {
  const ids = libraryGames.filter(g => g.recomp && config.extraGames.find(x => x.id === g.added)?.source?.repo).map(g => g.id);
  const out = {};
  await mapLimit(ids, 4, async id => { out[id] = await checkRecomp(id, !!force); });
  return out;
});
handle('recomp:markCurrent', gameId => {
  const { entry } = recompEntry(gameId);
  const hit = recompChecks.get(gameId);
  if (!hit?.latest) throw new Error('Check for an update first.');
  entry.installed = { tag: hit.latest.tag, assetId: hit.latest.assetId, date: hit.latest.publishedAt };
  saveConfig(config);
  return recompStatus(entry, hit.latest);
});
handle('recomp:update', gameId => updateRecomp(gameId, p => win.webContents.send('recomp:progress', p)));
handle('recomp:openPage', async gameId => {
  const { entry } = recompEntry(gameId);
  const page = recompChecks.get(gameId)?.latest?.page || (entry.source?.repo && `https://github.com/${entry.source.repo}/releases`);
  if (!page || !/^https:\/\/github\.com\//.test(page)) throw new Error('No release page for this game.');
  await shell.openExternal(page);
  return true;
});


// ---------- Game videos ----------
const videos = createVideoService({
  dataDir: DATA, ghJson, extract, sha256File, defenderScan, log,
  download: (url, file, onBytes) => artwork.download(url, file, onBytes),
  getGames: () => libraryGames,
  getSystemName: id => config.systems.find(s => s.id === id)?.name || '',
  // The game's trailer / gameplay link from the LaunchBox database (rebuilt with links if it predates them).
  lookup: async game => { await launchbox.load(false); return (await launchbox.details(game.system, artwork.titleKeys(game)))?.video || null; },
  emit: job => { if (win && !win.isDestroyed()) win.webContents.send('video:progress', job); },
});
handle('video:start', options => videos.start(options || {}));
handle('video:status', () => videos.status());
handle('video:cancel', () => { videos.cancel(); return true; });
handle('art:start', options => artwork.start(options));
handle('art:status', () => artwork.status());
handle('art:cancel', () => artwork.cancel());
handle('emu:list', () => config.customEmulators.map(e => emuStatus(e.id)));
handle('emu:openFolder', id => { const exe = resolveExe(id); if (exe) shell.openPath(path.dirname(exe)); return !!exe; });
handle('emu:pickExe', async id => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose emulator program', filters: PROGRAM_FILTERS, properties: ['openFile'], ...PROGRAM_START });
  if (r.canceled) return null;
  config.emulators[id] = { ...(config.emulators[id] || {}), exe: r.filePaths[0] };
  saveConfig(config);
  return emuStatus(id);
});
handle('emu:remove', id => {
  if (!config.customEmulators.some(e => e.id === id)) throw new Error('Only emulators you added can be removed');
  config.customEmulators = config.customEmulators.filter(e => e.id !== id);
  delete config.emulators[id];
  for (const s of config.systems) if (s.emulator === id) s.emulator = ''; // consoles that used it have none now
  saveConfig(config);
  return true;
});
handle('dialog:folder', async title => {
  const r = await dialog.showOpenDialog(win, { title, properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (stateTimer) writeState(); });
app.on('browser-window-created', (_e, created) => { if (created !== webpWindow) created.on('closed', () => { if (BrowserWindow.getAllWindows().every(w => w === webpWindow)) closeWebpWindow(); }); });
