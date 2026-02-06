import { BlockType } from './blocks.js';
import { SimplexNoise } from './noise.js';
import { WORLD_HEIGHT } from './world.js';

const VILLAGE_SPACING = 256; // grid spacing for village placement
const VILLAGE_JITTER = 80;   // random offset within grid cell

// Seeded RNG for deterministic village layout
function mulberry32(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class VillageGenerator {
  constructor(seed) {
    this.seed = seed;
    this.noise = new SimplexNoise(seed * 31 + 17);
  }

  static getSpawnVillagePos(seed) {
    return { x: 40, z: 40 };
  }

  // Find village centers near a given chunk
  getVillagesNear(cx, cz, worldSeed) {
    const villages = [];
    const worldX = cx * 16;
    const worldZ = cz * 16;

    // Always place a village at the spawn village location
    const sv = VillageGenerator.getSpawnVillagePos(worldSeed);
    const svDist = Math.max(Math.abs(worldX - sv.x), Math.abs(worldZ - sv.z));
    if (svDist < VILLAGE_SPACING) {
      villages.push({ x: sv.x, z: sv.z, rng: mulberry32(sv.x * 98237 + sv.z * 13987 + worldSeed) });
    }

    // Check surrounding grid cells
    for (let gx = -1; gx <= 1; gx++) {
      for (let gz = -1; gz <= 1; gz++) {
        const cellX = Math.floor(worldX / VILLAGE_SPACING) + gx;
        const cellZ = Math.floor(worldZ / VILLAGE_SPACING) + gz;

        const rng = mulberry32(cellX * 341873128712 + cellZ * 132897987541 + worldSeed);

        // Only some cells get a village
        if (rng() > 0.4) continue;

        const vx = cellX * VILLAGE_SPACING + Math.floor(rng() * VILLAGE_JITTER * 2 - VILLAGE_JITTER);
        const vz = cellZ * VILLAGE_SPACING + Math.floor(rng() * VILLAGE_JITTER * 2 - VILLAGE_JITTER);

        villages.push({ x: vx, z: vz, rng: mulberry32(vx * 98237 + vz * 13987 + worldSeed) });
      }
    }
    return villages;
  }

  // Place a village into the world using setBlockDirect (writes to any loaded chunk)
  placeVillage(village, getHeight, setBlock) {
    const { x: vcx, z: vcz, rng } = village;

    // Get average ground height at village center
    const centerY = getHeight(vcx, vcz);
    if (centerY <= 40) return; // Don't place in water

    const baseY = centerY;

    // Clear trees in the entire village area (radius ~30 blocks)
    const clearRadius = 30;
    for (let dx = -clearRadius; dx <= clearRadius; dx++) {
      for (let dz = -clearRadius; dz <= clearRadius; dz++) {
        const gx = vcx + dx;
        const gz = vcz + dz;
        const gy = getHeight(gx, gz);
        // Remove logs and leaves above ground
        for (let y = gy + 1; y < gy + 15; y++) {
          setBlock(gx, y, gz, BlockType.AIR);
        }
      }
    }

    // ── Central Well ──
    this._placeWell(vcx, baseY, vcz, setBlock);

    // ── Paths radiating from center ──
    const numBuildings = 4 + Math.floor(rng() * 4); // 4-7 buildings
    const buildings = [];

    for (let i = 0; i < numBuildings; i++) {
      const angle = (i / numBuildings) * Math.PI * 2 + (rng() - 0.5) * 0.5;
      const dist = 10 + Math.floor(rng() * 12);
      const bx = vcx + Math.round(Math.cos(angle) * dist);
      const bz = vcz + Math.round(Math.sin(angle) * dist);
      const by = getHeight(bx, bz);

      if (by <= 40) continue; // Skip if in water
      if (Math.abs(by - baseY) > 5) continue; // Skip if terrain too uneven

      buildings.push({ x: bx, z: bz, y: by, angle, type: rng() });

      // Path from center to building
      this._placePath(vcx, vcz, bx, bz, getHeight, setBlock);
    }

    // ── Place buildings ──
    for (const b of buildings) {
      if (b.type < 0.5) {
        this._placeSmallHouse(b.x, b.y, b.z, rng, setBlock);
      } else if (b.type < 0.8) {
        this._placeLargeHouse(b.x, b.y, b.z, rng, setBlock);
      } else {
        this._placeFarm(b.x, b.y, b.z, rng, setBlock);
      }
    }

    // ── Lamp posts along paths ──
    for (const b of buildings) {
      const mx = Math.round((vcx + b.x) / 2);
      const mz = Math.round((vcz + b.z) / 2);
      const my = getHeight(mx, mz);
      if (my > 40) {
        this._placeLampPost(mx, my, mz, setBlock);
      }
    }
  }

  _placeWell(x, y, z, set) {
    // 3x3 cobblestone rim with water inside, 1-deep
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        // Foundation
        set(x + dx, y, z + dz, BlockType.COBBLESTONE);
        if (dx === 0 && dz === 0) {
          // Water inside
          set(x, y + 1, z, BlockType.WATER);
        } else {
          // Walls
          set(x + dx, y + 1, z + dz, BlockType.COBBLESTONE);
        }
      }
    }
    // Posts and roof
    set(x - 1, y + 2, z - 1, BlockType.OAK_LOG);
    set(x + 1, y + 2, z - 1, BlockType.OAK_LOG);
    set(x - 1, y + 2, z + 1, BlockType.OAK_LOG);
    set(x + 1, y + 2, z + 1, BlockType.OAK_LOG);
    // Roof
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        set(x + dx, y + 3, z + dz, BlockType.OAK_PLANKS);
      }
    }
  }

  _placeSmallHouse(x, y, z, rng, set) {
    const w = 3; // half-width (total 5x5 interior becomes 7x7 with walls)
    const wallBlock = rng() > 0.5 ? BlockType.COBBLESTONE : BlockType.OAK_PLANKS;
    const floorBlock = BlockType.OAK_PLANKS;

    // Clear interior + build
    for (let dx = -w; dx <= w; dx++) {
      for (let dz = -w; dz <= w; dz++) {
        // Foundation/floor
        set(x + dx, y, z + dz, floorBlock);

        const isWall = Math.abs(dx) === w || Math.abs(dz) === w;

        for (let dy = 1; dy <= 3; dy++) {
          if (isWall) {
            set(x + dx, y + dy, z + dz, wallBlock);
          } else {
            set(x + dx, y + dy, z + dz, BlockType.AIR);
          }
        }

        // Roof (pitched)
        set(x + dx, y + 4, z + dz, BlockType.OAK_PLANKS);
      }
    }

    // Door (front, clear 1x2 opening)
    set(x, y + 1, z + w, BlockType.AIR);
    set(x, y + 2, z + w, BlockType.AIR);

    // Windows (glass on sides)
    set(x + w, y + 2, z, BlockType.GLASS);
    set(x - w, y + 2, z, BlockType.GLASS);
    set(x, y + 2, z - w, BlockType.GLASS);
  }

  _placeLargeHouse(x, y, z, rng, set) {
    const wx = 4;
    const wz = 5;
    const wallBlock = BlockType.BRICK;
    const floorBlock = BlockType.OAK_PLANKS;

    for (let dx = -wx; dx <= wx; dx++) {
      for (let dz = -wz; dz <= wz; dz++) {
        set(x + dx, y, z + dz, floorBlock);

        const isWall = Math.abs(dx) === wx || Math.abs(dz) === wz;

        for (let dy = 1; dy <= 4; dy++) {
          if (isWall) {
            set(x + dx, y + dy, z + dz, wallBlock);
          } else {
            set(x + dx, y + dy, z + dz, BlockType.AIR);
          }
        }

        // Flat roof
        set(x + dx, y + 5, z + dz, BlockType.OAK_PLANKS);
      }
    }

    // Door
    set(x, y + 1, z + wz, BlockType.AIR);
    set(x, y + 2, z + wz, BlockType.AIR);
    set(x + 1, y + 1, z + wz, BlockType.AIR);
    set(x + 1, y + 2, z + wz, BlockType.AIR);

    // Windows on each side
    for (let i = -2; i <= 2; i += 2) {
      set(x + i, y + 2, z - wz, BlockType.GLASS);
      set(x + i, y + 3, z - wz, BlockType.GLASS);
      set(x + wx, y + 2, z + i, BlockType.GLASS);
      set(x + wx, y + 3, z + i, BlockType.GLASS);
      set(x - wx, y + 2, z + i, BlockType.GLASS);
      set(x - wx, y + 3, z + i, BlockType.GLASS);
    }
  }

  _placeFarm(x, y, z, rng, set) {
    // Fenced area with farmland (use dirt as farmland)
    const w = 3;
    for (let dx = -w; dx <= w; dx++) {
      for (let dz = -w; dz <= w; dz++) {
        const isBorder = Math.abs(dx) === w || Math.abs(dz) === w;
        if (isBorder) {
          // Fence posts (use oak log as fence)
          set(x + dx, y + 1, z + dz, BlockType.OAK_LOG);
        } else {
          // Farmland rows
          if (dx === 0) {
            set(x + dx, y, z + dz, BlockType.WATER);
          } else {
            set(x + dx, y, z + dz, BlockType.DIRT);
          }
        }
      }
    }
  }

  _placeLampPost(x, y, z, set) {
    set(x, y + 1, z, BlockType.OAK_LOG);
    set(x, y + 2, z, BlockType.OAK_LOG);
    set(x, y + 3, z, BlockType.OAK_LOG);
    // Glowstone substitute — use glass as lantern top
    set(x, y + 4, z, BlockType.GLASS);
  }

  _placePath(x1, z1, x2, z2, getHeight, set) {
    // Bresenham-style line for gravel path
    const dx = Math.abs(x2 - x1);
    const dz = Math.abs(z2 - z1);
    const sx = x1 < x2 ? 1 : -1;
    const sz = z1 < z2 ? 1 : -1;
    let err = dx - dz;
    let cx = x1, cz = z1;

    while (true) {
      const py = getHeight(cx, cz);
      if (py > 40) {
        // 3-wide path
        for (let pw = -1; pw <= 1; pw++) {
          if (dx > dz) {
            set(cx, py, cz + pw, BlockType.GRAVEL);
          } else {
            set(cx + pw, py, cz, BlockType.GRAVEL);
          }
        }
      }

      if (cx === x2 && cz === z2) break;
      const e2 = 2 * err;
      if (e2 > -dz) { err -= dz; cx += sx; }
      if (e2 < dx) { err += dx; cz += sz; }
    }
  }
}
