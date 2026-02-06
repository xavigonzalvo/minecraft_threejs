// Block type definitions and texture generation

export const BlockType = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WATER: 5,
  OAK_LOG: 6,
  OAK_LEAVES: 7,
  BEDROCK: 8,
  GRAVEL: 9,
  COAL_ORE: 10,
  IRON_ORE: 11,
  COBBLESTONE: 12,
  OAK_PLANKS: 13,
  SNOW: 14,
  GLASS: 15,
  BRICK: 16,
};

// Block properties
export const BlockData = {
  [BlockType.AIR]:         { name: 'Air',         solid: false, transparent: true  },
  [BlockType.GRASS]:       { name: 'Grass',       solid: true,  transparent: false },
  [BlockType.DIRT]:        { name: 'Dirt',        solid: true,  transparent: false },
  [BlockType.STONE]:       { name: 'Stone',       solid: true,  transparent: false },
  [BlockType.SAND]:        { name: 'Sand',        solid: true,  transparent: false },
  [BlockType.WATER]:       { name: 'Water',       solid: false, transparent: true  },
  [BlockType.OAK_LOG]:     { name: 'Oak Log',     solid: true,  transparent: false },
  [BlockType.OAK_LEAVES]:  { name: 'Oak Leaves',  solid: true,  transparent: true  },
  [BlockType.BEDROCK]:     { name: 'Bedrock',     solid: true,  transparent: false },
  [BlockType.GRAVEL]:      { name: 'Gravel',      solid: true,  transparent: false },
  [BlockType.COAL_ORE]:    { name: 'Coal Ore',    solid: true,  transparent: false },
  [BlockType.IRON_ORE]:    { name: 'Iron Ore',    solid: true,  transparent: false },
  [BlockType.COBBLESTONE]: { name: 'Cobblestone', solid: true,  transparent: false },
  [BlockType.OAK_PLANKS]:  { name: 'Oak Planks',  solid: true,  transparent: false },
  [BlockType.SNOW]:        { name: 'Snow',        solid: true,  transparent: false },
  [BlockType.GLASS]:       { name: 'Glass',       solid: true,  transparent: true  },
  [BlockType.BRICK]:       { name: 'Brick',       solid: true,  transparent: false },
};

// Hotbar blocks the player can place
export const HOTBAR_BLOCKS = [
  BlockType.GRASS,
  BlockType.DIRT,
  BlockType.STONE,
  BlockType.OAK_LOG,
  BlockType.OAK_PLANKS,
  BlockType.COBBLESTONE,
  BlockType.SAND,
  BlockType.GLASS,
  BlockType.BRICK,
];

const TEX_SIZE = 16;

function createCtx() {
  const c = document.createElement('canvas');
  c.width = TEX_SIZE;
  c.height = TEX_SIZE;
  return c.getContext('2d');
}

// Seeded random for consistent texture noise
function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function addNoise(ctx, color, intensity, seed = 42) {
  const rng = seededRandom(seed);
  const imageData = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * intensity;
    d[i]     = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(imageData, 0, 0);
}

function generateGrassTop() {
  const ctx = createCtx();
  ctx.fillStyle = '#5a9b2f';
  ctx.fillRect(0, 0, 16, 16);
  addNoise(ctx, '#5a9b2f', 30, 101);
  // Add some darker spots
  const rng = seededRandom(201);
  for (let i = 0; i < 20; i++) {
    const x = Math.floor(rng() * 16);
    const y = Math.floor(rng() * 16);
    ctx.fillStyle = `rgba(40,80,20,${0.2 + rng() * 0.3})`;
    ctx.fillRect(x, y, 1, 1);
  }
  return ctx.canvas;
}

function generateGrassSide() {
  const ctx = createCtx();
  // Dirt bottom
  ctx.fillStyle = '#8b6b3d';
  ctx.fillRect(0, 0, 16, 16);
  addNoise(ctx, '#8b6b3d', 25, 102);
  // Grass top strip
  ctx.fillStyle = '#5a9b2f';
  ctx.fillRect(0, 0, 16, 3);
  addNoise(ctx, '#5a9b2f', 20, 103);
  // Hanging grass pixels
  const rng = seededRandom(301);
  for (let x = 0; x < 16; x++) {
    if (rng() > 0.5) {
      const h = Math.floor(rng() * 3) + 3;
      ctx.fillStyle = `rgba(80,140,40,${0.4 + rng() * 0.3})`;
      ctx.fillRect(x, 3, 1, h > 2 ? 1 : 0);
    }
  }
  return ctx.canvas;
}

