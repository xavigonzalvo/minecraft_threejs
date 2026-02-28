import * as THREE from 'three';
import { BlockData, isWaterBlock } from './blocks.js';

// Cache for mob textures
const _mobTextureCache = {};
function getMobTexture(name) {
  if (_mobTextureCache[name]) return _mobTextureCache[name];
  const saved = localStorage.getItem('tex:' + name);
  const loader = new THREE.TextureLoader();
  const tex = loader.load(saved || `/textures/${name}.png`);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  _mobTextureCache[name] = tex;
  return tex;
}

export function reloadMobTextures() {
  for (const name of Object.keys(_mobTextureCache)) {
    const saved = localStorage.getItem('tex:' + name);
    if (saved) {
      _mobTextureCache[name].image = new Image();
      _mobTextureCache[name].image.src = saved;
      _mobTextureCache[name].image.onload = () => {
        _mobTextureCache[name].needsUpdate = true;
      };
    }
  }
}

const GRAVITY = -52;
const MOB_WIDTH = 0.6;
const MOB_HEIGHT = 1.8;

// AI states
const STATE_IDLE = 'idle';
const STATE_WANDER = 'wander';
const STATE_CHASE = 'chase';
const STATE_ATTACK = 'attack';

// Zombie constants
const ZOMBIE_SPEED = 3.0;
const ZOMBIE_HEALTH = 20;
const ZOMBIE_ATTACK_DAMAGE = 3;
const ZOMBIE_ATTACK_RANGE = 1.5;
const ZOMBIE_ATTACK_RANGE_Y = 4;
const ZOMBIE_ATTACK_COOLDOWN = 1.0;
const ZOMBIE_DETECTION_RANGE = 16;
const ZOMBIE_KNOCKBACK = 8;

class Mob {
  constructor(x, y, z, world) {
    this.position = new THREE.Vector3(x, y, z);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.world = world;
    this.health = 20;
    this.maxHealth = 20;
    this.dead = false;
    this.onGround = false;
    this.width = MOB_WIDTH;
    this.height = MOB_HEIGHT;
    this.yaw = Math.random() * Math.PI * 2;
    this.group = new THREE.Group();
    this.removed = false;

    // Damage flash
    this._flashTimer = 0;
  }

