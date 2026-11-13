# Harbour

![Harbour](ui/assets/brand/harbour-banner.png)

Every game, one harbour. A lightweight, controller-friendly launcher for PC recomps, ports and emulators.

- **One big picture:** the selected game's background art fades into a 45-second HD gameplay clip.
  Console tabs along the top (oldest on the left), covers on a shelf along the bottom.
- **Recomps on their real console's shelf**, with update checks: Harbour reads each one's GitHub releases and
  can install updates itself (checksum, Windows Defender scan, backup of replaced files, settings kept).
- **Emulators you already have:** link the program, say which consoles it plays.
- **Artwork** (covers, logos, backgrounds, screenshots) from the LaunchBox games database, GameTDB and libretro
  thumbnails. **Gameplay clips** from no-commentary HD longplays on YouTube, cut with yt-dlp + FFmpeg (downloaded
  into `data/tools` the first time, checked against GitHub's checksums). No accounts needed.
- **Light:** nothing animates unless you're using it; in the background or while a game runs, Harbour freezes.
- **Screensaver:** after a while the interface fades and the selected game's clip keeps playing.

No AI at runtime: everything is plain rules and downloads.

## Run
`npm install`, then `node_modules\electron\dist\electron.exe "<this folder>"` (or `npm start`).
Settings, artwork, clips and logs live in `data\` (not in git). Your own UI sounds: drop `move`, `tab`, `select`,
`open`, `back`, `launch` or `error` (.wav/.ogg/.mp3) into `ui\sounds\`. Logo and icons: `npm run brand:build`.
