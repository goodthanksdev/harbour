# Harbour

![Harbour](ui/assets/brand/harbour-banner.png)

Every game, one harbour. A controller-friendly launcher for PC recomps, ports and emulators, with 3D game cases,
box art from the LaunchBox database, and update checks for every recomp.

Harbour is a modified version of [PyroCade](https://github.com/Pyrodrifter/PyroCade) by Pyrodrifter (MIT licence, see `LICENSE`).

## What Harbour adds
- **Recomps on their real console's shelf.** Banjo-Kazooie sits with the N64 games, Gears of War with Xbox 360, and so on.
  Right-click a recomp → **Platform & updates…** to change it.
- **Recomp updates.** Each recomp can have a GitHub repository. Harbour checks it (results kept for 3 hours), shows the
  installed and newest version, and an **Update** button.
  - **Install updates for me** on: downloads the release, checks it against GitHub's checksum, scans it with Windows
    Defender, backs up the files it replaces to `<game folder>\_harbour-backup\<old version>\`, and never overwrites
    settings or saves (`.ini .toml .cfg .conf .yaml .sav`).
  - Off: the button opens the release page instead (for games with their own installer or launcher).
- If the GitHub CLI (`gh`) is logged in, its login is used for update checks (5,000 an hour instead of 60).

## Removed from PyroCade
Feedback reports, Leia SR 3D display support, the Android build, Mac/Linux packages, demo/readme tooling and the
self-updater (Harbour never replaces itself; new PyroCade versions are merged in by hand).

## Run
`node_modules\electron\dist\electron.exe .` from this folder (or `npm start`). Settings and library data live in `data\`.
Logo and icons: `npm run brand:build` (source in `scripts/build-harbour-brand.cjs`).
