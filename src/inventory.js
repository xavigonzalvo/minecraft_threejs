import { BlockType, BlockData } from './blocks.js';

const PLACEABLE_BLOCKS = [
  BlockType.GRASS, BlockType.DIRT, BlockType.STONE, BlockType.SAND,
  BlockType.OAK_LOG, BlockType.OAK_LEAVES, BlockType.GRAVEL,
  BlockType.COAL_ORE, BlockType.IRON_ORE, BlockType.COBBLESTONE,
  BlockType.OAK_PLANKS, BlockType.SNOW, BlockType.GLASS, BlockType.BRICK,
];

const STORAGE_KEY = 'hotbar_v2';

export class Inventory {
  constructor(atlas) {
    this.atlas = atlas;
    this.selectedSlot = 0;
    this.hotbarBlocks = this._loadHotbar();
    this._buildDOM();
  }

  _loadHotbar() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length === 9 &&
            arr.every(v => v === BlockType.AIR || PLACEABLE_BLOCKS.includes(v))) {
          return arr;
        }
      }
    } catch { /* fall through */ }
    return new Array(9).fill(BlockType.AIR);
  }

  _saveHotbar() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.hotbarBlocks));
  }

  _buildDOM() {
    const overlay = document.createElement('div');
    overlay.id = 'inventory-overlay';
    overlay.style.display = 'none';

    const title = document.createElement('h2');
    title.textContent = 'Inventory';
    overlay.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'inventory-grid';

    for (const bt of PLACEABLE_BLOCKS) {
      const cell = document.createElement('div');
      cell.className = 'inventory-cell';

      const canvas = document.createElement('canvas');
      canvas.width = 40;
      canvas.height = 40;
      const ctx = canvas.getContext('2d');
      const [u, v] = this.atlas.getUV(bt, 2);
      const srcX = Math.floor(u * this.atlas.canvas.width);
      const srcY = Math.floor(v * this.atlas.canvas.height);
      const srcSize = Math.floor(this.atlas.tileSize * this.atlas.canvas.width);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.atlas.canvas, srcX, srcY, srcSize, srcSize, 0, 0, 40, 40);
      cell.appendChild(canvas);

      const name = document.createElement('span');
      name.className = 'inventory-name';
      name.textContent = BlockData[bt].name;
      cell.appendChild(name);

      cell.addEventListener('click', () => this._onBlockSelect(bt));
      grid.appendChild(cell);
    }

    overlay.appendChild(grid);

    this.hintEl = document.createElement('div');
    this.hintEl.className = 'inventory-hint';
    this._updateHint();
    overlay.appendChild(this.hintEl);

    const closeBtn = document.createElement('div');
    closeBtn.className = 'inventory-close-btn';
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('inventory-close'));
    });
    overlay.appendChild(closeBtn);

    document.body.appendChild(overlay);
    this.overlay = overlay;
  }

  _updateHint() {
    this.hintEl.textContent = `Tap a block to assign to slot ${this.selectedSlot + 1}`;
  }

  _onBlockSelect(blockType) {
    this.hotbarBlocks[this.selectedSlot] = blockType;
    this._saveHotbar();
    document.dispatchEvent(new CustomEvent('hotbar-changed'));
    document.dispatchEvent(new CustomEvent('inventory-close'));
  }

  show() {
    this._updateHint();
    this.overlay.style.display = 'flex';
  }

  hide() {
    this.overlay.style.display = 'none';
  }

  setSelectedSlot(slot) {
    this.selectedSlot = slot;
    if (this.overlay.style.display !== 'none') {
      this._updateHint();
    }
  }

  getHotbarBlock(slot) {
    return this.hotbarBlocks[slot];
  }
}
