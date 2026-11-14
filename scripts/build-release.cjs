// Builds a ready-to-run Windows release: dist\Harbour-<version>-win64.zip, holding Harbour.exe (the Electron runtime)
// with Harbour's own files in resources\app. No Node.js needed to run it. Usage: npm run release:build
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const electronDir = path.join(root, 'node_modules', 'electron', 'dist');
const electronVersion = require(path.join(root, 'node_modules', 'electron', 'package.json')).version;
const name = `Harbour-${pkg.version}-win64`;
const dist = path.join(root, 'dist');
const out = path.join(dist, name);
const zip = path.join(dist, `${name}.zip`);

// Harbour's own files: everything the app loads, plus its licence and notices. Not data\, node_modules or dev files.
const APP_FILES = ['main.js', 'preload.js', 'artwork.js', 'launchbox.js', 'videos.js', 'package.json', 'ui',
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md'];

if (!fs.existsSync(path.join(electronDir, 'electron.exe'))) throw new Error('Run npm install first (no Electron in node_modules).');
fs.rmSync(out, { recursive: true, force: true });
fs.rmSync(zip, { force: true });
fs.mkdirSync(out, { recursive: true });

// The runtime, with electron.exe renamed and Electron's demo app left out.
fs.cpSync(electronDir, out, { recursive: true });
fs.renameSync(path.join(out, 'electron.exe'), path.join(out, 'Harbour.exe'));
fs.rmSync(path.join(out, 'resources', 'default_app.asar'), { force: true });
fs.writeFileSync(path.join(out, 'electron-version.txt'), electronVersion + '\n');  // updates check this

// Harbour itself.
const app = path.join(out, 'resources', 'app');
for (const f of APP_FILES) fs.cpSync(path.join(root, f), path.join(app, f), { recursive: true });
const slim = { ...pkg };
delete slim.devDependencies;
delete slim.scripts;
fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify(slim, null, 2) + '\n');
fs.copyFileSync(path.join(root, 'ui', 'assets', 'brand', 'harbour.ico'), path.join(out, 'Harbour.ico'));

// Zip it with the bsdtar built into Windows, and write its checksum.
execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', zip, '-C', dist, name], { stdio: 'inherit' });
const hash = createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
fs.writeFileSync(zip + '.sha256', `${hash}  ${path.basename(zip)}\n`);
console.log(`${path.relative(root, zip)}  ${(fs.statSync(zip).size / 1048576).toFixed(0)} MB  sha256 ${hash}`);