  damage(amount, knockbackDir) {
    if (this.dead) return;
    this.health -= amount;
    this._flashTimer = 0.15;

    if (knockbackDir) {
      const kb = knockbackDir.clone().normalize().multiplyScalar(ZOMBIE_KNOCKBACK);
      this.velocity.x = kb.x;
      this.velocity.z = kb.z;
      this.velocity.y = 5;
      this.onGround = false;
    }

    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      document.dispatchEvent(new CustomEvent('mob-death', { detail: { mob: this } }));
    } else {
      document.dispatchEvent(new CustomEvent('mob-hit', { detail: { mob: this } }));
    }
  }

  _moveAxis(axis, delta) {
    if (Math.abs(delta) < 0.0001) return;

    const hw = this.width / 2;
    const h = this.height;
    const eps = 0.001;

    if (axis === 0) this.position.x += delta;
    else if (axis === 1) this.position.y += delta;
    else this.position.z += delta;

    const pMinX = this.position.x - hw;
    const pMaxX = this.position.x + hw;
    const pMinY = this.position.y - h + eps;
    const pMaxY = this.position.y;
    const pMinZ = this.position.z - hw;
    const pMaxZ = this.position.z + hw;

    const bx0 = Math.floor(pMinX);
    const bx1 = Math.floor(pMaxX);
    const by0 = Math.floor(pMinY);
    const by1 = Math.floor(pMaxY);
    const bz0 = Math.floor(pMinZ);
    const bz1 = Math.floor(pMaxZ);

    for (let bx = bx0; bx <= bx1; bx++) {
      for (let by = by0; by <= by1; by++) {
        for (let bz = bz0; bz <= bz1; bz++) {
          if (!this.world.isSolid(bx, by, bz)) continue;

          if (pMaxX > bx && pMinX < bx + 1 &&
              pMaxY > by && pMinY < by + 1 &&
              pMaxZ > bz && pMinZ < bz + 1) {
            if (axis === 1) {
              if (delta < 0) {
                this.position.y = by + 1 + h;
                this.onGround = true;
              } else {
                this.position.y = by - eps;
              }
              this.velocity.y = 0;
              return;
            } else {
              // Auto-step: step up 1 block if on ground
              const feetY = Math.floor(this.position.y - h + eps);
              if (this.onGround && by === feetY) {
                const stepY = this.position.y + 1;
                const sMinY = Math.floor(stepY - h + eps);
                const sMaxY = Math.floor(stepY);
                let canStep = true;
                for (let sx = bx0; sx <= bx1 && canStep; sx++) {
                  for (let sy = sMinY; sy <= sMaxY && canStep; sy++) {
                    for (let sz = bz0; sz <= bz1 && canStep; sz++) {
                      if (this.world.isSolid(sx, sy, sz)) canStep = false;
                    }
                  }
                }
                if (canStep) {
                  this.position.y = by + 1 + h;
                  return;
                }
              }
              if (axis === 0) {
                if (delta > 0) this.position.x = bx - hw - eps;
                else this.position.x = bx + 1 + hw + eps;
              } else {
                if (delta > 0) this.position.z = bz - hw - eps;
                else this.position.z = bz + 1 + hw + eps;
              }
              return;
            }
          }
        }
      }
    }

    if (axis === 1) {
      this.onGround = false;
    }
  }

  update(dt) {
    // Override in subclass
  }

  updatePhysics(dt) {
    this.velocity.y += GRAVITY * dt;
    this._moveAxis(1, this.velocity.y * dt);
    this._moveAxis(0, this.velocity.x * dt);
    this._moveAxis(2, this.velocity.z * dt);

    // Friction on ground
    if (this.onGround) {
      this.velocity.x *= 0.8;
      this.velocity.z *= 0.8;
    }
  }

  updateMeshPosition() {
    this.group.position.set(this.position.x, this.position.y - this.height, this.position.z);
    this.group.rotation.y = this.yaw;
  }

  getAABB() {
    const hw = this.width / 2;
    return {
      minX: this.position.x - hw,
      maxX: this.position.x + hw,
      minY: this.position.y - this.height,
      maxY: this.position.y,
      minZ: this.position.z - hw,
      maxZ: this.position.z + hw,
    };
  }
}

export class Zombie extends Mob {
  constructor(x, y, z, world) {
    super(x, y, z, world);
    this.health = ZOMBIE_HEALTH;
    this.maxHealth = ZOMBIE_HEALTH;
    this.speed = ZOMBIE_SPEED;

    // AI
    this.state = STATE_IDLE;
    this._stateTimer = 0;
    this._wanderDir = new THREE.Vector3();
    this._attackCooldown = 0;
    this._groanTimer = 3 + Math.random() * 7;

    // Animation
    this._walkPhase = Math.random() * Math.PI * 2;

    // Death animation
    this._deathTimer = 0;

    this._buildModel();
  }

