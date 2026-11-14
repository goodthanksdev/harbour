# Third-party notices

## PyroCade

Harbour started from [PyroCade](https://github.com/Pyrodrifter/PyroCade) by Pyrodrifter. Its interface and most
features have been rebuilt since, and `launchbox.js` and `artwork.js` were rewritten from scratch, but the library
engine in `main.js` (configuration, library scanning and cache, launching games, the window) is based on PyroCade's
code, used under the MIT License:

```
MIT License

Copyright (c) 2026 Pyrodrifter

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Used at runtime (not included in this repository)

- [Electron](https://www.electronjs.org/) (MIT), installed by `npm install`.
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense) and [FFmpeg](https://ffmpeg.org/) (GPL build from
  [yt-dlp/FFmpeg-Builds](https://github.com/yt-dlp/FFmpeg-Builds)), downloaded into `data/tools` the first time game
  clips are made.
- Emulators you install from Harbour (RMG, PCSX2, Dolphin, melonDS and the rest in `emulators.js`) are downloaded
  from each project's own official releases into the `Emulators` folder, under their own licences. Harbour includes
  none of them.

## Data sources

Game details and artwork come from the [LaunchBox Games Database](https://gamesdb.launchbox-app.com/),
[GameTDB](https://www.gametdb.com/) and [libretro thumbnails](https://thumbnails.libretro.com/), and are downloaded to
your PC when you use Harbour. Harbour includes none of their data. Gameplay clips are cut from public YouTube videos
for your own use on your own PC.
