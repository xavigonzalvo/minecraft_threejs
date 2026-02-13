import * as THREE from 'three';
import { BlockType, BlockData, HOTBAR_BLOCKS, isWaterBlock } from './blocks.js';

const REACH = 6;
const RAY_STEP = 0.02;

export class Interaction {
  constructor(player, world, scene, onBlockChange) {
    this.player = player;
    this.world = world;
    this.scene = scene;
    this.onBlockChange = onBlockChange;
    this.selectedSlot = 0;
    this.breakCooldown = 0;
    this.placeCooldown = 0;
    this.isTouch = false;
    this._touchScreenPos = null;

    // Block highlight wireframe
    const hlGeo = new THREE.BoxGeometry(1.005, 1.005, 1.005);
    const hlMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      wireframe: true,
      transparent: true,
      opacity: 0.4,
      depthTest: true,
    });
    this.highlight = new THREE.Mesh(hlGeo, hlMat);
    this.highlight.visible = false;
    scene.add(this.highlight);

    this._mouseDown = {};
    this._setupInput();

    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement) {
        this._mouseDown = {};
      }
    });

    document.addEventListener('hotbar-select', (e) => {
      this.selectedSlot = e.detail.slot;
      this._updateHotbar();
    });
  }

  _setupInput() {
    document.addEventListener('mousedown', (e) => {
      if (!this.player.active) return;
      this._mouseDown[e.button] = true;
    });
    document.addEventListener('mouseup', (e) => {
      this._mouseDown[e.button] = false;
    });
    document.addEventListener('wheel', (e) => {
      if (!this.player.active) return;
      if (e.deltaY > 0) {
        this.selectedSlot = (this.selectedSlot + 1) % HOTBAR_BLOCKS.length;
      } else {
        this.selectedSlot = (this.selectedSlot - 1 + HOTBAR_BLOCKS.length) % HOTBAR_BLOCKS.length;
      }
      this._updateHotbar();
    });
    document.addEventListener('keydown', (e) => {
      const num = parseInt(e.key);
      if (num >= 1 && num <= 9) {
        this.selectedSlot = num - 1;
        this._updateHotbar();
      }
    });
  }

  _updateHotbar() {
    document.querySelectorAll('.hotbar-slot').forEach((el, i) => {
      el.classList.toggle('selected', i === this.selectedSlot);
    });
  }

  // DDA-like raycast along a ray
  _raycastRay(origin, dir) {
    let prevX = -999, prevY = -999, prevZ = -999;

    for (let t = 0; t < REACH; t += RAY_STEP) {
      const px = origin.x + dir.x * t;
      const py = origin.y + dir.y * t;
      const pz = origin.z + dir.z * t;

      const bx = Math.floor(px);
      const by = Math.floor(py);
      const bz = Math.floor(pz);

      if (bx === prevX && by === prevY && bz === prevZ) continue;

      const block = this.world.getBlock(bx, by, bz);
      if (block !== BlockType.AIR && !isWaterBlock(block)) {
        return {
          hit: true,
          x: bx, y: by, z: bz,
          prevX, prevY, prevZ,
          blockType: block,
        };
      }

      prevX = bx;
      prevY = by;
      prevZ = bz;
    }

    return { hit: false };
  }

  // Raycast from camera center (desktop)
  raycast() {
    const origin = this.player.camera.position.clone();
    const dir = this.player.getForwardDirection();
    return this._raycastRay(origin, dir);
  }

  // Raycast from a screen position (touch)
  raycastFromScreen(screenX, screenY) {
    const ndcX = (screenX / window.innerWidth) * 2 - 1;
    const ndcY = -(screenY / window.innerHeight) * 2 + 1;
    const origin = this.player.camera.position.clone();
    const far = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(this.player.camera);
    const dir = far.sub(origin).normalize();
    return this._raycastRay(origin, dir);
  }

  update(dt) {
    if (!this.player.active) {
      this.highlight.visible = false;
      return;
    }

    this.breakCooldown = Math.max(0, this.breakCooldown - dt);
    this.placeCooldown = Math.max(0, this.placeCooldown - dt);

    // On touch devices, only raycast when there's an active touch target
    if (this.isTouch && !this._touchScreenPos) {
      this.highlight.visible = false;
      return;
    }

    const ray = this._touchScreenPos
      ? this.raycastFromScreen(this._touchScreenPos.x, this._touchScreenPos.y)
      : this.raycast();

    if (ray.hit) {
      this.highlight.position.set(ray.x + 0.5, ray.y + 0.5, ray.z + 0.5);
      this.highlight.visible = true;

      // Break block (left click)
      if (this._mouseDown[0] && this.breakCooldown <= 0) {
        if (ray.blockType !== BlockType.BEDROCK) {
          this.world.setBlock(ray.x, ray.y, ray.z, BlockType.AIR);
          this.world.flowWater(ray.x, ray.y, ray.z);
          this.onBlockChange();
          this.breakCooldown = 0.25;
        }
      }

      // Place block (right click)
      if (this._mouseDown[2] && this.placeCooldown <= 0) {
        if (ray.prevX !== -999) {
          const placeType = HOTBAR_BLOCKS[this.selectedSlot];
          // Don't place inside player
          const px = Math.floor(this.player.position.x);
          const py1 = Math.floor(this.player.position.y - 1.62);
          const py2 = Math.floor(this.player.position.y);
          const pz = Math.floor(this.player.position.z);
          if (!(ray.prevX === px && ray.prevZ === pz && (ray.prevY === py1 || ray.prevY === py2))) {
            this.world.setBlock(ray.prevX, ray.prevY, ray.prevZ, placeType);
            this.onBlockChange();
            this.placeCooldown = 0.25;
          }
        }
      }
    } else {
      this.highlight.visible = false;
    }
  }

  placeBlockAtScreen(screenX, screenY) {
    if (this.placeCooldown > 0) return;
    const ray = this.raycastFromScreen(screenX, screenY);
    if (!ray.hit || ray.prevX === -999) return;
    const placeType = HOTBAR_BLOCKS[this.selectedSlot];
    const px = Math.floor(this.player.position.x);
    const py1 = Math.floor(this.player.position.y - 1.62);
    const py2 = Math.floor(this.player.position.y);
    const pz = Math.floor(this.player.position.z);
    if (!(ray.prevX === px && ray.prevZ === pz && (ray.prevY === py1 || ray.prevY === py2))) {
      this.world.setBlock(ray.prevX, ray.prevY, ray.prevZ, placeType);
      this.onBlockChange();
      this.placeCooldown = 0.25;
    }
  }

  getSelectedBlockType() {
    return HOTBAR_BLOCKS[this.selectedSlot];
  }
}
