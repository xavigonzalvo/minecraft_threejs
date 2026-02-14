import { BlockData, BlockType } from './blocks.js';

export class UI {
  constructor(atlas, inventory, playerArm) {
    this.atlas = atlas;
    this.inventory = inventory;
    this.playerArm = playerArm;
    this.debugEl = document.getElementById('debug');
    this.fps = 0;
    this.frameCount = 0;
    this.fpsTimer = 0;
    this._buildHotbar();
    this._updateHand();

    document.addEventListener('hotbar-changed', () => {
      this._buildHotbar();
      this._updateHand();
    });

    document.addEventListener('hotbar-select', () => {
      this._updateHand();
    });
  }

  _buildHotbar() {
    const hotbar = document.getElementById('hotbar');
    hotbar.innerHTML = '';

    this.inventory.hotbarBlocks.forEach((bt, i) => {
      const slot = document.createElement('div');
      slot.className = 'hotbar-slot' + (i === 0 ? ' selected' : '');

      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = i + 1;
      slot.appendChild(key);

      // Mini block preview (only if slot is not empty)
      if (bt !== BlockType.AIR) {
        const previewCanvas = document.createElement('canvas');
        previewCanvas.width = 32;
        previewCanvas.height = 32;
        const ctx = previewCanvas.getContext('2d');

        const [u, v] = this.atlas.getUV(bt, 2); // side face
        const srcX = Math.floor(u * this.atlas.canvas.width);
        const srcY = Math.floor(v * this.atlas.canvas.height);
        const srcSize = Math.floor(this.atlas.tileSize * this.atlas.canvas.width);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.atlas.canvas, srcX, srcY, srcSize, srcSize, 0, 0, 32, 32);

        slot.appendChild(previewCanvas);
      }

      slot.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('hotbar-select', { detail: { slot: i } }));
      });

      hotbar.appendChild(slot);
    });
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

    this.debugEl.innerHTML = [
      `FPS: ${this.fps}`,
      `XYZ: ${pos.x.toFixed(1)} / ${pos.y.toFixed(1)} / ${pos.z.toFixed(1)}`,
      `Chunk: ${cx}, ${cz}`,
      `Chunks loaded: ${chunkCount}`,
      `${player.inWater ? 'Swimming' : player.onGround ? 'On ground' : 'Airborne'}`,
    ].join('<br>');

    this.playerArm.update(dt, player);
  }
}
