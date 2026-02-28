const DB_NAME = 'minecraft_world';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('chunks')) {
        db.createObjectStore('chunks');
      }
      if (!db.objectStoreNames.contains('mobs')) {
        db.createObjectStore('mobs', { autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function hasSavedWorld() {
  return localStorage.getItem('world_seed') !== null;
}

export async function saveWorld(world, player, mobManager) {
  const db = await openDB();

  // Save chunks
  const tx = db.transaction('chunks', 'readwrite');
  const store = tx.objectStore('chunks');
  store.clear();
  for (const [key, chunk] of world.chunks) {
    store.put(chunk.blocks, key);
  }
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });

  // Save mobs
  const mobTx = db.transaction('mobs', 'readwrite');
  const mobStore = mobTx.objectStore('mobs');
  mobStore.clear();
  if (mobManager) {
    const mobData = mobManager.serialize();
    for (const mob of mobData) {
      mobStore.put(mob);
    }
  }
  await new Promise((resolve, reject) => {
    mobTx.oncomplete = resolve;
    mobTx.onerror = () => reject(mobTx.error);
  });

  // Save metadata to localStorage
  localStorage.setItem('world_seed', String(world.seed));

  const state = player.getState();
  localStorage.setItem('player_pos', JSON.stringify(state.position));
  localStorage.setItem('player_rot', JSON.stringify({ yaw: state.yaw, pitch: state.pitch }));
  localStorage.setItem('player_health', String(state.health));
  localStorage.setItem('player_flying', String(state.flying));

  // Save placed villages set
  localStorage.setItem('placedVillages', JSON.stringify([...world.placedVillages]));

  db.close();
}

export async function loadWorld(world) {
  const db = await openDB();

  // Load chunks
  const tx = db.transaction('chunks', 'readonly');
  const store = tx.objectStore('chunks');
  const allKeys = await new Promise((resolve, reject) => {
    const req = store.getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const allValues = await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  for (let i = 0; i < allKeys.length; i++) {
    const key = allKeys[i];
    const blocks = allValues[i];
    const [cx, cz] = key.split(',').map(Number);
    world.loadChunkFromData(cx, cz, new Uint8Array(blocks));
  }

  // Load mobs
  const mobTx = db.transaction('mobs', 'readonly');
  const mobStore = mobTx.objectStore('mobs');
  const mobData = await new Promise((resolve, reject) => {
    const req = mobStore.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  // Load player state
  const playerState = {};
  const posStr = localStorage.getItem('player_pos');
  if (posStr) playerState.position = JSON.parse(posStr);
  const rotStr = localStorage.getItem('player_rot');
  if (rotStr) {
    const rot = JSON.parse(rotStr);
    playerState.yaw = rot.yaw;
    playerState.pitch = rot.pitch;
  }
  const healthStr = localStorage.getItem('player_health');
  if (healthStr) playerState.health = Number(healthStr);
  const flyingStr = localStorage.getItem('player_flying');
  if (flyingStr) playerState.flying = flyingStr === 'true';

  // Restore placed villages
  const villagesStr = localStorage.getItem('placedVillages');
  if (villagesStr) {
    const villages = JSON.parse(villagesStr);
    for (const v of villages) world.placedVillages.add(v);
  }

  db.close();

  return { playerState, mobData };
}

export async function deleteWorld() {
  // Clear IndexedDB
  const db = await openDB();
  const tx = db.transaction(['chunks', 'mobs'], 'readwrite');
  tx.objectStore('chunks').clear();
  tx.objectStore('mobs').clear();
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();

  // Clear localStorage keys
  localStorage.removeItem('world_seed');
  localStorage.removeItem('player_pos');
  localStorage.removeItem('player_rot');
  localStorage.removeItem('player_health');
  localStorage.removeItem('player_flying');
  localStorage.removeItem('placedVillages');
  localStorage.removeItem('hotbar_v2');
  localStorage.removeItem('blockCounts');
  localStorage.removeItem('personalInventory');
}
