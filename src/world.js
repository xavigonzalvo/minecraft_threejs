import { SimplexNoise } from './noise.js';
import { BlockType, BlockData, isWaterBlock } from './blocks.js';
import { VillageGenerator } from './village.js';

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 128;
const SEA_LEVEL = 40;

export class World {
  constructor(seed = 12345) {
    this.seed = seed;
    this.chunks = new Map();
    this.noise = new SimplexNoise(seed);
    this.noise2 = new SimplexNoise(seed * 7 + 3);
    this.noise3 = new SimplexNoise(seed * 13 + 7);
    this.treeNoise = new SimplexNoise(seed * 17 + 11);
    this.villageGen = new VillageGenerator(seed);
    this.placedVillages = new Set(); // track which villages have been placed
    this._waterQueue = [];
    this._waterVisited = new Set();
    this._waterTimer = 0;
    this._waterUpdates = 0;
  }

  chunkKey(cx, cz) {
    return `${cx},${cz}`;
  }

  getChunk(cx, cz) {
    return this.chunks.get(this.chunkKey(cx, cz));
  }

  generateChunk(cx, cz) {
    const key = this.chunkKey(cx, cz);
    if (this.chunks.has(key)) return this.chunks.get(key);

    const blocks = new Uint8Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE);
    const chunk = { cx, cz, blocks, dirty: true, mesh: null, waterMesh: null };

    const wx = cx * CHUNK_SIZE;
    const wz = cz * CHUNK_SIZE;

    // Generate terrain height map and populate blocks
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const worldX = wx + x;
        const worldZ = wz + z;

        // Multi-octave terrain height
        const continentalness = this.noise.fbm2D(worldX * 0.001, worldZ * 0.001, 4, 2, 0.5);
        const erosion = this.noise.fbm2D(worldX * 0.004, worldZ * 0.004, 6, 2, 0.5);
        const detail = this.noise2.fbm2D(worldX * 0.02, worldZ * 0.02, 3, 2, 0.45);

        // Asymmetric continental contribution: full strength above sea level,
        // but weak below to prevent vast ocean basins (scale 0.001 = ~1000 block features)
        const cContrib = continentalness > 0 ? continentalness * 12 : continentalness * 2;
        let rawHeight = cContrib + erosion * 6 + detail * 3;

        // Compress remaining underwater depth so lakes are shallow and self-contained
        if (rawHeight < 0) {
          rawHeight = Math.max(-3, rawHeight * 0.25);
        }

        let height = SEA_LEVEL + rawHeight;
        height = Math.floor(height);
        height = Math.max(1, Math.min(WORLD_HEIGHT - 2, height));

        // Biome determination
        const temp = this.noise3.fbm2D(worldX * 0.002 + 500, worldZ * 0.002 + 500, 3);
        const moisture = this.noise3.fbm2D(worldX * 0.002 + 1000, worldZ * 0.002 + 1000, 3);

        const isBeach = height >= SEA_LEVEL - 1 && height <= SEA_LEVEL + 2;
        const isDesert = temp > 0.3 && moisture < -0.1;
        const isSnow = temp < -0.4;

        for (let y = 0; y < WORLD_HEIGHT; y++) {
          const idx = (x * WORLD_HEIGHT + y) * CHUNK_SIZE + z;

          if (y === 0) {
            blocks[idx] = BlockType.BEDROCK;
          } else if (y < height - 4) {
            // Deep underground: stone with ores
            blocks[idx] = BlockType.STONE;

            // Cave generation using 3D noise
            const cave1 = this.noise.noise3D(worldX * 0.03, y * 0.05, worldZ * 0.03);
            const cave2 = this.noise2.noise3D(worldX * 0.04, y * 0.04, worldZ * 0.04);
            if (Math.abs(cave1) < 0.08 && Math.abs(cave2) < 0.08 && y > 5 && y < height - 8) {
              blocks[idx] = BlockType.AIR;
              continue;
            }

            // Ore generation
            if (y < 20) {
              const oreVal = this.noise3.noise3D(worldX * 0.1, y * 0.1, worldZ * 0.1);
              if (oreVal > 0.6) blocks[idx] = BlockType.IRON_ORE;
            }
            if (y < 50) {
              const coalVal = this.noise3.noise3D(worldX * 0.08 + 100, y * 0.08, worldZ * 0.08 + 100);
              if (coalVal > 0.55) blocks[idx] = BlockType.COAL_ORE;
            }
            // Gravel patches
            const gravelVal = this.noise2.noise3D(worldX * 0.06, y * 0.06, worldZ * 0.06);
            if (gravelVal > 0.65 && y < 40) blocks[idx] = BlockType.GRAVEL;
          } else if (y < height) {
            // Near surface
            if (isDesert || isBeach) {
              blocks[idx] = BlockType.SAND;
            } else {
              blocks[idx] = BlockType.DIRT;
            }
          } else if (y === height) {
            // Surface
            if (isDesert) {
              blocks[idx] = BlockType.SAND;
            } else if (isBeach && height <= SEA_LEVEL + 1) {
              blocks[idx] = BlockType.SAND;
            } else if (isSnow) {
              blocks[idx] = BlockType.SNOW;
            } else {
              blocks[idx] = BlockType.GRASS;
            }
          } else if (y <= SEA_LEVEL && y > height) {
            blocks[idx] = BlockType.WATER;
          }
        }

