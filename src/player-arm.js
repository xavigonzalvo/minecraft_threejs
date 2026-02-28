import * as THREE from 'three';

// Item type constants (mirrored from crafting.js to avoid circular deps)
const ITEM_STICK = 1000;
const ITEM_WOODEN_AXE = 1001;

// Texture paths for voxel-based tool rendering
const ITEM_TEXTURES = {
  [ITEM_WOODEN_AXE]: '/textures/wooden_axe.png',
  [ITEM_STICK]: '/textures/stick.png',
};

// Cache for loaded voxel meshes (shared across instances)
const _voxelMeshCache = {};

/**
 * Build a 3D voxel model from a 16x16 item texture, like Minecraft's
 * held-item rendering. Each opaque pixel becomes a tiny cube with the
 * exact colour from the sprite. All cubes are merged into a single
 * BufferGeometry for performance.
 */
function buildVoxelMeshFromImage(img) {
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, size, size);
  const imageData = ctx.getImageData(0, 0, size, size);
  const pixels = imageData.data;

  const pxSize = 1 / size; // Each pixel = 1/16 of a unit
  const depth = pxSize;    // Thin slab depth

  // Collect per-pixel data
  const voxels = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const a = pixels[i + 3];
      if (a < 128) continue; // Skip transparent pixels

      const r = pixels[i] / 255;
      const g = pixels[i + 1] / 255;
      const b = pixels[i + 2] / 255;

      // Position: origin at centre of the 16x16 grid, Y-up, flip Y
      const px = (x - size / 2 + 0.5) * pxSize;
      const py = (size / 2 - y - 0.5) * pxSize;
      const pz = 0;

      voxels.push({ x: px, y: py, z: pz, r, g, b });
    }
  }

  // Build merged geometry — 6 faces x 2 tris x 3 verts = 36 verts per voxel
  const vertCount = voxels.length * 36;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);

  // Unit cube face definitions (position offsets + normal)
  const h = pxSize / 2;
  const d = depth / 2;
  const faces = [
    // Front (+Z)
    { n: [0, 0, 1], verts: [[-h, -h, d], [h, -h, d], [h, h, d], [-h, -h, d], [h, h, d], [-h, h, d]], shade: 1.0 },
    // Back (-Z)
    { n: [0, 0, -1], verts: [[h, -h, -d], [-h, -h, -d], [-h, h, -d], [h, -h, -d], [-h, h, -d], [h, h, -d]], shade: 1.0 },
    // Top (+Y)
    { n: [0, 1, 0], verts: [[-h, h, -d], [h, h, -d], [h, h, d], [-h, h, -d], [h, h, d], [-h, h, d]], shade: 0.95 },
    // Bottom (-Y)
    { n: [0, -1, 0], verts: [[-h, -h, d], [h, -h, d], [h, -h, -d], [-h, -h, d], [h, -h, -d], [-h, -h, -d]], shade: 0.85 },
    // Right (+X)
    { n: [1, 0, 0], verts: [[h, -h, d], [h, -h, -d], [h, h, -d], [h, -h, d], [h, h, -d], [h, h, d]], shade: 0.9 },
    // Left (-X)
    { n: [-1, 0, 0], verts: [[-h, -h, -d], [-h, -h, d], [-h, h, d], [-h, -h, -d], [-h, h, d], [-h, h, -d]], shade: 0.9 },
  ];

  let vi = 0;
  for (const voxel of voxels) {
    for (const face of faces) {
      for (const vert of face.verts) {
        positions[vi * 3] = voxel.x + vert[0];
        positions[vi * 3 + 1] = voxel.y + vert[1];
        positions[vi * 3 + 2] = voxel.z + vert[2];
        normals[vi * 3] = face.n[0];
        normals[vi * 3 + 1] = face.n[1];
        normals[vi * 3 + 2] = face.n[2];
        colors[vi * 3] = voxel.r * face.shade;
        colors[vi * 3 + 1] = voxel.g * face.shade;
        colors[vi * 3 + 2] = voxel.b * face.shade;
        vi++;
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  return new THREE.Mesh(geo, mat);
}

/**
 * Load a texture and return a promise that resolves with the voxel Mesh.
 * Results are cached so the image is only decoded once.
 */
function loadVoxelTool(itemType) {
  if (_voxelMeshCache[itemType]) {
    return Promise.resolve(_voxelMeshCache[itemType].clone());
  }
  const src = ITEM_TEXTURES[itemType];
  if (!src) return Promise.resolve(null);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const mesh = buildVoxelMeshFromImage(img);
      _voxelMeshCache[itemType] = mesh;
      resolve(mesh.clone());
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export class PlayerArm {
  constructor(camera) {
    this.group = new THREE.Group();

    const skinMat = new THREE.MeshLambertMaterial({ color: 0xc49a6c });

    // Forearm
    const armGeo = new THREE.BoxGeometry(0.1, 0.35, 0.1);
    this.arm = new THREE.Mesh(armGeo, skinMat);

    // Hand — sits at bottom of arm
    const handGeo = new THREE.BoxGeometry(0.1, 0.08, 0.12);
    this.hand = new THREE.Mesh(handGeo, skinMat);
    this.hand.position.set(0, -0.215, 0.01);

    // 3D tool model held in the hand
    this.toolMesh = null;
    this._currentToolType = null;

    this.group.add(this.arm);
    this.group.add(this.hand);

    // Position in lower-right of view, beyond near plane
    this.group.position.set(0.32, -0.38, -0.45);
    // Natural angle
    this.group.rotation.set(-0.15, -0.1, 0.05);

    camera.add(this.group);

    this._bobTime = 0;
    this._swingTime = 0;  // 0 = idle, >0 = swinging
    this._swingDuration = 0.25;
    this._baseRotX = -0.15;
    this._baseRotY = -0.1;
    this._baseRotZ = 0.05;

    document.addEventListener('block-break', () => this.swing());
  }

  swing() {
    this._swingTime = this._swingDuration;
  }

  setTool(itemType) {
    // Remove old tool mesh if any
    if (this.toolMesh) {
      this.group.remove(this.toolMesh);
      this.toolMesh.traverse(child => {
        if (child.isMesh) {
          child.geometry.dispose();
          child.material.dispose();
        }
      });
      this.toolMesh = null;
    }
    this._currentToolType = itemType;

    if (!itemType) return;

    // Load the voxel model from the item's texture
    loadVoxelTool(itemType).then(mesh => {
      // Guard: tool may have changed while loading
      if (this._currentToolType !== itemType || !mesh) return;

      const toolGroup = new THREE.Group();
      toolGroup.add(mesh);

      // Scale up — the voxel model is 1 unit wide, we want ~0.45 in view
      const toolScale = 0.5;
      toolGroup.scale.set(toolScale, toolScale, toolScale);

      // Position & rotate like Minecraft first-person held item
      // Tilted diagonally, extending up-right from the hand
      toolGroup.position.set(-0.01, 0.04, -0.06);
      toolGroup.rotation.set(-0.3, 0.2, 0.65);

      this.toolMesh = toolGroup;
      this.group.add(toolGroup);
    });
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  update(dt, player) {
    const speed = Math.sqrt(
      player.velocity.x * player.velocity.x +
      player.velocity.z * player.velocity.z
    );
    const isWalking = speed > 0.5;

    const bobSpeed = isWalking ? 8 : 1.5;
    const bobAmount = isWalking ? 0.015 : 0.005;

    this._bobTime += dt * bobSpeed;

    this.group.position.y = -0.38 + Math.sin(this._bobTime) * bobAmount;
    this.group.position.x = 0.32 + Math.cos(this._bobTime * 0.5) * bobAmount * 0.5;

    // Swing animation
    if (this._swingTime > 0) {
      this._swingTime = Math.max(0, this._swingTime - dt);
      // t goes 1→0 over the swing duration
      const t = this._swingTime / this._swingDuration;
      // Quick arc: peaks at t=0.5, returns to rest at t=0
      const swing = Math.sin(t * Math.PI);
      this.group.rotation.x = this._baseRotX - swing * 0.8;
      this.group.rotation.z = this._baseRotZ + swing * 0.3;
      this.group.position.z = -0.45 + swing * 0.08;
    } else {
      this.group.rotation.set(this._baseRotX, this._baseRotY, this._baseRotZ);
      this.group.position.z = -0.45;
    }
  }

  dispose() {
    this.arm.geometry.dispose();
    this.hand.geometry.dispose();
    this.arm.material.dispose();
    if (this.toolMesh) {
      this.toolMesh.traverse(child => {
        if (child.isMesh) {
          child.geometry.dispose();
          child.material.dispose();
        }
      });
    }
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
