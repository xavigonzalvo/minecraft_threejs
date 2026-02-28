import { BlockType, BlockData } from './blocks.js';
import { GameMode } from './gamemode.js';

const PLACEABLE_BLOCKS = [
  BlockType.GRASS, BlockType.DIRT, BlockType.STONE, BlockType.SAND,
  BlockType.OAK_LOG, BlockType.OAK_LEAVES, BlockType.GRAVEL,
  BlockType.COAL_ORE, BlockType.IRON_ORE, BlockType.COBBLESTONE,
  BlockType.OAK_PLANKS, BlockType.SNOW, BlockType.GLASS, BlockType.BRICK,
];

const STORAGE_KEY = 'hotbar_v2';
const COUNTS_KEY = 'blockCounts';
const PERSONAL_KEY = 'personalInventory';
const MAIN_SLOTS = 27; // 3 rows x 9 cols
const HOTBAR_SLOTS = 9;

export class Inventory {
  constructor(atlas) {
    this.atlas = atlas;
    this.selectedSlot = 0;
    this.hotbarBlocks = this._loadHotbar();
    this.blockCounts = this._loadCounts();
    this.personalSlots = this._loadPersonal();

    // Held item state: what the player is currently carrying on cursor
    // { type, count, source } or null
    // source: 'catalog' | { area: 'personal', index } | { area: 'hotbar', index }
    this.heldItem = null;

    this._buildDOM();
    this._onMouseMove = this._onMouseMove.bind(this);
  }

  // ── Persistence ──

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

  _loadCounts() {
    try {
      const raw = localStorage.getItem(COUNTS_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        const map = new Map();
        for (const [k, v] of Object.entries(obj)) map.set(Number(k), v);
        return map;
      }
    } catch { /* fall through */ }
    return new Map();
  }

  _saveCounts() {
    const obj = {};
    for (const [k, v] of this.blockCounts) obj[k] = v;
    localStorage.setItem(COUNTS_KEY, JSON.stringify(obj));
  }