        // Tree generation
        if (height > SEA_LEVEL + 1 && !isDesert && !isBeach && !isSnow) {
          const treeVal = this.treeNoise.noise2D(worldX * 0.5, worldZ * 0.5);
          if (treeVal > 0.6 && x > 2 && x < CHUNK_SIZE - 3 && z > 2 && z < CHUNK_SIZE - 3) {
            this._placeTree(blocks, x, height + 1, z);
          }
        }
      }
    }

    this.chunks.set(key, chunk);

    // Mark adjacent chunks dirty so they rebuild faces at the shared border
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nc = this.getChunk(cx + dx, cz + dz);
      if (nc) nc.dirty = true;
    }

    return chunk;
  }

  _placeTree(blocks, x, y, z) {
    const trunkHeight = 4 + Math.floor(Math.random() * 3);

    // Check we have room
    if (y + trunkHeight + 3 >= WORLD_HEIGHT) return;

    // Trunk
    for (let dy = 0; dy < trunkHeight; dy++) {
      const idx = (x * WORLD_HEIGHT + (y + dy)) * CHUNK_SIZE + z;
      blocks[idx] = BlockType.OAK_LOG;
    }

    // Leaves (spherical-ish shape)
    const leafStart = y + trunkHeight - 2;
    const leafEnd = y + trunkHeight + 2;
    for (let ly = leafStart; ly <= leafEnd; ly++) {
      const radius = ly < leafEnd - 1 ? 2 : 1;
      for (let lx = -radius; lx <= radius; lx++) {
        for (let lz = -radius; lz <= radius; lz++) {
          if (Math.abs(lx) === radius && Math.abs(lz) === radius) continue; // Skip corners
          const bx = x + lx;
          const bz = z + lz;
          if (bx < 0 || bx >= CHUNK_SIZE || bz < 0 || bz >= CHUNK_SIZE) continue;
          if (ly < 0 || ly >= WORLD_HEIGHT) continue;
          const idx = (bx * WORLD_HEIGHT + ly) * CHUNK_SIZE + bz;
          if (blocks[idx] === BlockType.AIR) {
            blocks[idx] = BlockType.OAK_LEAVES;
          }
        }
      }
    }
  }

  // Get the ground height at a world coordinate, ignoring trees
  getSurfaceHeight(x, z) {
    for (let y = WORLD_HEIGHT - 1; y > 0; y--) {
      const block = this.getBlock(x, y, z);
      if (block === BlockType.AIR || isWaterBlock(block)
          || block === BlockType.OAK_LOG || block === BlockType.OAK_LEAVES) continue;
      return y;
    }
    return SEA_LEVEL;
  }

  // Place villages that overlap with loaded chunks
  placeVillagesNear(cx, cz) {
    const villages = this.villageGen.getVillagesNear(cx, cz, this.seed);
    for (const village of villages) {
      const key = `${village.x},${village.z}`;
      if (this.placedVillages.has(key)) continue;

      // Check that the chunks the village needs are loaded (within ~2 chunk radius of center)
      const vcx = Math.floor(village.x / CHUNK_SIZE);
      const vcz = Math.floor(village.z / CHUNK_SIZE);
      let allLoaded = true;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (!this.getChunk(vcx + dx, vcz + dz)) {
            allLoaded = false;
            break;
          }
        }
        if (!allLoaded) break;
      }
      if (!allLoaded) continue;

      this.placedVillages.add(key);
      this.villageGen.placeVillage(
        village,
        (x, z) => this.getSurfaceHeight(x, z),
        (x, y, z, type) => this._setBlockDirect(x, y, z, type)
      );
    }
  }

  // Set block without marking dirty (used during generation)
  _setBlockDirect(x, y, z, type) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return;
    const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    chunk.blocks[(lx * WORLD_HEIGHT + y) * CHUNK_SIZE + lz] = type;
    chunk.dirty = true;
  }

  loadChunkFromData(cx, cz, blocks) {
    const key = this.chunkKey(cx, cz);
    const chunk = { cx, cz, blocks, dirty: true, mesh: null, waterMesh: null };
    this.chunks.set(key, chunk);
    return chunk;
  }

  getBlock(x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return BlockType.AIR;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return BlockType.AIR;
    const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return chunk.blocks[(lx * WORLD_HEIGHT + y) * CHUNK_SIZE + lz];
  }

  setBlock(x, y, z, type) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return;
    const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    chunk.blocks[(lx * WORLD_HEIGHT + y) * CHUNK_SIZE + lz] = type;
    chunk.dirty = true;

    // Mark adjacent chunks dirty if on border
    if (lx === 0) { const nc = this.getChunk(cx - 1, cz); if (nc) nc.dirty = true; }
    if (lx === CHUNK_SIZE - 1) { const nc = this.getChunk(cx + 1, cz); if (nc) nc.dirty = true; }
    if (lz === 0) { const nc = this.getChunk(cx, cz - 1); if (nc) nc.dirty = true; }
    if (lz === CHUNK_SIZE - 1) { const nc = this.getChunk(cx, cz + 1); if (nc) nc.dirty = true; }
  }

  flowWater(x, y, z) {
    const key = `${x},${y},${z}`;
    if (this._waterVisited.has(key)) return;
    this._waterVisited.add(key);
    this._waterQueue.push([x, y, z, 0]);
  }

  static _WATER_LEVELS = [BlockType.WATER_25, BlockType.WATER_50, BlockType.WATER_75, BlockType.WATER];

  updateWater(dt) {
    if (this._waterQueue.length === 0) return false;

    this._waterTimer += dt;
    if (this._waterTimer < 0.15) return false;
    this._waterTimer = 0;

    // Pop entries until we advance one block or exhaust the queue
    while (this._waterQueue.length > 0 && this._waterUpdates < 200) {
      const [bx, by, bz, hDist] = this._waterQueue.shift();
      const current = this.getBlock(bx, by, bz);

      // Determine next water level for this block
      const levels = World._WATER_LEVELS;
      let levelIdx = levels.indexOf(current);
      if (levelIdx === -1) {
        // Block is AIR — start at level 0 (WATER_25)
        if (current !== BlockType.AIR) continue;
        levelIdx = -1;
      }

      // Already full water — nothing to do
      if (current === BlockType.WATER) continue;

      // Check if any neighbor (above + 4 horizontal) is water source
      const hasWaterNeighbor =
        isWaterBlock(this.getBlock(bx, by + 1, bz)) ||
        isWaterBlock(this.getBlock(bx + 1, by, bz)) ||
        isWaterBlock(this.getBlock(bx - 1, by, bz)) ||
        isWaterBlock(this.getBlock(bx, by, bz + 1)) ||
        isWaterBlock(this.getBlock(bx, by, bz - 1));

      if (!hasWaterNeighbor) continue;

      // If water is directly above, fill instantly (gravity)
      const waterAbove = isWaterBlock(this.getBlock(bx, by + 1, bz));
      const nextLevel = waterAbove ? BlockType.WATER : levels[levelIdx + 1];
      this.setBlock(bx, by, bz, nextLevel);
      this._waterUpdates++;

      if (nextLevel !== BlockType.WATER) {
        // Not yet full — re-enqueue to keep filling
        this._waterQueue.push([bx, by, bz, hDist]);
      } else {
        // Reached full water — spread to neighbors
        const belowKey = `${bx},${by - 1},${bz}`;
        if (!this._waterVisited.has(belowKey)) {
          this._waterVisited.add(belowKey);
          this._waterQueue.push([bx, by - 1, bz, 0]);
        }

        if (hDist < 4) { // reduced from 7 to keep water contained
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nk = `${bx + dx},${by},${bz + dz}`;
            if (!this._waterVisited.has(nk)) {
              this._waterVisited.add(nk);
              this._waterQueue.push([bx + dx, by, bz + dz, hDist + 1]);
            }
          }
        }
      }

      return true; // one level change, let caller rebuild
    }

    // Queue empty or cap reached — reset state
    if (this._waterQueue.length === 0 || this._waterUpdates >= 200) {
      this._waterQueue = [];
      this._waterVisited = new Set();
      this._waterUpdates = 0;
    }

    return false;
  }

  // Run once after world generation to fill air gaps adjacent to water
  seedInitialWaterFlow() {
    const queue = [];
    const visited = new Set();

    // Scan all chunks for water blocks with air horizontal/below
    for (const chunk of this.chunks.values()) {
      const wx = chunk.cx * CHUNK_SIZE;
      const wz = chunk.cz * CHUNK_SIZE;
      for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          for (let y = 0; y < WORLD_HEIGHT; y++) {
            if (chunk.blocks[(x * WORLD_HEIGHT + y) * CHUNK_SIZE + z] !== BlockType.WATER) continue;
            const worldX = wx + x;
            const worldZ = wz + z;
            for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,-1,0]]) {
              const nx = worldX + dx;
              const ny = y + dy;
              const nz = worldZ + dz;
              const key = `${nx},${ny},${nz}`;
              if (!visited.has(key) && this.getBlock(nx, ny, nz) === BlockType.AIR) {
                visited.add(key);
                queue.push([nx, ny, nz, dy === 0 ? 1 : 0]);
              }
            }
          }
        }
      }
    }

    // Synchronous BFS fill — only within sea level and with containment
    while (queue.length > 0) {
      const [bx, by, bz, hDist] = queue.shift();
      if (by > SEA_LEVEL || by < 1) continue; // never above sea level
      if (this.getBlock(bx, by, bz) !== BlockType.AIR) continue;

      const hasWaterNeighbor =
        isWaterBlock(this.getBlock(bx, by + 1, bz)) ||
        isWaterBlock(this.getBlock(bx + 1, by, bz)) ||
        isWaterBlock(this.getBlock(bx - 1, by, bz)) ||
        isWaterBlock(this.getBlock(bx, by, bz + 1)) ||
        isWaterBlock(this.getBlock(bx, by, bz - 1));

      if (!hasWaterNeighbor) continue;

      this.setBlock(bx, by, bz, BlockType.WATER);

      const belowKey = `${bx},${by - 1},${bz}`;
      if (!visited.has(belowKey)) {
        visited.add(belowKey);
        queue.push([bx, by - 1, bz, 0]);
      }

      if (hDist < 4) { // reduced from 7 to keep water contained
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nk = `${bx + dx},${by},${bz + dz}`;
          if (!visited.has(nk)) {
            visited.add(nk);
            queue.push([bx + dx, by, bz + dz, hDist + 1]);
          }
        }
      }
    }
  }

  isSolid(x, y, z) {
    const block = this.getBlock(x, y, z);
    return BlockData[block]?.solid ?? false;
  }

  isTransparent(x, y, z) {
    const block = this.getBlock(x, y, z);
    return BlockData[block]?.transparent ?? true;
  }

  getSpawnPoint() {
    // Spawn next to the village on dry land
    const vp = VillageGenerator.getSpawnVillagePos(this.seed);
    // Spiral outward from village center to find solid, non-water ground
    for (let r = 2; r < 40; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue; // only perimeter
          const sx = vp.x + dx;
          const sz = vp.z + dz;
          for (let y = WORLD_HEIGHT - 1; y > 0; y--) {
            const block = this.getBlock(sx, y, sz);
            if (block === BlockType.AIR || block === BlockType.OAK_LEAVES
                || block === BlockType.OAK_LOG) continue;
            if (isWaterBlock(block)) break; // water column, skip this spot
            // Found solid dry ground
            return { x: sx + 0.5, y: y + 2.62, z: sz + 0.5 };
          }
        }
      }
    }
    return { x: vp.x + 0.5, y: 80, z: vp.z + 0.5 };
  }
}
