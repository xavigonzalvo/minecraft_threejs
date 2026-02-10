import { HOTBAR_BLOCKS, BlockData, BlockType } from './blocks.js';

export class UI {
  constructor(atlas) {
    this.atlas = atlas;
    this.debugEl = document.getElementById('debug');
    this.fps = 0;
    this.frameCount = 0;
    this.fpsTimer = 0;
    this._buildHotbar();
  }

  _buildHotbar() {
    const hotbar = document.getElementById('hotbar');
    hotbar.innerHTML = '';

    HOTBAR_BLOCKS.forEach((bt, i) => {
      const slot = document.createElement('div');
      slot.className = 'hotbar-slot' + (i === 0 ? ' selected' : '');

      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = i + 1;
      slot.appendChild(key);

      // Mini block preview
      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = 32;
      previewCanvas.height = 32;
      const ctx = previewCanvas.getContext('2d');

      // Draw the block texture from atlas
      const [u, v] = this.atlas.getUV(bt, 2); // side face
      const srcX = Math.floor(u * this.atlas.canvas.width);
      const srcY = Math.floor(v * this.atlas.canvas.height);
      const srcSize = Math.floor(this.atlas.tileSize * this.atlas.canvas.width);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.atlas.canvas, srcX, srcY, srcSize, srcSize, 0, 0, 32, 32);

      slot.appendChild(previewCanvas);

      slot.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('hotbar-select', { detail: { slot: i } }));
      });

      hotbar.appendChild(slot);
    });
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
  }
}
