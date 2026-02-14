import * as THREE from 'three';
import { BlockData, BlockType } from './blocks.js';
import { GameMode } from './gamemode.js';

export class UI {
  constructor(atlas, inventory, playerArm, camera) {
    this.atlas = atlas;
    this.inventory = inventory;
    this.playerArm = playerArm;
    this.camera = camera;
    this.debugEl = document.getElementById('debug');
    this.healthBarEl = document.getElementById('health-bar');
    this.deathOverlay = document.getElementById('death-overlay');
    this.miningOverlay = document.getElementById('mining-overlay');
    this.miningFill = this.miningOverlay.querySelector('.mining-fill');
    this.fps = 0;
    this.frameCount = 0;
    this.fpsTimer = 0;
    this._buildHotbar();
    this._buildHearts();
    this._updateHand();
    this._updateHealthBarVisibility();

    document.addEventListener('hotbar-changed', () => {
      this._buildHotbar();
      this._updateHand();
    });

    document.addEventListener('hotbar-select', () => {
      this._updateHand();
    });

    document.addEventListener('health-change', (e) => {
      this._updateHearts(e.detail.health, e.detail.max);
    });

    document.addEventListener('player-death', () => {
      this.deathOverlay.style.display = 'flex';
    });

    document.addEventListener('player-respawn', () => {
      this.deathOverlay.style.display = 'none';
    });

    document.addEventListener('gamemode-change', () => {
      this._updateHealthBarVisibility();
      this._buildHotbar();
    });

    // Mining progress overlay
    this._miningActive = false;
    this._miningBlockPos = null;
    document.addEventListener('mining-progress', (e) => {
      const { progress, active, blockX, blockY, blockZ } = e.detail;
      this._miningActive = active;
      if (active) {
        this._miningBlockPos = { x: blockX + 0.5, y: blockY + 0.5, z: blockZ + 0.5 };
        this.miningFill.style.height = `${progress * 100}%`;
        this.miningOverlay.style.display = 'block';
      } else {
        this.miningOverlay.style.display = 'none';
      }
    });
  }

  _buildHearts() {
    this.healthBarEl.innerHTML = '';
    this.hearts = [];
    for (let i = 0; i < 10; i++) {
      const span = document.createElement('span');
      span.className = 'heart full';
      span.textContent = '\u2764';
      this.healthBarEl.appendChild(span);
      this.hearts.push(span);
    }
  }

  _updateHearts(health, max) {
    const fullHearts = Math.floor(health / 2);
    const halfHeart = health % 2 === 1;
    for (let i = 0; i < 10; i++) {
      if (i < fullHearts) {
        this.hearts[i].className = 'heart full';
        this.hearts[i].textContent = '\u2764';
      } else if (i === fullHearts && halfHeart) {
        this.hearts[i].className = 'heart half';
        this.hearts[i].textContent = '\u2764';
      } else {
        this.hearts[i].className = 'heart empty';
        this.hearts[i].textContent = '\u2764';
      }
    }
  }

  _updateHealthBarVisibility() {
    this.healthBarEl.style.display = GameMode.isSurvival() ? 'flex' : 'none';
  }

  _buildHotbar() {
    const hotbar = document.getElementById('hotbar');
    hotbar.innerHTML = '';
    const isSurvival = GameMode.isSurvival();

    this.inventory.hotbarBlocks.forEach((bt, i) => {
      const slot = document.createElement('div');
      slot.className = 'hotbar-slot' + (i === 0 ? ' selected' : '');

      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = i + 1;
      slot.appendChild(key);

      if (bt !== BlockType.AIR) {
        const previewCanvas = document.createElement('canvas');
        previewCanvas.width = 32;
        previewCanvas.height = 32;
        const ctx = previewCanvas.getContext('2d');

        const [u, v] = this.atlas.getUV(bt, 2);
        const srcX = Math.floor(u * this.atlas.canvas.width);
        const srcY = Math.floor(v * this.atlas.canvas.height);
        const srcSize = Math.floor(this.atlas.tileSize * this.atlas.canvas.width);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.atlas.canvas, srcX, srcY, srcSize, srcSize, 0, 0, 32, 32);

        slot.appendChild(previewCanvas);

        // Block count badge (survival only)
        if (isSurvival) {
          const count = this.inventory.getCount(bt);
          const badge = document.createElement('span');
          badge.className = 'hotbar-count';
          badge.textContent = count;
          slot.appendChild(badge);
        }
      }

      slot.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('hotbar-select', { detail: { slot: i } }));
      });

      hotbar.appendChild(slot);
    });

    // Three-dots inventory button
    const invBtn = document.createElement('div');
    invBtn.id = 'hotbar-inventory-btn';
    invBtn.textContent = '\u2022\u2022\u2022';
    invBtn.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('touch-inventory'));
    });
    hotbar.appendChild(invBtn);
  }

  _updateHand() {
    const bt = this.inventory.getHotbarBlock(this.inventory.selectedSlot);
    this.playerArm.setVisible(bt === BlockType.AIR);
  }

  update(dt, player, world, chunkCount) {
    this.frameCount++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.frameCount / this.fpsTimer);
      this.frameCount = 0;
      this.fpsTimer = 0;
    }

    const pos = player.position;
    const cx = Math.floor(pos.x / 16);
    const cz = Math.floor(pos.z / 16);

    const statusParts = [];
    if (player.inWater) statusParts.push('Swimming');
    else if (player.onGround) statusParts.push('On ground');
    else statusParts.push('Airborne');
    if (player.flying) statusParts.push('Flying');

    this.debugEl.innerHTML = [
      `FPS: ${this.fps}`,
      `XYZ: ${pos.x.toFixed(1)} / ${pos.y.toFixed(1)} / ${pos.z.toFixed(1)}`,
      `Chunk: ${cx}, ${cz}`,
      `Chunks loaded: ${chunkCount}`,
      statusParts.join(' | '),
      `Mode: ${GameMode.current}`,
    ].join('<br>');

    // Update mining overlay screen position
    if (this._miningActive && this._miningBlockPos) {
      const pos3d = new THREE.Vector3(
        this._miningBlockPos.x,
        this._miningBlockPos.y,
        this._miningBlockPos.z
      );
      pos3d.project(this.camera);
      if (pos3d.z < 1) {
        const x = (pos3d.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-pos3d.y * 0.5 + 0.5) * window.innerHeight;
        this.miningOverlay.style.left = `${x - 20}px`;
        this.miningOverlay.style.top = `${y - 20}px`;
      }
    }

    this.playerArm.update(dt, player);
  }
}
