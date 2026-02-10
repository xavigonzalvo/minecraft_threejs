# Minecraft Three.js

A Minecraft-like voxel game built with Three.js.

## Development

```bash
npm install
npm run dev
```

This starts a Vite dev server with hot reload at `http://localhost:5173`.

To build for production:

```bash
npm run build
npm run preview
```

## Textures

All block textures are individual **16x16 PNG files** located in `public/textures/`. You can edit them with any image editor (Aseprite, Photoshop, GIMP, Pixelorama, etc.).

### Texture files

| File | Block / Face |
|------|-------------|
| `grass_top.png` | Grass (top) |
| `grass_side.png` | Grass (sides) |
| `dirt.png` | Dirt (all faces), Grass (bottom) |
| `stone.png` | Stone |
| `sand.png` | Sand |
| `water.png` | Water |
| `oak_log_side.png` | Oak Log (sides) |
| `oak_log_top.png` | Oak Log (top and bottom) |
| `oak_leaves.png` | Oak Leaves |
| `bedrock.png` | Bedrock |
| `gravel.png` | Gravel |
| `coal_ore.png` | Coal Ore |
| `iron_ore.png` | Iron Ore |
| `cobblestone.png` | Cobblestone |
| `oak_planks.png` | Oak Planks |
| `snow.png` | Snow |
| `glass.png` | Glass |
| `brick.png` | Brick |

### Editing textures

1. Open any PNG file from `public/textures/` in your image editor
2. Edit the 16x16 pixel image
3. Save the file
4. Refresh the browser to see changes

Textures must remain **16x16 pixels, RGBA PNG** format. The game uses nearest-neighbor filtering so each pixel renders as a sharp block.

### Adding a new block texture

1. Create a 16x16 PNG and save it to `public/textures/your_texture.png`
2. In `src/blocks.js`, add the block type to `BlockType`, `BlockData`, and `TEXTURE_FILES`:
   ```js
   // TEXTURE_FILES
   [BlockType.YOUR_BLOCK]: { all: 'your_texture' },
   // or for different faces:
   [BlockType.YOUR_BLOCK]: { top: 'your_top', bottom: 'your_bottom', side: 'your_side' },
   ```

### Regenerating default textures

The original procedural textures can be regenerated at any time:

```bash
node scripts/export-textures.mjs
```

This overwrites all PNGs in `public/textures/` with the defaults.
