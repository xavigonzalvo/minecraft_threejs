import * as THREE from 'three';
import { BlockType, isWaterBlock } from './blocks.js';

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
    this.smoothCameraY = 0; // smoothly interpolated camera Y

    this.keys = {};
    this.locked = false;
    this.active = false;

    this._setupControls();
  }

  _setupControls() {
    document.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'ShiftLeft') this.sprinting = true;
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
  }

  update(dt) {
    if (!this.active) return;

    // Clamp dt to avoid physics explosion on tab-switch
    dt = Math.min(dt, 0.1);

    // Check if player is in water (feet or head)
    const feetBlockY = Math.floor(this.position.y - PLAYER_HEIGHT);
    const headBlockY = Math.floor(this.position.y - 0.1);
    const blockX = Math.floor(this.position.x);
    const blockZ = Math.floor(this.position.z);
    this.inWater = isWaterBlock(this.world.getBlock(blockX, feetBlockY, blockZ))
                || isWaterBlock(this.world.getBlock(blockX, feetBlockY + 1, blockZ));
    this.headInWater = isWaterBlock(this.world.getBlock(blockX, headBlockY, blockZ));

    const speed = this.inWater ? SWIM_SPEED : (this.sprinting ? SPRINT_SPEED : WALK_SPEED);

    // Movement direction from input
    const forward = new THREE.Vector3(
      -Math.sin(this.yaw),
      0,
      -Math.cos(this.yaw)
    );
    const right = new THREE.Vector3(
      Math.cos(this.yaw),
      0,
      -Math.sin(this.yaw)
    );

    const moveDir = new THREE.Vector3(0, 0, 0);
    if (this.keys['KeyW']) moveDir.add(forward);
    if (this.keys['KeyS']) moveDir.sub(forward);
    if (this.keys['KeyA']) moveDir.sub(right);
    if (this.keys['KeyD']) moveDir.add(right);
    if (moveDir.length() > 0) moveDir.normalize();

    // Apply horizontal velocity
    this.velocity.x = moveDir.x * speed;
    this.velocity.z = moveDir.z * speed;

    if (this.inWater) {
      // Water physics: slow sinking + drag
      this.velocity.y += WATER_GRAVITY * dt;
      this.velocity.y *= WATER_DRAG;

      // Swim up with space, sink faster with shift
      if (this.keys['Space']) {
        this.velocity.y = SWIM_SPEED;
      } else if (this.keys['ShiftLeft']) {
        this.velocity.y = -SWIM_SPEED;
      }

      // Clamp vertical speed in water
      this.velocity.y = Math.max(-SWIM_SPEED, Math.min(SWIM_SPEED, this.velocity.y));
    } else {
      // Normal gravity
      this.velocity.y += GRAVITY * dt;

      // Jump
      if (this.keys['Space'] && this.onGround) {
        this.velocity.y = JUMP_SPEED;
        this.onGround = false;
      }
    }

    // Move with collision detection (split axes, Y first so ground is resolved before horizontal)
    this._moveAxis(1, this.velocity.y * dt);
    this._moveAxis(0, this.velocity.x * dt);
    this._moveAxis(2, this.velocity.z * dt);

    // Update camera: smooth only upward step-ups, snap instantly on falls/landings
    const targetCamY = this.position.y + PLAYER_EYE_HEIGHT - PLAYER_HEIGHT;
    if (targetCamY < this.smoothCameraY) {
      // Falling or landing: snap camera instantly for a sharp feel
      this.smoothCameraY = targetCamY;
    } else {
      // Stepping up: smooth interpolation
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
