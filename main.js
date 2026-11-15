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
const { CATALOG } = require('./emulators');

const ROOT = __dirname;
const PACKAGE = require('./package.json');
const APP_VERSION = PACKAGE.version;
// Settings, artwork, videos and logs live in data\: next to Harbour.exe in a release (so an update, which replaces
// Harbour's own files, never touches them), or in the source folder when run from there.
const DATA = app.isPackaged ? path.join(path.dirname(process.execPath), 'data') : path.join(ROOT, 'data');
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
    // A console set to an emulator that isn't set up (older settings named built-in ones) has none.
    const known = new Set((saved.customEmulators || []).map(e => e.id));
    for (const s of saved.systems || []) if (s.emulator && !known.has(s.emulator)) s.emulator = '';
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

// Leftover format tags in a file name: "Crash Nitro Kart (USA).xiso.iso" leaves ".xiso" once ".iso" is taken off.
const FORMAT_TAG = /(\.(xiso|iso|cso|zso|chd|rvz|wbfs|gcm|ciso|nsp|xci|nsz|bin|cue|img|z64|n64|v64|nds|3ds|cia|gba|gbc|gb|sfc|smc|nes))+$/i;
function cleanTitle(name) {
  return name.replace(FORMAT_TAG, '').replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '')
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
  // PS4 games are folders too: eboot.bin, with the game's name in sce_sys/param.sfo (folders are often just "CUSA01234").
  const eboot = exts.includes('.pkg') && entries.find(e => e.isFile() && e.name.toLowerCase() === 'eboot.bin');
  if (eboot) {
    const title = (await ps4Title(dir)) || path.basename(dir);
    out.push({ name: title.replace(/[™®©]/g, '').replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim() + '.dump', path: path.join(dir, eboot.name), size: 9e9, dump: true });
    return out;
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

// A PS4 game's name from its param.sfo: a small table of keys and values; TITLE is the name.
async function ps4Title(dir) {
  try {
    const b = await fsp.readFile(path.join(dir, 'sce_sys', 'param.sfo'));
    if (b.length < 20 || b.toString('latin1', 0, 4) !== '\x00PSF') return null;
    const keys = b.readUInt32LE(8), data = b.readUInt32LE(12), count = b.readUInt32LE(16);
    for (let i = 0; i < count && 20 + i * 16 + 16 <= b.length; i++) {
      const at = 20 + i * 16;
      const keyStart = keys + b.readUInt16LE(at), keyEnd = b.indexOf(0, keyStart);
      if (b.toString('latin1', keyStart, keyEnd) !== 'TITLE') continue;
      const start = data + b.readUInt32LE(at + 12), len = b.readUInt32LE(at + 4);
      return b.toString('utf8', start, start + len).replace(/\0+$/, '').trim() || null;
    }
  } catch {}
  return null;
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
// A file's title ID: from its name ("[0100…]"), else from inside it (f.tid, read during the scan).
const fileTitleId = f => switchTitleId(f.name) || (f.tid ? switchTitleId(`[${f.tid}]`) : null);
// The title ID inside a Switch game whose name doesn't carry one: a dump folder's exefs/main.npdm (ACI0 block), or an
// NSP/NSZ's ticket ("<title id><key gen>.tik" in its file table). Copies of one game then become one entry, however
// they're named ("Mario Odyssey.nsp" and a "SMO-1.0.0" dump folder).
async function innerTitleId(f) {
  try {
    if (f.dump) {
      const b = await fsp.readFile(path.join(path.dirname(f.path), 'main.npdm'));
      if (b.toString('latin1', 0, 4) !== 'META') return null;
      const aci = b.readUInt32LE(0x70);
      return b.toString('latin1', aci, aci + 4) === 'ACI0' ? b.readBigUInt64LE(aci + 0x10).toString(16).padStart(16, '0') : null;
    }
    if (!/\.(nsp|nsz)$/i.test(f.name)) return null;
    const fh = await fsp.open(f.path, 'r');
    try {
      const b = Buffer.alloc(0x8000);
      await fh.read(b, 0, b.length, 0);
      if (b.toString('latin1', 0, 4) !== 'PFS0') return null;
      const count = b.readUInt32LE(4), names = 0x10 + count * 0x18;
      for (let i = 0; i < count && names < b.length; i++) {
        const start = names + b.readUInt32LE(0x10 + i * 0x18 + 0x10), end = b.indexOf(0, start);
        const m = b.toString('latin1', start, end).match(/^([0-9a-f]{16})[0-9a-f]{16}\.tik$/i);
        if (m) return m[1].toLowerCase();
      }
    } finally { await fh.close(); }
  } catch {}
  return null;
}

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
  if (titleIds) { const id = fileTitleId(f); if (id) s += id.part === 0 ? 8 : -8; }
  if (f.dump) s -= 1;  // a properly named file of the same game names it better than a dump folder ("SMO-1.0.0")
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
    if (titleIds) await mapLimit(files.filter(f => !f.added && !TITLE_ID.test(f.name)), SCAN_CONCURRENCY, async f => { f.tid = await innerTitleId(f); });
    // Keep every copy that shares the top score; only those ties need their file sizes read,
    // and those reads all run together.
    const tops = new Map();
    for (const f of files) {
      // Games added one by one are named by their title: two Switch folder dumps are both called "main".
      const base = f.recomp ? f.name : f.added && f.title ? f.title.replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim() : path.basename(f.name, path.extname(f.name));
      if (!/\.m3u$/i.test(f.name) && /\(disc \d+\)/i.test(base) && m3u.has(looseKey(base))) continue;
      // Games added one by one are always their own game (two Switch folder dumps are both called "main").
      const key = f.added ? f.added : (titleIds && fileTitleId(f)?.base) || looseKey(base) || base.toLowerCase();
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
      if (titleIds && !pick.added && (fileTitleId(pick)?.part || 0) !== 0) continue;
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
        ...(f.recomp && inPortsDir(config.extraGames.find(x => x.id === f.added)?.path) ? { deletable: true } : {}),
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
  const ports = new Set(games.filter(g => g.recomp && !gameState(g.id).hidden).map(g => g.system + '|' + looseKey(g.title)));
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
// Emulators Harbour installed or you added, linked by their .exe. "{rom}" in the launch options is
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
      if (!/\.(zip|7z|rar|exe)$/.test(n)) return -1;
      if (/(macos|mac|osx|darwin|linux|android|ios|appimage|flatpak)/.test(n)) return -1;
      if (/win|windows|msvc|mingw/.test(n)) v += 4;
      if (/x64|x86_64|amd64|win64/.test(n)) v += 2;
      if (/\.(zip|7z|rar)$/.test(n)) v += 2; // portable archives over installers
      if (/setup|install/.test(n)) v -= 3;
      if (/rog-?ally|steam-?deck|legacy/.test(n)) return -1; // builds for one handheld or old CPUs
      if (/no-?avx|no-?sse|compat|fallback|safe-?mode/.test(n)) v -= 3; // builds for old CPUs, when a normal one exists
      if (/msvc|clang|mingw|llvm/.test(n)) v -= .5; // when a plain build sits next to compiler variants, take the plain one
      if (/pgo/.test(n)) v += 1; // profile-optimised builds are the same program, just faster
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
  if (!r.ok) {
    const e = new Error(r.status === 403 || r.status === 429 ? "GitHub's limit for update checks is used up for now. Try again in an hour."
      : r.status === 404 ? "GitHub can't find that project." : `GitHub didn't answer (error ${r.status}). Try again later.`);
    e.status = r.status; throw e;
  }
  return r.json();
}

async function findRelease(repo, { asset: pattern, prerelease }) {
  const re = pattern ? new RegExp(pattern, 'i') : null;
  let list;
  if (prerelease) list = await ghJson(`https://api.github.com/repos/${repo}/releases?per_page=15`);
  else {
    // Forks often only publish pre-releases, which /releases/latest skips.
    try { list = [await ghJson(`https://api.github.com/repos/${repo}/releases/latest`)]; }
    catch (e) { if (e.status !== 404) throw e; list = (await ghJson(`https://api.github.com/repos/${repo}/releases?per_page=15`)).filter(r => !r.draft); }
    if (!list.length) throw new Error(`${repo} has no releases to download.`);
  }
  for (const rel of list) {
    if (rel.draft) continue;
    const asset = re ? rel.assets.find(a => re.test(a.name)) : guessAsset(rel.assets);
    if (asset) return {
      tag: rel.tag_name, releaseName: rel.name || rel.tag_name, publishedAt: asset.updated_at || rel.published_at,
      assetId: asset.id, assetName: asset.name, size: asset.size, url: asset.browser_download_url, notes: rel.body || '',
      digest: asset.digest || null, page: rel.html_url || `https://github.com/${repo}/releases`, api: asset.url || null,
      uploader: asset.uploader?.login || rel.author?.login || null,
    };
  }
  const platformName = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
  throw new Error(re ? `No ${platformName} download matching /${pattern}/ found in recent releases of ${repo}.` : `No ${platformName} download found in recent releases of ${repo}. Set its download file pattern in ••• → Platform & updates.`);
}

// Linux programs (AppImages, binaries) usually have no .exe extension.
const PROGRAM_FILTERS = process.platform === 'win32' ? [{ name: 'Programs', extensions: ['exe'] }]
  : process.platform === 'darwin' ? [{ name: 'Applications', extensions: ['app'] }, { name: 'All files', extensions: ['*'] }]
  : [{ name: 'All files', extensions: ['*'] }];
const PROGRAM_START = process.platform === 'darwin' ? { defaultPath: '/Applications' } : {};
const ARCHIVE = /\.(zip|7z|rar|tar|tgz|tar\.(gz|xz|zst|bz2))$/i;  // bsdtar (built into Windows) reads all of these
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
// Updates you do yourself (an emulator's own updater, a download from the release page) are noticed
// by the program file: Harbour remembers its size and date while your version is current, and once a
// newer release is out, a changed program file (or one dated after that release) means you have it.
function fileStamp(file) { try { const s = fs.statSync(file); return { id: `${s.size}:${Math.round(s.mtimeMs)}`, mtime: s.mtimeMs }; } catch { return null; } }
function noticeUpdate(holder, file, latest, outdated, current, name) {
  const inst = holder.installed, stamp = file && fileStamp(file);
  if (!inst || !stamp || !latest) return;
  if (!outdated(inst)) { if (inst.stamp !== stamp.id) { inst.stamp = stamp.id; saveConfig(config); } return; }
  // Needs the exact release time: a day-only date would count a file from earlier that day as newer.
  const released = Date.parse(latest.published || latest.publishedAt || '') || Infinity;
  if ((inst.stamp && inst.stamp !== stamp.id) || stamp.mtime > released) {
    holder.installed = { ...current(), uploader: inst.uploader, stamp: stamp.id }; saveConfig(config);
    log(`noticed ${name} was updated to ${latest.tag}`);
  } else if (!inst.stamp) { inst.stamp = stamp.id; saveConfig(config); }
}
function recompStatus(entry, latest) {
  noticeUpdate(entry, entry.executable, latest, i => i.assetId ? i.assetId !== latest.assetId : i.tag !== latest.tag,
    () => ({ tag: latest.tag, assetId: latest.assetId, date: latest.publishedAt }), entry.title);
  const inst = entry.installed || null;
  const updateAvailable = !latest ? null : inst?.assetId ? inst.assetId !== latest.assetId : inst?.tag ? inst.tag !== latest.tag : null;
  return {
    installed: inst, updateAvailable, auto: harbourInstalls(entry.source), repo: entry.source?.repo || null,
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
// Download a release file, check it (checksum when the site gives one, Windows Defender), and give
// back the folder of new files ready to copy. The caller removes tmp afterwards.
async function fetchRelease(rel, tmp, send) {
  const archive = path.join(tmp, rel.assetName);
  let r = await fetch(rel.url, { headers: { 'User-Agent': UA['User-Agent'] } });
  // A private GitHub repository's downloads need the GitHub login (gh) on this PC, through GitHub's own address.
  // The login is sent only to api.github.com: the redirect to the file itself drops it.
  if (r.status === 404 && /^https:[/][/]api[.]github[.]com[/]/.test(rel.api || '') && githubToken())
    r = await fetch(rel.api, { headers: { 'User-Agent': UA['User-Agent'], Accept: 'application/octet-stream', Authorization: `Bearer ${githubToken()}` } });
  if (!r.ok) throw new Error(`The download failed (error ${r.status}). Try again later.`);
  const total = Number(r.headers.get('content-length')) || rel.size || 0;
  let got = 0, last = 0;
  await downloadTo(r, archive, chunk => {
    got += chunk.length;
    if (Date.now() - last > 120) { last = Date.now(); send({ stage: `Downloading ${rel.assetName}`, pct: total ? got / total : 0 }); }
  });
  send({ stage: 'Checking the download…', pct: 1 });
  if (rel.digest && /^sha256:/i.test(rel.digest)) {
    const want = rel.digest.slice(7).toLowerCase(), have = await sha256File(archive);
    if (want !== have) throw new Error("The download doesn't match its published checksum. Nothing was installed.");
  }
  const scan = await defenderScan(archive);
  return { archive, scan };
}
async function unpackRelease(rel, archive, tmp, send) {
  const stage = path.join(tmp, 'x');
  await fsp.mkdir(stage);
  if (ARCHIVE.test(rel.assetName)) { send({ stage: 'Extracting…', pct: 1 }); await extract(archive, stage); }
  else await fsp.rename(archive, path.join(stage, rel.assetName));
  const top = fs.readdirSync(stage, { withFileTypes: true });
  return top.length === 1 && top[0].isDirectory() ? path.join(stage, top[0].name) : stage;
}
// ---- Same uploader ----
// An update is only installed when the same account uploaded it as the version you have: a project taken over by
// someone else, or a stranger's file, is stopped. (The first version Harbour installs sets who that is.) This and the
// checksum work on any system; the Windows Defender scan is an extra where it's there.
function checkUploader(installed, rel, name) {
  if (installed?.uploader && rel.uploader && installed.uploader.toLowerCase() !== rel.uploader.toLowerCase())
    throw new Error(`${name} ${rel.tag} was uploaded by a different account (${rel.uploader}, before: ${installed.uploader}). Harbour didn't install it: check its release page.`);
}
// ---- Can Harbour install this update, and where do its files go? ----
// Harbour installs every update itself unless you switched that off, or it found that a project's downloads are
// not the program itself (a setup kit or builder that makes the game from your copy): then that project updates
// with its own tool, and Harbour only says so.
const harbourInstalls = source => !!source && source.auto !== false && !source.ownTool;
class NotReadyToRun extends Error {}
function updatesWithOwnTool(source, name) {
  if (source && !source.ownTool) { source.ownTool = true; saveConfig(config); log(`${name}: downloads aren't ready-to-run builds, updates with its own tool`); }
  return new NotReadyToRun(`${name}: update in app.`);
}
// The files inside a remote zip, read from its end with a few small range requests instead of downloading it all.
// null when the server can't do that (the full download then decides).
async function remoteZipNames(url) {
  try {
    const part = async (start, end) => {
      const r = await fetch(url, { headers: { ...UA, Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(20000) });
      if (r.status !== 206) throw new Error('no ranges');
      return { bytes: Buffer.from(await r.arrayBuffer()), size: Number((r.headers.get('content-range') || '').split('/')[1]) };
    };
    const { size } = await part(0, 0);
    const tailLength = Math.min(size, 0xffff + 22);
    const { bytes: tail } = await part(size - tailLength, size - 1);
    const end = tail.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'));
    if (end < 0) return null;
    let dirSize = tail.readUInt32LE(end + 12), dirStart = tail.readUInt32LE(end + 16);
    if (dirStart === 0xffffffff) {  // zip64: the real numbers are in the zip64 end record
      const locator = tail.lastIndexOf(Buffer.from('PK\x06\x07', 'latin1'));
      if (locator < 0) return null;
      const at = Number(tail.readBigUInt64LE(locator + 8));
      const { bytes: z } = await part(at, at + 55);
      dirSize = Number(z.readBigUInt64LE(40)); dirStart = Number(z.readBigUInt64LE(48));
    }
    const { bytes: dir } = await part(dirStart, dirStart + dirSize - 1);
    // The names, with each file's unpacked size in names.sizes (used to tell which release a program is from).
    const names = [];
    names.sizes = new Map();
    for (let p = 0; p + 46 <= dir.length && dir.readUInt32LE(p) === 0x02014b50;) {
      const n = dir.readUInt16LE(p + 28);
      const name = dir.toString('utf8', p + 46, p + 46 + n);
      names.push(name);
      names.sizes.set(name, dir.readUInt32LE(p + 24));
      p += 46 + n + dir.readUInt16LE(p + 30) + dir.readUInt16LE(p + 32);
    }
    return names;
  } catch { return null; }
}
// Where an unpacked release goes: find the program you start (exe) inside it, and line the two up. A release whose
// folders sit one level deeper or shallower than your install lines up by itself. null when the program isn't in
// the release at all.
function placeRelease(src, exe) {
  if (!exe) return null;
  const want = path.basename(exe).toLowerCase();
  const found = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (r.split('/').length < 6) walk(path.join(dir, e.name), r); }
      else if (e.name.toLowerCase() === want) found.push(r);
    }
  };
  walk(src, '');
  const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  for (const rel of found.sort((a, b) => a.split('/').length - b.split('/').length)) {
    const parts = rel.split('/');
    let root = path.dirname(exe);
    for (let i = 1; i < parts.length; i++) root = path.dirname(root);
    if (same(path.join(root, ...parts), exe) && fs.existsSync(root)) return root;
  }
  return null;
}

// Copy new files over a program folder: the files replaced go to _harbour-backup\<old version>,
// settings files are kept, and only the newest two backups are left so the folder doesn't grow forever.
async function installInto(folder, src, oldTag, send) {
  send({ stage: 'Installing…', pct: 1 });
  const root = path.join(folder, '_harbour-backup');
  const backup = path.join(root, (oldTag || 'before-' + new Date().toISOString().slice(0, 10)).replace(/[^\w.-]+/g, '_'));
  const kept = [];
  try { await copyUpdate(src, folder, backup, kept); }
  catch (e) { if (/EBUSY|EPERM|EACCES/.test(e.code || '')) throw new Error('A file is in use or protected. Close the program and try again.'); throw e; }
  try {
    const old = fs.readdirSync(root).map(n => ({ p: path.join(root, n), t: fs.statSync(path.join(root, n)).mtimeMs })).sort((a, b) => b.t - a.t).slice(2);
    for (const o of old) await fsp.rm(o.p, { recursive: true, force: true });
  } catch {}
  return { kept, backup: fs.existsSync(backup) ? backup : null };
}
// Is a program (by its file name) running right now? Windows only; elsewhere assume not.
function isRunning(exe) {
  if (process.platform !== 'win32' || !exe) return false;
  const r = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${path.basename(exe)}`, '/NH'], { windowsHide: true, encoding: 'utf8' });
  return (r.stdout || '').toLowerCase().includes(path.basename(exe).toLowerCase());
}
const updatingRecomps = new Set();
async function updateRecomp(gameId, sendRaw) {
  const { game, entry } = recompEntry(gameId);
  if (!entry.source?.repo) throw new Error('Set an update source for this game first.');
  if (!harbourInstalls(entry.source)) throw new NotReadyToRun(`${game.title}: update in app.`);
  if (updatingRecomps.has(gameId)) throw new Error('Already updating');
  if (running.has(gameId) || isRunning(entry.executable)) throw new Error('Close the game before updating it.');
  const send = p => sendRaw({ gameId, ...p });
  updatingRecomps.add(gameId);
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'harbour-recomp-'));
  try {
    send({ stage: 'Checking latest release…', pct: 0 });
    const hit = recompChecks.get(gameId);
    const rel = hit && hit.repo === entry.source.repo && Date.now() - hit.at < 10 * 60 * 1000 && hit.latest?.url ? hit.latest
      : await findRelease(entry.source.repo, { asset: entry.source.asset, prerelease: entry.source.prerelease });
    checkUploader(entry.installed, rel, game.title);
    // A zip's file list says, before the big download, whether it holds the game's program at all.
    const exeName = entry.executable && path.basename(entry.executable).toLowerCase();
    if (exeName && /\.zip$/i.test(rel.assetName)) {
      send({ stage: 'Looking inside the release…', pct: 0 });
      const names = await remoteZipNames(rel.url);
      if (names && !names.some(n => n.split('/').pop().toLowerCase() === exeName)) throw updatesWithOwnTool(entry.source, game.title);
    }
    const { archive, scan } = await fetchRelease(rel, tmp, send);
    const src = await unpackRelease(rel, archive, tmp, send);
    // The release's files go wherever its copy of the program lines up with the one you start.
    const root = entry.executable ? placeRelease(src, entry.executable) : entry.path;
    if (!root) throw updatesWithOwnTool(entry.source, game.title);
    const { kept, backup } = await installInto(root, src, entry.installed?.tag, send);
    if (inPortsDir(entry.path) && path.resolve(root) === path.resolve(entry.path)) await rememberRelease(entry.id, src);
    if (entry.executable && !fs.existsSync(entry.executable)) {
      const exe = guessProgram(root, entry.source.repo);
      if (exe) entry.executable = exe;
    }
    entry.installed = { tag: rel.tag, assetId: rel.assetId, date: rel.publishedAt, at: new Date().toISOString(), uploader: rel.uploader || entry.installed?.uploader };
    saveConfig(config);
    recompChecks.set(gameId, { at: Date.now(), latest: rel, repo: entry.source.repo }); saveRecompChecks();
    send({ stage: 'Done', pct: 1, done: true });
    log(`recomp update ${game.title} -> ${rel.tag} (defender: ${scan}, kept ${kept.length} settings files)`);
    return { ...recompStatus(entry, rel), backup, kept, scan };
  } finally {
    updatingRecomps.delete(gameId);
    fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- Launching ----------
// While Steam runs it owns a Steam Controller and hands games a virtual gamepad instead. SDL's own Steam Controller
// driver (used by many emulators) would read the raw device and get nothing, so programs Harbour starts are told to
// leave it to Steam then. Without Steam running, the emulator may read the controller directly.
function launchEnv() {
  return isRunning('steam.exe') ? { ...process.env, SDL_JOYSTICK_HIDAPI_STEAM: '0' } : process.env;
}
// Emulators that start with no controller buttons set get a standard gamepad layout, so a pad works straight away.
// Only when nothing is bound yet: anything the player set themselves is left alone. melonDS: SDL button numbers of
// an Xbox-style pad, d-pad as hat 0 (0x100 + up 1 / right 2 / down 4 / left 8), DS A/B on the pad's east/south.
const PAD_DEFAULTS = {
  'melonds.exe': { file: 'melonDS.toml', section: '[Instance0.Joystick]',
    keys: { A: 1, B: 0, X: 3, Y: 2, L: 4, R: 5, Select: 6, Start: 7, Up: 0x101, Right: 0x102, Down: 0x104, Left: 0x108 } },
};
function padDefaults(exe) {
  const d = PAD_DEFAULTS[path.basename(exe).toLowerCase()];
  if (!d) return;
  try {
    const file = path.join(path.dirname(exe), d.file);
    const text = fs.readFileSync(file, 'utf8');
    const a = text.indexOf(d.section);
    if (a < 0) return;
    const next = text.indexOf('\n[', a + d.section.length);
    const b = next < 0 ? text.length : next;
    let sec = text.slice(a, b);
    const bound = Object.keys(d.keys).some(k => { const m = sec.match(new RegExp(`^${k} = (-?\\d+)`, 'm')); return m && m[1] !== '-1'; });
    if (bound) return;
    for (const [k, v] of Object.entries(d.keys)) sec = sec.replace(new RegExp(`^${k} = -1`, 'm'), `${k} = ${v}`);
    fs.writeFileSync(file, text.slice(0, a) + sec + text.slice(b));
  } catch {}
}
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
  if (!file) throw new Error('Choose its program first: ••• → Choose game .exe…');
  if (!fs.existsSync(file)) throw new Error(`${path.basename(file)} is missing. Was it moved or deleted?`);
  // Programs are started directly; batch files, shortcuts and anything else open the way the system would.
  const program = process.platform === 'win32' ? /\.exe$/i.test(file) : (/\.app$/i.test(file) || (fs.statSync(file).mode & 0o111) !== 0);
  if (!program) {
    const err = await shell.openPath(file);
    if (err) throw new Error(`Couldn't open ${path.basename(file)}: ${err}`);
    sendWindow('game:started', { ...recordPlay(game.id), untracked: true });
    return true;
  }
  const exe = macAppBinary(file);
  // A PC port can need options or its own starting folder (NX2navi starts through its launcher's play mode).
  const entry = game.recomp ? config.extraGames.find(x => x.id === game.added) : null;
  const args = Array.isArray(entry?.args) ? entry.args.map(String) : [];
  const cwd = entry?.cwd && fs.existsSync(entry.cwd) ? entry.cwd : path.dirname(exe);
  return new Promise((resolve, reject) => {
    padDefaults(exe);
    const child = spawn(exe, args, { cwd, env: launchEnv(), detached: true, stdio: 'ignore' });
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
// ---------- Emulator setup: fullscreen and a sharp picture ----------
// Every emulator Harbour starts a game in opens fullscreen, and draws at a resolution that fits this screen instead
// of the console's own (480 lines on a PS2, stretched up). Works for emulators you added too: they're known by their
// program's name. The resolution is set once per settings file and screen size, so a change you make inside the
// emulator stays (until the screen changes). Emulators that already draw at the screen's resolution (RMG, PPSSPP)
// and ones too heavy to push further on most PCs (Switch, Wii U, PS3, Xbox 360) are left as they are.

// The console's own picture height, and the most Harbour scales it up (a cap so older GPUs keep full speed).
const NATIVE_LINES = { ps1: 240, n64: 240, ps2: 480, gc: 480, wii: 480, xbox: 480, dreamcast: 480, psp: 272, nds: 192, '3ds': 240 };
const MAX_SCALE = { ps1: 8, ps2: 4, gc: 4, wii: 4, xbox: 3, dreamcast: 4, nds: 8, '3ds': 5 };
function resolutionScale(sysId) {
  if (!NATIVE_LINES[sysId] || !MAX_SCALE[sysId]) return 0;
  let height = 1080;
  try {
    const { screen } = require('electron');
    const d = win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
    height = Math.round(d.size.height * d.scaleFactor);
  } catch {}
  return Math.max(1, Math.min(MAX_SCALE[sysId], Math.round(height / NATIVE_LINES[sysId])));
}
const appData = () => process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const localAppData = () => process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const documents = () => { try { return app.getPath('documents'); } catch { return path.join(os.homedir(), 'Documents'); } };
// What each emulator needs: its fullscreen switch, and how to set its resolution (a launch option, or a settings
// file: the first of `files` that exists, with section -> key -> value).
const EMU_SETUP = [
  { exe: /^dolphin\.exe$/i, fullscreen: ['-C', 'Dolphin.Display.Fullscreen=True'], args: s => ['-C', `GFX.Settings.InternalResolution=${s}`] },
  { exe: /^flycast\.exe$/i, fullscreen: ['-config', 'window:fullscreen=yes'], args: s => ['-config', `config:rend.Resolution=${480 * s}`] },
  { exe: /^pcsx2.*\.exe$/i, fullscreen: ['-fullscreen'],
    files: dir => [path.join(dir, 'inis', 'PCSX2.ini'), path.join(documents(), 'PCSX2', 'inis', 'PCSX2.ini')],
    values: s => ({ 'EmuCore/GS': { upscale_multiplier: s } }) },
  { exe: /^duckstation.*\.exe$/i, fullscreen: ['-fullscreen'],
    files: dir => [path.join(dir, 'settings.ini'), path.join(localAppData(), 'DuckStation', 'settings.ini'), path.join(documents(), 'DuckStation', 'settings.ini')],
    values: s => ({ GPU: { ResolutionScale: s } }) },
  { exe: /^melonds\.exe$/i, fullscreen: ['-f'],
    files: dir => [path.join(dir, 'melonDS.toml'), path.join(appData(), 'melonDS', 'melonDS.toml')],
    values: s => ({ '3D': { Renderer: 1 }, '3D.GL': { ScaleFactor: s } }) },  // the OpenGL renderer can scale; software can't
  { exe: /^xemu\.exe$/i, fullscreen: ['-full-screen'],
    files: dir => [path.join(dir, 'xemu.toml'), path.join(appData(), 'xemu', 'xemu', 'xemu.toml')],
    values: s => ({ 'display.quality': { surface_scale: s } }) },
  { exe: /^(azahar|citra-qt|lime3ds)\.exe$/i, fullscreen: ['-f'],
    files: dir => [path.join(dir, 'user', 'config', 'qt-config.ini'), path.join(appData(), 'Azahar', 'config', 'qt-config.ini')],
    values: s => ({ Renderer: { 'resolution_factor\\default': 'false', resolution_factor: s } }) },
  { exe: /^rpcs3\.exe$/i, fullscreen: ['--fullscreen'], only: args => args.includes('--no-gui') },  // RPCS3's switch needs --no-gui
  { exe: /^(eden|lichii|yuzu|citron|suyu|sudachi|torzu)\.exe$/i, fullscreen: ['-f'] },
  { exe: /^rmg\.exe$/i, fullscreen: ['--fullscreen'] },
  { exe: /^shadps4\.exe$/i, fullscreen: ['-f', 'true'] },
  { exe: /^ppsspp.*\.exe$/i, fullscreen: ['--fullscreen'] },
  { exe: /^xenia.*\.exe$/i, fullscreen: ['--fullscreen'] },
  { exe: /^cemu\.exe$/i, fullscreen: ['-f'] },
  { exe: /^mgba\.exe$/i, fullscreen: ['-f'] },
  { exe: /^snes9x.*\.exe$/i, fullscreen: ['-fullscreen'] },
  { exe: /^mesen\.exe$/i, fullscreen: ['--fullscreen'] },
];
const setupFor = exe => EMU_SETUP.find(x => x.exe.test(path.basename(exe)));
// Sets key = value lines inside [section] blocks of an ini/TOML-style file, adding what's missing. Keeps the rest.
function setFileValues(file, sections) {
  const text = fs.readFileSync(file, 'utf8'), nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [section, values] of Object.entries(sections)) {
    let start = lines.findIndex(l => l.trim() === `[${section}]`);
    if (start < 0) { if (lines.length && lines[lines.length - 1].trim() !== '') lines.push(''); lines.push(`[${section}]`); start = lines.length - 1; }
    let end = lines.findIndex((l, i) => i > start && /^\s*\[/.test(l));
    if (end < 0) end = lines.length;
    for (const [key, value] of Object.entries(values)) {
      const at = lines.findIndex((l, i) => i > start && i < end && new RegExp(`^\\s*${esc(key)}\\s*=`).test(l));
      if (at >= 0) lines[at] = `${key} = ${value}`;
      else { lines.splice(start + 1, 0, `${key} = ${value}`); end++; }
    }
  }
  fs.writeFileSync(file, lines.join(nl));
}
// The launch options for a game: the emulator's own, plus its fullscreen switch and resolution when they're missing.
// Settings files are written here too (before the game starts, and again after it closes, for an emulator whose
// settings file only appears on its first run).
function emulatorSetup(exe, sysId, args) {
  padDefaults(exe);
  const s = setupFor(exe);
  if (!s) return args;
  // Added at the front: some emulators stop reading options at the game file, and options like "-dvd_path <file>"
  // must stay together.
  let out = [...args];
  const present = flag => out.some(a => a.toLowerCase() === flag.toLowerCase());
  if (s.fullscreen && (!s.only || s.only(out)) && !s.fullscreen.every(present)) out = [...s.fullscreen, ...out];
  const scale = resolutionScale(sysId);
  if (scale && s.args) out = [...s.args(scale), ...out];
  if (scale && s.files) tuneFile(exe, s, scale);
  return out;
}
function tuneFile(exe, s, scale) {
  const file = s.files(path.dirname(exe)).find(f => fs.existsSync(f));
  if (!file) return;
  config.tuned ||= {};
  const key = file.toLowerCase();
  if (config.tuned[key] === scale) return;  // set already; a change made in the emulator since then stays
  try { setFileValues(file, s.values(scale)); config.tuned[key] = scale; saveConfig(config); log(`set ${path.basename(exe)} to ${scale}x resolution (${file})`); }
  catch (e) { log(`couldn't set ${path.basename(exe)}'s resolution: ${e.message}`); }
}

function launchGame(gameId, options = {}) {
  // The ROM path always comes from the scanned library, never from the renderer.
  const game = libraryGames.find(g => g.id === gameId);
  if (!game) throw new Error('This game is no longer in your library. Was it moved or deleted?');
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
  const args = emulatorSetup(exe, sys.id, splitArgs(tpl).map(a => a.split('{rom}').join(rom)));
  return new Promise((resolve, reject) => {
    // detached: the game keeps running if Harbour is closed or restarted while playing.
    const child = spawn(exe, args, { cwd: path.dirname(exe), env: launchEnv(), detached: true, stdio: 'ignore' });
    child.once('error', e => reject(new Error(`Launch failed: ${e.message}`)));
    // An emulator's settings file can first appear when it closes: set its resolution then, for next time.
    child.once('exit', () => { const s = setupFor(exe), scale = resolutionScale(sys.id); if (s?.files && scale) tuneFile(exe, s, scale); });
    child.once('spawn', () => { track(game, child); child.unref(); resolve(true); });
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
  // Web links (like the catalogue's credit) open in the normal browser, never inside Harbour.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:[/][/]/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https:[/][/]/.test(url)) shell.openExternal(url); } });
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
  if (!game?.romPath || !fs.existsSync(game.romPath)) throw new Error('The game file is missing. Was it moved or deleted?');
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
// ---- Working out what a PC port is, from its folder ----
// Consoles named in text, most specific first ("Switch 2" before "Switch", "Xbox 360" before "Xbox").
const CONSOLE_NAMES = [
  ['switch2', /\bswitch ?2\b|\bnx2\b/i], ['switch', /\bswitch\b/i], ['x360', /xbox ?360|\bx360\b/i],
  ['xbox', /\bxbox\b(?! ?(?:360|one|series))|\bog xbox\b/i], ['ps4', /\bps4\b|playstation ?4/i], ['ps3', /\bps3\b|playstation ?3/i],
  ['ps2', /\bps2\b|playstation ?2/i], ['psp', /\bpsp\b/i], ['ps1', /\bps1\b|\bpsx\b|playstation(?! ?[2-5])/i],
  ['n64', /\bn64\b|nintendo ?64/i], ['gc', /gamecube|\bngc\b/i], ['wiiu', /\bwii ?u\b/i], ['wii', /\bwii\b(?! ?u)/i],
  ['3ds', /\b3ds\b/i], ['nds', /\bnds\b|nintendo ds\b/i], ['gba', /\bgba\b|game ?boy advance/i], ['dreamcast', /dreamcast/i],
  ['genesis', /genesis|mega ?drive/i], ['snes', /\bsnes\b|super nintendo/i], ['nes', /\bnes\b/i],
];
const consolesNamedIn = text => CONSOLE_NAMES.filter(([, re]) => re.test(text || '')).map(([id]) => id);
// "SuperMarioOdyssey_v2" -> "Super Mario Odyssey v2"
const splitName = s => String(s || '').replace(/\.exe$/i, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/[-_.]+/g, ' ').trim();
const PORT_JARGON = /\b(re-?comp(?:iled|ilation)?|static|native|pc|ports?|decomp(?:iled|ilation)?|launcher|win(?:dows|64)?|x64|setup|portable|release)\b/gi;

// GitHub projects the game's own files link to (readme, licence, credits), most mentioned first.
function linkedRepos(folder) {
  const counts = new Map();
  let budget = 400;  // files looked at, so a folder of unpacked game data doesn't take minutes
  const walk = (dir, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (depth > 0 && entries.length > 300) return;  // a data folder, not docs
    for (const e of entries) {
      if (budget <= 0) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 2 && !/^(_harbour-backup|node_modules|\.git|cache|shaders?|saves?|romfs|exefs)$/i.test(e.name)) walk(p, depth + 1); continue; }
      if (!/\.(md|txt|json|ini|toml|ya?ml|cfg|html?)$|^(license|readme|credits|notice)/i.test(e.name)) continue;
      budget--;
      let text = '';
      try { if (fs.statSync(p).size < 300 * 1024) text = fs.readFileSync(p, 'utf8'); } catch { continue; }
      for (const m of text.matchAll(/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?=[/\s"'`)<>#?,]|$)/gi)) {
        const repo = `${m[1]}/${m[2]}`;
        if (!/^(sponsors|orgs|features|topics|login)$/i.test(m[1])) counts.set(repo, (counts.get(repo) || 0) + 1);
      }
    }
  };
  walk(folder, 0);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([repo]) => repo);
}

// Is this project the one in the folder? Its newest release must hold the program. The release whose copy of the
// program is exactly the size of yours is the version you have (exact: true); failing that, the newest release
// published by the time your copy was made.
async function matchReleases(repo, exe) {
  const want = path.basename(exe).toLowerCase(), { size, mtimeMs } = fs.statSync(exe);
  let releases;
  try { releases = (await ghJson(`https://api.github.com/repos/${repo}/releases?per_page=4`)).filter(r => !r.draft); } catch { return null; }
  const held = [];
  for (const [i, rel] of releases.entries()) {
    const asset = guessAsset(rel.assets || []);
    if (!asset || !/\.zip$/i.test(asset.name)) continue;
    const names = await remoteZipNames(asset.browser_download_url);
    if (!names) continue;
    const inside = names.find(n => n.split('/').pop().toLowerCase() === want);
    if (!inside) { if (i === 0) return null; continue; }   // the newest release doesn't have it: not this project
    const installed = { tag: rel.tag_name, assetId: asset.id, date: asset.updated_at || rel.published_at };
    if (names.sizes.get(inside) === size) return { repo, prerelease: rel.prerelease, installed, exact: true };
    held.push(installed);
  }
  if (!held.length) return null;
  const byDate = held.find(r => Date.parse(r.date) <= mtimeMs + 2 * 864e5) || null;
  return { repo, prerelease: !!releases[0]?.prerelease, installed: byDate, exact: false };
}

// Words around a title that aren't part of it ("the Perfect Dark", "Nitro-Fueled and").
const EDGE_WORDS = /^(the|a|an|and|of|for|on|in|to|with|by|is|from)$/i;
// The game's real name and console: the longest run of words in the project's description, readme title, repo name
// or folder name that the LaunchBox database knows on a console (its PC listings are often the fan ports themselves,
// so they don't count). A console named in the text decides between several.
// When a game came out on several consoles and nothing names one: the consoles PC ports are usually made from first.
const PORT_CONSOLES = ['n64', 'ps2', 'x360', 'xbox', 'switch', 'gc', 'ps1', 'ps3', 'wii', 'switch2', 'ps4', 'dreamcast', 'psp', 'wiiu', 'snes', 'genesis', 'nds', '3ds', 'gba', 'gbc', 'gb', 'nes', 'a2600', 'arcade'];
const portRank = id => { const i = PORT_CONSOLES.indexOf(id); return i < 0 ? 99 : i; };
async function nameAndConsole(texts, ownName = '', clues = []) {
  texts = texts.filter(Boolean).map(t => t.replace(PORT_JARGON, ' '));
  const named = [...new Set([...clues, ...consolesNamedIn(texts.join(' \n '))])];
  // The first text with a match wins (the project's own title and description before anything it mentions later);
  // within it, the longest match.
  for (const text of texts) {
    let best = null;
    const words = text.replace(/[^\p{L}\p{N}'&:!.\- ]+/gu, ' ').split(/\s+/).map(w => w.replace(/^[:.\-]+$/, '')).filter(Boolean);
    for (let len = Math.min(words.length, 8); len >= 1; len--)
      for (let start = 0; start + len <= words.length; start++) {
        let run = words.slice(start, start + len);
        while (run.length && EDGE_WORDS.test(run[0].replace(/[:.\-]/g, '')) && run[0][0] === run[0][0].toLowerCase()) run = run.slice(1);
        while (run.length && EDGE_WORDS.test(run.at(-1).replace(/[:.\-]/g, ''))) run = run.slice(0, -1);
        const phrase = run.join(' ').replace(/^[:.\-]+|[:.\-]+$/g, '').trim();
        const key = looseKey(phrase);
        // A name starts with a capital or a number ("using" in a sentence is not the game Using).
        if (key.length < 5 || key === ownName || !/^[\p{Lu}\p{N}]/u.test(phrase) || (best && key.length <= best.key.length)) continue;
        const consoles = (await launchbox.consolesFor(key)).filter(c => c !== 'pc');
        if (!consoles.length) continue;
        const pick = consoles.find(c => named.includes(c)) || [...consoles].sort((a, b) => portRank(a) - portRank(b))[0];
        best = { key, title: phrase, platform: pick };
      }
    if (best) return { title: best.title, platform: best.platform };
  }
  return { title: null, platform: named.find(c => c !== 'pc') || null };
}

// Consoles the game's own folder gives away: its readme and notes, and files only one console's games have.
const CONSOLE_FILES = [['n64', /\.(z64|n64|v64)$/i], ['switch', /^(romfs|exefs)$|\.(nsp|xci)$/i], ['x360', /\.xex$/i], ['xbox', /\.xbe$/i],
  ['ps2', /\.(elf|irx)$|^slus_|^sles_/i], ['gc', /\.(gcm|rvz)$/i], ['ps1', /\.cue$/i]];
function consoleClues(folder) {
  const found = new Set();
  let text = '', budget = 200;
  const walk = (dir, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (budget-- <= 0) return;
      for (const [id, re] of CONSOLE_FILES) if (re.test(e.name)) found.add(id);
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 1 && entries.length < 300) walk(p, depth + 1); continue; }
      if (/\.(md|txt)$|^readme/i.test(e.name)) try { if (fs.statSync(p).size < 100 * 1024) text += fs.readFileSync(p, 'utf8').slice(0, 4000) + '\n'; } catch {}
    }
  };
  walk(folder, 0);
  for (const id of consolesNamedIn(text)) found.add(id);
  return [...found];
}

// Folder names that say nothing about the game: look one folder up as well.
const GENERIC_FOLDER = /^(launcher|bin|game|port|app|x64|win64|windows|build|release|dist|portable|files)$/i;

async function detectPort(folder, exe, known = null) {
  // 1. Which GitHub project: ones the game's files link to, then a search on its folder and program names.
  // (Installed from its GitHub page: the project and version are known already.)
  const folders = [path.basename(folder)];
  if (GENERIC_FOLDER.test(folders[0])) folders.push(path.basename(path.dirname(folder)));
  const candidates = known ? [] : linkedRepos(GENERIC_FOLDER.test(folders[0]) ? path.dirname(folder) : folder);
  const linked = new Set(candidates);
  // A name without the port jargon ("sly2-windows-x64" -> "sly2").
  const plain = s => splitName(String(s || '').replace(/[-_.]+/g, ' ').replace(PORT_JARGON, ' ')).replace(PORT_JARGON, ' ').replace(/\s+/g, ' ').trim();
  const names = [...new Set([...folders, path.basename(exe)].flatMap(n => [plain(n), splitName(n)]))].filter(n => n.length > 2 && !GENERIC_FOLDER.test(n));
  for (const n of known ? [] : names.slice(0, 3)) {  // GitHub allows only a few searches a minute
    try {
      const found = await ghJson(`https://api.github.com/search/repositories?q=${encodeURIComponent(n)}&sort=stars&per_page=5`);
      for (const r of found.items || []) candidates.push(r.full_name);
    } catch {}
  }
  // The first project whose release has exactly your program wins. One that only holds a program of that name
  // counts just when the game's own files link to it: from a search alone it could be a fork (blank beats wrong).
  // (linked: the projects the game's own files mention, captured before the search results were added)
  let match = known ? { repo: known.repo, installed: known.installed, prerelease: false, exact: true } : null;
  for (const repo of known ? [] : [...new Set(candidates)].slice(0, 8)) {
    const m = await matchReleases(repo, exe);
    if (!m) continue;
    if (m.exact) { match = m; break; }
    if (linked.has(repo)) match ||= m;
  }

  // 2. Its name and console, from the project's description and readme title, else the folder's name.
  // The GitHub description usually names the game ("A PC port of Super Mario 64"); a readme's title is often the
  // port's own name ("Ghostship"), and the rest of the readme mentions other games too, so it comes last.
  let description = '', readmeTitle = '', readmeBody = '';
  if (match) {
    try { description = (await ghJson(`https://api.github.com/repos/${match.repo}`)).description || ''; } catch {}
    try {
      const readme = Buffer.from((await ghJson(`https://api.github.com/repos/${match.repo}/readme`)).content || '', 'base64').toString('utf8');
      readmeTitle = (/^#\s+(.+)$/m.exec(readme) || [])[1] || '';
      readmeBody = readme.slice(0, 1500);
    } catch {}
  }
  // The project's own name ("Ghostship") isn't the game's name, even if the games database lists it.
  const ownName = match ? looseKey(plain(match.repo.split('/')[1])) : '';
  // Your own game file's name ("Mario Kart 64 (USA).z64") says best which game it is, so it's asked first.
  const guess = await nameAndConsole([known?.gameFile ? cleanTitle(path.basename(known.gameFile, path.extname(known.gameFile))) : '', description, readmeTitle, match && plain(match.repo.split('/')[1]), ...folders.map(plain), plain(path.basename(exe)), readmeBody], ownName, consoleClues(GENERIC_FOLDER.test(folders[0]) ? path.dirname(folder) : folder));
  return {
    title: (guess.title || plain(folders.at(-1)) || titleFromFolder(path.basename(folder))).slice(0, 120),
    platform: guess.platform && config.systems.some(s => s.id === guess.platform) ? guess.platform : '',
    repo: match?.repo || '', prerelease: !!match?.prerelease, installed: match?.installed || null,
  };
}

// Works out a port's project, version, name and console (also run when adding one).
handle('harbour:detectPort', ({ folder, executable }) => detectPort(folder, executable));
// Step 1 of adding a PC port: choose its folder; Harbour finds the program and works out the rest.
handle('harbour:pickPort', async () => {
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
  const found = await detectPort(folder, executable);
  log(`detected ${folder}: ${JSON.stringify(found)}`);
  return { folder, executable, exeName: path.basename(executable), ...found };
});
// Step 2: add it as confirmed.
handle('harbour:addPort', async ({ folder, executable, platform, title, repo, prerelease, installed }) => {
  if (!folder || !executable || !fs.existsSync(executable)) throw new Error('Choose the game\'s folder first.');
  if (platform && !config.systems.some(s => s.id === platform)) throw new Error('Unknown console.');
  if (config.extraGames.some(x => x.system === 'recomp' && path.resolve(x.path) === path.resolve(folder))) throw new Error('That game is already in Harbour.');
  const source = String(repo || '').trim() ? { repo: parseRepo(repo), prerelease: !!prerelease } : undefined;
  const entry = { id: randomUUID().slice(0, 8), system: 'recomp', path: folder, title: String(title || '').trim().slice(0, 120) || titleFromFolder(path.basename(folder)),
    executable, platform: platform || undefined, source, installed: source && installed?.tag ? installed : undefined };
  config.extraGames.push(entry); saveConfig(config);
  return { ...entry, exeName: path.basename(executable) };
});
// ---- Installing a PC port from its GitHub page, with your game file ----
// Harbour downloads the newest Windows release (checked like any update), unpacks it into Ports\<name> beside its
// data, puts your ROM or disc next to the program (where these ports look for it on their first start), works out
// the name and console and adds it. Projects without a ready-to-run Windows build are refused up front.
const PORTS_DIR = path.join(path.dirname(DATA), 'Ports');
const GAME_FILE_EXTS = [...new Set(DEFAULT_SYSTEMS.filter(s => !s.direct).flatMap(s => s.extensions).map(e => e.slice(1)))];
handle('harbour:pickGameFile', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose your game file (the ROM or disc the port is made from)', properties: ['openFile'],
    filters: [{ name: 'Game files', extensions: [...GAME_FILE_EXTS, 'sfc', 'smc', 'rsdk', 'bin', 'img'] }, { name: 'All files', extensions: ['*'] }] });
  return r.canceled ? null : r.filePaths[0];
});
// The catalogue of ports to choose from: Recompendium's (https://recompendium.com/, CC BY-SA 4.0), read once a week.
// Only what Harbour shows is kept: the game, the project, its GitHub page, its console and what it needs from you.
const CATALOG_FILE = path.join(DATA, 'media', '_index', 'recompendium.json');
const CATALOG_CONSOLES = { gamecube: 'gc', megadrive: 'genesis' };
handle('harbour:portCatalog', async () => {
  let cached = null;
  try { cached = JSON.parse(await fsp.readFile(CATALOG_FILE, 'utf8')); } catch {}
  if (!cached || Date.now() - cached.at > 7 * 864e5) {
    try {
      const r = await fetch('https://recompendium.com/unricopie/catalogo.json', { headers: { 'User-Agent': UA['User-Agent'] }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`recompendium.com didn't answer (error ${r.status})`);
      const list = ((await r.json()).entradas || [])
        .filter(x => x.repo && /^[\w.-]+\/[\w.-]+$/.test(x.repo) && !x.retirado && !x.sin_enlace)
        .map(x => ({ name: x.nombre, project: x.proyecto, repo: x.repo, console: CATALOG_CONSOLES[x.consola] || x.consola, consoleName: x.consola_nombre,
          status: x.estado, needs: x.requisitos?.en || '', stars: x.estrellas || 0, year: x.anio || null, released: !!x.version }));
      cached = { at: Date.now(), list };
      await fsp.mkdir(path.dirname(CATALOG_FILE), { recursive: true });
      await fsp.writeFile(CATALOG_FILE, JSON.stringify(cached));
    } catch (e) { if (!cached) throw e; }  // offline: last week's list is fine
  }
  const have = new Set(config.extraGames.map(x => x.source?.repo?.toLowerCase()).filter(Boolean));
  return cached.list.map(x => ({ ...x, platform: config.systems.some(s => s.id === x.console) ? x.console : '', installed: have.has(x.repo.toLowerCase()) }));
});
const installingPorts = new Set();
handle('harbour:installPort', async ({ repo: link, rom, title, platform }) => {
  const repo = parseRepo(link);
  if (config.extraGames.some(x => x.source?.repo?.toLowerCase() === repo.toLowerCase())) throw new Error('That game is already in Harbour.');
  if (rom && !fs.existsSync(rom)) throw new Error("Can't find that game file.");
  if (installingPorts.has(repo)) throw new Error('Already installing.');
  installingPorts.add(repo);
  const send = p => win?.webContents.send('recomp:progress', { gameId: 'port:' + repo, ...p });
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'harbour-port-'));
  try {
    send({ stage: 'Finding the latest release…', pct: 0 });
    let rel;
    try { rel = await findRelease(repo, { prerelease: false }); }
    catch (e) { throw new Error(e.status === 404 ? "GitHub can't find that project." : `${repo} has no Windows download Harbour can install. Install it the way its page says, then add its folder.`); }
    const notReady = () => new Error(`${repo} doesn't publish a ready-to-run Windows build. Install it the way its page says, then add its folder.`);
    if (/setup|install/i.test(rel.assetName) && /\.(exe|msi)$/i.test(rel.assetName)) throw notReady();
    if (/\.zip$/i.test(rel.assetName)) { const names = await remoteZipNames(rel.url); if (names && !names.some(n => /\.exe$/i.test(n))) throw notReady(); }
    const { archive, scan } = await fetchRelease(rel, tmp, send);
    const src = await unpackRelease(rel, archive, tmp, send);
    send({ stage: 'Installing…', pct: 1 });
    // Its own folder, named after the project ("SpaghettiKart"). Installed before and deleted: the same folder again,
    // where your saves and mods still are. Never on top of a folder another game in Harbour uses.
    const used = f => config.extraGames.some(x => path.resolve(x.path).toLowerCase() === path.resolve(f).toLowerCase());
    let folder = path.join(PORTS_DIR, repo.split('/')[1].replace(/[<>:"|?*]/g, ''));
    for (let n = 2; used(folder); n++) folder = path.join(PORTS_DIR, `${repo.split('/')[1]} ${n}`);
    await fsp.mkdir(folder, { recursive: true });
    // Files already there are yours from before (a settings file you changed): the download doesn't replace them.
    await fsp.cp(src, folder, { recursive: true, force: false, errorOnExist: false });
    const exe = findGameExe(folder) || guessProgram(folder, repo);
    if (!exe) { await fsp.rm(folder, { recursive: true, force: true }); throw notReady(); }
    const returning = (await filesIn(folder)).length > (await filesIn(src)).length;  // your files were already there
    if (rom) await fsp.copyFile(rom, path.join(path.dirname(exe), path.basename(rom)));
    const installed = { tag: rel.tag, assetId: rel.assetId, date: rel.publishedAt, uploader: rel.uploader || undefined };
    // From the catalogue the name and console are known; otherwise Harbour works them out.
    const found = title ? { title: String(title).slice(0, 120), platform: config.systems.some(s => s.id === platform) ? platform : '' }
      : await detectPort(folder, exe, { repo, installed, gameFile: rom });
    const entry = { id: randomUUID().slice(0, 8), system: 'recomp', path: folder, title: found.title, executable: exe,
      platform: found.platform || undefined, source: { repo, prerelease: false }, installed, gameFile: rom ? path.basename(rom) : undefined };
    config.extraGames.push(entry); saveConfig(config);
    await rememberRelease(entry.id, src);
    log(`installed port ${repo} ${rel.tag} (${rel.assetName}, defender: ${scan}) to ${folder} as ${found.title} [${found.platform || 'recomp'}]${rom ? ' with ' + path.basename(rom) : ''}${returning ? ', back into its folder with your files' : ''}`);
    send({ stage: 'Done', pct: 1, done: true });
    return entry;
  } finally {
    installingPorts.delete(repo);
    fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
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
// ---- Installing a well-known emulator (emulators.js) ----
// Into an Emulators folder beside Harbour's data, ready for its consoles, with updates from where it's released.
const EMULATORS_DIR = path.join(path.dirname(DATA), 'Emulators');
const sameSource = (a, b) => !!a && !!b && a.repo?.toLowerCase() === b.repo?.toLowerCase() && (a.host || '') === (b.host || '');
handle('harbour:emulatorCatalog', () => CATALOG
  .map(c => ({ ...c, consoles: c.consoles.filter(id => config.systems.some(s => s.id === id)),
    installed: config.customEmulators.find(e => sameSource(e.source, c.source))?.id || null }))
  .filter(c => c.consoles.length));
const installing = new Set();
handle('harbour:installEmulator', async catalogId => {
  const c = CATALOG.find(x => x.id === catalogId);
  if (!c) throw new Error('Unknown emulator.');
  if (config.customEmulators.some(e => sameSource(e.source, c.source))) throw new Error(`${c.name} is already set up.`);
  if (installing.has(c.id)) throw new Error('Already installing.');
  installing.add(c.id);
  const send = p => win?.webContents.send('recomp:progress', { gameId: 'install:' + c.id, ...p });
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'harbour-install-'));
  try {
    send({ stage: 'Finding the latest release…', pct: 0 });
    const source = { ...c.source, prerelease: false };
    const rel = await emulatorDownload(source);
    const { archive, scan } = await fetchRelease(rel, tmp, send);
    const src = await unpackRelease(rel, archive, tmp, send);
    send({ stage: 'Installing…', pct: 1 });
    const folder = path.join(EMULATORS_DIR, c.name);
    await fsp.mkdir(folder, { recursive: true });
    await fsp.cp(src, folder, { recursive: true, force: false, errorOnExist: false });
    // The program: the one the catalogue names, wherever it sits in the release, else the best guess.
    let exe = null;
    const look = (dir, depth) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (depth < 3 && !exe) look(p, depth + 1); }
        else if (e.name.toLowerCase() === c.exe.toLowerCase()) exe ||= p;
      }
    };
    look(folder, 0);
    exe ||= guessProgram(folder, c.source.repo);
    if (!exe) throw new Error(`${c.name} was downloaded, but its program wasn't found in it.`);
    // Portable mode: its settings live in its own folder, where Harbour can find them.
    if (c.portable && !fs.existsSync(path.join(path.dirname(exe), c.portable))) fs.writeFileSync(path.join(path.dirname(exe), c.portable), '');
    const id = 'custom-' + c.id;
    config.customEmulators = config.customEmulators.filter(e => e.id !== id);
    config.customEmulators.push({ id, name: c.name, exe, args: c.args, systems: [...c.consoles],
      source: { ...c.source, prerelease: false },
      installed: { tag: rel.tag, stamp: fileStamp(exe)?.id, uploader: rel.uploader || undefined } });
    // Consoles without a working emulator start using it.
    for (const s of config.systems) if (c.consoles.includes(s.id) && !emuDef(s.emulator)) s.emulator = id;
    saveConfig(config);
    log(`installed ${c.name} ${rel.tag} (${rel.assetName}, defender: ${scan}) to ${folder}`);
    send({ stage: 'Done', pct: 1, done: true });
    return { id, name: c.name, note: c.note || '' };
  } finally {
    installing.delete(c.id);
    fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
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
// An emulator can have an update source: a GitHub repository ("owner/name"), one on another Forgejo/Gitea site
// ("git.eden-emu.dev/eden-emu/eden") or Dolphin's own site. Harbour installs its updates (see harbour:emuUpdate), and
// notices when you update it some other way (see noticeUpdate).
function parseSource(input) {
  const text = String(input || '').trim().replace(/^https?:\/\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  if (!text) return null;
  if (/^(www.)?dolphin-emu.org(?:[/]|$)/i.test(text)) return { type: 'dolphin', repo: 'dolphin-emu/dolphin' };
  const m = text.match(/^(?:(?:www\.)?github\.com\/)?([\w.-]+\/[\w.-]+)$/i);
  if (m) return { type: 'github', repo: parseRepo(m[1]) };
  const f = text.match(/^([a-z0-9.-]+\.[a-z]{2,})\/([\w.-]+\/[\w.-]+)(?:\/.*)?$/i);
  if (f) return { type: 'forgejo', host: f[1].toLowerCase(), repo: f[2] };
  throw new Error('Enter a GitHub repository (owner/name) or a link to the project page.');
}
// Dolphin publishes its builds on its own site, not GitHub: its built-in updater reads this feed of the newest release.
async function dolphinRelease() {
  const r = await fetch('https://dolphin-emu.org/update/latest/beta/', { headers: { 'User-Agent': UA['User-Agent'] } });
  if (!r.ok) throw new Error(`dolphin-emu.org didn't answer (error ${r.status}). Try again later.`);
  const j = await r.json();
  const a = (j.artifacts || []).find(x => /^windows x64/i.test(x.system));
  if (!a) throw new Error('No Windows download in the newest Dolphin release.');
  return { tag: j.shortrev, date: (j.date || '').slice(0, 10), publishedAt: j.date || null, published: j.date || null,
    assetId: j.hash, assetName: path.basename(new URL(a.url).pathname), size: 0, url: a.url, digest: null, page: 'https://dolphin-emu.org/download/' };
}
async function latestEmulatorRelease(source, prerelease) {
  let list, page;
  if (source.type === 'dolphin') return dolphinRelease();
  if (source.type === 'github') {
    page = `https://github.com/${source.repo}/releases`;
    // Stable track: ask GitHub for the latest stable release directly. Busy projects (PCSX2) publish
    // so many test builds that a stable one may not be among the newest few.
    if (!prerelease) {
      try {
        const rel = await ghJson(`https://api.github.com/repos/${source.repo}/releases/latest`);
        return { tag: rel.tag_name, date: (rel.published_at || '').slice(0, 10), published: rel.published_at || null, page: rel.html_url || page };
      } catch (e) { if (e.status !== 404) throw e; } // only test builds published: fall through
    }
    list = await ghJson(`https://api.github.com/repos/${source.repo}/releases?per_page=10`);
  } else {
    const r = await fetch(`https://${source.host}/api/v1/repos/${source.repo}/releases?limit=10`, { headers: { 'User-Agent': UA['User-Agent'] } });
    if (!r.ok) throw new Error(`${source.host} didn't answer (error ${r.status}). Try again later.`);
    list = await r.json();
    page = `https://${source.host}/${source.repo}/releases`;
  }
  const rel = list.find(x => !x.draft && (prerelease || !x.prerelease)) || list.find(x => !x.draft);
  if (!rel) throw new Error(`${source.repo} has no releases.`);
  return { tag: rel.tag_name, date: (rel.published_at || '').slice(0, 10), published: rel.published_at || null, page: rel.html_url || page };
}
function emulatorUpdateStatus(e, latest, error) {
  noticeUpdate(e, resolveExe(e.id), latest, i => i.tag !== latest.tag, () => ({ tag: latest.tag }), e.name);
  const installed = e.installed?.tag || null;
  return { id: e.id, source: e.source || null, installed, latest: latest || null, error: error || null, canInstall: harbourInstalls(e.source) && !!resolveExe(e.id),
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
// ---- Installing emulator updates ----
// The release with its Windows download. installer: true picks the setup .exe instead of the portable archive.
async function emulatorDownload(source, { installer = false } = {}) {
  if (source.type === 'dolphin') { if (installer) throw new Error('Dolphin has no installer here.'); return dolphinRelease(); }
  const pattern = installer ? '(setup|install).*\\.exe$' : source.asset;
  if (source.type === 'github') return findRelease(source.repo, { asset: pattern, prerelease: source.prerelease });
  const r = await fetch(`https://${source.host}/api/v1/repos/${source.repo}/releases?limit=10`, { headers: { 'User-Agent': UA['User-Agent'] } });
  if (!r.ok) throw new Error(`${source.host} didn't answer (error ${r.status}). Try again later.`);
  const re = pattern ? new RegExp(pattern, 'i') : null;
  for (const rel of (await r.json()).filter(x => !x.draft && (source.prerelease || !x.prerelease))) {
    const a = re ? rel.assets.find(x => re.test(x.name)) : guessAsset(rel.assets);
    if (a) return { tag: rel.tag_name, publishedAt: rel.published_at, assetId: a.id, assetName: a.name, size: a.size || 0,
      url: a.browser_download_url, digest: null, page: rel.html_url || `https://${source.host}/${source.repo}/releases`, uploader: rel.author?.login || null };
  }
  throw new Error(`No Windows download found in the recent releases of ${source.repo}.`);
}
// Can Harbour write into this folder? (Program Files can't be written without admin rights.)
function canWrite(folder) {
  const probe = path.join(folder, `.harbour-${process.pid}.tmp`);
  try { fs.writeFileSync(probe, ''); fs.unlinkSync(probe); return true; } catch { return false; }
}
// Run a program's own installer with admin rights (one Windows prompt) and silent switches.
// NSIS installers (like PCSX2's) take /S; Inno Setup ones take /VERYSILENT.
function runInstallerElevated(file) {
  const q = s => `'${String(s).replace(/'/g, "''")}'`;
  const ps = `$p = Start-Process -FilePath ${q(file)} -ArgumentList '/S','/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -Verb RunAs -Wait -PassThru; exit $p.ExitCode`;
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
    let err = ''; p.stderr.on('data', d => (err += d));
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error(/canceled|cancelled/i.test(err) ? 'The admin prompt was cancelled. Nothing was installed.' : `The installer stopped (code ${code}).`)));
  });
}
const updatingEmus = new Set();
handle('harbour:emuUpdate', async id => {
  const e = config.customEmulators.find(x => x.id === id);
  const exe = e && resolveExe(id);
  if (!e?.source) throw new Error('Set where this emulator\'s updates come from first (Updates…).');
  if (!exe) throw new Error(`Can't find ${e.name}'s program. Choose it again first.`);
  if (!harbourInstalls(e.source)) throw new NotReadyToRun(`${e.name}: update in app.`);
  if (updatingEmus.has(id)) throw new Error('Already updating.');
  if (running.size || isRunning(exe)) throw new Error(`Close ${e.name} (and any game) before updating it.`);
  const send = p => win?.webContents.send('recomp:progress', { gameId: 'emu:' + id, ...p });
  updatingEmus.add(id);
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'harbour-emu-'));
  try {
    send({ stage: 'Checking latest release…', pct: 0 });
    const folder = path.dirname(exe);
    const viaInstaller = !canWrite(folder);
    const rel = await emulatorDownload(e.source, { installer: viaInstaller });
    checkUploader(e.installed, rel, e.name);
    if (!viaInstaller && /\.zip$/i.test(rel.assetName)) {
      const names = await remoteZipNames(rel.url);
      if (names && !names.some(n => n.split('/').pop().toLowerCase() === path.basename(exe).toLowerCase())) throw updatesWithOwnTool(e.source, e.name);
    }
    const { archive, scan } = await fetchRelease(rel, tmp, send);
    let kept = [];
    if (viaInstaller) {
      send({ stage: 'Installing (approve the Windows prompt)…', pct: 1 });
      await runInstallerElevated(archive);
    } else {
      const src = await unpackRelease(rel, archive, tmp, send);
      const root = placeRelease(src, exe);
      if (!root) throw updatesWithOwnTool(e.source, e.name);
      ({ kept } = await installInto(root, src, e.installed?.tag, send));
    }
    if (!fs.existsSync(exe)) throw new Error(`${path.basename(exe)} is gone after the update. Choose the program again in Emulators.`);
    e.installed = { tag: rel.tag, stamp: fileStamp(exe)?.id, uploader: rel.uploader || e.installed?.uploader };
    saveConfig(config);
    const latest = { tag: rel.tag, date: (rel.publishedAt || '').slice(0, 10), published: rel.publishedAt, page: rel.page };
    recompChecks.set('emu:' + id, { at: Date.now(), latest, repo: JSON.stringify(e.source) }); saveRecompChecks();
    send({ stage: 'Done', pct: 1, done: true });
    log(`emulator update ${e.name} -> ${rel.tag} (${rel.assetName}, ${viaInstaller ? 'installer' : 'copied'}, defender: ${scan}, kept ${kept.length} settings files)`);
    return emulatorUpdateStatus(e, latest);
  } finally {
    updatingEmus.delete(id);
    fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

// ---------- Harbour's own updates ----------
// A release of Harbour is a zip: Harbour.exe and the Electron runtime, with Harbour's own files in resources\app.
// An update replaces resources\app (your data\ is outside it) and restarts. A release built on a different Electron
// can't be swapped in while Harbour runs, so that one is "update in app": its release page.
const SELF_REPO = String(PACKAGE.repository?.url || PACKAGE.repository || '').replace(/^github:|^https:\/\/github\.com\/|\.git$/g, '');
let selfCheck = null;  // { at, latest }
async function harbourStatus(force = false) {
  if (!app.isPackaged || !SELF_REPO) return { packaged: app.isPackaged, current: APP_VERSION, updateAvailable: false };
  if (force || !selfCheck || Date.now() - selfCheck.at > RECOMP_CHECK_MS) {
    try { selfCheck = { at: Date.now(), latest: await findRelease(SELF_REPO, { asset: 'win64\\.zip$', prerelease: false }) }; }
    catch (e) { return { packaged: true, current: APP_VERSION, updateAvailable: false, error: e.message }; }
  }
  const latest = selfCheck.latest;
  const tag = String(latest.tag || '').replace(/^v/, '');
  const newer = tag.localeCompare(APP_VERSION, undefined, { numeric: true }) > 0;
  return { packaged: true, current: APP_VERSION, updateAvailable: newer, latest: { tag: latest.tag, page: latest.page, notes: latest.notes } };
}
handle('harbour:selfStatus', force => harbourStatus(!!force));
handle('harbour:selfUpdate', async () => {
  const st = await harbourStatus(true);
  if (!st.updateAvailable) return st;
  const rel = selfCheck.latest;
  const send = p => win?.webContents.send('recomp:progress', { gameId: 'harbour', ...p });
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'harbour-self-'));
  try {
    const { archive, scan } = await fetchRelease(rel, tmp, send);
    const src = await unpackRelease(rel, archive, tmp, send);
    const appSrc = path.join(src, 'resources', 'app');
    if (!fs.existsSync(path.join(appSrc, 'main.js'))) throw new Error('That release doesn\'t look like Harbour.');
    const runtime = (() => { try { return fs.readFileSync(path.join(src, 'electron-version.txt'), 'utf8').trim(); } catch { return ''; } })();
    if (runtime && runtime !== process.versions.electron) {
      await shell.openExternal(rel.page);
      throw new NotReadyToRun('This Harbour update needs a fresh download: update in app (its release page is open).');
    }
    send({ stage: 'Installing…', pct: 1 });
    const backup = path.join(DATA, '_harbour-backup', 'harbour-' + APP_VERSION);
    await copyUpdate(appSrc, ROOT, backup, []);
    log(`harbour updated ${APP_VERSION} -> ${rel.tag} (defender: ${scan})`);
    send({ stage: 'Restarting…', pct: 1, done: true });
    setTimeout(() => { app.relaunch(); app.exit(0); }, 800);
    return { ...st, installed: rel.tag };
  } finally {
    fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

handle('harbour:openEmulatorPage', async id => {
  const e = config.customEmulators.find(x => x.id === id);
  const page = recompChecks.get('emu:' + id)?.latest?.page || (e?.source && (e.source.type === 'dolphin' ? 'https://dolphin-emu.org/download/' : e.source.type === 'github' ? `https://github.com/${e.source.repo}/releases` : `https://${e.source.host}/${e.source.repo}/releases`));
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
// ---- What a port's install put in its folder ----
// Harbour remembers the files that came in a port's download, with their sizes (data\ports\<id>.json). Deleting the
// port removes just those (and the copy of your game file Harbour placed there); everything else in its folder (saves,
// mods you added, settings you changed) stays where it is, so installing it again picks up right where you were.
const manifestFile = id => path.join(DATA, 'ports', `${id}.json`);
async function filesIn(dir, base = dir, out = []) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await filesIn(p, base, out); else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}
async function rememberRelease(id, dir) {
  let known = {};
  try { const j = JSON.parse(await fsp.readFile(manifestFile(id), 'utf8')); if (!Array.isArray(j)) known = j; } catch {}
  for (const rel of await filesIn(dir)) { try { known[rel.toLowerCase()] = (await fsp.stat(path.join(dir, rel))).size; } catch {} }
  await fsp.mkdir(path.dirname(manifestFile(id)), { recursive: true });
  await fsp.writeFile(manifestFile(id), JSON.stringify(known));
}
// What came in the download: the list Harbour kept, or (for ports installed before it kept one) the release's zip.
async function releaseFilesOf(entry) {
  try { return new Map(Object.entries(JSON.parse(await fsp.readFile(manifestFile(entry.id), 'utf8')))); } catch {}
  try {
    const rel = await findRelease(entry.source.repo, { asset: entry.source.asset, prerelease: entry.source.prerelease });
    const all = await remoteZipNames(rel.url), names = all?.filter(n => !n.endsWith('/'));
    if (!names?.length) return null;
    const top = names[0].split('/')[0] + '/';  // a zip holding one folder: it was unpacked without it
    const strip = names.every(m => m.startsWith(top));
    return new Map(names.map(n => [(strip ? n.slice(top.length) : n).toLowerCase(), all.sizes.get(n) ?? null]));
  } catch { return null; }
}
// Removes what the install put there (files changed since are yours and stay), then any folders left empty.
async function removeInstalled(entry) {
  const release = await releaseFilesOf(entry);
  if (!release) throw new Error("Harbour can't tell which files came with it, so it didn't delete anything. Undock it instead.");
  const ownGameFile = entry.gameFile && path.relative(entry.path, path.join(path.dirname(entry.executable), entry.gameFile)).split(path.sep).join('/').toLowerCase();
  let removed = 0, left = 0;
  for (const rel of await filesIn(entry.path)) {
    const lower = rel.toLowerCase(), file = path.join(entry.path, rel);
    let size; try { size = (await fsp.stat(file)).size; } catch { continue; }
    const fromInstall = (release.has(lower) && (release.get(lower) == null || release.get(lower) === size)) || lower === ownGameFile;
    if (!fromInstall) { left++; continue; }
    await fsp.unlink(file); removed++;
  }
  const prune = async dir => {
    for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) if (e.isDirectory()) await prune(path.join(dir, e.name));
    if (!(await fsp.readdir(dir).catch(() => ['x'])).length) await fsp.rmdir(dir).catch(() => {});
  };
  await prune(entry.path);
  return { removed, left };
}
// "Undock and delete": only for a port Harbour installed into its own Ports folder (just its install is removed, see
// above). Ports you installed yourself are never deleted by Harbour; they can only be undocked.
const inPortsDir = p => { if (!p) return false; const rel = path.relative(PORTS_DIR, path.resolve(p)); return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel) && !rel.includes(path.sep); };
handle('game:delete', async gameId => {
  const game = libraryGames.find(g => g.id === gameId && g.recomp);
  const entry = game && config.extraGames.find(x => x.id === game.added);
  if (!entry) throw new Error('Select a PC port first.');
  if (!inPortsDir(entry.path)) throw new Error('Harbour only deletes ports it installed itself. Undock this one instead.');
  if (running.has(gameId) || isRunning(entry.executable)) throw new Error('Close the game first.');
  let result;
  try { result = await removeInstalled(entry); }
  catch (e) { throw new Error(/EBUSY|EPERM/.test(e.code || '') ? 'A file in it is in use. Close the game and try again.' : e.message); }
  config.extraGames = config.extraGames.filter(x => x.id !== entry.id); saveConfig(config);
  delete libraryState.hidden[gameId]; saveState();
  recompChecks.delete(gameId); saveRecompChecks();
  await fsp.rm(manifestFile(entry.id), { force: true });
  log(`deleted port ${entry.title} (${entry.path}): ${result.removed} installed files removed, ${result.left} of yours left in place`);
  return { kept: result.left };
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
// Game clips Harbour downloaded: how much space they take, and deleting them all (data\media\<console>\videos).
const clipFolders = () => { try { return fs.readdirSync(path.join(DATA, 'media'), { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('_')).map(e => path.join(DATA, 'media', e.name, 'videos')).filter(d => fs.existsSync(d)); } catch { return []; } };
const folderSize = dir => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? folderSize(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
handle('video:usage', () => clipFolders().reduce((n, d) => n + folderSize(d), 0));
handle('video:clearAll', async () => {
  videos.cancel();
  let freed = 0;
  for (const d of clipFolders()) { freed += folderSize(d); await fsp.rm(d, { recursive: true, force: true }); }
  log(`deleted all game clips (${Math.round(freed / 1048576)} MB)`);
  return freed;
});
handle('video:status', () => videos.status());
handle('video:cancel', () => { videos.cancel(); return true; });
handle('art:start', options => artwork.start(options));
handle('art:status', () => artwork.status());
handle('art:cancel', () => artwork.cancel());
handle('emu:list', () => config.customEmulators.map(e => emuStatus(e.id)));
handle('emu:openFolder', id => { const exe = resolveExe(id); if (exe) shell.openPath(path.dirname(exe)); return !!exe; });
// Start an emulator on its own (no game, not fullscreen), to change its settings.
handle('emu:open', id => {
  const exe = resolveExe(id);
  if (!exe) throw new Error("Can't find that emulator's program.");
  padDefaults(exe);
  spawn(exe, [], { cwd: path.dirname(exe), env: launchEnv(), detached: true, stdio: 'ignore' }).unref();
  return true;
});
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
