// Well-known emulators Harbour can install by itself: where their Windows builds are released, which program starts
// them, and how to start a game in them. Harbour picks the Windows download from each release (unless `asset` says
// which), checks and unpacks it into its Emulators folder, sets it up for its consoles and keeps it updated.
// `args`: {rom} is the game file.
const CATALOG = [
  { id: 'rmg', name: 'RMG', consoles: ['n64'], source: { type: 'github', repo: 'Rosalie241/RMG' },
    exe: 'RMG.exe', args: '--fullscreen --quit-after-emulation {rom}' },
  { id: 'duckstation', name: 'DuckStation', consoles: ['ps1'], source: { type: 'github', repo: 'stenzek/duckstation' },
    exe: 'duckstation-qt-x64-ReleaseLTCG.exe', args: '-batch -fullscreen {rom}' },
  { id: 'pcsx2', name: 'PCSX2', consoles: ['ps2'], source: { type: 'github', repo: 'PCSX2/pcsx2' },
    exe: 'pcsx2-qt.exe', args: '-batch -nogui -fullscreen {rom}' },
  { id: 'rpcs3', name: 'RPCS3', consoles: ['ps3'], source: { type: 'github', repo: 'RPCS3/rpcs3-binaries-win' },
    exe: 'rpcs3.exe', args: '--no-gui {rom}', note: 'Needs the PS3 firmware, installed once from its File menu.' },
  { id: 'ppsspp', name: 'PPSSPP', consoles: ['psp'], source: { type: 'github', repo: 'hrydgard/ppsspp' },
    exe: 'PPSSPPWindows64.exe', args: '--fullscreen {rom}' },
  { id: 'xemu', name: 'xemu', consoles: ['xbox'], source: { type: 'github', repo: 'xemu-project/xemu' },
    exe: 'xemu.exe', args: '-full-screen -dvd_path {rom}', note: 'Needs Xbox system files, chosen once in its settings.' },
  { id: 'xenia-canary', name: 'Xenia Canary', consoles: ['x360'], source: { type: 'github', repo: 'xenia-canary/xenia-canary-releases' },
    exe: 'xenia_canary.exe', args: '--fullscreen {rom}' },
  { id: 'melonds', name: 'melonDS', consoles: ['nds'], source: { type: 'github', repo: 'melonDS-emu/melonDS' },
    exe: 'melonDS.exe', args: '-f {rom}' },
  { id: 'azahar', name: 'Azahar', consoles: ['3ds'], source: { type: 'github', repo: 'azahar-emu/azahar', asset: 'windows-msvc-[\\d.]+\\.zip$' },
    exe: 'azahar.exe', args: '{rom}' },
  { id: 'mgba', name: 'mGBA', consoles: ['gba', 'gbc', 'gb'], source: { type: 'github', repo: 'mgba-emu/mgba', asset: 'win64\\.7z$' },
    exe: 'mGBA.exe', args: '-f {rom}' },
  { id: 'cemu', name: 'Cemu', consoles: ['wiiu'], source: { type: 'github', repo: 'cemu-project/Cemu' },
    exe: 'Cemu.exe', args: '-f -g {rom}', note: 'Needs your Wii U keys, added once in its settings.' },
  { id: 'eden', name: 'Eden', consoles: ['switch'], source: { type: 'forgejo', host: 'git.eden-emu.dev', repo: 'eden-emu/eden' },
    exe: 'eden.exe', args: '-g {rom}', note: 'Needs your Switch keys and firmware, added once in its settings.' },
  { id: 'lichii', name: 'Lichii', consoles: ['switch2'], source: { type: 'github', repo: 'zortos293/Lichii' },
    exe: 'lichii.exe', args: '-g {rom}', note: 'Needs your Switch 2 keys and firmware, added once in its settings.' },
  { id: 'flycast', name: 'Flycast', consoles: ['dreamcast'], source: { type: 'github', repo: 'flyinghead/flycast' },
    exe: 'flycast.exe', args: '{rom}' },
  { id: 'snes9x', name: 'Snes9x', consoles: ['snes'], source: { type: 'github', repo: 'snes9xgit/snes9x', asset: 'win32-x64\\.zip$' },
    exe: 'snes9x-x64.exe', args: '-fullscreen {rom}' },
  { id: 'mesen', name: 'Mesen', consoles: ['nes'], source: { type: 'github', repo: 'SourMesen/Mesen2' },
    exe: 'Mesen.exe', args: '--fullscreen {rom}', note: 'Needs the .NET 8 Desktop Runtime from Microsoft.' },
];

module.exports = { CATALOG };