  _buildModel() {
    const headMat = new THREE.MeshLambertMaterial({ map: getMobTexture('zombie_head') });
    const bodyMat = new THREE.MeshLambertMaterial({ map: getMobTexture('zombie_body') });
    const armMat  = new THREE.MeshLambertMaterial({ map: getMobTexture('zombie_arm') });
    const legMat  = new THREE.MeshLambertMaterial({ map: getMobTexture('zombie_leg') });

    // Head (0.5 x 0.5 x 0.5) — sits on top of body at y=1.5
    const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    this.head = new THREE.Mesh(headGeo, headMat);
    this.head.position.set(0, 1.75, 0);

    // Body (0.5 x 0.75 x 0.25) — from y=0.75 to y=1.5
    const bodyGeo = new THREE.BoxGeometry(0.5, 0.75, 0.25);
    this.body = new THREE.Mesh(bodyGeo, bodyMat);
    this.body.position.set(0, 1.125, 0);

    // Arms (0.25 x 0.75 x 0.25) — pivot at top of body (y=1.5)
    const leftArmGeo = new THREE.BoxGeometry(0.25, 0.75, 0.25);
    leftArmGeo.translate(0, -0.375, 0); // pivot at top
    this.leftArm = new THREE.Mesh(leftArmGeo, armMat);
    this.leftArm.position.set(-0.375, 1.5, 0);

    const rightArmGeo = new THREE.BoxGeometry(0.25, 0.75, 0.25);
    rightArmGeo.translate(0, -0.375, 0);
    this.rightArm = new THREE.Mesh(rightArmGeo, armMat);
    this.rightArm.position.set(0.375, 1.5, 0);

    // Legs (0.25 x 0.75 x 0.25) — pivot at bottom of body (y=0.75)
    const leftLegGeo = new THREE.BoxGeometry(0.25, 0.75, 0.25);
    leftLegGeo.translate(0, -0.375, 0); // pivot at top
    this.leftLeg = new THREE.Mesh(leftLegGeo, legMat);
    this.leftLeg.position.set(-0.125, 0.75, 0);

    const rightLegGeo = new THREE.BoxGeometry(0.25, 0.75, 0.25);
    rightLegGeo.translate(0, -0.375, 0);
    this.rightLeg = new THREE.Mesh(rightLegGeo, legMat);
    this.rightLeg.position.set(0.125, 0.75, 0);

    this.group.add(this.head, this.body, this.leftArm, this.rightArm, this.leftLeg, this.rightLeg);

    // Store materials for flash effect
    this._materials = [headMat, bodyMat, armMat, legMat];
    this._originalColors = this._materials.map(m => m.color.clone());
  }

