#!/usr/bin/env node
// One-time script to export procedural textures as editable PNG files.
// Run: node scripts/export-textures.mjs
// Output: public/textures/*.png (16x16 RGBA PNGs)

import { writeFileSync, mkdirSync } from 'fs';
import { deflateSync } from 'zlib';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'textures');
mkdirSync(OUT_DIR, { recursive: true });

const TEX = 16;

// ── Minimal PNG encoder ──

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(px) {
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(px.w, 0); ihdr.writeUInt32BE(px.h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(px.h * (1 + px.w * 4));
  for (let y = 0; y < px.h; y++) {
    raw[y * (1 + px.w * 4)] = 0; // no filter
    for (let x = 0; x < px.w; x++) {
      const si = (y * px.w + x) * 4;
      const di = y * (1 + px.w * 4) + 1 + x * 4;
      raw[di] = px.d[si]; raw[di+1] = px.d[si+1]; raw[di+2] = px.d[si+2]; raw[di+3] = px.d[si+3];
    }
  }
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

// ── Pixel buffer (mimics Canvas 2D for texture generation) ──

class Px {
  constructor(w = TEX, h = TEX) { this.w = w; this.h = h; this.d = new Uint8Array(w * h * 4); }

  fill(r, g, b, a = 255) {
    for (let i = 0; i < this.d.length; i += 4) { this.d[i]=r; this.d[i+1]=g; this.d[i+2]=b; this.d[i+3]=a; }
  }

  rect(x, y, w, h, r, g, b, a = 255) {
    for (let py = Math.max(0, y); py < Math.min(this.h, y + h); py++) {
      for (let px = Math.max(0, x); px < Math.min(this.w, x + w); px++) {
        const i = (py * this.w + px) * 4;
        if (a < 255) {
          const sa = a / 255;
          this.d[i]   = Math.round(this.d[i]   * (1 - sa) + r * sa);
          this.d[i+1] = Math.round(this.d[i+1] * (1 - sa) + g * sa);
          this.d[i+2] = Math.round(this.d[i+2] * (1 - sa) + b * sa);
          this.d[i+3] = Math.min(255, this.d[i+3] + a);
        } else {
          this.d[i]=r; this.d[i+1]=g; this.d[i+2]=b; this.d[i+3]=a;
        }
      }
    }
  }

  noise(intensity, seed = 42) {
    const rng = srand(seed);
    for (let i = 0; i < this.d.length; i += 4) {
      const n = (rng() - 0.5) * intensity;
      this.d[i]   = clamp(this.d[i]   + n);
      this.d[i+1] = clamp(this.d[i+1] + n);
      this.d[i+2] = clamp(this.d[i+2] + n);
    }
  }
}

function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }

function srand(seed) {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

function hex(h) {
  h = h.replace('#', '');
  return [parseInt(h.substring(0,2),16), parseInt(h.substring(2,4),16), parseInt(h.substring(4,6),16)];
}

// ── Texture generators (ported from blocks.js) ──

function grassTop() {
  const p = new Px();
  const [r,g,b] = hex('5a9b2f');
  p.rect(0,0,16,16, r,g,b);
  p.noise(30, 101);
  const rng = srand(201);
  for (let i = 0; i < 20; i++) {
    const x = Math.floor(rng()*16), y = Math.floor(rng()*16);
    const a = Math.round((0.2 + rng()*0.3) * 255);
    p.rect(x,y,1,1, 40,80,20, a);
  }
  return p;
}

function grassSide() {
  const p = new Px();
  const [dr,dg,db] = hex('8b6b3d');
  p.rect(0,0,16,16, dr,dg,db);
  p.noise(25, 102);
  const [gr,gg,gb] = hex('5a9b2f');
  p.rect(0,0,16,3, gr,gg,gb);
  p.noise(20, 103);
  const rng = srand(301);
  for (let x = 0; x < 16; x++) {
    if (rng() > 0.5) {
      const h = Math.floor(rng()*3) + 3;
      const a = Math.round((0.4 + rng()*0.3) * 255);
      p.rect(x,3,1, h > 2 ? 1 : 0, 80,140,40, a);
    }
  }
  return p;
}

function dirt() {
  const p = new Px();
  const [r,g,b] = hex('8b6b3d');
  p.rect(0,0,16,16, r,g,b);
  p.noise(30, 104);
  const rng = srand(401);
  for (let i = 0; i < 8; i++) {
    const a = Math.round((0.3 + rng()*0.3) * 255);
    p.rect(Math.floor(rng()*14), Math.floor(rng()*14), 2,2, 100,75,45, a);
  }
  return p;
}

function stone() {
  const p = new Px();
  p.rect(0,0,16,16, 0x88,0x88,0x88);
  p.noise(35, 105);
  const rng = srand(501);
  for (let i = 0; i < 5; i++) {
    const a = Math.round((0.3 + rng()*0.3) * 255);
    const x = Math.floor(rng()*14), y = Math.floor(rng()*14);
    p.rect(x,y, Math.floor(rng()*4)+1, 1, 60,60,60, a);
  }
  return p;
}

function sand() {
  const p = new Px();
  const [r,g,b] = hex('dbc67b');
  p.rect(0,0,16,16, r,g,b);
  p.noise(20, 106);
  const rng = srand(601);
  for (let i = 0; i < 10; i++) {
    const a = Math.round((0.2 + rng()*0.2) * 255);
    p.rect(Math.floor(rng()*16), Math.floor(rng()*16), 1,1, 200,180,100, a);
  }
  return p;
}

function water() {
  const p = new Px();
  const [r,g,b] = hex('1a5c8a');
  p.rect(0,0,16,16, r,g,b);
  const rng = srand(701);
  for (let y = 0; y < 16; y++) {
    const wave = Math.sin(y * 0.8) * 0.15;
    const a = Math.round((0.15 + wave) * 255);
    p.rect(0,y,16,1, 40,150,220, Math.max(0, a));
  }
  for (let i = 0; i < 20; i++) {
    const x = Math.floor(rng()*14)+1, y = Math.floor(rng()*14)+1;
    const sz = rng() > 0.5 ? 2 : 1;
    const a = Math.round((0.15 + rng()*0.15) * 255);
    p.rect(x,y,sz,sz, 80,190,255, a);
  }
  for (let i = 0; i < 10; i++) {
    const a = Math.round((0.1 + rng()*0.15) * 255);
    p.rect(Math.floor(rng()*14), Math.floor(rng()*14), 2,2, 10,40,80, a);
  }
  return p;
}

function oakLogSide() {
  const p = new Px();
  const [r,g,b] = hex('6b5030');
  p.rect(0,0,16,16, r,g,b);
  p.noise(20, 107);
  for (let y = 0; y < 16; y += 3) {
    p.rect(0,y,16,1, 80,55,30, Math.round(0.4*255));
  }
  return p;
}

function oakLogTop() {
  const p = new Px();
  const [r1,g1,b1] = hex('6b5030');
  p.rect(0,0,16,16, r1,g1,b1);
  const [r2,g2,b2] = hex('a08050');
  p.rect(3,3,10,10, r2,g2,b2);
  const [r3,g3,b3] = hex('8b6b3d');
  p.rect(5,5,6,6, r3,g3,b3);
  p.rect(7,7,2,2, r1,g1,b1);
  p.noise(15, 108);
  return p;
}

function oakLeaves() {
  const p = new Px();
  const [r,g,b] = hex('3a7a1a');
  p.rect(0,0,16,16, r,g,b);
  p.noise(40, 109);
  const rng = srand(801);
  for (let i = 0; i < 30; i++) {
    const light = rng() > 0.5;
    const a = Math.round((0.3 + rng()*0.4) * 255);
    p.rect(Math.floor(rng()*16), Math.floor(rng()*16), 1,1,
      light ? 50 : 30, light ? 110 : 70, light ? 25 : 15, a);
  }
  return p;
}

function bedrock() {
  const p = new Px();
  p.rect(0,0,16,16, 0x33,0x33,0x33);
  p.noise(40, 110);
  const rng = srand(901);
  for (let i = 0; i < 12; i++) {
    const a = Math.round((0.3 + rng()*0.4) * 255);
    p.rect(Math.floor(rng()*14), Math.floor(rng()*14), Math.floor(rng()*3)+1, Math.floor(rng()*3)+1, 20,20,20, a);
  }
  return p;
}

function gravel() {
  const p = new Px();
  p.rect(0,0,16,16, 0x77,0x77,0x77);
  p.noise(30, 111);
  const rng = srand(1001);
  for (let i = 0; i < 15; i++) {
    const gray = Math.floor(60 + rng()*80);
    p.rect(Math.floor(rng()*14), Math.floor(rng()*14), 2,2, gray,gray,gray, Math.round(0.5*255));
  }
  return p;
}

function ore(oreColor, seed) {
  const p = new Px();
  p.rect(0,0,16,16, 0x88,0x88,0x88);
  p.noise(30, seed);
  const rng = srand(seed + 100);
  const [or,og,ob] = hex(oreColor);
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(rng()*12)+2, y = Math.floor(rng()*12)+2;
    p.rect(x,y,2,2, or,og,ob);
    if (rng() > 0.4) p.rect(x+1,y+1,2,1, or,og,ob);
  }
  return p;
}

function cobblestone() {
  const p = new Px();
  p.rect(0,0,16,16, 0x55,0x55,0x55);
  const rng = srand(1401);
  const stones = [
    {x:0,y:0,w:5,h:4},{x:6,y:0,w:4,h:3},{x:11,y:0,w:5,h:4},
    {x:0,y:5,w:4,h:3},{x:5,y:4,w:6,h:4},{x:12,y:5,w:4,h:3},
    {x:0,y:9,w:5,h:4},{x:6,y:9,w:5,h:3},{x:12,y:9,w:4,h:4},
    {x:0,y:14,w:4,h:2},{x:5,y:13,w:6,h:3},{x:12,y:14,w:4,h:2},
  ];
  for (const s of stones) {
    const gray = Math.floor(105 + rng()*45);
    p.rect(s.x,s.y,s.w,s.h, gray,gray,gray);
    const ha = Math.round((0.1+rng()*0.1)*255);
    p.rect(s.x,s.y,s.w,1, 200,200,200, ha);
    p.rect(s.x,s.y,1,s.h, 200,200,200, ha);
    const sa = Math.round((0.15+rng()*0.1)*255);
    p.rect(s.x,s.y+s.h-1,s.w,1, 30,30,30, sa);
    p.rect(s.x+s.w-1,s.y,1,s.h, 30,30,30, sa);
  }
  p.noise(12, 114);
  return p;
}

function planks() {
  const p = new Px();
  const [r,g,b] = hex('b08840');
  p.rect(0,0,16,16, r,g,b);
  const la = Math.round(0.3*255);
  p.rect(0,3,16,1, 80,55,20, la);
  p.rect(0,7,16,1, 80,55,20, la);
  p.rect(0,11,16,1, 80,55,20, la);
  p.rect(0,15,16,1, 80,55,20, la);
  p.rect(8,0,1,4, 80,55,20, la);
  p.rect(4,4,1,4, 80,55,20, la);
  p.rect(12,8,1,4, 80,55,20, la);
  p.rect(6,12,1,4, 80,55,20, la);
  p.noise(20, 115);
  return p;
}

function snow() {
  const p = new Px();
  p.rect(0,0,16,16, 0xf0,0xf0,0xf0);
  p.noise(15, 116);
  return p;
}

function glass() {
  const p = new Px();
  const [r,g,b] = hex('c8ddf0');
  p.rect(0,0,16,16, r,g,b);
  const [fr,fg,fb] = hex('8fa8b8');
  p.rect(0,0,16,1, fr,fg,fb);
  p.rect(0,15,16,1, fr,fg,fb);
  p.rect(0,0,1,16, fr,fg,fb);
  p.rect(15,0,1,16, fr,fg,fb);
  const [sr,sg,sb] = hex('ddeeff');
  p.rect(2,2,3,3, sr,sg,sb);
  p.rect(3,3,1,1, sr,sg,sb);
  return p;
}

function brick() {
  const p = new Px();
  const [r,g,b] = hex('9b5550');
  p.rect(0,0,16,16, r,g,b);
  const [mr,mg,mb] = hex('b0a090');
  for (let y = 0; y < 16; y += 4) p.rect(0,y+3,16,1, mr,mg,mb);
  for (let row = 0; row < 4; row++) {
    const y = row * 4;
    const offset = (row % 2) * 8;
    p.rect(offset,y,1,4, mr,mg,mb);
    p.rect(offset+8,y,1,4, mr,mg,mb);
  }
  p.noise(20, 117);
  return p;
}

// ── Export all textures ──

const textures = {
  grass_top:    grassTop(),
  grass_side:   grassSide(),
  dirt:         dirt(),
  stone:        stone(),
  sand:         sand(),
  water:        water(),
  oak_log_side: oakLogSide(),
  oak_log_top:  oakLogTop(),
  oak_leaves:   oakLeaves(),
  bedrock:      bedrock(),
  gravel:       gravel(),
  coal_ore:     ore('222222', 112),
  iron_ore:     ore('c8a060', 113),
  cobblestone:  cobblestone(),
  oak_planks:   planks(),
  snow:         snow(),
  glass:        glass(),
  brick:        brick(),
};

for (const [name, px] of Object.entries(textures)) {
  const path = join(OUT_DIR, `${name}.png`);
  writeFileSync(path, encodePNG(px));
  console.log(`  ${name}.png`);
}

console.log(`\nExported ${Object.keys(textures).length} textures to public/textures/`);
