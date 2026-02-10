import * as THREE from 'three';
import { World, CHUNK_SIZE } from './world.js';
import { TextureAtlas } from './blocks.js';
import { ChunkMesher } from './chunkmesher.js';
import { Player } from './player.js';
import { Interaction } from './interaction.js';
import { Sky } from './sky.js';
import { UI } from './ui.js';
import { Menu } from './menu.js';
import { TouchControls } from './touch.js';

// ── Configuration ──
const RENDER_DISTANCE = 8; // chunks in each direction
const SEED = Math.floor(Math.random() * 999999);

// ── Three.js Setup ──
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x88bbff);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Prevent context menu on right click
document.addEventListener('contextmenu', (e) => e.preventDefault());

// ── Initialize Systems ──
const atlas = new TextureAtlas();
const world = new World(SEED);
let mesher;
const player = new Player(camera, world, renderer.domElement);
const sky = new Sky(scene);

// Track loaded chunk meshes
const loadedChunks = new Map();

function rebuildDirtyChunks() {
  for (const [key, chunk] of world.chunks) {
    if (!chunk.dirty) continue;
    mesher.buildMesh(chunk);

    const prevEntry = loadedChunks.get(key);
    if (prevEntry) {
      if (prevEntry.mesh) scene.remove(prevEntry.mesh);
      if (prevEntry.waterMesh) scene.remove(prevEntry.waterMesh);
      if (prevEntry.glassMesh) scene.remove(prevEntry.glassMesh);
    }

    if (chunk.mesh) scene.add(chunk.mesh);
    if (chunk.waterMesh) scene.add(chunk.waterMesh);
    if (chunk.glassMesh) scene.add(chunk.glassMesh);
    loadedChunks.set(key, { mesh: chunk.mesh, waterMesh: chunk.waterMesh, glassMesh: chunk.glassMesh });
  }
}

function loadChunksAroundPlayer() {
  const px = Math.floor(player.position.x / CHUNK_SIZE);
  const pz = Math.floor(player.position.z / CHUNK_SIZE);

  const needed = new Set();

  for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
    for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
      if (dx * dx + dz * dz > RENDER_DISTANCE * RENDER_DISTANCE) continue;
      const cx = px + dx;
      const cz = pz + dz;
      const key = `${cx},${cz}`;
      needed.add(key);

      if (!world.chunks.has(key)) {
        world.generateChunk(cx, cz);
      }
    }
  }

  // Place villages in newly loaded areas
  world.placeVillagesNear(px, pz);

  // Unload distant chunks
  for (const [key, entry] of loadedChunks) {
    if (!needed.has(key)) {
      if (entry.mesh) scene.remove(entry.mesh);
      if (entry.waterMesh) scene.remove(entry.waterMesh);
      if (entry.glassMesh) scene.remove(entry.glassMesh);
      loadedChunks.delete(key);
      const chunk = world.chunks.get(key);
      if (chunk) {
        if (chunk.mesh) { chunk.mesh.geometry.dispose(); chunk.mesh = null; }
        if (chunk.waterMesh) { chunk.waterMesh.geometry.dispose(); chunk.waterMesh = null; }
        if (chunk.glassMesh) { chunk.glassMesh.geometry.dispose(); chunk.glassMesh = null; }
      }
      world.chunks.delete(key);
    }
  }

  rebuildDirtyChunks();
}

// ── Initial World Load ──
async function init() {
  const loadingEl = document.getElementById('loading');
  const progressEl = document.getElementById('load-progress');

  // Load textures from PNG files
  await atlas.load();
  mesher = new ChunkMesher(world, atlas);

  // Generate initial chunks with loading progress
  const initialRadius = 5;
  const chunkList = [];
  for (let dx = -initialRadius; dx <= initialRadius; dx++) {
    for (let dz = -initialRadius; dz <= initialRadius; dz++) {
      if (dx * dx + dz * dz <= initialRadius * initialRadius) {
        chunkList.push([dx, dz]);
      }
    }
  }

  let loaded = 0;
  const total = chunkList.length;

  for (const [cx, cz] of chunkList) {
    world.generateChunk(cx, cz);
    loaded++;
    progressEl.style.width = `${(loaded / total) * 100}%`;
    // Yield to update UI
    if (loaded % 5 === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // Place villages in the initial loaded area
  world.placeVillagesNear(0, 0);

  // Fill any air gaps adjacent to water bodies
  world.seedInitialWaterFlow();

  rebuildDirtyChunks();

  // Spawn player
  const spawn = world.getSpawnPoint();
  player.spawn(spawn);

  // Setup interaction after world is loaded
  const interaction = new Interaction(player, world, scene, () => {
    rebuildDirtyChunks();
  });

  // Show title screen
  const menu = new Menu(renderer.domElement, player);
  menu.setState('title');

  const ui = new UI(atlas);

  // Touch controls
  let touchControls = null;
  if (TouchControls.isTouchDevice()) {
    touchControls = new TouchControls(player, interaction, renderer.domElement);

    document.addEventListener('game-state-change', (e) => {
      if (e.detail.state === 'playing') {
        touchControls.show();
        // Request fullscreen + lock to landscape
        if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().then(() => {
            screen.orientation?.lock?.('landscape').catch(() => {});
          }).catch(() => {});
        }
      } else {
        touchControls.hide();
      }
    });

    renderer.domElement.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    renderer.domElement.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  }

  // ── Game Loop ──
  let lastTime = performance.now();
  let chunkUpdateTimer = 0;

  function gameLoop(now) {
    requestAnimationFrame(gameLoop);

    const dt = (now - lastTime) / 1000;
    lastTime = now;

    // Update systems
    if (touchControls) touchControls.update(dt);
    player.update(dt);
    interaction.update(dt);
    if (world.updateWater(dt)) {
      rebuildDirtyChunks();
    }
    sky.update(dt, player.position);
    ui.update(dt, player, world, loadedChunks.size);

    // Underwater effect: blue fog when head is submerged
    if (player.headInWater) {
      scene.fog = new THREE.FogExp2(0x1a3c5a, 0.06);
      renderer.setClearColor(0x1a3c5a);
    } else {
      scene.fog = new THREE.FogExp2(sky.scene.fog?.color || 0x88bbff, 0.005);
      renderer.setClearColor(0x88bbff);
    }

    // Periodically load/unload chunks
    chunkUpdateTimer += dt;
    if (chunkUpdateTimer > 0.5) {
      chunkUpdateTimer = 0;
      loadChunksAroundPlayer();
    }

    renderer.render(scene, camera);
  }

  requestAnimationFrame(gameLoop);
}

init();