function generateDirt() {
  const ctx = createCtx();
  ctx.fillStyle = '#8b6b3d';
  ctx.fillRect(0, 0, 16, 16);
  addNoise(ctx, '#8b6b3d', 30, 104);
  const rng = seededRandom(401);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = `rgba(100,75,45,${0.3 + rng() * 0.3})`;
    ctx.fillRect(Math.floor(rng()*14), Math.floor(rng()*14), 2, 2);
  }
  return ctx.canvas;
}

function generateStone() {
  const ctx = createCtx();
  ctx.fillStyle = '#888888';
  ctx.fillRect(0, 0, 16, 16);
  addNoise(ctx, '#888888', 35, 105);
  const rng = seededRandom(501);
  // Cracks
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = `rgba(60,60,60,${0.3 + rng() * 0.3})`;
    const x = Math.floor(rng() * 14);
    const y = Math.floor(rng() * 14);
    ctx.fillRect(x, y, Math.floor(rng() * 4) + 1, 1);
  }
  return ctx.canvas;
}

function generateSand() {
  const ctx = createCtx();
  ctx.fillStyle = '#dbc67b';
  ctx.fillRect(0, 0, 16, 16);
  addNoise(ctx, '#dbc67b', 20, 106);
  const rng = seededRandom(601);
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = `rgba(200,180,100,${0.2 + rng() * 0.2})`;
    ctx.fillRect(Math.floor(rng()*16), Math.floor(rng()*16), 1, 1);
  }
  return ctx.canvas;
}

function generateWater() {
  const ctx = createCtx();
  // Deep blue-green base
  ctx.fillStyle = '#1a5c8a';
  ctx.fillRect(0, 0, 16, 16);
  const rng = seededRandom(701);
  // Layered wave highlights
  for (let y = 0; y < 16; y++) {
    const wave = Math.sin(y * 0.8) * 0.15;
    ctx.fillStyle = `rgba(40,150,220,${0.15 + wave})`;
    ctx.fillRect(0, y, 16, 1);
  }
  // Lighter caustic-like spots
  for (let i = 0; i < 20; i++) {
    const x = Math.floor(rng() * 14) + 1;
    const y = Math.floor(rng() * 14) + 1;
    const size = rng() > 0.5 ? 2 : 1;
    ctx.fillStyle = `rgba(80,190,255,${0.15 + rng() * 0.15})`;
    ctx.fillRect(x, y, size, size);
  }
  // Darker depth spots
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = `rgba(10,40,80,${0.1 + rng() * 0.15})`;
    ctx.fillRect(Math.floor(rng() * 14), Math.floor(rng() * 14), 2, 2);
  }
  return ctx.canvas;
}

function generateLogSide() {
  const ctx = createCtx();
  ctx.fillStyle = '#6b5030';
  ctx.fillRect(0, 0, 16, 16);
  addNoise(ctx, '#6b5030', 20, 107);
  // Bark lines
  for (let y = 0; y < 16; y += 3) {
    ctx.fillStyle = 'rgba(80,55,30,0.4)';
    ctx.fillRect(0, y, 16, 1);
  }
  return ctx.canvas;
}

function generateLogTop() {
  const ctx = createCtx();
  ctx.fillStyle = '#6b5030';
  ctx.fillRect(0, 0, 16, 16);
  // Rings
  ctx.fillStyle = '#a08050';
  ctx.fillRect(3, 3, 10, 10);
  ctx.fillStyle = '#8b6b3d';
  ctx.fillRect(5, 5, 6, 6);
  ctx.fillStyle = '#6b5030';
  ctx.fillRect(7, 7, 2, 2);
  addNoise(ctx, '#6b5030', 15, 108);
  return ctx.canvas;
}

function generateLeaves() {
  const ctx = createCtx();
  ctx.fillStyle = '#3a7a1a';
  ctx.fillRect(0, 0, 16, 16);
  addNoise(ctx, '#3a7a1a', 40, 109);
  const rng = seededRandom(801);
  for (let i = 0; i < 30; i++) {
    const shade = rng() > 0.5 ? 'rgba(50,110,25,' : 'rgba(30,70,15,';
    ctx.fillStyle = shade + (0.3 + rng() * 0.4) + ')';
    ctx.fillRect(Math.floor(rng()*16), Math.floor(rng()*16), 1, 1);
  }
  return ctx.canvas;
}

function generateBedrock() {
  const ctx = createCtx();
  ctx.fillStyle = '#333333';
  ctx.fillRect(0, 0, 16, 16);
  addNoise(ctx, '#333333', 40, 110);
  const rng = seededRandom(901);
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = `rgba(20,20,20,${0.3 + rng() * 0.4})`;
    ctx.fillRect(Math.floor(rng()*14), Math.floor(rng()*14), Math.floor(rng()*3)+1, Math.floor(rng()*3)+1);
  }
  return ctx.canvas;
}

