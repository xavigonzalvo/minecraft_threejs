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
  WATER_25: 17,
  WATER_50: 18,
  WATER_75: 19,
};

// Block properties — drops: what block type is added to inventory when broken (null = nothing)
// hardness: seconds to break (Infinity = unbreakable)
export const BlockData = {
  [BlockType.AIR]:         { name: 'Air',         solid: false, transparent: true,  drops: null,                   hardness: 0 },
  [BlockType.GRASS]:       { name: 'Grass',       solid: true,  transparent: false, drops: BlockType.DIRT,         hardness: 0.5 },
  [BlockType.DIRT]:        { name: 'Dirt',        solid: true,  transparent: false, drops: BlockType.DIRT,         hardness: 0.4 },
  [BlockType.STONE]:       { name: 'Stone',       solid: true,  transparent: false, drops: BlockType.COBBLESTONE,  hardness: 1.5 },
  [BlockType.SAND]:        { name: 'Sand',        solid: true,  transparent: false, drops: BlockType.SAND,         hardness: 0.4 },
  [BlockType.WATER]:       { name: 'Water',       solid: false, transparent: true,  drops: null,                   hardness: 0 },
  [BlockType.OAK_LOG]:     { name: 'Oak Log',     solid: true,  transparent: false, drops: BlockType.OAK_LOG,      hardness: 1.0 },
  [BlockType.OAK_LEAVES]:  { name: 'Oak Leaves',  solid: true,  transparent: true,  drops: null,                   hardness: 0.2 },
  [BlockType.BEDROCK]:     { name: 'Bedrock',     solid: true,  transparent: false, drops: null,                   hardness: Infinity },
  [BlockType.GRAVEL]:      { name: 'Gravel',      solid: true,  transparent: false, drops: BlockType.GRAVEL,       hardness: 0.4 },
  [BlockType.COAL_ORE]:    { name: 'Coal Ore',    solid: true,  transparent: false, drops: BlockType.COAL_ORE,     hardness: 2.0 },
  [BlockType.IRON_ORE]:    { name: 'Iron Ore',    solid: true,  transparent: false, drops: BlockType.IRON_ORE,     hardness: 2.0 },
  [BlockType.COBBLESTONE]: { name: 'Cobblestone', solid: true,  transparent: false, drops: BlockType.COBBLESTONE,  hardness: 1.5 },
  [BlockType.OAK_PLANKS]:  { name: 'Oak Planks',  solid: true,  transparent: false, drops: BlockType.OAK_PLANKS,   hardness: 1.0 },
  [BlockType.SNOW]:        { name: 'Snow',        solid: true,  transparent: false, drops: BlockType.SNOW,         hardness: 0.4 },
  [BlockType.GLASS]:       { name: 'Glass',       solid: true,  transparent: true,  drops: null,                   hardness: 0.3 },
  [BlockType.BRICK]:       { name: 'Brick',       solid: true,  transparent: false, drops: BlockType.BRICK,        hardness: 1.5 },
  [BlockType.WATER_25]:    { name: 'Water',       solid: false, transparent: true,  drops: null,                   hardness: 0 },
  [BlockType.WATER_50]:    { name: 'Water',       solid: false, transparent: true,  drops: null,                   hardness: 0 },
  [BlockType.WATER_75]:    { name: 'Water',       solid: false, transparent: true,  drops: null,                   hardness: 0 },
};

export function isWaterBlock(type) {
  return type === BlockType.WATER || type === BlockType.WATER_25 ||
         type === BlockType.WATER_50 || type === BlockType.WATER_75;
}

export function waterHeight(type) {
  switch (type) {
    case BlockType.WATER_25: return 0.25;
    case BlockType.WATER_50: return 0.5;
    case BlockType.WATER_75: return 0.75;
    default: return 1.0;
  }
}

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

// Texture file mapping: blockType -> { top/bottom/side/all: filename (without .png) }
export const TEXTURE_FILES = {
  [BlockType.GRASS]:       { top: 'grass_top', bottom: 'dirt', side: 'grass_side' },
  [BlockType.DIRT]:        { all: 'dirt' },
  [BlockType.STONE]:       { all: 'stone' },
  [BlockType.SAND]:        { all: 'sand' },
  [BlockType.WATER]:       { all: 'water' },
  [BlockType.OAK_LOG]:     { top: 'oak_log_top', bottom: 'oak_log_top', side: 'oak_log_side' },
  [BlockType.OAK_LEAVES]:  { all: 'oak_leaves' },
  [BlockType.BEDROCK]:     { all: 'bedrock' },
  [BlockType.GRAVEL]:      { all: 'gravel' },
  [BlockType.COAL_ORE]:    { all: 'coal_ore' },
  [BlockType.IRON_ORE]:    { all: 'iron_ore' },
  [BlockType.COBBLESTONE]: { all: 'cobblestone' },
  [BlockType.OAK_PLANKS]:  { all: 'oak_planks' },
  [BlockType.SNOW]:        { all: 'snow' },
  [BlockType.GLASS]:       { all: 'glass' },
  [BlockType.BRICK]:       { all: 'brick' },
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load texture: ${src}`));
    img.src = src;
  });
}

// Build texture atlas: arrange all block face textures into a single large texture
import * as THREE from 'three';

const ATLAS_COLS = 16;

export class TextureAtlas {
  constructor() {
    this.uvMap = {};
    this.canvas = null;
    this.texture = null;
    this.tileSize = 0;
  }

  async load() {
    // Collect unique texture names
    const unique = new Set();
    for (const faces of Object.values(TEXTURE_FILES)) {
      for (const name of Object.values(faces)) unique.add(name);
    }

    // Load all images in parallel
    const images = {};
    await Promise.all([...unique].map(async (name) => {
      images[name] = await loadImage(`/textures/${name}.png`);
    }));

    // Build atlas
    let idx = 0;
    const entries = [];

    for (const btStr of Object.keys(BlockData)) {
      const bt = Number(btStr);
      if (bt === BlockType.AIR) continue;
      const faces = TEXTURE_FILES[bt];
      if (!faces) continue;

      this.uvMap[bt] = {};
      if (faces.all) {
        entries.push({ image: images[faces.all], idx });
        const u = (idx % ATLAS_COLS) / ATLAS_COLS;
        const v = Math.floor(idx / ATLAS_COLS) / ATLAS_COLS;
        this.uvMap[bt] = { top: [u, v], bottom: [u, v], side: [u, v] };
        idx++;
      } else {
        for (const face of ['top', 'bottom', 'side']) {
          entries.push({ image: images[faces[face]], idx });
          const u = (idx % ATLAS_COLS) / ATLAS_COLS;
          const v = Math.floor(idx / ATLAS_COLS) / ATLAS_COLS;
          this.uvMap[bt][face] = [u, v];
          idx++;
        }
      }
    }

    const atlasSize = ATLAS_COLS * TEX_SIZE;
    this.canvas = document.createElement('canvas');
    this.canvas.width = atlasSize;
    this.canvas.height = atlasSize;
    const ctx = this.canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(0, 0, atlasSize, atlasSize);

    for (const entry of entries) {
      const col = entry.idx % ATLAS_COLS;
      const row = Math.floor(entry.idx / ATLAS_COLS);
      ctx.drawImage(entry.image, col * TEX_SIZE, row * TEX_SIZE, TEX_SIZE, TEX_SIZE);
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
