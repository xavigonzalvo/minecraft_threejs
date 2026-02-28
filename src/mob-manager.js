import { Zombie } from './mob.js';
import { isWaterBlock, BlockData } from './blocks.js';
import { GameMode } from './gamemode.js';

const MAX_MOBS = 8;
const SPAWN_INTERVAL = 5;
const SPAWN_MIN_DIST = 16;
const SPAWN_MAX_DIST = 32;
const DESPAWN_DIST = 64;

export class MobManager {
  constructor(scene, world, sky) {
    this.scene = scene;
    this.world = world;
    this.sky = sky;
    this.mobs = [];
    this._spawnTimer = SPAWN_INTERVAL;
  }

  update(dt, player) {
    if (!player.active || player.dead) return;

    dt = Math.min(dt, 0.1);

    // Spawning
    if (GameMode.isSurvival()) {
      this._spawnTimer -= dt;
      if (this._spawnTimer <= 0) {
        this._spawnTimer = SPAWN_INTERVAL;
        this._trySpawn(player);
      }
    }

    // Despawn all mobs when day arrives
    if (this.sky && !this.sky.isNight() && this.mobs.length > 0) {
      for (const mob of this.mobs) {
        if (!mob.dead) mob.removed = true;
      }
    }

    // Update all mobs
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const mob = this.mobs[i];
      mob.update(dt, player.position);

      // Despawn if too far
      const dx = mob.position.x - player.position.x;
      const dz = mob.position.z - player.position.z;
      if (dx * dx + dz * dz > DESPAWN_DIST * DESPAWN_DIST) {
        mob.removed = true;
      }

      // Remove if flagged
      if (mob.removed) {
        this.scene.remove(mob.group);
        mob.dispose();
        this.mobs.splice(i, 1);
        continue;
      }

      // Check mob attacking player
      if (!mob.dead && mob.canAttackPlayer(player.position)) {
        const damage = mob.onAttackPlayer();
        player.damage(damage);

        // Knockback player away from mob
        const kx = player.position.x - mob.position.x;
        const kz = player.position.z - mob.position.z;
        const kLen = Math.sqrt(kx * kx + kz * kz) || 1;
        player.velocity.x = (kx / kLen) * 6;
        player.velocity.z = (kz / kLen) * 6;
        player.velocity.y = 4;

        document.dispatchEvent(new CustomEvent('mob-hit-player', { detail: { damage } }));
      }

      // Void cleanup
      if (mob.position.y < -10) {
        mob.removed = true;
      }
    }

    // Mob-to-mob collision: push overlapping mobs apart
    for (let i = 0; i < this.mobs.length; i++) {
      const a = this.mobs[i];
      if (a.dead) continue;
      for (let j = i + 1; j < this.mobs.length; j++) {
        const b = this.mobs[j];
        if (b.dead) continue;

        const dx = a.position.x - b.position.x;
        const dz = a.position.z - b.position.z;
        const minDist = (a.width + b.width) / 2;
        const distSq = dx * dx + dz * dz;

        if (distSq < minDist * minDist && distSq > 0.0001) {
          // Vertical overlap check
          const aTop = a.position.y;
          const aBot = a.position.y - a.height;
          const bTop = b.position.y;
          const bBot = b.position.y - b.height;
          if (aTop <= bBot || bTop <= aBot) continue;

          const dist = Math.sqrt(distSq);
          const overlap = minDist - dist;
          const nx = dx / dist;
          const nz = dz / dist;
          const half = overlap / 2;
          a.position.x += nx * half;
          a.position.z += nz * half;
          b.position.x -= nx * half;
          b.position.z -= nz * half;
        } else if (distSq <= 0.0001) {
          // Mobs at exact same position — nudge apart
          const angle = Math.random() * Math.PI * 2;
          a.position.x += Math.cos(angle) * 0.05;
          a.position.z += Math.sin(angle) * 0.05;
          b.position.x -= Math.cos(angle) * 0.05;
          b.position.z -= Math.sin(angle) * 0.05;
        }
      }
    }
  }

  _trySpawn(player) {
    if (this.mobs.length >= MAX_MOBS) return;
    if (this.sky && !this.sky.isNight()) return;

    // Pick random angle and distance
    const angle = Math.random() * Math.PI * 2;
    const dist = SPAWN_MIN_DIST + Math.random() * (SPAWN_MAX_DIST - SPAWN_MIN_DIST);
    const x = Math.floor(player.position.x + Math.cos(angle) * dist) + 0.5;
    const z = Math.floor(player.position.z + Math.sin(angle) * dist) + 0.5;

    // Find surface height
    const surfaceY = this.world.getSurfaceHeight(Math.floor(x), Math.floor(z));
    if (surfaceY === undefined || surfaceY <= 0) return;

    // Check the surface block isn't water
    const surfaceBlock = this.world.getBlock(Math.floor(x), surfaceY, Math.floor(z));
    if (isWaterBlock(surfaceBlock)) return;

    // Ensure space above for the mob (2 blocks of air)
    const block1 = this.world.getBlock(Math.floor(x), surfaceY + 1, Math.floor(z));
    const block2 = this.world.getBlock(Math.floor(x), surfaceY + 2, Math.floor(z));
    if (BlockData[block1]?.solid || BlockData[block2]?.solid) return;

    const spawnY = surfaceY + 1 + 1.8; // feet at surfaceY+1, head at surfaceY+1+1.8
    const zombie = new Zombie(x, spawnY, z, this.world);
    this.mobs.push(zombie);
    this.scene.add(zombie.group);
  }

  // Get all mob AABBs for raycast checking
  getMobs() {
    return this.mobs.filter(m => !m.dead);
  }

  dispose() {
    for (const mob of this.mobs) {
      this.scene.remove(mob.group);
      mob.dispose();
    }
    this.mobs.length = 0;
  }
}