function generateGravel() {
  const ctx = createCtx();
  ctx.fillStyle = '#777777';
  ctx.fillRect(0, 0, 16, 16);
  addNoise(ctx, '#777777', 30, 111);
  const rng = seededRandom(1001);
  for (let i = 0; i < 15; i++) {
    const gray = Math.floor(60 + rng() * 80);
    ctx.fillStyle = `rgba(${gray},${gray},${gray},0.5)`;
    ctx.fillRect(Math.floor(rng()*14), Math.floor(rng()*14), 2, 2);
  }
  return ctx.canvas;
}

function generateOre(baseColor, oreColor, seed) {
  const ctx = createCtx();
  ctx.fillStyle = '#888888';
  ctx.fillRect(0, 0, 16, 16);
  addNoise(ctx, '#888888', 30, seed);
  const rng = seededRandom(seed + 100);
  // Ore spots
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = oreColor;
    const x = Math.floor(rng() * 12) + 2;
    const y = Math.floor(rng() * 12) + 2;
    ctx.fillRect(x, y, 2, 2);
    if (rng() > 0.4) ctx.fillRect(x + 1, y + 1, 2, 1);
  }
  return ctx.canvas;
}

function generateCobblestone() {
  const ctx = createCtx();
  // Dark mortar base
  ctx.fillStyle = '#555555';
  ctx.fillRect(0, 0, 16, 16);
  // Defined stone pieces in a cobble pattern
  const rng = seededRandom(1401);
  const stones = [
    { x: 0, y: 0, w: 5, h: 4 },
    { x: 6, y: 0, w: 4, h: 3 },
    { x: 11, y: 0, w: 5, h: 4 },
    { x: 0, y: 5, w: 4, h: 3 },
    { x: 5, y: 4, w: 6, h: 4 },
    { x: 12, y: 5, w: 4, h: 3 },
    { x: 0, y: 9, w: 5, h: 4 },
    { x: 6, y: 9, w: 5, h: 3 },
    { x: 12, y: 9, w: 4, h: 4 },
    { x: 0, y: 14, w: 4, h: 2 },
    { x: 5, y: 13, w: 6, h: 3 },
    { x: 12, y: 14, w: 4, h: 2 },
  ];
  for (const s of stones) {
    const gray = Math.floor(105 + rng() * 45);
    ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
    ctx.fillRect(s.x, s.y, s.w, s.h);
    // Subtle highlight on top-left edge
    ctx.fillStyle = `rgba(200,200,200,${0.1 + rng() * 0.1})`;
    ctx.fillRect(s.x, s.y, s.w, 1);
    ctx.fillRect(s.x, s.y, 1, s.h);
    // Shadow on bottom-right edge
    ctx.fillStyle = `rgba(30,30,30,${0.15 + rng() * 0.1})`;
    ctx.fillRect(s.x, s.y + s.h - 1, s.w, 1);
    ctx.fillRect(s.x + s.w - 1, s.y, 1, s.h);
  }
  addNoise(ctx, '#888', 12, 114);
  return ctx.canvas;
}

function generatePlanks() {
  const ctx = createCtx();
  ctx.fillStyle = '#b08840';
  ctx.fillRect(0, 0, 16, 16);
  // Plank lines
  ctx.fillStyle = 'rgba(80,55,20,0.3)';
  ctx.fillRect(0, 3, 16, 1);
  ctx.fillRect(0, 7, 16, 1);
  ctx.fillRect(0, 11, 16, 1);
  ctx.fillRect(0, 15, 16, 1);
  // Vertical dividers offset per plank
  ctx.fillRect(8, 0, 1, 4);
  ctx.fillRect(4, 4, 1, 4);
  ctx.fillRect(12, 8, 1, 4);
  ctx.fillRect(6, 12, 1, 4);
  addNoise(ctx, '#b08840', 20, 115);
  return ctx.canvas;
}

function generateSnow() {
  const ctx = createCtx();
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, 16, 16);
  addNoise(ctx, '#f0f0f0', 15, 116);
  return ctx.canvas;
}

function generateGlass() {
  const ctx = createCtx();
  // Light blue pane (opaque — transparency handled by material)
  ctx.fillStyle = '#c8ddf0';
  ctx.fillRect(0, 0, 16, 16);
  // Frame
  ctx.fillStyle = '#8fa8b8';
  ctx.fillRect(0, 0, 16, 1);
  ctx.fillRect(0, 15, 16, 1);
  ctx.fillRect(0, 0, 1, 16);
  ctx.fillRect(15, 0, 1, 16);
  // Shine highlight
  ctx.fillStyle = '#ddeeff';
  ctx.fillRect(2, 2, 3, 3);
  ctx.fillRect(3, 3, 1, 1);
  return ctx.canvas;
}

