// Harbour identity: a lighthouse throwing two beams over a wave. Builds SVG/PNG/ICO exports.
// Run: node_modules\electron\dist\electron.exe scripts\build-harbour-brand.cjs
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..'),brand=path.join(root,'ui/assets/brand');fs.mkdirSync(brand,{recursive:true});
app.setPath('sessionData',path.join(os.tmpdir(),'Harbour-brand-'+process.pid));

const C={navy1:'#16314d',navy2:'#0b1a2c',navy3:'#060d18',beam1:'#ffe3a1',beam2:'#ffb547',tower1:'#f4f7fb',tower2:'#c9d6e6',band:'#e2574c',sea1:'#5fd6cc',sea2:'#2a9d9a'};
// 128x128 mark
// Beams: curved, flaring edges, tilted a little (left up, right down) like a light that's turning.
const BEAM_L='M53 29C40 22 22 15 2 9C2 22 3 35 4 47C22 41 39 37 53 35Z', BEAM_R='M75 29C89 25 106 24 126 25C126 38 125 50 124 62C106 52 89 41 75 35Z';
// Tower: tall and thick, its base runs down into the sea so the waves wash over it.
const TOWER='M41 122L49.5 47H78.5L87 122Z', GALLERY=['46','41','36','7'], LAMP=['52','23','24','18'], ROOF='M48 24L64 9L80 24Z';
const WAVE_BACK='M0 101C11 94 21 94 32 101S53 108 64 101S85 94 96 101S117 108 128 100V128H0Z';
const WAVE_FRONT='M0 110C12 103 24 103 36 110S60 117 72 110S96 103 108 110S122 114 128 108V128H0Z';
const beams=`<path d="${BEAM_L}" fill="url(#BEAM)" opacity=".9"/><path d="${BEAM_R}" fill="url(#BEAM)" opacity=".9"/>`;
const tower=`<path d="${TOWER}" fill="url(#TOWER)"/>`+
  `<path d="M48.7 57H79.3L80.7 69H47.3Z" fill="${C.band}"/><path d="M46 81H82L83.4 93H44.6Z" fill="${C.band}"/>`+
  `<rect x="${GALLERY[0]}" y="${GALLERY[1]}" width="${GALLERY[2]}" height="${GALLERY[3]}" rx="2" fill="${C.tower2}"/>`+
  `<rect x="${LAMP[0]}" y="${LAMP[1]}" width="${LAMP[2]}" height="${LAMP[3]}" rx="3" fill="url(#LAMP)"/>`+
  `<path d="${ROOF}" fill="${C.band}"/><circle cx="64" cy="8.5" r="2.6" fill="${C.band}"/>`;
const sea=`<path d="${WAVE_BACK}" fill="${C.sea2}"/><path d="${WAVE_FRONT}" fill="url(#SEA)"/>`;
const defs=id=>`<defs><linearGradient id="${id}BEAM" x1="0" y1="0" x2="1" y2="0"><stop stop-color="${C.beam1}" stop-opacity=".05"/><stop offset=".5" stop-color="${C.beam2}" stop-opacity=".55"/><stop offset="1" stop-color="${C.beam1}" stop-opacity=".05"/></linearGradient>`+
  `<linearGradient id="${id}TOWER" x2="1"><stop stop-color="${C.tower1}"/><stop offset="1" stop-color="${C.tower2}"/></linearGradient>`+
  `<linearGradient id="${id}LAMP" y2="1"><stop stop-color="${C.beam1}"/><stop offset="1" stop-color="${C.beam2}"/></linearGradient>`+
  `<linearGradient id="${id}SEA" y2="1"><stop stop-color="${C.sea1}"/><stop offset="1" stop-color="${C.sea2}"/></linearGradient></defs>`;
