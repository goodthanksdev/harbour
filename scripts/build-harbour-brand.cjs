// Harbour identity: a lighthouse throwing two beams over a wave. Builds SVG/PNG/ICO exports.
// Run: node_modules\electron\dist\electron.exe scripts\build-harbour-brand.cjs
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..'),brand=path.join(root,'ui/assets/brand');fs.mkdirSync(brand,{recursive:true});
app.setPath('sessionData',path.join(os.tmpdir(),'Harbour-brand-'+process.pid));

const C={navy1:'#16314d',navy2:'#0b1a2c',navy3:'#060d18',beam1:'#ffe3a1',beam2:'#ffb547',tower1:'#f4f7fb',tower2:'#c9d6e6',band:'#e2574c',sea1:'#5fd6cc',sea2:'#2a9d9a'};
// 128x128 mark
const beams=`<path d="M58 33L8 16V52Z" fill="url(#BEAM)" opacity=".85"/><path d="M70 33L120 16V52Z" fill="url(#BEAM)" opacity=".85"/>`;
const tower=`<path d="M53 106L57.5 50H70.5L75 106Z" fill="url(#TOWER)"/>`+
  `<path d="M55.4 76H72.6L73.3 85H54.7Z" fill="${C.band}"/><path d="M56.6 61H71.4L72 68H56Z" fill="${C.band}"/>`+
  `<rect x="54" y="45" width="20" height="6" rx="2" fill="${C.tower2}"/>`+
  `<rect x="58" y="29" width="12" height="16" rx="2.5" fill="url(#LAMP)"/>`+
  `<path d="M55 30L64 19L73 30Z" fill="${C.band}"/><circle cx="64" cy="18" r="2.2" fill="${C.band}"/>`;
const sea=`<path d="M10 108C20 101 30 101 40 108S60 115 70 108S90 101 100 108S114 113 118 110V118H10Z" fill="url(#SEA)"/>`;
const defs=id=>`<defs><linearGradient id="${id}BEAM" x1="0" y1="0" x2="1" y2="0"><stop stop-color="${C.beam1}" stop-opacity=".05"/><stop offset=".5" stop-color="${C.beam2}" stop-opacity=".55"/><stop offset="1" stop-color="${C.beam1}" stop-opacity=".05"/></linearGradient>`+
  `<linearGradient id="${id}TOWER" x2="1"><stop stop-color="${C.tower1}"/><stop offset="1" stop-color="${C.tower2}"/></linearGradient>`+
  `<linearGradient id="${id}LAMP" y2="1"><stop stop-color="${C.beam1}"/><stop offset="1" stop-color="${C.beam2}"/></linearGradient>`+
  `<linearGradient id="${id}SEA" y2="1"><stop stop-color="${C.sea1}"/><stop offset="1" stop-color="${C.sea2}"/></linearGradient></defs>`;
const mark=(id='m')=>(defs(id)+beams+tower+sea).replace(/url\(#(BEAM|TOWER|LAMP|SEA)\)/g,`url(#${id}$1)`);
const svg=(viewBox,content,extra='role="img"')=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" ${extra}>${content}</svg>`;
const markSvg=svg('0 0 128 128',mark());
const monoSvg=svg('0 0 128 128',`<g fill="currentColor"><path d="M58 33L8 16V52Z" opacity=".5"/><path d="M70 33L120 16V52Z" opacity=".5"/><path d="M53 106L57.5 50H70.5L75 106Z"/><rect x="54" y="45" width="20" height="6" rx="2"/><rect x="58" y="29" width="12" height="16" rx="2.5"/><path d="M55 30L64 19L73 30Z"/><path d="M10 108C20 101 30 101 40 108S60 115 70 108S90 101 100 108S114 113 118 110V118H10Z"/></g>`);
const iconSvg=svg('0 0 256 256',`<defs><linearGradient id="tile" x2=".7" y2="1"><stop stop-color="${C.navy1}"/><stop offset=".55" stop-color="${C.navy2}"/><stop offset="1" stop-color="${C.navy3}"/></linearGradient><radialGradient id="glow" cx=".5" cy=".28" r=".55"><stop stop-color="${C.beam2}" stop-opacity=".28"/><stop offset="1" stop-color="${C.beam2}" stop-opacity="0"/></radialGradient><linearGradient id="rim" x2=".65" y2="1"><stop stop-color="#ffffff50"/><stop offset=".5" stop-color="#ffffff08"/><stop offset="1" stop-color="#ffffff18"/></linearGradient></defs>`+
  `<rect x="2" y="2" width="252" height="252" rx="58" fill="url(#tile)" stroke="url(#rim)" stroke-width="2"/><rect x="4" y="4" width="248" height="248" rx="56" fill="url(#glow)"/>`+
  `<g transform="translate(18 14) scale(1.72)">${mark('i')}</g>`);
const word=(x,y,size)=>`<text x="${x}" y="${y}" font-family="Segoe UI,Arial,sans-serif" font-size="${size}" font-weight="300" letter-spacing="${size*.12}" fill="#f2f6fb">HAR<tspan font-weight="800" fill="${C.sea1}">BOUR</tspan></text>`;
const wordmarkSvg=svg('0 0 860 160',`<g transform="translate(0 6) scale(1.15)">${mark('w')}</g>${word(170,108,72)}`);
const bannerSvg=svg('0 0 1280 420',`<defs><linearGradient id="back" x2="1" y2="1"><stop stop-color="${C.navy1}"/><stop offset="1" stop-color="${C.navy3}"/></linearGradient></defs><rect width="1280" height="420" rx="24" fill="url(#back)"/>`+
  `<g transform="translate(103 80)">${iconSvg.replace(/^<svg[^>]*>/,'<svg width="256" height="256" viewBox="0 0 256 256">')}</g>${word(428,205,64)}`+
  `<text x="430" y="252" fill="#a9c1d6" font-family="Segoe UI,Arial,sans-serif" font-size="23">Every game, one harbour.</text>`+
  `<text x="432" y="300" fill="#6f8aa3" font-family="Segoe UI,Arial,sans-serif" font-size="11" letter-spacing="2.1">RECOMPS  ·  PORTS  ·  EMULATORS</text>`);
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
