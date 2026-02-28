import * as THREE from 'three';
import { BlockType, BlockData, isWaterBlock } from './blocks.js';
import { GameMode } from './gamemode.js';
import { isItemType, ItemData } from './crafting.js';

const REACH = 6;
const RAY_STEP = 0.02;

export class Interaction {
  constructor(player, world, scene, onBlockChange, inventory, itemManager) {
    this.player = player;
    this.world = world;
    this.scene = scene;
    this.onBlockChange = onBlockChange;
    this.inventory = inventory;
    this.itemManager = itemManager;
    this.mobManager = null;
    this.selectedSlot = 0;
    this.breakCooldown = 0;
    this.placeCooldown = 0;
    this.attackCooldown = 0;
    this.isTouch = false;
    this._touchScreenPos = null;

    // Mining progress state
    this._miningTarget = null; // {x, y, z} of block being mined
    this._miningProgress = 0;
    this._miningHardness = 0;

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
      this.inventory.setSelectedSlot(this.selectedSlot);
      this._updateHotbar();
    });
  }

  setMobManager(manager) {
    this.mobManager = manager;
  }

  // Check if ray hits any mob before reaching a block
  _raycastMobs(origin, dir) {
    if (!this.mobManager) return null;

    const mobs = this.mobManager.getMobs();
    let closestHit = null;
    let closestDist = REACH;

    for (const mob of mobs) {
      const aabb = mob.getAABB();
      const hit = this._rayAABBIntersect(origin, dir, aabb);
      if (hit !== null && hit < closestDist) {
        closestDist = hit;
        closestHit = mob;
      }
    }

    return closestHit ? { mob: closestHit, distance: closestDist } : null;
  }

  _rayAABBIntersect(origin, dir, aabb) {
    let tmin = 0;
    let tmax = REACH;

    for (let i = 0; i < 3; i++) {
      const axis = ['x', 'y', 'z'][i];
      const min = [aabb.minX, aabb.minY, aabb.minZ][i];
      const max = [aabb.maxX, aabb.maxY, aabb.maxZ][i];
      const o = origin[axis];
      const d = dir[axis];

      if (Math.abs(d) < 1e-8) {
        if (o < min || o > max) return null;
      } else {
        let t1 = (min - o) / d;
        let t2 = (max - o) / d;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }

    return tmin;
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
      let newSlot;
      if (e.deltaY > 0) {
        newSlot = (this.selectedSlot + 1) % 9;
      } else {
        newSlot = (this.selectedSlot - 1 + 9) % 9;
      }
      document.dispatchEvent(new CustomEvent('hotbar-select', { detail: { slot: newSlot } }));
    });
    document.addEventListener('keydown', (e) => {
      const num = parseInt(e.key);
      if (num >= 1 && num <= 9) {
        document.dispatchEvent(new CustomEvent('hotbar-select', { detail: { slot: num - 1 } }));
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

  _resetMining() {
    if (this._miningTarget) {
      this._miningTarget = null;
      this._miningProgress = 0;
      this._miningHardness = 0;
      document.dispatchEvent(new CustomEvent('mining-progress', { detail: { progress: 0, active: false } }));
    }
  }

  _breakBlock(ray) {
    const blockData = BlockData[ray.blockType];
    const drop = blockData?.drops;

    // Add block directly to hotbar (survival mode)
    if (drop !== null && drop !== undefined) {
      if (GameMode.isSurvival() && this.inventory) {
        this.inventory.addBlock(drop);
        document.dispatchEvent(new CustomEvent('item-pickup', { detail: { blockType: drop } }));
      }
    }

    this.world.setBlock(ray.x, ray.y, ray.z, BlockType.AIR);
    this.world.flowWater(ray.x, ray.y, ray.z);
    this.onBlockChange();
    document.dispatchEvent(new CustomEvent('block-break', { detail: { blockType: ray.blockType } }));
  }

  update(dt) {
    if (!this.player.active) {
      this.highlight.visible = false;
      this._resetMining();
      return;
    }

    this.breakCooldown = Math.max(0, this.breakCooldown - dt);
    this.placeCooldown = Math.max(0, this.placeCooldown - dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    // On touch devices, only raycast when there's an active touch target
    if (this.isTouch && !this._touchScreenPos) {
      this.highlight.visible = false;
      this._resetMining();
      return;
    }

    // Check mob hit on left click (priority over block mining)
    if (this._mouseDown[0] && this.attackCooldown <= 0 && this.mobManager) {
      const origin = this._touchScreenPos
        ? this.player.camera.position.clone()
        : this.player.camera.position.clone();
      let dir;
      if (this._touchScreenPos) {
        const ndcX = (this._touchScreenPos.x / window.innerWidth) * 2 - 1;
        const ndcY = -(this._touchScreenPos.y / window.innerHeight) * 2 + 1;
        const far = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(this.player.camera);
        dir = far.sub(origin.clone()).normalize();
      } else {
        dir = this.player.getForwardDirection();
      }
      const mobHit = this._raycastMobs(origin, dir);
      if (mobHit) {
        const knockDir = new THREE.Vector3(
          mobHit.mob.position.x - this.player.position.x,
          0,
          mobHit.mob.position.z - this.player.position.z
        );
        mobHit.mob.damage(4, knockDir);
        this.attackCooldown = 0.4;
        document.dispatchEvent(new CustomEvent('block-break', { detail: {} })); // trigger arm swing
      }
    }

    const ray = this._touchScreenPos
      ? this.raycastFromScreen(this._touchScreenPos.x, this._touchScreenPos.y)
      : this.raycast();

    if (ray.hit) {
      this.highlight.position.set(ray.x + 0.5, ray.y + 0.5, ray.z + 0.5);
      this.highlight.visible = true;

      // Break block (left click hold-to-mine)
      if (this._mouseDown[0]) {
        const hardness = BlockData[ray.blockType]?.hardness ?? 0;

        // Bedrock / infinite hardness — can't mine
        if (hardness === Infinity) {
          this._resetMining();
        } else if (GameMode.isCreative()) {
          // Creative: instant break with small cooldown
          if (this.breakCooldown <= 0) {
            this._breakBlock(ray);
            this.breakCooldown = 0.25;
          }
        } else {
          // Survival: hold to mine
          const target = this._miningTarget;
          if (!target || target.x !== ray.x || target.y !== ray.y || target.z !== ray.z) {
            // Changed target — reset
            this._miningTarget = { x: ray.x, y: ray.y, z: ray.z };
            this._miningProgress = 0;
            // Check if held tool speeds up mining
            let effectiveHardness = hardness;
            const heldType = this.inventory.getHotbarBlock(this.selectedSlot);
            if (isItemType(heldType)) {
              const itemInfo = ItemData[heldType];
              if (itemInfo && itemInfo.miningMultiplier && itemInfo.effectiveOn &&
                  itemInfo.effectiveOn.includes(ray.blockType)) {
                effectiveHardness = hardness / itemInfo.miningMultiplier;
              }
            }
            this._miningHardness = effectiveHardness;
          }

          this._miningProgress += dt;

          const ratio = Math.min(this._miningProgress / this._miningHardness, 1);
          document.dispatchEvent(new CustomEvent('mining-progress', {
            detail: {
              progress: ratio,
              active: true,
              blockX: ray.x, blockY: ray.y, blockZ: ray.z,
              blockType: ray.blockType,
            }
          }));

          if (this._miningProgress >= this._miningHardness) {
            this._breakBlock(ray);
            this._miningTarget = null;
            this._miningProgress = 0;
            this._miningHardness = 0;
            document.dispatchEvent(new CustomEvent('mining-progress', { detail: { progress: 0, active: false } }));
          }
        }
      } else {
        // Not holding left click — reset mining
        if (this._miningTarget) {
          this._resetMining();
        }
      }

      // Right-click on crafting table → open crafting UI
      if (this._mouseDown[2] && this.placeCooldown <= 0 && ray.blockType === BlockType.CRAFTING_TABLE) {
        this._mouseDown[2] = false;
        this.placeCooldown = 0.25;
        document.dispatchEvent(new Event('open-crafting'));
      }

      // Place block (right click)
      if (this._mouseDown[2] && this.placeCooldown <= 0) {
        if (ray.prevX !== -999) {
          const placeType = this.inventory.getHotbarBlock(this.selectedSlot);
          if (placeType !== BlockType.AIR && !isItemType(placeType) && this.inventory.canPlace(placeType)) {
            // Don't place inside player
            const px = Math.floor(this.player.position.x);
            const py1 = Math.floor(this.player.position.y - 1.62);
            const py2 = Math.floor(this.player.position.y);
            const pz = Math.floor(this.player.position.z);
            if (!(ray.prevX === px && ray.prevZ === pz && (ray.prevY === py1 || ray.prevY === py2))) {
              // Survival: consume block from inventory
              if (GameMode.isSurvival()) {
                this.inventory.removeBlock(placeType);
              }
              this.world.setBlock(ray.prevX, ray.prevY, ray.prevZ, placeType);
              this.onBlockChange();
              this.placeCooldown = 0.25;
            }
          }
        }
      }
    } else {
      this.highlight.visible = false;
      this._resetMining();
    }
  }

  placeBlockAtScreen(screenX, screenY) {
    if (this.placeCooldown > 0) return;
    const placeType = this.inventory.getHotbarBlock(this.selectedSlot);
    if (placeType === BlockType.AIR || isItemType(placeType) || !this.inventory.canPlace(placeType)) return;
    const ray = this.raycastFromScreen(screenX, screenY);
    if (!ray.hit || ray.prevX === -999) return;
    const px = Math.floor(this.player.position.x);
    const py1 = Math.floor(this.player.position.y - 1.62);
    const py2 = Math.floor(this.player.position.y);
    const pz = Math.floor(this.player.position.z);
    if (!(ray.prevX === px && ray.prevZ === pz && (ray.prevY === py1 || ray.prevY === py2))) {
      if (GameMode.isSurvival()) {
        this.inventory.removeBlock(placeType);
      }
      this.world.setBlock(ray.prevX, ray.prevY, ray.prevZ, placeType);
      this.onBlockChange();
      this.placeCooldown = 0.25;
    }
  }

  getSelectedBlockType() {
    return this.inventory.getHotbarBlock(this.selectedSlot);
  }
}