const mark=(id='m')=>(defs(id)+beams+tower+sea).replace(/url\(#(BEAM|TOWER|LAMP|SEA)\)/g,`url(#${id}$1)`);
const svg=(viewBox,content,extra='role="img"')=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" ${extra}>${content}</svg>`;
const markSvg=svg('0 0 128 128',mark());
const monoSvg=svg('0 0 128 128',`<g fill="currentColor"><path d="${BEAM_L}" opacity=".5"/><path d="${BEAM_R}" opacity=".5"/><path d="${TOWER}"/><rect x="${GALLERY[0]}" y="${GALLERY[1]}" width="${GALLERY[2]}" height="${GALLERY[3]}" rx="2"/><rect x="${LAMP[0]}" y="${LAMP[1]}" width="${LAMP[2]}" height="${LAMP[3]}" rx="3"/><path d="${ROOF}"/><path d="${WAVE_BACK}" opacity=".7"/><path d="${WAVE_FRONT}"/></g>`);
const iconSvg=svg('0 0 256 256',`<defs><linearGradient id="tile" x2=".7" y2="1"><stop stop-color="${C.navy1}"/><stop offset=".55" stop-color="${C.navy2}"/><stop offset="1" stop-color="${C.navy3}"/></linearGradient><radialGradient id="glow" cx=".5" cy=".28" r=".55"><stop stop-color="${C.beam2}" stop-opacity=".28"/><stop offset="1" stop-color="${C.beam2}" stop-opacity="0"/></radialGradient><linearGradient id="rim" x2=".65" y2="1"><stop stop-color="#ffffff50"/><stop offset=".5" stop-color="#ffffff08"/><stop offset="1" stop-color="#ffffff18"/></linearGradient></defs>`+
  `<rect x="2" y="2" width="252" height="252" rx="58" fill="url(#tile)" stroke="url(#rim)" stroke-width="2"/><rect x="4" y="4" width="248" height="248" rx="56" fill="url(#glow)"/>`+
  // The mark fills the tile and is clipped to its rounded corners, so beams and sea run off the edges.
  `<clipPath id="tileClip"><rect x="2" y="2" width="252" height="252" rx="58"/></clipPath>`+
  `<g clip-path="url(#tileClip)"><g transform="translate(4 14) scale(1.94)">${mark('i')}</g></g>`);
const word=(x,y,size)=>`<text x="${x}" y="${y}" font-family="Segoe UI,Arial,sans-serif" font-size="${size}" font-weight="700" letter-spacing="${size*.24}" fill="#ffffff">HARBOUR</text>`+
  `<g transform="translate(${x} ${y}) skewX(-10) scale(1 -.8) translate(${-x} ${-y+size*.06})" opacity=".55"><text x="${x}" y="${y}" font-family="Segoe UI,Arial,sans-serif" font-size="${size}" font-weight="700" letter-spacing="${size*.24}" fill="${C.sea1}">HARBOUR</text></g>`;
const wordmarkSvg=svg('0 0 860 160',`<g transform="translate(0 6) scale(1.15)">${mark('w')}</g>${word(170,108,72)}`);
const bannerSvg=svg('0 0 1280 420',`<defs><linearGradient id="back" x2="1" y2="1"><stop stop-color="${C.navy1}"/><stop offset="1" stop-color="${C.navy3}"/></linearGradient></defs><rect width="1280" height="420" rx="24" fill="url(#back)"/>`+
  `<g transform="translate(103 80)">${iconSvg.replace(/^<svg[^>]*>/,'<svg width="256" height="256" viewBox="0 0 256 256">')}</g>${word(428,180,64)}`+
  `<text x="430" y="270" fill="#a9c1d6" font-family="Segoe UI,Arial,sans-serif" font-size="23">Every game, one harbour.</text>`+
  `<text x="432" y="314" fill="#6f8aa3" font-family="Segoe UI,Arial,sans-serif" font-size="11" letter-spacing="2.1">RECOMPS  ·  PORTS  ·  EMULATORS</text>`);
const files={'harbour-mark.svg':markSvg,'harbour-mark-mono.svg':monoSvg,'harbour-icon.svg':iconSvg,'harbour-wordmark.svg':wordmarkSvg,'harbour-banner.svg':bannerSvg};
for(const [name,data]of Object.entries(files))fs.writeFileSync(path.join(brand,name),data+'\n');

app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true,offscreen:true}});
  try{
    await win.loadURL('data:text/html,<html><body></body></html>');
    const exported=await win.webContents.executeJavaScript(`(async()=>{
      const results=[];async function render(svg,w,h,name){const img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await img.decode();const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.drawImage(img,0,0,w,h);results.push({name,data:c.toDataURL('image/png').split(',')[1]})}
      for(const size of [16,24,32,48,64,128,256,512,1024])await render(${JSON.stringify(iconSvg)},size,size,'harbour-icon-'+size+'.png');
      await render(${JSON.stringify(markSvg)},512,512,'harbour-mark.png');await render(${JSON.stringify(wordmarkSvg)},1720,320,'harbour-wordmark.png');await render(${JSON.stringify(bannerSvg)},1280,420,'harbour-banner.png');return results;
    })()`);
    for(const e of exported)fs.writeFileSync(path.join(brand,e.name),Buffer.from(e.data,'base64'));
    const sizes=[16,24,32,48,64,128,256],images=sizes.map(size=>fs.readFileSync(path.join(brand,'harbour-icon-'+size+'.png'))),header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
    images.forEach((image,i)=>{const size=sizes[i],start=6+16*i;header[start]=size===256?0:size;header[start+1]=size===256?0:size;header.writeUInt16LE(1,start+4);header.writeUInt16LE(32,start+6);header.writeUInt32LE(image.length,start+8);header.writeUInt32LE(offset,start+12);offset+=image.length});
    fs.writeFileSync(path.join(brand,'harbour.ico'),Buffer.concat([header,...images]));
    console.log('Harbour brand: 5 SVGs, 12 PNGs, header mark, 7-size ICO.');app.exit(0);
  }catch(e){console.error(e);app.exit(1)}
});