  _loadPersonal() {
    try {
      const raw = localStorage.getItem(PERSONAL_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length === MAIN_SLOTS) return arr;
      }
    } catch { /* fall through */ }
    return new Array(MAIN_SLOTS).fill(null);
  }

  _savePersonal() {
    localStorage.setItem(PERSONAL_KEY, JSON.stringify(this.personalSlots));
  }

  // ── Public API (used by game systems) ──

  addBlock(blockType, count = 1) {
    const cur = this.blockCounts.get(blockType) || 0;
    this.blockCounts.set(blockType, cur + count);
    this._saveCounts();
    this._addToPersonal(blockType, count);

    if (!this.hotbarBlocks.includes(blockType)) {
      const emptySlot = this.hotbarBlocks.indexOf(BlockType.AIR);
      if (emptySlot !== -1) {
        this.hotbarBlocks[emptySlot] = blockType;
        this._saveHotbar();
      }
    }
    document.dispatchEvent(new Event('hotbar-changed'));
  }

  removeBlock(blockType) {
    const cur = this.blockCounts.get(blockType) || 0;
    if (cur <= 0) return false;
    this.blockCounts.set(blockType, cur - 1);
    this._removeFromPersonal(blockType, 1);
    if (cur - 1 === 0) {
      this.blockCounts.delete(blockType);
      for (let i = 0; i < this.hotbarBlocks.length; i++) {
        if (this.hotbarBlocks[i] === blockType) {
          this.hotbarBlocks[i] = BlockType.AIR;
        }
      }
      this._saveHotbar();
    }
    this._saveCounts();
    document.dispatchEvent(new Event('hotbar-changed'));
    return true;
  }

  canPlace(blockType) {
    if (GameMode.isCreative()) return true;
    return (this.blockCounts.get(blockType) || 0) > 0;
  }

  getCount(blockType) {
    return this.blockCounts.get(blockType) || 0;
  }

  getHotbarBlock(slot) {
    return this.hotbarBlocks[slot];
  }

  setSelectedSlot(slot) {
    this.selectedSlot = slot;
    if (this.overlay.style.display !== 'none') {
      this._refreshUI();
    }
  }

  show() {
    this.heldItem = null;
    this.cursorEl.style.display = 'none';
    this._refreshUI();
    this.overlay.style.display = 'flex';
    document.addEventListener('mousemove', this._onMouseMove);
  }

  hide() {
    // If holding an item, put it back
    this._cancelHeld();
    this.overlay.style.display = 'none';
    document.removeEventListener('mousemove', this._onMouseMove);
  }

  // ── Personal slots helpers ──

  _addToPersonal(blockType, count) {
    for (let i = 0; i < MAIN_SLOTS; i++) {
      if (this.personalSlots[i] && this.personalSlots[i].type === blockType) {
        this.personalSlots[i].count += count;
        this._savePersonal();
        return;
      }
    }
    for (let i = 0; i < MAIN_SLOTS; i++) {
      if (!this.personalSlots[i]) {
        this.personalSlots[i] = { type: blockType, count };
        this._savePersonal();
        return;
      }
    }
  }

  _removeFromPersonal(blockType, count = 1) {
    for (let i = 0; i < MAIN_SLOTS; i++) {
      if (this.personalSlots[i] && this.personalSlots[i].type === blockType) {
        this.personalSlots[i].count -= count;
        if (this.personalSlots[i].count <= 0) {
          this.personalSlots[i] = null;
        }
        this._savePersonal();
        return;
      }
    }
  }

  // ── Cursor / held item ──

  _onMouseMove(e) {
    if (!this.heldItem) return;
    this.cursorEl.style.left = e.clientX - 18 + 'px';
    this.cursorEl.style.top = e.clientY - 18 + 'px';
  }

  _pickUp(type, count, source) {
    this.heldItem = { type, count, source };
    // Show cursor icon
    this.cursorEl.innerHTML = '';
    this.cursorEl.appendChild(this._makeBlockCanvas(type));
    if (count !== Infinity) {
      const badge = document.createElement('span');
      badge.className = 'inv-cell-count';
      badge.textContent = String(count);
      this.cursorEl.appendChild(badge);
    }
    this.cursorEl.style.display = 'block';
    this._refreshUI();
  }

  _cancelHeld() {
    if (!this.heldItem) return;
    const h = this.heldItem;
    // Return item to its source
    if (h.source !== 'catalog') {
      if (h.source.area === 'personal') {
        this.personalSlots[h.source.index] = { type: h.type, count: h.count };
        this._savePersonal();
      } else if (h.source.area === 'hotbar') {
        this.hotbarBlocks[h.source.index] = h.type;
        this._saveHotbar();
      }
    }
    this.heldItem = null;
    this.cursorEl.style.display = 'none';
    document.dispatchEvent(new Event('hotbar-changed'));
  }

  // ── Click handlers ──

  _onCatalogClick(blockType, e) {
    const isCreative = GameMode.isCreative();

    if (this.heldItem) {
      // Clicking catalog while holding: just drop held item back
      this._cancelHeld();
      this._refreshUI();
      return;
    }

    // Pick up from catalog (infinite source in creative, or copy in survival if owned)
    if (!isCreative && this.getCount(blockType) <= 0) return;

    const count = isCreative ? Infinity : this.getCount(blockType);
    this._pickUp(blockType, count, 'catalog');

    // Position cursor at mouse
    this.cursorEl.style.left = e.clientX - 18 + 'px';
    this.cursorEl.style.top = e.clientY - 18 + 'px';
  }

  _onPersonalClick(index, e) {
    const slot = this.personalSlots[index];

    if (this.heldItem) {
      // Place held item into this personal slot
      this._placeIntoPersonal(index);
      return;
    }

    // Pick up from personal slot
    if (!slot) return;
    this.personalSlots[index] = null;
    this._savePersonal();
    this._pickUp(slot.type, slot.count, { area: 'personal', index });
    this.cursorEl.style.left = e.clientX - 18 + 'px';
    this.cursorEl.style.top = e.clientY - 18 + 'px';
  }

  _onHotbarClick(index, e) {
    const bt = this.hotbarBlocks[index];

    if (this.heldItem) {
      // Place held item into hotbar slot
      this._placeIntoHotbar(index);
      return;
    }

    // Pick up from hotbar
    if (bt === BlockType.AIR) return;
    this.hotbarBlocks[index] = BlockType.AIR;
    this._saveHotbar();
    // In survival, find count from personal slots; in creative, infinite
    const count = GameMode.isCreative() ? Infinity : 1;
    this._pickUp(bt, count, { area: 'hotbar', index });
    this.cursorEl.style.left = e.clientX - 18 + 'px';
    this.cursorEl.style.top = e.clientY - 18 + 'px';
    document.dispatchEvent(new Event('hotbar-changed'));
  }

  _placeIntoPersonal(index) {
    const h = this.heldItem;
    if (!h) return;

    const existing = this.personalSlots[index];

    if (h.source === 'catalog') {
      // From catalog: place a copy, don't remove from catalog
      if (existing && existing.type === h.type && h.count !== Infinity) {
        // Stack same type
        existing.count += h.count;
      } else if (existing) {
        // Swap: put existing back — but catalog source means just overwrite
        this.personalSlots[index] = h.count === Infinity
          ? { type: h.type, count: 64 }
          : { type: h.type, count: h.count };
      } else {
        this.personalSlots[index] = h.count === Infinity
          ? { type: h.type, count: 64 }
          : { type: h.type, count: h.count };
      }
    } else {
      // From personal or hotbar
      if (existing && existing.type === h.type) {
        // Stack same type
        existing.count += (h.count === Infinity ? 64 : h.count);
      } else if (existing) {
        // Swap: put existing where held item came from
        this.personalSlots[index] = { type: h.type, count: h.count === Infinity ? 64 : h.count };
        if (h.source.area === 'personal') {
          this.personalSlots[h.source.index] = existing;
        } else if (h.source.area === 'hotbar') {
          this.hotbarBlocks[h.source.index] = existing.type;
          this._saveHotbar();
        }
      } else {
        this.personalSlots[index] = { type: h.type, count: h.count === Infinity ? 64 : h.count };
      }
    }

    this._savePersonal();
    this._syncCountsFromPersonal();
    this.heldItem = null;
    this.cursorEl.style.display = 'none';
    this._refreshUI();
    document.dispatchEvent(new Event('hotbar-changed'));
  }

  _placeIntoHotbar(index) {
    const h = this.heldItem;
    if (!h) return;

    const existingBt = this.hotbarBlocks[index];

    // Place held block type into hotbar
    this.hotbarBlocks[index] = h.type;

    // If there was a block in the hotbar, swap it back to source
    if (existingBt !== BlockType.AIR && h.source !== 'catalog') {
      if (h.source.area === 'personal') {
        this.personalSlots[h.source.index] = this.personalSlots[h.source.index] || null;
        // Put the old hotbar block back where the held item came from
        const existingPersonal = this.personalSlots[h.source.index];
        if (!existingPersonal) {
          // Find the count for the existing hotbar block from personal slots
          this.personalSlots[h.source.index] = null; // will be empty, hotbar is just a reference
        }
      } else if (h.source.area === 'hotbar') {
        this.hotbarBlocks[h.source.index] = existingBt;
      }
    }

    // If source was personal/hotbar, the item we picked up is now in the hotbar
    // If from catalog with creative, it just assigns
    if (h.source !== 'catalog' && h.source.area === 'personal') {
      // Already removed from personal on pickup, that's fine — hotbar is separate from personal
    }

    this._saveHotbar();
    this._savePersonal();
    this.heldItem = null;
    this.cursorEl.style.display = 'none';
    this._refreshUI();
    document.dispatchEvent(new Event('hotbar-changed'));
  }

  _syncCountsFromPersonal() {
    if (GameMode.isCreative()) return;
    // Rebuild blockCounts from personal slots
    this.blockCounts.clear();
    for (const slot of this.personalSlots) {
      if (slot) {
        const cur = this.blockCounts.get(slot.type) || 0;
        this.blockCounts.set(slot.type, cur + slot.count);
      }
    }
    this._saveCounts();
  }

  // ── Rendering ──

  _makeBlockCanvas(blockType) {
    const canvas = document.createElement('canvas');
    canvas.width = 36;
    canvas.height = 36;
    const ctx = canvas.getContext('2d');
    const [u, v] = this.atlas.getUV(blockType, 2);
    const srcX = Math.floor(u * this.atlas.canvas.width);
    const srcY = Math.floor(v * this.atlas.canvas.height);
    const srcSize = Math.floor(this.atlas.tileSize * this.atlas.canvas.width);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.atlas.canvas, srcX, srcY, srcSize, srcSize, 0, 0, 36, 36);
    return canvas;
  }

  _makeCellWithBlock(blockType, countText) {
    const cell = document.createElement('div');
    cell.className = 'inv-cell';
    cell.appendChild(this._makeBlockCanvas(blockType));

    const name = document.createElement('span');
    name.className = 'inv-cell-name';
    name.textContent = BlockData[blockType].name;
    cell.appendChild(name);

    if (countText !== null) {
      const badge = document.createElement('span');
      badge.className = 'inv-cell-count';
      badge.textContent = countText;
      cell.appendChild(badge);
    }
    return cell;
  }

  _makeEmptyCell() {
    const cell = document.createElement('div');
    cell.className = 'inv-cell inv-empty';
    return cell;
  }

  _buildDOM() {
    const overlay = document.createElement('div');
    overlay.id = 'inventory-overlay';
    overlay.style.display = 'none';

    const container = document.createElement('div');
    container.className = 'inventory-container';

    // Left panel: All blocks catalog
    const leftPanel = document.createElement('div');
    leftPanel.className = 'inv-panel';
    const leftTitle = document.createElement('div');
    leftTitle.className = 'inv-panel-title';
    leftTitle.textContent = 'All Blocks';
    leftPanel.appendChild(leftTitle);
    this.catalogGrid = document.createElement('div');
    this.catalogGrid.className = 'inv-catalog';
    leftPanel.appendChild(this.catalogGrid);
    container.appendChild(leftPanel);

    // Right panel: Personal inventory
    const rightPanel = document.createElement('div');
    rightPanel.className = 'inv-panel';
    const rightTitle = document.createElement('div');
    rightTitle.className = 'inv-panel-title';
    rightTitle.textContent = 'Inventory';
    rightPanel.appendChild(rightTitle);

    const personal = document.createElement('div');
    personal.className = 'inv-personal';
    this.mainGrid = document.createElement('div');
    this.mainGrid.className = 'inv-main-grid';
    personal.appendChild(this.mainGrid);

    const sep = document.createElement('div');
    sep.className = 'inv-hotbar-separator';
    personal.appendChild(sep);

    this.hotbarGrid = document.createElement('div');
    this.hotbarGrid.className = 'inv-hotbar-grid';
    personal.appendChild(this.hotbarGrid);

    this.hintEl = document.createElement('div');
    this.hintEl.className = 'inv-hint';
    personal.appendChild(this.hintEl);

    rightPanel.appendChild(personal);
    container.appendChild(rightPanel);

    // Close button
    const closeBtn = document.createElement('div');
    closeBtn.className = 'inventory-close-btn';
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('inventory-close'));
    });
    container.appendChild(closeBtn);

    overlay.appendChild(container);

    // Cursor element — follows mouse when holding an item
    this.cursorEl = document.createElement('div');
    this.cursorEl.className = 'inv-cursor';
    this.cursorEl.style.display = 'none';
    overlay.appendChild(this.cursorEl);

    document.body.appendChild(overlay);
    this.overlay = overlay;
  }

  _refreshUI() {
    const isCreative = GameMode.isCreative();

    // Catalog (left)
    this.catalogGrid.innerHTML = '';
    for (const bt of PLACEABLE_BLOCKS) {
      const count = this.getCount(bt);
      const countText = isCreative ? '\u221e' : (count > 0 ? String(count) : null);
      const cell = this._makeCellWithBlock(bt, countText);
      if (!isCreative && count === 0) {
        cell.style.opacity = '0.4';
        cell.style.cursor = 'not-allowed';
      }
      cell.addEventListener('click', (e) => this._onCatalogClick(bt, e));
      this.catalogGrid.appendChild(cell);
    }

    // Main inventory (right, 27 slots)
    this.mainGrid.innerHTML = '';
    for (let i = 0; i < MAIN_SLOTS; i++) {
      const slot = this.personalSlots[i];
      let cell;
      if (slot && slot.count > 0) {
        const countText = isCreative ? '\u221e' : String(slot.count);
        cell = this._makeCellWithBlock(slot.type, countText);
      } else {
        cell = this._makeEmptyCell();
      }
      cell.addEventListener('click', (e) => this._onPersonalClick(i, e));
      this.mainGrid.appendChild(cell);
    }

    // Hotbar (right, 9 slots)
    this.hotbarGrid.innerHTML = '';
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const bt = this.hotbarBlocks[i];
      let cell;
      if (bt !== BlockType.AIR) {
        const count = this.getCount(bt);
        const countText = isCreative ? '\u221e' : (count > 0 ? String(count) : '0');
        cell = this._makeCellWithBlock(bt, countText);
      } else {
        cell = this._makeEmptyCell();
      }
      if (i === this.selectedSlot) {
        cell.style.borderColor = '#5f5';
        cell.style.background = '#6b8b6b';
      }
      cell.addEventListener('click', (e) => this._onHotbarClick(i, e));
      this.hotbarGrid.appendChild(cell);
    }

    // Hint
    if (this.heldItem) {
      const name = BlockData[this.heldItem.type].name;
      this.hintEl.textContent = `Holding ${name} — click a slot to place`;
    } else {
      this.hintEl.textContent = 'Click a block to pick it up';
    }
  }
}
