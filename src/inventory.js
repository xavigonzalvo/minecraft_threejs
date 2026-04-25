import { BlockType, BlockData } from './blocks.js';
import { GameMode } from './gamemode.js';
import {
  isItemType, getItemOrBlockData, ItemType, ItemData,
  findMatchingRecipe, recipeIngredients, canCraftRecipe, getRecipesForGrid,
} from './crafting.js';

const PLACEABLE_BLOCKS = [
  BlockType.GRASS, BlockType.DIRT, BlockType.STONE, BlockType.SAND,
  BlockType.OAK_LOG, BlockType.OAK_LEAVES, BlockType.GRAVEL,
  BlockType.COAL_ORE, BlockType.IRON_ORE, BlockType.GOLD_ORE, BlockType.COBBLESTONE,
  BlockType.OAK_PLANKS, BlockType.SNOW, BlockType.GLASS, BlockType.BRICK,
  BlockType.CRAFTING_TABLE,
];

const CATALOG_ITEMS = [
  ...PLACEABLE_BLOCKS,
  ItemType.STICK,
  ItemType.WOODEN_AXE,
];

const STORAGE_KEY = 'inventory_v3';
// Legacy keys (read for migration, then removed)
const LEGACY_HOTBAR_KEY = 'hotbar_v2';
const LEGACY_COUNTS_KEY = 'blockCounts';
const LEGACY_PERSONAL_KEY = 'personalInventory';

const HOTBAR_SLOTS = 9;
const MAIN_SLOTS = 27;
const TOTAL_SLOTS = HOTBAR_SLOTS + MAIN_SLOTS; // 36
const STACK_SIZE = 64;

// Item texture file mapping
const ITEM_TEXTURES = {
  [ItemType.STICK]: 'stick',
  [ItemType.WOODEN_AXE]: 'wooden_axe',
};

function isValidSlotType(v) {
  return v === BlockType.AIR || PLACEABLE_BLOCKS.includes(v) || isItemType(v);
}

