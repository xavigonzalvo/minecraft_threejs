import * as THREE from 'three';
import { BlockData } from './blocks.js';
import { GameMode } from './gamemode.js';

const GRAVITY = 20;
const PICKUP_RADIUS = 1.5;
const DESPAWN_TIME = 60;
const ITEM_SIZE = 0.3;
const BOB_SPEED = 2.5;
const BOB_HEIGHT = 0.1;
const SPIN_SPEED = 2.0;

class DroppedItem {
  constructor(x, y, z, blockType, mesh) {
    this.position = new THREE.Vector3(x, y, z);
    this.velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      4 + Math.random() * 2,
      (Math.random() - 0.5) * 2
    );
    this.blockType = blockType;
    this.mesh = mesh;
    this.age = 0;
    this.onGround = false;
    this.bobPhase = Math.random() * Math.PI * 2;
  }

  update(dt, world) {
    this.age += dt;

    if (!this.onGround) {
      this.velocity.y -= GRAVITY * dt;
      this.position.x += this.velocity.x * dt;
      this.position.y += this.velocity.y * dt;
      this.position.z += this.velocity.z * dt;

      // Ground collision
      const bx = Math.floor(this.position.x);
      const by = Math.floor(this.position.y - 0.1);
      const bz = Math.floor(this.position.z);
      const below = world.getBlock(bx, by, bz);
      if (below !== undefined && BlockData[below]?.solid) {
        this.position.y = by + 1 + 0.15;
        this.velocity.set(0, 0, 0);
        this.onGround = true;
      }

      // Prevent falling into void forever
      if (this.position.y < -10) {
        this.age = DESPAWN_TIME;
      }
    } else {
      // Bobbing animation
      this.bobPhase += BOB_SPEED * dt;
      const bobOffset = Math.sin(this.bobPhase) * BOB_HEIGHT;
      this.mesh.position.y = this.position.y + bobOffset;
    }

    // Spinning
    this.mesh.material.rotation += SPIN_SPEED * dt;

    // Update mesh position
    this.mesh.position.x = this.position.x;
    if (!this.onGround) {
      this.mesh.position.y = this.position.y;
    }
    this.mesh.position.z = this.position.z;
  }
}

export class ItemManager {
  constructor(scene, world, atlas, inventory) {
    this.scene = scene;
    this.world = world;
    this.atlas = atlas;
    this.inventory = inventory;
    this.items = [];
    this._materialCache = new Map();
  }

  _getMaterial(blockType) {
    if (this._materialCache.has(blockType)) {
      return this._materialCache.get(blockType).clone();
    }

    // Extract block face texture from atlas (side face)
    const [u, v] = this.atlas.getUV(blockType, 2);
    const srcX = Math.floor(u * this.atlas.canvas.width);
    const srcY = Math.floor(v * this.atlas.canvas.height);
    const srcSize = Math.floor(this.atlas.tileSize * this.atlas.canvas.width);

    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.atlas.canvas, srcX, srcY, srcSize, srcSize, 0, 0, 16, 16);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;

    const material = new THREE.SpriteMaterial({ map: texture });
    this._materialCache.set(blockType, material);
    return material.clone();
  }

  spawnItem(x, y, z, blockType) {
    const material = this._getMaterial(blockType);
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(ITEM_SIZE, ITEM_SIZE, ITEM_SIZE);

    this.scene.add(sprite);

    const item = new DroppedItem(x + 0.5, y + 0.5, z + 0.5, blockType, sprite);
    this.items.push(item);
  }

  update(dt, player) {
    const playerPos = player.position;

    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      item.update(dt, this.world);

      // Check pickup
      const dx = item.position.x - playerPos.x;
      const dy = item.position.y - (playerPos.y - 0.8);
      const dz = item.position.z - playerPos.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq < PICKUP_RADIUS * PICKUP_RADIUS) {
        if (GameMode.isSurvival()) {
          this.inventory.addBlock(item.blockType);
        }
        document.dispatchEvent(new CustomEvent('item-pickup', { detail: { blockType: item.blockType } }));
        this.scene.remove(item.mesh);
        item.mesh.material.dispose();
        this.items.splice(i, 1);
        continue;
      }

      // Despawn expired items
      if (item.age >= DESPAWN_TIME) {
        this.scene.remove(item.mesh);
        item.mesh.material.dispose();
        this.items.splice(i, 1);
      }
    }
  }
}
