import { BlockType, BlockData } from './blocks.js';
import { GameMode } from './gamemode.js';
import { isItemType, getItemOrBlockData, ItemType, ItemData, findMatchingRecipe } from './crafting.js';

const PLACEABLE_BLOCKS = [
  BlockType.GRASS, BlockType.DIRT, BlockType.STONE, BlockType.SAND,
  BlockType.OAK_LOG, BlockType.OAK_LEAVES, BlockType.GRAVEL,
  BlockType.COAL_ORE, BlockType.IRON_ORE, BlockType.COBBLESTONE,
  BlockType.OAK_PLANKS, BlockType.SNOW, BlockType.GLASS, BlockType.BRICK,
  BlockType.CRAFTING_TABLE,
];

const CATALOG_ITEMS = [
  ...PLACEABLE_BLOCKS,
  ItemType.STICK,
  ItemType.WOODEN_AXE,
];

const STORAGE_KEY = 'hotbar_v2';
const COUNTS_KEY = 'blockCounts';
const PERSONAL_KEY = 'personalInventory';
const MAIN_SLOTS = 27; // 3 rows x 9 cols
const HOTBAR_SLOTS = 9;

// Item texture file mapping
const ITEM_TEXTURES = {
  [ItemType.STICK]: 'stick',
  [ItemType.WOODEN_AXE]: 'wooden_axe',
};

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
    //       | { area: 'crafting', index } | 'craftOutput'
    this.heldItem = null;

    // Item texture cache: itemType -> Image
    this.itemImages = {};
    this._loadItemTextures();

    // Crafting grid: 9 slots (3x3), each null or { type, count }
    this.craftingGrid = new Array(9).fill(null);
    this.craftingResult = null;

    // Inventory 2x2 mini crafting grid
    this.invCraftingGrid = new Array(4).fill(null);
    this.invCraftingResult = null;

    this._buildDOM();
    this._buildCraftingDOM();
    this._onMouseMove = this._onMouseMove.bind(this);
  }

  async _loadItemTextures() {
    for (const [typeStr, filename] of Object.entries(ITEM_TEXTURES)) {
      const img = new Image();
      img.src = `/textures/${filename}.png`;
      try {
        await img.decode();
      } catch { /* will show empty */ }
      this.itemImages[Number(typeStr)] = img;
    }
  }

  // ── Persistence ──

  _loadHotbar() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length === 9 &&
            arr.every(v => v === BlockType.AIR || PLACEABLE_BLOCKS.includes(v) || isItemType(v))) {
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

  /** Convert creative infinites to 64 stacks when switching to survival */
  materializeCreativeBlocks() {
    let changed = false;
    // Give 64 of each hotbar block that has no count — set count directly
    // without adding to personal slots (the block already lives in the hotbar)
    for (const bt of this.hotbarBlocks) {
      if (bt !== BlockType.AIR && (this.blockCounts.get(bt) || 0) <= 0) {
        this.blockCounts.set(bt, 64);
        changed = true;
      }
    }
    // Convert any Infinity personal slots to 64
    for (let i = 0; i < MAIN_SLOTS; i++) {
      const slot = this.personalSlots[i];
      if (slot && (slot.count === Infinity || slot.count <= 0)) {
        slot.count = 64;
        changed = true;
      }
    }
    if (changed) {
      this._savePersonal();
      this._saveCounts();
      document.dispatchEvent(new Event('hotbar-changed'));
    }
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
    this.invCraftingGrid = new Array(4).fill(null);
    this.invCraftingResult = null;
    this._refreshUI();
    this.overlay.style.display = 'flex';
    document.addEventListener('mousemove', this._onMouseMove);
  }

  hide() {
    // Return 2x2 crafting grid items to inventory
    for (let i = 0; i < 4; i++) {
      const slot = this.invCraftingGrid[i];
      if (slot) {
        this._addToPersonal(slot.type, slot.count);
        this.invCraftingGrid[i] = null;
      }
    }
    // If holding an item, put it back
    this._cancelHeld();
    this._syncCountsFromPersonal();
    document.dispatchEvent(new Event('hotbar-changed'));
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
    this.cursorEl.appendChild(this._makeIconCanvas(type));
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
    if (h.source !== 'catalog' && h.source !== 'craftOutput') {
      if (h.source.area === 'personal') {
        this.personalSlots[h.source.index] = { type: h.type, count: h.count };
        this._savePersonal();
      } else if (h.source.area === 'hotbar') {
        this.hotbarBlocks[h.source.index] = h.type;
        this._saveHotbar();
      } else if (h.source.area === 'crafting') {
        this.craftingGrid[h.source.index] = { type: h.type, count: h.count };
      } else if (h.source.area === 'invCrafting') {
        this.invCraftingGrid[h.source.index] = { type: h.type, count: h.count };
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

  _onTrashClick() {
    if (!this.heldItem) return;
    // In creative mode, simply discard the held item
    // In survival mode, also discard (item was already removed from source on pickup)
    this.heldItem = null;
    this.cursorEl.style.display = 'none';
    this._syncCountsFromPersonal();
    this._refreshUI();
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
        } else if (h.source.area === 'crafting') {
          this.craftingGrid[h.source.index] = existing;
        } else if (h.source.area === 'invCrafting') {
          this.invCraftingGrid[h.source.index] = existing;
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

  _makeIconCanvas(id) {
    const canvas = document.createElement('canvas');
    canvas.width = 36;
    canvas.height = 36;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    if (isItemType(id)) {
      const img = this.itemImages[id];
      if (img && img.complete) {
        ctx.drawImage(img, 0, 0, 36, 36);
      }
    } else {
      const [u, v] = this.atlas.getUV(id, 2);
      const srcX = Math.floor(u * this.atlas.canvas.width);
      const srcY = Math.floor(v * this.atlas.canvas.height);
      const srcSize = Math.floor(this.atlas.tileSize * this.atlas.canvas.width);
      ctx.drawImage(this.atlas.canvas, srcX, srcY, srcSize, srcSize, 0, 0, 36, 36);
    }
    return canvas;
  }

  // Keep backward compat alias
  _makeBlockCanvas(blockType) {
    return this._makeIconCanvas(blockType);
  }

  _makeCellWithBlock(blockType, countText) {
    const cell = document.createElement('div');
    cell.className = 'inv-cell';
    cell.appendChild(this._makeIconCanvas(blockType));

    const name = document.createElement('span');
    name.className = 'inv-cell-name';
    const data = getItemOrBlockData(blockType);
    name.textContent = data ? data.name : '?';
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
    leftTitle.textContent = 'All Items';
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

    // Trash bin (creative mode only)
    this.trashEl = document.createElement('div');
    this.trashEl.className = 'inv-trash';
    this.trashEl.innerHTML = '🗑';
    const trashLabel = document.createElement('span');
    trashLabel.className = 'inv-trash-label';
    trashLabel.textContent = 'Destroy Item';
    this.trashEl.appendChild(trashLabel);
    this.trashEl.addEventListener('click', () => this._onTrashClick());
    personal.appendChild(this.trashEl);

    rightPanel.appendChild(personal);

    // 2x2 mini crafting area (survival mode)
    const invCraftArea = document.createElement('div');
    invCraftArea.className = 'inv-craft-area';

    this.invCraftGrid = document.createElement('div');
    this.invCraftGrid.className = 'inv-craft-grid';
    invCraftArea.appendChild(this.invCraftGrid);

    const invCraftArrow = document.createElement('div');
    invCraftArrow.className = 'inv-craft-arrow';
    invCraftArrow.textContent = '\u2192';
    invCraftArea.appendChild(invCraftArrow);

    this.invCraftOutput = document.createElement('div');
    this.invCraftOutput.className = 'inv-cell inv-craft-output';
    this.invCraftOutput.addEventListener('click', () => this._onInvCraftOutputClick());
    invCraftArea.appendChild(this.invCraftOutput);

    this.invCraftAreaEl = invCraftArea;
    rightPanel.appendChild(invCraftArea);

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

  // ── Crafting UI ──

  _buildCraftingDOM() {
    const overlay = document.createElement('div');
    overlay.id = 'crafting-overlay';
    overlay.style.display = 'none';

    const container = document.createElement('div');
    container.className = 'crafting-container';

    // Title
    const title = document.createElement('div');
    title.className = 'inv-panel-title';
    title.textContent = 'Crafting Table';
    container.appendChild(title);

    // Crafting area: grid + arrow + output
    const craftArea = document.createElement('div');
    craftArea.className = 'craft-area';

    // 3x3 grid
    this.craftGrid = document.createElement('div');
    this.craftGrid.className = 'craft-grid';
    craftArea.appendChild(this.craftGrid);

    // Arrow
    const arrow = document.createElement('div');
    arrow.className = 'craft-arrow';
    arrow.textContent = '\u2192';
    craftArea.appendChild(arrow);

    // Output slot
    this.craftOutput = document.createElement('div');
    this.craftOutput.className = 'inv-cell craft-output';
    this.craftOutput.addEventListener('click', (e) => this._onCraftingOutputClick(e));
    craftArea.appendChild(this.craftOutput);

    container.appendChild(craftArea);

    // Player inventory section in crafting view
    const invSection = document.createElement('div');
    invSection.className = 'craft-inventory-section';

    const invTitle = document.createElement('div');
    invTitle.className = 'inv-panel-title';
    invTitle.textContent = 'Inventory';
    invSection.appendChild(invTitle);

    this.craftPersonalGrid = document.createElement('div');
    this.craftPersonalGrid.className = 'inv-main-grid';
    invSection.appendChild(this.craftPersonalGrid);

    const sep = document.createElement('div');
    sep.className = 'inv-hotbar-separator';
    invSection.appendChild(sep);

    this.craftHotbarGrid = document.createElement('div');
    this.craftHotbarGrid.className = 'inv-hotbar-grid';
    invSection.appendChild(this.craftHotbarGrid);

    container.appendChild(invSection);

    // Close button
    const closeBtn = document.createElement('div');
    closeBtn.className = 'inventory-close-btn';
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', () => {
      document.dispatchEvent(new Event('crafting-close'));
    });
    container.appendChild(closeBtn);

    overlay.appendChild(container);

    // Cursor element for crafting
    this.craftCursorEl = document.createElement('div');
    this.craftCursorEl.className = 'inv-cursor';
    this.craftCursorEl.style.display = 'none';
    overlay.appendChild(this.craftCursorEl);

    document.body.appendChild(overlay);
    this.craftingOverlay = overlay;
  }

  showCrafting() {
    this.heldItem = null;
    this.cursorEl.style.display = 'none';
    this.craftCursorEl.style.display = 'none';
    this.craftingGrid = new Array(9).fill(null);
    this.craftingResult = null;
    this._refreshCraftingUI();
    this.craftingOverlay.style.display = 'flex';
    document.addEventListener('mousemove', this._onMouseMove);
  }

  hideCrafting() {
    // Return crafting grid items to inventory
    for (let i = 0; i < 9; i++) {
      const slot = this.craftingGrid[i];
      if (slot) {
        this._addToPersonal(slot.type, slot.count);
        this.craftingGrid[i] = null;
      }
    }
    this._cancelHeld();
    this._syncCountsFromPersonal();
    document.dispatchEvent(new Event('hotbar-changed'));
    this.craftingOverlay.style.display = 'none';
    document.removeEventListener('mousemove', this._onMouseMove);
  }

  _onCraftGridClick(index, e) {
    if (this.heldItem) {
      // Place held item into crafting grid
      const existing = this.craftingGrid[index];
      if (existing && existing.type === this.heldItem.type) {
        existing.count += (this.heldItem.count === Infinity ? 1 : this.heldItem.count);
        if (this.heldItem.source !== 'catalog' && this.heldItem.source !== 'craftOutput') {
          // item consumed
        }
      } else if (existing) {
        // Swap
        const newSlot = { type: this.heldItem.type, count: this.heldItem.count === Infinity ? 1 : this.heldItem.count };
        this.craftingGrid[index] = newSlot;
        this._pickUp(existing.type, existing.count, { area: 'crafting', index });
        this._updateCraftingResult();
        this._refreshCraftingUI();
        return;
      } else {
        this.craftingGrid[index] = { type: this.heldItem.type, count: this.heldItem.count === Infinity ? 1 : this.heldItem.count };
      }
      this.heldItem = null;
      this.cursorEl.style.display = 'none';
      this.craftCursorEl.style.display = 'none';
    } else {
      // Pick up from crafting grid
      const slot = this.craftingGrid[index];
      if (!slot) return;
      this.craftingGrid[index] = null;
      this._pickUp(slot.type, slot.count, { area: 'crafting', index });
      this.cursorEl.style.left = e.clientX - 18 + 'px';
      this.cursorEl.style.top = e.clientY - 18 + 'px';
    }
    this._updateCraftingResult();
    this._refreshCraftingUI();
  }

  _onCraftingOutputClick(e) {
    if (!this.craftingResult) return;
    if (this.heldItem) return; // Must have empty hand

    const result = this.craftingResult;

    // Consume one of each ingredient from grid
    for (let i = 0; i < 9; i++) {
      const slot = this.craftingGrid[i];
      if (slot) {
        slot.count -= 1;
        if (slot.count <= 0) {
          this.craftingGrid[i] = null;
        }
      }
    }

    // Add result to inventory
    this.addBlock(result.type, result.count);

    this._updateCraftingResult();
    this._refreshCraftingUI();
    document.dispatchEvent(new Event('hotbar-changed'));
  }

  _onCraftPersonalClick(index, e) {
    const slot = this.personalSlots[index];
    if (this.heldItem) {
      this._placeIntoPersonal(index);
      this._refreshCraftingUI();
      return;
    }
    if (!slot) return;
    this.personalSlots[index] = null;
    this._savePersonal();
    this._pickUp(slot.type, slot.count, { area: 'personal', index });
    this.cursorEl.style.left = e.clientX - 18 + 'px';
    this.cursorEl.style.top = e.clientY - 18 + 'px';
    this._refreshCraftingUI();
  }

  _onCraftHotbarClick(index, e) {
    const bt = this.hotbarBlocks[index];
    if (this.heldItem) {
      this._placeIntoHotbar(index);
      this._refreshCraftingUI();
      return;
    }
    if (bt === BlockType.AIR) return;
    this.hotbarBlocks[index] = BlockType.AIR;
    this._saveHotbar();
    const count = GameMode.isCreative() ? Infinity : 1;
    this._pickUp(bt, count, { area: 'hotbar', index });
    this.cursorEl.style.left = e.clientX - 18 + 'px';
    this.cursorEl.style.top = e.clientY - 18 + 'px';
    document.dispatchEvent(new Event('hotbar-changed'));
    this._refreshCraftingUI();
  }

  _updateCraftingResult() {
    // Build flat grid of types for recipe matching
    const grid = this.craftingGrid.map(s => (s ? s.type : 0));
    this.craftingResult = findMatchingRecipe(grid);
  }

  _refreshCraftingUI() {
    const isCreative = GameMode.isCreative();

    // 3x3 crafting grid
    this.craftGrid.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const slot = this.craftingGrid[i];
      let cell;
      if (slot && slot.count > 0) {
        cell = this._makeCellWithBlock(slot.type, String(slot.count));
      } else {
        cell = this._makeEmptyCell();
      }
      cell.addEventListener('click', (e) => this._onCraftGridClick(i, e));
      this.craftGrid.appendChild(cell);
    }

    // Output slot
    this.craftOutput.innerHTML = '';
    if (this.craftingResult) {
      const resultCell = this._makeCellWithBlock(this.craftingResult.type, String(this.craftingResult.count));
      resultCell.style.border = 'none';
      resultCell.style.background = 'none';
      this.craftOutput.appendChild(resultCell);
      this.craftOutput.style.cursor = 'pointer';
    } else {
      this.craftOutput.style.cursor = 'default';
    }

    // Player inventory in crafting view
    this.craftPersonalGrid.innerHTML = '';
    for (let i = 0; i < MAIN_SLOTS; i++) {
      const slot = this.personalSlots[i];
      let cell;
      if (slot && slot.count > 0) {
        const countText = isCreative ? '\u221e' : String(slot.count);
        cell = this._makeCellWithBlock(slot.type, countText);
      } else {
        cell = this._makeEmptyCell();
      }
      cell.addEventListener('click', (e) => this._onCraftPersonalClick(i, e));
      this.craftPersonalGrid.appendChild(cell);
    }

    // Hotbar in crafting view
    this.craftHotbarGrid.innerHTML = '';
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
      cell.addEventListener('click', (e) => this._onCraftHotbarClick(i, e));
      this.craftHotbarGrid.appendChild(cell);
    }
  }

  // ── Inventory 2x2 mini crafting ──

  _onInvCraftGridClick(index, e) {
    if (this.heldItem) {
      // Place held item into 2x2 grid
      const existing = this.invCraftingGrid[index];
      if (existing && existing.type === this.heldItem.type) {
        existing.count += (this.heldItem.count === Infinity ? 1 : this.heldItem.count);
        if (this.heldItem.source !== 'catalog' && this.heldItem.source !== 'craftOutput') {
          // item consumed
        }
      } else if (existing) {
        // Swap
        const newSlot = { type: this.heldItem.type, count: this.heldItem.count === Infinity ? 1 : this.heldItem.count };
        this.invCraftingGrid[index] = newSlot;
        this._pickUp(existing.type, existing.count, { area: 'invCrafting', index });
      } else {
        this.invCraftingGrid[index] = { type: this.heldItem.type, count: this.heldItem.count === Infinity ? 1 : this.heldItem.count };
      }
      if (!existing || existing.type === this.heldItem.type) {
        this.heldItem = null;
        this.cursorEl.style.display = 'none';
      }
    } else {
      // Pick up from 2x2 grid
      const slot = this.invCraftingGrid[index];
      if (!slot) return;
      this.invCraftingGrid[index] = null;
      this._pickUp(slot.type, slot.count, { area: 'invCrafting', index });
      this.cursorEl.style.left = e.clientX - 18 + 'px';
      this.cursorEl.style.top = e.clientY - 18 + 'px';
    }
    this._updateInvCraftingResult();
    this._refreshUI();
  }

  _onInvCraftOutputClick() {
    if (!this.invCraftingResult) return;
    if (this.heldItem) return;

    const result = this.invCraftingResult;

    // Consume one of each ingredient from 2x2 grid
    for (let i = 0; i < 4; i++) {
      const slot = this.invCraftingGrid[i];
      if (slot) {
        slot.count -= 1;
        if (slot.count <= 0) {
          this.invCraftingGrid[i] = null;
        }
      }
    }

    // Add result to inventory
    this.addBlock(result.type, result.count);

    this._updateInvCraftingResult();
    this._refreshUI();
    document.dispatchEvent(new Event('hotbar-changed'));
  }

  _updateInvCraftingResult() {
    // Embed 2x2 grid into 3x3 for recipe matching
    const g = this.invCraftingGrid;
    const grid9 = [
      g[0] ? g[0].type : 0, g[1] ? g[1].type : 0, 0,
      g[2] ? g[2].type : 0, g[3] ? g[3].type : 0, 0,
      0, 0, 0,
    ];
    this.invCraftingResult = findMatchingRecipe(grid9);
  }

  _refreshUI() {
    const isCreative = GameMode.isCreative();

    // Catalog (left)
    this.catalogGrid.innerHTML = '';
    for (const bt of CATALOG_ITEMS) {
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

    // Trash bin visibility
    this.trashEl.style.display = isCreative ? 'flex' : 'none';

    // 2x2 mini crafting grid (survival only)
    this.invCraftAreaEl.style.display = isCreative ? 'none' : 'flex';
    this.invCraftGrid.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const slot = this.invCraftingGrid[i];
      let cell;
      if (slot && slot.count > 0) {
        cell = this._makeCellWithBlock(slot.type, String(slot.count));
      } else {
        cell = this._makeEmptyCell();
      }
      cell.addEventListener('click', (e) => this._onInvCraftGridClick(i, e));
      this.invCraftGrid.appendChild(cell);
    }
    this.invCraftOutput.innerHTML = '';
    if (this.invCraftingResult) {
      const resultCell = this._makeCellWithBlock(this.invCraftingResult.type, String(this.invCraftingResult.count));
      resultCell.style.border = 'none';
      resultCell.style.background = 'none';
      this.invCraftOutput.appendChild(resultCell);
      this.invCraftOutput.style.cursor = 'pointer';
    } else {
      this.invCraftOutput.style.cursor = 'default';
    }

    // Hint
    if (this.heldItem) {
      const data = getItemOrBlockData(this.heldItem.type);
      const name = data ? data.name : '?';
      const trashHint = isCreative ? ' or trash bin to destroy' : '';
      this.hintEl.textContent = `Holding ${name} — click a slot to place${trashHint}`;
    } else {
      this.hintEl.textContent = 'Click a block to pick it up';
    }
  }
}