export class Inventory {
  constructor(atlas) {
    this.atlas = atlas;
    this.selectedSlot = 0;
    // Unified inventory: slots[0..8] = hotbar, slots[9..35] = main inventory
    // Each slot is null or { type, count }
    this.slots = this._loadSlots();

    // Held item state: what the player is currently carrying on cursor
    // { type, count, source } or null
    // source: 'catalog' | { area: 'slot', index } | { area: 'crafting', index }
    //       | { area: 'invCrafting', index } | 'craftOutput'
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

  _loadSlots() {
    // Try the new unified format first
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length === TOTAL_SLOTS) {
          return arr.map(s => {
            if (!s || typeof s !== 'object') return null;
            if (!isValidSlotType(s.type) || s.type === BlockType.AIR) return null;
            const count = Number(s.count);
            if (!Number.isFinite(count) || count <= 0) return null;
            return { type: s.type, count: Math.min(count, STACK_SIZE) };
          });
        }
      }
    } catch { /* fall through */ }

    // Migrate from legacy storage (hotbar_v2 + personalInventory)
    const slots = new Array(TOTAL_SLOTS).fill(null);
    let migrated = false;
    try {
      const personalRaw = localStorage.getItem(LEGACY_PERSONAL_KEY);
      if (personalRaw) {
        const arr = JSON.parse(personalRaw);
        if (Array.isArray(arr)) {
          for (let i = 0; i < Math.min(arr.length, MAIN_SLOTS); i++) {
            const s = arr[i];
            if (s && isValidSlotType(s.type) && s.type !== BlockType.AIR) {
              const count = Number(s.count);
              if (Number.isFinite(count) && count > 0) {
                slots[HOTBAR_SLOTS + i] = { type: s.type, count: Math.min(count, STACK_SIZE) };
                migrated = true;
              }
            }
          }
        }
      }
      const hotbarRaw = localStorage.getItem(LEGACY_HOTBAR_KEY);
      if (hotbarRaw) {
        const arr = JSON.parse(hotbarRaw);
        if (Array.isArray(arr)) {
          // Move stacks of the referenced types from main into hotbar slots
          for (let i = 0; i < Math.min(arr.length, HOTBAR_SLOTS); i++) {
            const t = arr[i];
            if (t === BlockType.AIR || !isValidSlotType(t)) continue;
            // Find a stack in main of this type and move it to hotbar slot i
            for (let j = HOTBAR_SLOTS; j < TOTAL_SLOTS; j++) {
              if (slots[j] && slots[j].type === t) {
                slots[i] = slots[j];
                slots[j] = null;
                migrated = true;
                break;
              }
            }
          }
        }
      }
    } catch { /* fall through */ }

    if (migrated) {
      // Persist migration result and clean up legacy keys
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
      localStorage.removeItem(LEGACY_HOTBAR_KEY);
      localStorage.removeItem(LEGACY_COUNTS_KEY);
      localStorage.removeItem(LEGACY_PERSONAL_KEY);
    }
    return slots;
  }

  _saveSlots() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.slots));
  }

  // ── Public API (used by game systems) ──

  get hotbarBlocks() {
    // Backwards-compatible getter: array of types (AIR for empty)
    return this.slots.slice(0, HOTBAR_SLOTS).map(s => s ? s.type : BlockType.AIR);
  }

  /**
   * Add `count` of `type` to the inventory. Stacks into existing matching
   * stacks (up to STACK_SIZE) first; otherwise places into the first empty
   * slot, preferring the hotbar so newly-acquired types are quick-access.
   * Returns the number of items that did not fit.
   */
  addBlock(type, count = 1) {
    if (type === BlockType.AIR || count <= 0) return count;
    let remaining = count;

    // 1. Top up existing stacks of this type
    for (let i = 0; i < TOTAL_SLOTS && remaining > 0; i++) {
      const s = this.slots[i];
      if (s && s.type === type && s.count < STACK_SIZE) {
        const room = STACK_SIZE - s.count;
        const add = Math.min(room, remaining);
        s.count += add;
        remaining -= add;
      }
    }
    // 2. Place into empty slots (hotbar first, then main)
    for (let i = 0; i < TOTAL_SLOTS && remaining > 0; i++) {
      if (!this.slots[i]) {
        const add = Math.min(STACK_SIZE, remaining);
        this.slots[i] = { type, count: add };
        remaining -= add;
      }
    }

    this._saveSlots();
    document.dispatchEvent(new Event('hotbar-changed'));
    return remaining;
  }

  /**
   * Remove one of `type` from the inventory. Prefers the currently-selected
   * hotbar slot, then any hotbar slot of that type, then main inventory.
   * Returns true if removed.
   */
  removeBlock(type) {
    // Prefer the selected hotbar slot if it matches
    const sel = this.slots[this.selectedSlot];
    if (sel && sel.type === type) {
      sel.count -= 1;
      if (sel.count <= 0) this.slots[this.selectedSlot] = null;
      this._saveSlots();
      document.dispatchEvent(new Event('hotbar-changed'));
      return true;
    }
    // Otherwise scan hotbar then main
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const s = this.slots[i];
      if (s && s.type === type) {
        s.count -= 1;
        if (s.count <= 0) this.slots[i] = null;
        this._saveSlots();
        document.dispatchEvent(new Event('hotbar-changed'));
        return true;
      }
    }
    return false;
  }

  canPlace(type) {
    if (GameMode.isCreative()) return true;
    return this.getCount(type) > 0;
  }

  /** When switching from creative to survival, ensure all hotbar types have
   *  a stack (default 64) so the player isn't suddenly unarmed. */
  materializeCreativeBlocks() {
    let changed = false;
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const s = this.slots[i];
      if (s && (!Number.isFinite(s.count) || s.count <= 0)) {
        s.count = STACK_SIZE;
        changed = true;
      }
    }
    if (changed) {
      this._saveSlots();
      document.dispatchEvent(new Event('hotbar-changed'));
    }
  }

  getCount(type) {
    let n = 0;
    for (const s of this.slots) {
      if (s && s.type === type) n += s.count;
    }
    return n;
  }

  getHotbarBlock(slot) {
    const s = this.slots[slot];
    return s ? s.type : BlockType.AIR;
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
        this.addBlock(slot.type, slot.count);
        this.invCraftingGrid[i] = null;
      }
    }
    // If holding an item, put it back at its source
    this._cancelHeld();
    this._saveSlots();
    document.dispatchEvent(new Event('hotbar-changed'));
    this.overlay.style.display = 'none';
    document.removeEventListener('mousemove', this._onMouseMove);
  }

  // ── Cursor / held item ──

  _onMouseMove(e) {
    if (!this.heldItem) return;
    this.cursorEl.style.left = e.clientX - 18 + 'px';
    this.cursorEl.style.top = e.clientY - 18 + 'px';
  }

  _pickUp(type, count, source) {
    this.heldItem = { type, count, source };
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
    // Return item to its source. Catalog and craftOutput are virtual sources
    // (no real slot), so just discard.
    if (h.source !== 'catalog' && h.source !== 'craftOutput') {
      const stack = { type: h.type, count: h.count === Infinity ? STACK_SIZE : h.count };
      if (h.source.area === 'slot') {
        // Try to put back in the original slot; if occupied, add to inventory
        if (!this.slots[h.source.index]) {
          this.slots[h.source.index] = stack;
        } else {
          this.addBlock(stack.type, stack.count);
        }
      } else if (h.source.area === 'crafting') {
        if (!this.craftingGrid[h.source.index]) {
          this.craftingGrid[h.source.index] = stack;
        } else {
          this.addBlock(stack.type, stack.count);
        }
      } else if (h.source.area === 'invCrafting') {
        if (!this.invCraftingGrid[h.source.index]) {
          this.invCraftingGrid[h.source.index] = stack;
        } else {
          this.addBlock(stack.type, stack.count);
        }
      }
    }
    this.heldItem = null;
    this.cursorEl.style.display = 'none';
    this._saveSlots();
    document.dispatchEvent(new Event('hotbar-changed'));
  }

  // ── Click handlers ──

  _onCatalogClick(blockType, e) {
    // Catalog only exists in creative mode; ignore in survival.
    if (!GameMode.isCreative()) return;

    if (this.heldItem) {
      // Clicking catalog while holding: discard held (catalog acts as trash)
      this.heldItem = null;
      this.cursorEl.style.display = 'none';
      this._refreshUI();
      return;
    }

    // Pick up an infinite stack from the catalog
    this._pickUp(blockType, Infinity, 'catalog');
    this.cursorEl.style.left = e.clientX - 18 + 'px';
    this.cursorEl.style.top = e.clientY - 18 + 'px';
  }

  _onSlotClick(index, e) {
    if (this.heldItem) {
      this._placeIntoSlot(index);
      return;
    }
    const slot = this.slots[index];
    if (!slot) return;
    // Pick up entire stack
    this.slots[index] = null;
    this._saveSlots();
    this._pickUp(slot.type, slot.count, { area: 'slot', index });
    this.cursorEl.style.left = e.clientX - 18 + 'px';
    this.cursorEl.style.top = e.clientY - 18 + 'px';
    document.dispatchEvent(new Event('hotbar-changed'));
  }

  _placeIntoSlot(index) {
    const h = this.heldItem;
    if (!h) return;

    const existing = this.slots[index];
    const isCatalog = h.source === 'catalog';
    // For catalog (creative), Infinity becomes a STACK_SIZE drop
    const heldCount = h.count === Infinity ? STACK_SIZE : h.count;

    if (existing && existing.type === h.type) {
      // Stack same-type
      const room = STACK_SIZE - existing.count;
      const moved = Math.min(room, heldCount);
      existing.count += moved;
      const leftover = heldCount - moved;
      if (isCatalog) {
        // Held was infinite — it stays in hand if catalog
        if (h.count === Infinity) {
          // Cursor unchanged
          this._saveSlots();
          this._refreshUI();
          return;
        }
        // Non-infinite catalog drop (shouldn't happen but handle)
        if (leftover > 0) {
          this.heldItem = { ...h, count: leftover };
          this._refreshCursor();
        } else {
          this._clearHeld();
        }
      } else {
        if (leftover > 0) {
          this.heldItem = { ...h, count: leftover };
          this._refreshCursor();
        } else {
          this._clearHeld();
        }
      }
    } else if (existing) {
      // Different type — swap. Held becomes the previously-in-slot stack.
      // (For a catalog/infinite cursor, this drops the infinite-ness, matching
      // Minecraft creative: re-click the catalog to get an infinite cursor again.)
      this.slots[index] = { type: h.type, count: heldCount };
      this._pickUp(existing.type, existing.count, { area: 'slot', index });
    } else {
      // Empty target — place
      this.slots[index] = { type: h.type, count: heldCount };
      if (isCatalog && h.count === Infinity) {
        // Keep held infinite — catalog is an infinite source
        this._saveSlots();
        this._refreshUI();
        return;
      }
      this._clearHeld();
    }

    this._saveSlots();
    document.dispatchEvent(new Event('hotbar-changed'));
    this._refreshUI();
  }

  _refreshCursor() {
    const h = this.heldItem;
    this.cursorEl.innerHTML = '';
    this.cursorEl.appendChild(this._makeIconCanvas(h.type));
    if (h.count !== Infinity) {
      const badge = document.createElement('span');
      badge.className = 'inv-cell-count';
      badge.textContent = String(h.count);
      this.cursorEl.appendChild(badge);
    }
    this.cursorEl.style.display = 'block';
  }

  _clearHeld() {
    this.heldItem = null;
    this.cursorEl.style.display = 'none';
  }

  _onTrashClick() {
    if (!this.heldItem) return;
    this.heldItem = null;
    this.cursorEl.style.display = 'none';
    this._refreshUI();
    document.dispatchEvent(new Event('hotbar-changed'));
  }

  // ── Recipe book rendering ──

  _renderRecipeBook(listEl, gridArr, gridWidth, gridHeight, onAfterFill) {
    // Count inventory + whatever is currently in this grid (those items will
    // be returned to inventory before auto-fill runs).
    const counts = this._inventoryCounts();
    for (const slot of gridArr) {
      if (slot) counts.set(slot.type, (counts.get(slot.type) || 0) + slot.count);
    }
    const recipes = getRecipesForGrid(gridWidth, gridHeight);
    listEl.innerHTML = '';
    for (const recipe of recipes) {
      const item = document.createElement('div');
      item.className = 'recipe-item';
      const canCraft = canCraftRecipe(recipe, counts);
      if (!canCraft) item.classList.add('recipe-item-disabled');
      item.appendChild(this._makeIconCanvas(recipe.result.type));

      const countBadge = document.createElement('span');
      countBadge.className = 'inv-cell-count';
      countBadge.textContent = String(recipe.result.count);
      item.appendChild(countBadge);

      // Tooltip: result name + ingredients
      const tip = document.createElement('span');
      tip.className = 'recipe-tooltip';
      const resultData = getItemOrBlockData(recipe.result.type);
      const resultName = resultData ? resultData.name : '?';
      const ingredients = [];
      for (const [type, n] of recipeIngredients(recipe)) {
        const data = getItemOrBlockData(type);
        ingredients.push(`${n}× ${data ? data.name : '?'}`);
      }
      tip.textContent = `${recipe.result.count}× ${resultName}\n${ingredients.join(', ')}`;
      item.appendChild(tip);

      if (canCraft) {
        item.addEventListener('click', () => {
          const ok = this._fillRecipeIntoGrid(recipe, gridArr, gridWidth);
          if (ok && onAfterFill) onAfterFill();
        });
      }
      listEl.appendChild(item);
    }
  }

  // ── Recipe book helpers ──

  /** Snapshot of current inventory totals as Map<type, count>. */
  _inventoryCounts() {
    const m = new Map();
    for (const s of this.slots) {
      if (!s) continue;
      m.set(s.type, (m.get(s.type) || 0) + s.count);
    }
    return m;
  }

  /** Find first slot containing the given type with count >= 1. -1 if none. */
  _findSlotWithItem(type) {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s && s.type === type && s.count > 0) return i;
    }
    return -1;
  }

  /**
   * Auto-fill the given crafting grid from the player's inventory based on
   * the recipe pattern. `gridArr` must be `this.craftingGrid` (3x3) or
   * `this.invCraftingGrid` (2x2). `gridWidth` is 3 or 2 respectively.
   * No-op if the player can't afford the recipe.
   */
  _fillRecipeIntoGrid(recipe, gridArr, gridWidth) {
    // In creative, we don't actually consume ingredients normally — but the
    // crafting grid still needs items. Use the same path as survival.
    if (!canCraftRecipe(recipe, this._inventoryCounts())) return false;

    // Cancel any held item back to source first
    this._cancelHeld();

    // Return whatever is currently in the grid back to inventory
    for (let i = 0; i < gridArr.length; i++) {
      const slot = gridArr[i];
      if (slot) {
        this.addBlock(slot.type, slot.count);
        gridArr[i] = null;
      }
    }

    // Place pattern cells: top-left aligned in the grid
    for (let ry = 0; ry < recipe.height; ry++) {
      for (let rx = 0; rx < recipe.width; rx++) {
        const t = recipe.pattern[ry * recipe.width + rx];
        if (!t) continue;
        const slotIdx = this._findSlotWithItem(t);
        if (slotIdx < 0) {
          // Shouldn't happen — canCraftRecipe verified it, but be safe:
          // restore items already pulled into the grid back to inventory
          for (let j = 0; j < gridArr.length; j++) {
            if (gridArr[j]) {
              this.addBlock(gridArr[j].type, gridArr[j].count);
              gridArr[j] = null;
            }
          }
          return false;
        }
        // Pull 1 of this type out of the inventory slot
        this.slots[slotIdx].count -= 1;
        if (this.slots[slotIdx].count <= 0) this.slots[slotIdx] = null;
        gridArr[ry * gridWidth + rx] = { type: t, count: 1 };
      }
    }
    this._saveSlots();
    return true;
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

    // Left panel: All blocks catalog (creative only)
    this.leftPanel = document.createElement('div');
    this.leftPanel.className = 'inv-panel';
    const leftTitle = document.createElement('div');
    leftTitle.className = 'inv-panel-title';
    leftTitle.textContent = 'All Items';
    this.leftPanel.appendChild(leftTitle);
    this.catalogGrid = document.createElement('div');
    this.catalogGrid.className = 'inv-catalog';
    this.leftPanel.appendChild(this.catalogGrid);
    container.appendChild(this.leftPanel);

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

    // Recipe book (only 2x2-fitting recipes)
    const invRecipeBook = document.createElement('div');
    invRecipeBook.className = 'recipe-book inv-recipe-book';
    const invRbTitle = document.createElement('div');
    invRbTitle.className = 'recipe-book-title';
    invRbTitle.textContent = 'Recipes';
    invRecipeBook.appendChild(invRbTitle);
    this.invRecipeBookList = document.createElement('div');
    this.invRecipeBookList.className = 'recipe-book-list';
    invRecipeBook.appendChild(this.invRecipeBookList);
    invCraftArea.appendChild(invRecipeBook);

    this.invCraftGrid = document.createElement('div');
    this.invCraftGrid.className = 'inv-craft-grid';
    invCraftArea.appendChild(this.invCraftGrid);

    const invCraftArrow = document.createElement('div');
    invCraftArrow.className = 'inv-craft-arrow';
    invCraftArrow.textContent = '→';
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
    closeBtn.textContent = '×';
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

    const title = document.createElement('div');
    title.className = 'inv-panel-title';
    title.textContent = 'Crafting Table';
    container.appendChild(title);

    const craftArea = document.createElement('div');
    craftArea.className = 'craft-area';

    // Recipe book (left of the 3x3 grid)
    const recipeBook = document.createElement('div');
    recipeBook.className = 'recipe-book';
    const rbTitle = document.createElement('div');
    rbTitle.className = 'recipe-book-title';
    rbTitle.textContent = 'Recipes';
    recipeBook.appendChild(rbTitle);
    this.recipeBookList = document.createElement('div');
    this.recipeBookList.className = 'recipe-book-list';
    recipeBook.appendChild(this.recipeBookList);
    craftArea.appendChild(recipeBook);

    this.craftGrid = document.createElement('div');
    this.craftGrid.className = 'craft-grid';
    craftArea.appendChild(this.craftGrid);

    const arrow = document.createElement('div');
    arrow.className = 'craft-arrow';
    arrow.textContent = '→';
    craftArea.appendChild(arrow);

    this.craftOutput = document.createElement('div');
    this.craftOutput.className = 'inv-cell craft-output';
    this.craftOutput.addEventListener('click', (e) => this._onCraftingOutputClick(e));
    craftArea.appendChild(this.craftOutput);

    container.appendChild(craftArea);

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

    const closeBtn = document.createElement('div');
    closeBtn.className = 'inventory-close-btn';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => {
      document.dispatchEvent(new Event('crafting-close'));
    });
    container.appendChild(closeBtn);

    overlay.appendChild(container);

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
        this.addBlock(slot.type, slot.count);
        this.craftingGrid[i] = null;
      }
    }
    this._cancelHeld();
    document.dispatchEvent(new Event('hotbar-changed'));
    this.craftingOverlay.style.display = 'none';
    document.removeEventListener('mousemove', this._onMouseMove);
  }

  _onCraftGridClick(index, e) {
    if (this.heldItem) {
      const existing = this.craftingGrid[index];
      const h = this.heldItem;
      const heldCount = h.count === Infinity ? 1 : h.count;
      if (existing && existing.type === h.type) {
        existing.count += heldCount;
        if (h.count === Infinity) {
          // Keep cursor (catalog)
        } else {
          this._clearHeld();
        }
      } else if (existing) {
        // Swap
        this.craftingGrid[index] = { type: h.type, count: heldCount };
        if (h.count === Infinity) {
          // Catalog source can't really be "swapped into" — the existing
          // crafting slot becomes the new held stack.
          this._pickUp(existing.type, existing.count, { area: 'crafting', index });
        } else {
          this._pickUp(existing.type, existing.count, { area: 'crafting', index });
        }
      } else {
        this.craftingGrid[index] = { type: h.type, count: heldCount };
        if (h.count === Infinity) {
          // Keep cursor (catalog)
        } else {
          this._clearHeld();
        }
      }
    } else {
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
    if (this.heldItem) return;

    const result = this.craftingResult;

    // Consume one of each ingredient from grid
    for (let i = 0; i < 9; i++) {
      const slot = this.craftingGrid[i];
      if (slot) {
        slot.count -= 1;
        if (slot.count <= 0) this.craftingGrid[i] = null;
      }
    }

    this.addBlock(result.type, result.count);

    this._updateCraftingResult();
    this._refreshCraftingUI();
    document.dispatchEvent(new Event('hotbar-changed'));
  }

  _onCraftSlotClick(index, e) {
    // Slot clicks in the crafting view delegate to the unified slot handler
    this._onSlotClick(index, e);
    this._refreshCraftingUI();
  }

  _updateCraftingResult() {
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

    // Output
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

    // Player inventory in crafting view (slots 9..35)
    this.craftPersonalGrid.innerHTML = '';
    for (let i = 0; i < MAIN_SLOTS; i++) {
      const slotIdx = HOTBAR_SLOTS + i;
      const s = this.slots[slotIdx];
      let cell;
      if (s && s.count > 0) {
        cell = this._makeCellWithBlock(s.type, String(s.count));
      } else {
        cell = this._makeEmptyCell();
      }
      cell.addEventListener('click', (e) => this._onCraftSlotClick(slotIdx, e));
      this.craftPersonalGrid.appendChild(cell);
    }

    // Hotbar in crafting view (slots 0..8)
    this.craftHotbarGrid.innerHTML = '';
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const s = this.slots[i];
      let cell;
      if (s && s.count > 0) {
        cell = this._makeCellWithBlock(s.type, String(s.count));
      } else {
        cell = this._makeEmptyCell();
      }
      if (i === this.selectedSlot) {
        cell.style.borderColor = '#5f5';
        cell.style.background = '#6b8b6b';
      }
      cell.addEventListener('click', (e) => this._onCraftSlotClick(i, e));
      this.craftHotbarGrid.appendChild(cell);
    }

    // Recipe book — all recipes (3x3 grid)
    this._renderRecipeBook(this.recipeBookList, this.craftingGrid, 3, 3, () => {
      this._updateCraftingResult();
      this._refreshCraftingUI();
      document.dispatchEvent(new Event('hotbar-changed'));
    });
  }

  // ── Inventory 2x2 mini crafting ──

  _onInvCraftGridClick(index, e) {
    if (this.heldItem) {
      const existing = this.invCraftingGrid[index];
      const h = this.heldItem;
      const heldCount = h.count === Infinity ? 1 : h.count;
      if (existing && existing.type === h.type) {
        existing.count += heldCount;
        if (h.count === Infinity) {
          // catalog: keep cursor
        } else {
          this._clearHeld();
        }
      } else if (existing) {
        this.invCraftingGrid[index] = { type: h.type, count: heldCount };
        this._pickUp(existing.type, existing.count, { area: 'invCrafting', index });
      } else {
        this.invCraftingGrid[index] = { type: h.type, count: heldCount };
        if (h.count === Infinity) {
          // catalog: keep cursor
        } else {
          this._clearHeld();
        }
      }
    } else {
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

    for (let i = 0; i < 4; i++) {
      const slot = this.invCraftingGrid[i];
      if (slot) {
        slot.count -= 1;
        if (slot.count <= 0) this.invCraftingGrid[i] = null;
      }
    }

    this.addBlock(result.type, result.count);

    this._updateInvCraftingResult();
    this._refreshUI();
    document.dispatchEvent(new Event('hotbar-changed'));
  }

  _updateInvCraftingResult() {
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

    // Catalog (left) — only visible in creative
    this.leftPanel.style.display = isCreative ? 'flex' : 'none';
    if (isCreative) {
      this.catalogGrid.innerHTML = '';
      for (const bt of CATALOG_ITEMS) {
        const cell = this._makeCellWithBlock(bt, '∞');
        cell.addEventListener('click', (e) => this._onCatalogClick(bt, e));
        this.catalogGrid.appendChild(cell);
      }
    }

    // Main inventory (slots 9..35)
    this.mainGrid.innerHTML = '';
    for (let i = 0; i < MAIN_SLOTS; i++) {
      const slotIdx = HOTBAR_SLOTS + i;
      const s = this.slots[slotIdx];
      let cell;
      if (s && s.count > 0) {
        cell = this._makeCellWithBlock(s.type, String(s.count));
      } else {
        cell = this._makeEmptyCell();
      }
      cell.addEventListener('click', (e) => this._onSlotClick(slotIdx, e));
      this.mainGrid.appendChild(cell);
    }

    // Hotbar (slots 0..8)
    this.hotbarGrid.innerHTML = '';
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const s = this.slots[i];
      let cell;
      if (s && s.count > 0) {
        cell = this._makeCellWithBlock(s.type, String(s.count));
      } else {
        cell = this._makeEmptyCell();
      }
      if (i === this.selectedSlot) {
        cell.style.borderColor = '#5f5';
        cell.style.background = '#6b8b6b';
      }
      cell.addEventListener('click', (e) => this._onSlotClick(i, e));
      this.hotbarGrid.appendChild(cell);
    }

    // Trash bin visibility (creative only)
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

    // Recipe book — only 2x2-fitting recipes (survival only, alongside the 2x2 grid)
    if (!isCreative) {
      this._renderRecipeBook(this.invRecipeBookList, this.invCraftingGrid, 2, 2, () => {
        this._updateInvCraftingResult();
        this._refreshUI();
        document.dispatchEvent(new Event('hotbar-changed'));
      });
    }

    // Hint
    if (this.heldItem) {
      const data = getItemOrBlockData(this.heldItem.type);
      const name = data ? data.name : '?';
      const trashHint = isCreative ? ' or trash bin to destroy' : '';
      this.hintEl.textContent = `Holding ${name} — click a slot to place${trashHint}`;
    } else {
      this.hintEl.textContent = isCreative
        ? 'Click a block to pick it up'
        : 'Click a slot to pick up its stack';
    }
  }
}
