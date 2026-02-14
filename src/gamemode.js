// Game mode singleton — 'creative' or 'survival'

const STORAGE_KEY = 'gameMode';

let currentMode = localStorage.getItem(STORAGE_KEY) || 'creative';

export const GameMode = {
  get current() { return currentMode; },

  isSurvival() { return currentMode === 'survival'; },
  isCreative() { return currentMode === 'creative'; },

  toggle() {
    currentMode = currentMode === 'creative' ? 'survival' : 'creative';
    localStorage.setItem(STORAGE_KEY, currentMode);
    document.dispatchEvent(new CustomEvent('gamemode-change', { detail: { mode: currentMode } }));
    return currentMode;
  },

  set(mode) {
    if (mode !== 'creative' && mode !== 'survival') return;
    currentMode = mode;
    localStorage.setItem(STORAGE_KEY, currentMode);
    document.dispatchEvent(new CustomEvent('gamemode-change', { detail: { mode: currentMode } }));
  },
};
