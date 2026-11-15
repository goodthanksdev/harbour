# Harbour

![Harbour](ui/assets/brand/harbour-banner.png)

Every game, one harbour. A lightweight, controller-friendly launcher for **PC recomps and ports and emulators**,
side by side on their real console's shelf, kept up to date for you.

![The shelf](docs/shelf.png)

## What it does

- **One big picture.** The selected game's background art fades into a 45-second HD gameplay clip. Console tabs
  along the top in release order, covers on a shelf along the bottom. After a while the interface fades and the
  clip keeps playing like a screensaver.
- **Recomps and ports where they belong.** A recomp of an N64 game sits on the N64 shelf next to the N64 games you
  play in an emulator. When you have both, only the port is shown.
- **One-click updates for recomps and emulators.** Harbour checks each one's releases (GitHub, or Forgejo sites like
  git.eden-emu.dev), then downloads the right Windows build, checks it against its published checksum, scans it with
  Windows Defender, backs up the files it replaces and keeps your settings. "Update all" does everything at once.
  Programs in protected folders (like Program Files) are updated with their own installer after one admin prompt.
  Update something yourself and Harbour notices.
- **Emulators in a click.** Harbour knows the well-known emulator for each console (RMG, DuckStation, PCSX2, RPCS3,
  PPSSPP, xemu, Xenia Canary, Dolphin, melonDS, Azahar, mGBA, Cemu, Eden, Lichii, Flycast, Snes9x, Mesen). Add a
  games folder, or press Play on a game with no emulator, and Harbour installs the right one from its official
  releases and sets it up. Games open fullscreen, drawn at a resolution that fits your screen (on a 1440p screen:
  PS2, GameCube and Xbox at 3×, PS1 at 6×, DS at 8×) instead of the console's own blurry one; change it in the
  emulator and your choice stays. Emulators with no controller buttons set get a standard pad layout, and a Steam
  Controller works through Steam.

  ![Installing emulators](docs/emulators.png)
- **Game folders.** Point Harbour at your games folder and it finds the console subfolders (N64, PS2, Switch…) by
  their names. New games show up by themselves.
- **Artwork and clips without accounts.** Covers, logos, backgrounds and screenshots come from the LaunchBox games
  database, GameTDB and libretro thumbnails. Clips are cut from no-commentary HD longplays with yt-dlp and FFmpeg,
  which Harbour downloads (and checks) the first time. New games get theirs automatically.
- **Light.** Nothing moves unless you're using it; in the background or while a game runs, Harbour freezes.
- **Controller first, mouse and keyboard too.** Every screen and dialog works with a pad.
- **No AI at runtime.** Everything is plain rules and downloads.

Harbour includes no games, ROMs, keys or game data: you bring your own copies, the same as for any emulator or
recomp.

## Getting started

Harbour runs on Windows 10 and 11.

**Download** the latest `Harbour-<version>-win64.zip` from [Releases](https://github.com/goodthanksdev/harbour/releases),
unzip it anywhere and run `Harbour.exe`. Harbour keeps itself up to date like everything else in it. To start it from
Steam, add `Harbour.exe` as a non-Steam game (`Harbour.ico` is next to it).

**From source** (needs [Node.js](https://nodejs.org/)): `git clone`, then `npm install` and `npm start`.
`npm run release:build` makes the release zip in `dist\`.

Then, in Harbour:

1. **Pick your games folder** (Harbour asks the first time; later: Settings → Emulators & game folders → Manage).
   Emulators for those consoles install by themselves; add ones you already have with ＋ → Emulator.
2. **＋ → PC port / recomp**: pick one from the catalogue (or paste its GitHub page) and choose your game file.
   Harbour downloads it, checks it, installs it into `Ports\` with your game file, and puts it on the right shelf.
   Already installed one? "Already installed…" picks its folder and Harbour works out the rest.
3. Artwork and clips arrive by themselves.

Everything Harbour keeps (settings, artwork, clips, logs) lives in `data\` next to it, so updates never touch it.

## Controls

| Pad | Keyboard | |
|---|---|---|
| A | Enter or Space | Play |
| B | Esc | Back / close |
| X | X | More (favourite, rename, change cover art, clip or video, hide or remove…) |
| Y | U | Update this game |
| LB / RB | Q / E or ↑ / ↓ | Previous / next console |
| LT / RT | Page Up / Page Down | Jump along the shelf |
| Start | F1 | Settings |
| Back | | Updates |
| Back + Start (hold) | | Close the running game |
| | F11 | Fullscreen |

## Making it yours

- **UI sounds:** drop `move`, `tab`, `select`, `open`, `back`, `launch` or `error` (.wav, .ogg or .mp3) into
  `ui\sounds\` (in a release: `resources\app\ui\sounds\`) and it replaces that built-in sound.
- **Logo and icons** are drawn by `scripts/build-harbour-brand.cjs`; `npm run brand:build` rebuilds them.

## Credits

Harbour started from [PyroCade](https://github.com/Pyrodrifter/PyroCade) by Pyrodrifter, and its library engine is
still based on PyroCade's code. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for that and the other tools and
data sources Harbour uses.

## License

[MIT](LICENSE)
