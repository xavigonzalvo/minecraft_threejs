import * as THREE from 'three';
import { BlockType, BlockData, HOTBAR_BLOCKS } from './blocks.js';

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
  }

  _setupInput() {
    document.addEventListener('mousedown', (e) => {
      if (!this.player.locked) return;
      this._mouseDown[e.button] = true;
    });
    document.addEventListener('mouseup', (e) => {
      this._mouseDown[e.button] = false;
    });
    document.addEventListener('wheel', (e) => {
      if (!this.player.locked) return;
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

  // DDA-like raycast to find block
  raycast() {
    const origin = this.player.camera.position.clone();
    const dir = this.player.getForwardDirection();

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
      if (block !== BlockType.AIR && block !== BlockType.WATER) {
        return {
          hit: true,
          x: bx, y: by, z: bz,
          prevX: prevX, prevY: prevY, prevZ: prevZ,
          blockType: block,
        };
      }

      prevX = bx;
      prevY = by;
      prevZ = bz;
    }

    return { hit: false };
  }

  update(dt) {
    this.breakCooldown = Math.max(0, this.breakCooldown - dt);
    this.placeCooldown = Math.max(0, this.placeCooldown - dt);

    const ray = this.raycast();

    if (ray.hit) {
      this.highlight.position.set(ray.x + 0.5, ray.y + 0.5, ray.z + 0.5);
      this.highlight.visible = true;

      // Break block (left click)
      if (this._mouseDown[0] && this.breakCooldown <= 0) {
        if (ray.blockType !== BlockType.BEDROCK) {
          this.world.setBlock(ray.x, ray.y, ray.z, BlockType.AIR);
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

  getSelectedBlockType() {
    return HOTBAR_BLOCKS[this.selectedSlot];
  }
}
