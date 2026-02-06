import * as THREE from 'three';
import { CHUNK_SIZE, WORLD_HEIGHT } from './world.js';
import { BlockType, BlockData } from './blocks.js';

// Face directions: [dx, dy, dz] and corresponding face index
const FACES = [
  { dir: [0, 1, 0],  face: 0, corners: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]] },       // top
  { dir: [0, -1, 0], face: 1, corners: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]] },       // bottom
  { dir: [0, 0, 1],  face: 2, corners: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]] },       // front (south +z)
  { dir: [0, 0, -1], face: 3, corners: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]] },       // back (north -z)
  { dir: [1, 0, 0],  face: 4, corners: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]] },       // right (east +x)
  { dir: [-1, 0, 0], face: 5, corners: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]] },       // left (west -x)
];

// AO calculation for a face vertex
function vertexAO(side1, side2, corner) {
  if (side1 && side2) return 0;
  return 3 - (side1 + side2 + corner);
}

export class ChunkMesher {
  constructor(world, atlas) {
    this.world = world;
    this.atlas = atlas;
  }

  buildMesh(chunk) {
    const solid    = { pos: [], norm: [], uv: [], idx: [], col: [], vi: 0 };
    const water    = { pos: [], norm: [], uv: [], idx: [], col: [], vi: 0 };
    const glass    = { pos: [], norm: [], uv: [], idx: [], col: [], vi: 0 };

    const wx = chunk.cx * CHUNK_SIZE;
    const wz = chunk.cz * CHUNK_SIZE;

    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let y = 0; y < WORLD_HEIGHT; y++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          const blockType = chunk.blocks[(x * WORLD_HEIGHT + y) * CHUNK_SIZE + z];
          if (blockType === BlockType.AIR) continue;

          const isWater = blockType === BlockType.WATER;
          const isGlass = blockType === BlockType.GLASS;
          const isTransparent = BlockData[blockType].transparent;

          for (const { dir, face, corners } of FACES) {
            const nx = wx + x + dir[0];
            const ny = y + dir[1];
            const nz = wz + z + dir[2];

            const neighbor = this.world.getBlock(nx, ny, nz);
            const neighborData = BlockData[neighbor];
            const neighborTransparent = neighborData?.transparent ?? true;

            if (neighbor === blockType && !isWater) continue;
            if (!isTransparent && !neighborTransparent) continue;
            if (isWater && neighbor === BlockType.WATER) continue;
            if (isTransparent && !isWater && neighbor === blockType) continue;

            const [u0, v0] = this.atlas.getUV(blockType, face);
            const tileSize = this.atlas.tileSize;

            // Pick buffer
            const buf = isWater ? water : isGlass ? glass : solid;

            // AO
            const aoValues = [];
            for (const corner of corners) {
              const cx_ = wx + x + corner[0];
              const cy_ = y + corner[1];
              const cz_ = wz + z + corner[2];

              if (isWater || isGlass) {
                aoValues.push(3);
              } else {
                const s1 = this.world.isSolid(cx_ + dir[0], cy_ - (1 - Math.abs(dir[1])), cz_ + dir[2]) ? 1 : 0;
                const s2 = this.world.isSolid(cx_ - (1 - Math.abs(dir[0])), cy_ + dir[1], cz_ - (1 - Math.abs(dir[2]))) ? 1 : 0;
                const c_ = this.world.isSolid(cx_ + dir[0] - (1 - Math.abs(dir[0])), cy_ + dir[1] - (1 - Math.abs(dir[1])), cz_ + dir[2] - (1 - Math.abs(dir[2]))) ? 1 : 0;
                aoValues.push(vertexAO(s1, s2, c_));
              }
            }

            const uvCorners = [
              [u0, v0 + tileSize],
              [u0 + tileSize, v0 + tileSize],
              [u0 + tileSize, v0],
              [u0, v0],
            ];

            const tVertIdx = buf.vi;
            for (let i = 0; i < 4; i++) {
              buf.pos.push(wx + x + corners[i][0], y + corners[i][1], wz + z + corners[i][2]);
              buf.norm.push(dir[0], dir[1], dir[2]);
              buf.uv.push(uvCorners[i][0], uvCorners[i][1]);
              const ao = aoValues[i] / 3;
              const brightness = 0.5 + 0.5 * ao;
              let faceBright = 1.0;
              if (dir[1] === 1) faceBright = 1.0;
              else if (dir[1] === -1) faceBright = 0.5;
              else if (dir[2] !== 0) faceBright = 0.8;
              else faceBright = 0.6;
              const shade = brightness * faceBright;
              buf.col.push(shade, shade, shade);
            }

            if (isWater || isGlass) {
              buf.idx.push(tVertIdx, tVertIdx+1, tVertIdx+2, tVertIdx, tVertIdx+2, tVertIdx+3);
            } else {
              if (aoValues[0] + aoValues[2] > aoValues[1] + aoValues[3]) {
                buf.idx.push(tVertIdx, tVertIdx+1, tVertIdx+2, tVertIdx, tVertIdx+2, tVertIdx+3);
              } else {
                buf.idx.push(tVertIdx+1, tVertIdx+2, tVertIdx+3, tVertIdx+1, tVertIdx+3, tVertIdx);
              }
            }
            buf.vi += 4;
          }
        }
      }
    }

    // Dispose old meshes
    if (chunk.mesh) chunk.mesh.geometry.dispose();
    if (chunk.waterMesh) chunk.waterMesh.geometry.dispose();
    if (chunk.glassMesh) chunk.glassMesh.geometry.dispose();

    // Solid mesh
    chunk.mesh = this._buildGeo(solid, chunk.mesh, () => new THREE.MeshLambertMaterial({
      map: this.atlas.texture, vertexColors: true, alphaTest: 0.1, side: THREE.FrontSide,
    }));

    // Water mesh
    chunk.waterMesh = this._buildGeo(water, chunk.waterMesh, () => new THREE.MeshLambertMaterial({
      map: this.atlas.texture, vertexColors: true, transparent: true,
      opacity: 0.65, side: THREE.DoubleSide, color: new THREE.Color(0.3, 0.7, 0.95), depthWrite: false,
    }), 1);

    // Glass mesh
    chunk.glassMesh = this._buildGeo(glass, chunk.glassMesh, () => new THREE.MeshLambertMaterial({
      map: this.atlas.texture, vertexColors: true, transparent: true,
      opacity: 0.3, side: THREE.DoubleSide, depthWrite: false,
    }), 2);

    chunk.dirty = false;
  }

  _buildGeo(buf, existingMesh, createMat, renderOrder) {
    if (buf.pos.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.norm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
    geo.setIndex(buf.idx);
    if (existingMesh) {
      existingMesh.geometry = geo;
      return existingMesh;
    }
    const mesh = new THREE.Mesh(geo, createMat());
    if (renderOrder !== undefined) mesh.renderOrder = renderOrder;
    return mesh;
  }
}