function generateBrick() {
  const ctx = createCtx();
  ctx.fillStyle = '#9b5550';
  ctx.fillRect(0, 0, 16, 16);
  // Mortar
  ctx.fillStyle = '#b0a090';
  for (let y = 0; y < 16; y += 4) {
    ctx.fillRect(0, y + 3, 16, 1);
  }
  // Vertical mortar lines (offset every other row)
  for (let row = 0; row < 4; row++) {
    const y = row * 4;
    const offset = (row % 2) * 8;
    ctx.fillRect(offset, y, 1, 4);
    ctx.fillRect(offset + 8, y, 1, 4);
  }
  addNoise(ctx, '#9b5550', 20, 117);
  return ctx.canvas;
}

// Face enum: 0=top, 1=bottom, 2=front, 3=back, 4=right, 5=left
// Returns canvas for each face of a block type
function getBlockFaceTextures(blockType) {
  switch (blockType) {
    case BlockType.GRASS:
      return { top: generateGrassTop(), bottom: generateDirt(), side: generateGrassSide() };
    case BlockType.DIRT:
      return { all: generateDirt() };
    case BlockType.STONE:
      return { all: generateStone() };
    case BlockType.SAND:
      return { all: generateSand() };
    case BlockType.WATER:
      return { all: generateWater() };
    case BlockType.OAK_LOG:
      return { top: generateLogTop(), bottom: generateLogTop(), side: generateLogSide() };
    case BlockType.OAK_LEAVES:
      return { all: generateLeaves() };
    case BlockType.BEDROCK:
      return { all: generateBedrock() };
    case BlockType.GRAVEL:
      return { all: generateGravel() };
    case BlockType.COAL_ORE:
      return { all: generateOre('#888', '#222', 112) };
    case BlockType.IRON_ORE:
      return { all: generateOre('#888', '#c8a060', 113) };
    case BlockType.COBBLESTONE:
      return { all: generateCobblestone() };
    case BlockType.OAK_PLANKS:
      return { all: generatePlanks() };
    case BlockType.SNOW:
      return { all: generateSnow() };
    case BlockType.GLASS:
      return { all: generateGlass() };
    case BlockType.BRICK:
      return { all: generateBrick() };
    default:
      return { all: generateStone() };
  }
}

// Build texture atlas: arrange all block face textures into a single large texture
import * as THREE from 'three';

const ATLAS_COLS = 16;
const ATLAS_TEX_SIZE = TEX_SIZE;

export class TextureAtlas {
  constructor() {
    this.uvMap = {}; // blockType -> { top: [u,v], bottom: [u,v], side: [u,v] } (uv of top-left corner)
    this.canvas = null;
    this.texture = null;
    this.transparentTexture = null;
    this._build();
  }

  _build() {
    let idx = 0;
    const entries = [];

    for (const btStr of Object.keys(BlockData)) {
      const bt = Number(btStr);
      if (bt === BlockType.AIR) continue;
      const faces = getBlockFaceTextures(bt);
      this.uvMap[bt] = {};
      if (faces.all) {
        entries.push({ bt, face: 'all', canvas: faces.all, idx });
        const u = (idx % ATLAS_COLS) / ATLAS_COLS;
        const v = Math.floor(idx / ATLAS_COLS) / ATLAS_COLS;
        this.uvMap[bt] = { top: [u, v], bottom: [u, v], side: [u, v] };
        idx++;
      } else {
        for (const face of ['top', 'bottom', 'side']) {
          entries.push({ bt, face, canvas: faces[face], idx });
          const u = (idx % ATLAS_COLS) / ATLAS_COLS;
          const v = Math.floor(idx / ATLAS_COLS) / ATLAS_COLS;
          this.uvMap[bt][face] = [u, v];
          idx++;
        }
      }
    }

    const rows = Math.ceil(idx / ATLAS_COLS);
    const atlasSize = ATLAS_COLS * ATLAS_TEX_SIZE;
    const atlasHeight = rows * ATLAS_TEX_SIZE;

    this.canvas = document.createElement('canvas');
    this.canvas.width = atlasSize;
    this.canvas.height = atlasSize; // Use square for simplicity
    const ctx = this.canvas.getContext('2d');
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(0, 0, atlasSize, atlasSize);

    for (const entry of entries) {
      const col = entry.idx % ATLAS_COLS;
      const row = Math.floor(entry.idx / ATLAS_COLS);
      ctx.drawImage(entry.canvas, col * ATLAS_TEX_SIZE, row * ATLAS_TEX_SIZE);
    }

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.flipY = false;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;

    this.tileSize = 1 / ATLAS_COLS;
  }

  getUV(blockType, face) {
    const map = this.uvMap[blockType];
    if (!map) return [0, 0];
    if (face === 0) return map.top || map.side;
    if (face === 1) return map.bottom || map.side;
    return map.side || map.top;
  }
}