  update(dt, playerPos) {
    if (this.dead) {
      this._deathTimer += dt;
      // Fall over animation
      const fallProgress = Math.min(this._deathTimer / 0.5, 1);
      this.group.rotation.x = fallProgress * Math.PI / 2;
      this.group.position.y = this.position.y - this.height + fallProgress * 0.5;
      if (this._deathTimer >= 1.0) {
        this.removed = true;
      }
      return;
    }

    dt = Math.min(dt, 0.1);

    // Damage flash
    if (this._flashTimer > 0) {
      this._flashTimer -= dt;
      this._materials.forEach(m => m.color.set(0xff4444));
    } else {
      this._materials.forEach((m, i) => m.color.copy(this._originalColors[i]));
    }

    // Attack cooldown
    this._attackCooldown = Math.max(0, this._attackCooldown - dt);

    // Groan timer
    this._groanTimer -= dt;
    if (this._groanTimer <= 0 && this.state === STATE_CHASE) {
      this._groanTimer = 5 + Math.random() * 5;
      document.dispatchEvent(new CustomEvent('mob-groan', { detail: { mob: this } }));
    }

    // AI state machine
    const dx = playerPos.x - this.position.x;
    const dy = playerPos.y - this.position.y;
    const dz = playerPos.z - this.position.z;
    const distToPlayer = Math.sqrt(dx * dx + dz * dz);
    const hDistToPlayer = distToPlayer;
    const canReachVertically = Math.abs(dy) < ZOMBIE_ATTACK_RANGE_Y;

    this._stateTimer -= dt;

    switch (this.state) {
      case STATE_IDLE:
        if (distToPlayer < ZOMBIE_DETECTION_RANGE) {
          this.state = STATE_CHASE;
        } else if (this._stateTimer <= 0) {
          this.state = STATE_WANDER;
          this._stateTimer = 2 + Math.random() * 3;
          const angle = Math.random() * Math.PI * 2;
          this._wanderDir.set(Math.sin(angle), 0, Math.cos(angle));
        }
        break;

      case STATE_WANDER:
        if (distToPlayer < ZOMBIE_DETECTION_RANGE) {
          this.state = STATE_CHASE;
        } else if (this._stateTimer <= 0) {
          this.state = STATE_IDLE;
          this._stateTimer = 1 + Math.random() * 2;
        } else {
          this.velocity.x = this._wanderDir.x * this.speed * 0.5;
          this.velocity.z = this._wanderDir.z * this.speed * 0.5;
          this.yaw = Math.atan2(this._wanderDir.x, this._wanderDir.z);
        }
        break;

      case STATE_CHASE:
        if (distToPlayer > ZOMBIE_DETECTION_RANGE * 2) {
          this.state = STATE_IDLE;
          this._stateTimer = 2;
        } else if (hDistToPlayer < ZOMBIE_ATTACK_RANGE && canReachVertically) {
          this.state = STATE_ATTACK;
        } else {
          const dirX = dx / distToPlayer;
          const dirZ = dz / distToPlayer;
          this.velocity.x = dirX * this.speed;
          this.velocity.z = dirZ * this.speed;
          this.yaw = Math.atan2(dirX, dirZ);

          // Jump if hitting a wall and on ground
          if (this.onGround && this._isBlockedHorizontally(dirX, dirZ)) {
            this.velocity.y = 10;
            this.onGround = false;
          }
        }
        break;

      case STATE_ATTACK:
        if (hDistToPlayer > ZOMBIE_ATTACK_RANGE * 1.5 || !canReachVertically) {
          this.state = STATE_CHASE;
        } else {
          // Face player
          this.yaw = Math.atan2(dx, dz);
          this.velocity.x *= 0.5;
          this.velocity.z *= 0.5;
        }
        break;
    }

    this.updatePhysics(dt);

    // Walk animation
    const isMoving = this.state === STATE_CHASE || this.state === STATE_WANDER;
    if (isMoving) {
      this._walkPhase += dt * 8;
      const swing = Math.sin(this._walkPhase) * 0.6;
      this.leftLeg.rotation.x = swing;
      this.rightLeg.rotation.x = -swing;
      // Zombie arms extended forward with slight swing
      this.leftArm.rotation.x = -Math.PI / 3 + swing * 0.2;
      this.rightArm.rotation.x = -Math.PI / 3 - swing * 0.2;
    } else {
      this.leftLeg.rotation.x = 0;
      this.rightLeg.rotation.x = 0;
      this.leftArm.rotation.x = -Math.PI / 3;
      this.rightArm.rotation.x = -Math.PI / 3;
    }

    this.updateMeshPosition();
  }

  _isBlockedHorizontally(dirX, dirZ) {
    const hw = this.width / 2;
    const checkX = this.position.x + dirX * (hw + 0.2);
    const checkZ = this.position.z + dirZ * (hw + 0.2);
    const feetY = Math.floor(this.position.y - this.height + 0.01);
    return this.world.isSolid(Math.floor(checkX), feetY, Math.floor(checkZ));
  }

  canAttackPlayer(playerPos) {
    if (this.dead || this._attackCooldown > 0 || this.state !== STATE_ATTACK) return false;
    const dx = playerPos.x - this.position.x;
    const dy = playerPos.y - this.position.y;
    const dz = playerPos.z - this.position.z;
    const hDist = Math.sqrt(dx * dx + dz * dz);
    return hDist < ZOMBIE_ATTACK_RANGE && Math.abs(dy) < ZOMBIE_ATTACK_RANGE_Y;
  }

  onAttackPlayer() {
    this._attackCooldown = ZOMBIE_ATTACK_COOLDOWN;
    return ZOMBIE_ATTACK_DAMAGE;
  }

  dispose() {
    this.group.children.forEach(child => {
      child.geometry.dispose();
    });
    this._materials.forEach(m => m.dispose());
  }
}
