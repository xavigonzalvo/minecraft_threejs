import { BlockType, BlockData } from './blocks.js';

// Item types start at 1000 to avoid collision with BlockType
export const ItemType = {
  STICK: 1000,
  WOODEN_AXE: 1001,
};

export const ItemData = {
  [ItemType.STICK]: {
    name: 'Stick',
    stackable: true,
    maxStack: 64,
  },
  [ItemType.WOODEN_AXE]: {
    name: 'Wooden Axe',
    stackable: false,
    maxStack: 1,
    toolType: 'axe',
    miningMultiplier: 2.0,
    effectiveOn: [BlockType.OAK_LOG, BlockType.OAK_PLANKS, BlockType.CRAFTING_TABLE],
  },
};

export function isItemType(id) {
  return id >= 1000;
}

export function getItemOrBlockData(id) {
  return isItemType(id) ? ItemData[id] : BlockData[id];
}

// Shaped crafting recipes
// pattern: row-major array of size width*height, 0 = empty slot
export const CraftingRecipes = [
  // 1 oak log → 4 oak planks
  {
    width: 1, height: 1,
    pattern: [BlockType.OAK_LOG],
    result: { type: BlockType.OAK_PLANKS, count: 4 },
  },
  // 4 planks in 2x2 → crafting table
  {
    width: 2, height: 2,
    pattern: [
      BlockType.OAK_PLANKS, BlockType.OAK_PLANKS,
      BlockType.OAK_PLANKS, BlockType.OAK_PLANKS,
    ],
    result: { type: BlockType.CRAFTING_TABLE, count: 1 },
  },
  // 2 planks vertically → 4 sticks
  {
    width: 1, height: 2,
    pattern: [BlockType.OAK_PLANKS, BlockType.OAK_PLANKS],
    result: { type: ItemType.STICK, count: 4 },
  },
  // Wooden axe
  {
    width: 2, height: 3,
    pattern: [
      BlockType.OAK_PLANKS, BlockType.OAK_PLANKS,
      BlockType.OAK_PLANKS, ItemType.STICK,
      0,                    ItemType.STICK,
    ],
    result: { type: ItemType.WOODEN_AXE, count: 1 },
  },
];

/**
 * Check if recipe matches at a given offset in the 3x3 grid.
 * grid is a flat array of length 9 (row-major 3x3), 0 = empty.
 */
function matchesAt(recipe, grid, offX, offY, mirror) {
  for (let ry = 0; ry < recipe.height; ry++) {
    for (let rx = 0; rx < recipe.width; rx++) {
      const gx = mirror ? offX + (recipe.width - 1 - rx) : offX + rx;
      const gy = offY + ry;
      const gridVal = grid[gy * 3 + gx] || 0;
      const patVal = recipe.pattern[ry * recipe.width + rx] || 0;
      if (gridVal !== patVal) return false;
    }
  }
  // Ensure all other grid cells are empty
  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 3; gx++) {
      const val = grid[gy * 3 + gx] || 0;
      if (val === 0) continue;
      if (gx >= offX && gx < offX + recipe.width && gy >= offY && gy < offY + recipe.height) {
        continue; // within recipe bounds, already checked
      }
      return false; // extra item outside recipe area
    }
  }
  return true;
}

/**
 * Find a matching recipe for the given 3x3 grid.
 * Returns { type, count } or null.
 */
export function findMatchingRecipe(grid) {
  for (const recipe of CraftingRecipes) {
    // Try all valid offsets
    for (let offY = 0; offY <= 3 - recipe.height; offY++) {
      for (let offX = 0; offX <= 3 - recipe.width; offX++) {
        if (matchesAt(recipe, grid, offX, offY, false)) {
          return recipe.result;
        }
        // Try mirrored
        if (recipe.width > 1 && matchesAt(recipe, grid, offX, offY, true)) {
          return recipe.result;
        }
      }
    }
  }
  return null;
}
