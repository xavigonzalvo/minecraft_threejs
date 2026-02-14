import * as THREE from 'three';
import { BlockType, isWaterBlock } from './blocks.js';
import { GameMode } from './gamemode.js';

const GRAVITY = -52;
const JUMP_SPEED = 13;
const WALK_SPEED = 4.3;
const SPRINT_SPEED = 7;
const SWIM_SPEED = 3.0;
const WATER_GRAVITY = -5;
const WATER_BUOYANCY = 8;
const WATER_DRAG = 0.85;
const PLAYER_HEIGHT = 1.62;
const PLAYER_WIDTH = 0.6;
const PLAYER_EYE_HEIGHT = 1.52;
const MOUSE_SENSITIVITY = 0.002;
const FLY_SPEED = 12;
const FLY_VERTICAL_SPEED = 8;
const MAX_HEALTH = 20;
const VOID_DAMAGE_INTERVAL = 0.5;
const DOUBLE_TAP_MS = 300;

export class Player {
  constructor(camera, world, canvas) {
    this.camera = camera;
    this.world = world;
    this.canvas = canvas;

    this.position = new THREE.Vector3(0, 80, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.pitch = 0;
    this.yaw = 0;
    this.onGround = false;
    this.sprinting = false;
    this.inWater = false;
    this.headInWater = false;
    this.smoothCameraY = 0;

    // Health system (survival)
    this.health = MAX_HEALTH;
    this.dead = false;

    // Fall damage tracking
    this._fallStartY = null;

    // Void damage timer
    this._voidDamageTimer = 0;

    // Creative flying
    this.flying = false;
    this._lastSpaceTap = 0;

    this.keys = {};
    this.locked = false;
    this.active = false;

    this._setupControls();
  }

  _setupControls() {
    document.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'ShiftLeft') this.sprinting = true;

      // Double-tap space to toggle flying (creative only)
      if (e.code === 'Space' && GameMode.isCreative() && this.active) {
        const now = performance.now();
        if (now - this._lastSpaceTap < DOUBLE_TAP_MS) {
          this.flying = !this.flying;
          this.velocity.y = 0;
          this._lastSpaceTap = 0;
        } else {
          this._lastSpaceTap = now;
        }
      }
    });
    document.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      if (e.code === 'ShiftLeft') this.sprinting = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * MOUSE_SENSITIVITY;
      this.pitch -= e.movementY * MOUSE_SENSITIVITY;
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.active = this.locked;
      if (!this.locked) {
        this.keys = {};
        this.sprinting = false;
      }
    });
  }

  spawn(pos) {
    this.position.set(pos.x, pos.y, pos.z);
    this.velocity.set(0, 0, 0);
    this.smoothCameraY = pos.y + PLAYER_EYE_HEIGHT - PLAYER_HEIGHT;
    this._fallStartY = null;
    this._voidDamageTimer = 0;
  }

  resetHealth() {
    this.health = MAX_HEALTH;
    this.dead = false;
    document.dispatchEvent(new CustomEvent('health-change', { detail: { health: this.health, max: MAX_HEALTH } }));
  }

  damage(amount) {
    if (GameMode.isCreative() || this.dead) return;
    this.health = Math.max(0, this.health - amount);
    document.dispatchEvent(new CustomEvent('health-change', { detail: { health: this.health, max: MAX_HEALTH } }));
    if (this.health <= 0) {
      this.dead = true;
      this.velocity.set(0, 0, 0);
      document.dispatchEvent(new Event('player-death'));
    }
  }

  update(dt) {
    if (!this.active || this.dead) return;

    // Clamp dt to avoid physics explosion on tab-switch
    dt = Math.min(dt, 0.1);

    // Disable flying if switched to survival
    if (GameMode.isSurvival() && this.flying) {
      this.flying = false;
    }

    // Check if player is in water (feet or head)
    const feetBlockY = Math.floor(this.position.y - PLAYER_HEIGHT);
    const headBlockY = Math.floor(this.position.y - 0.1);
    const blockX = Math.floor(this.position.x);
    const blockZ = Math.floor(this.position.z);
    this.inWater = isWaterBlock(this.world.getBlock(blockX, feetBlockY, blockZ))
                || isWaterBlock(this.world.getBlock(blockX, feetBlockY + 1, blockZ));
    this.headInWater = isWaterBlock(this.world.getBlock(blockX, headBlockY, blockZ));

    // Flying mode (creative)
    if (this.flying) {
      const flyH = this.sprinting ? FLY_SPEED * 1.5 : FLY_SPEED;
      const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

      const moveDir = new THREE.Vector3(0, 0, 0);
      if (this.keys['KeyW']) moveDir.add(forward);
      if (this.keys['KeyS']) moveDir.sub(forward);
      if (this.keys['KeyA']) moveDir.sub(right);
      if (this.keys['KeyD']) moveDir.add(right);
      if (moveDir.length() > 0) moveDir.normalize();

      this.velocity.x = moveDir.x * flyH;
      this.velocity.z = moveDir.z * flyH;
      this.velocity.y = 0;
      if (this.keys['Space']) this.velocity.y = FLY_VERTICAL_SPEED;
      if (this.keys['ShiftLeft']) this.velocity.y = -FLY_VERTICAL_SPEED;

      this._moveAxis(1, this.velocity.y * dt);
      this._moveAxis(0, this.velocity.x * dt);
      this._moveAxis(2, this.velocity.z * dt);
      this.onGround = false;
    } else {
      const speed = this.inWater ? SWIM_SPEED : (this.sprinting ? SPRINT_SPEED : WALK_SPEED);

      const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

      const moveDir = new THREE.Vector3(0, 0, 0);
      if (this.keys['KeyW']) moveDir.add(forward);
      if (this.keys['KeyS']) moveDir.sub(forward);
      if (this.keys['KeyA']) moveDir.sub(right);
      if (this.keys['KeyD']) moveDir.add(right);
      if (moveDir.length() > 0) moveDir.normalize();

      this.velocity.x = moveDir.x * speed;
      this.velocity.z = moveDir.z * speed;

      if (this.inWater) {
        this.velocity.y += WATER_GRAVITY * dt;
        this.velocity.y *= WATER_DRAG;
        if (this.keys['Space']) this.velocity.y = SWIM_SPEED;
        else if (this.keys['ShiftLeft']) this.velocity.y = -SWIM_SPEED;
        this.velocity.y = Math.max(-SWIM_SPEED, Math.min(SWIM_SPEED, this.velocity.y));
      } else {
        this.velocity.y += GRAVITY * dt;
        if (this.keys['Space'] && this.onGround) {
          this.velocity.y = JUMP_SPEED;
          this.onGround = false;
        }
      }

      // Fall damage tracking: record Y when leaving ground
      const wasOnGround = this.onGround;
      this._moveAxis(1, this.velocity.y * dt);

      // Detect landing
      if (this.onGround && !wasOnGround && this._fallStartY !== null) {
        const fallDist = this._fallStartY - this.position.y;
        if (fallDist > 3 && GameMode.isSurvival() && !this.inWater) {
          this.damage(Math.floor(fallDist - 3));
        }
        this._fallStartY = null;
      }

      // Track fall start
      if (!this.onGround && this._fallStartY === null && this.velocity.y < 0) {
        this._fallStartY = this.position.y;
      }
      if (this.onGround) this._fallStartY = null;

      this._moveAxis(0, this.velocity.x * dt);
      this._moveAxis(2, this.velocity.z * dt);
    }

    // Void damage (survival): below Y=0
    if (GameMode.isSurvival() && this.position.y < 0) {
      this._voidDamageTimer += dt;
      if (this._voidDamageTimer >= VOID_DAMAGE_INTERVAL) {
        this._voidDamageTimer -= VOID_DAMAGE_INTERVAL;
        this.damage(2);
      }
    } else {
      this._voidDamageTimer = 0;
    }

    // Update camera: smooth only upward step-ups, snap instantly on falls/landings
    const targetCamY = this.position.y + PLAYER_EYE_HEIGHT - PLAYER_HEIGHT;
    if (targetCamY < this.smoothCameraY) {
      this.smoothCameraY = targetCamY;
    } else {
      const lerpSpeed = 15;
      this.smoothCameraY += (targetCamY - this.smoothCameraY) * Math.min(1, lerpSpeed * dt);
    }
    this.camera.position.set(this.position.x, this.smoothCameraY, this.position.z);

    // Camera rotation
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
  }

  _moveAxis(axis, delta) {
    if (Math.abs(delta) < 0.0001) return;

    const hw = PLAYER_WIDTH / 2;
    const h = PLAYER_HEIGHT;
    const eps = 0.001;

    // Apply movement
    if (axis === 0) this.position.x += delta;
    else if (axis === 1) this.position.y += delta;
    else this.position.z += delta;

    // Player AABB: feet at (y - h), head at y
    // Use small epsilon to avoid floating point overlap with the block we're standing on
    const pMinX = this.position.x - hw;
    const pMaxX = this.position.x + hw;
    const pMinY = this.position.y - h + eps;
    const pMaxY = this.position.y;
    const pMinZ = this.position.z - hw;
    const pMaxZ = this.position.z + hw;

    // Block range to check
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

          // Block occupies [bx, bx+1] x [by, by+1] x [bz, bz+1]
          if (pMaxX > bx && pMinX < bx + 1 &&
              pMaxY > by && pMinY < by + 1 &&
              pMaxZ > bz && pMinZ < bz + 1) {
            // Resolve collision by pushing player out along movement axis
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
              // Auto-step: on land, if obstacle is 1 block above feet, step up
              const feetY = Math.floor(this.position.y - h + eps);
              if (this.onGround && !this.inWater && by === feetY) {
                // Check all blocks the player AABB would occupy one block higher
                const stepY = this.position.y + 1;
                const sMinY = Math.floor(stepY - h + eps);
                const sMaxY = Math.floor(stepY);
                let canStep = true;
                for (let sx = bx0; sx <= bx1 && canStep; sx++) {
                  for (let sy = sMinY; sy <= sMaxY && canStep; sy++) {
                    for (let sz = bz0; sz <= bz1 && canStep; sz++) {
                      if (this.world.isSolid(sx, sy, sz)) {
                        canStep = false;
                      }
                    }
                  }
                }
                if (canStep) {
                  this.position.y = by + 1 + h;
                  return;
                }
              }
              // Normal push-out
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

    // No Y collision — check if we're still on ground
    if (axis === 1) {
      this.onGround = false;
    }
  }

  getForwardDirection() {
    return new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    ).normalize();
  }
}
