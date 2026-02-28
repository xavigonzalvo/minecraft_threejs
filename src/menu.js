export class Menu {
  constructor(canvas, player) {
    this.canvas = canvas;
    this.player = player;
    this.state = 'loading';
    this.isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this._inventoryRequested = false;

    this.titleScreen = document.getElementById('title-screen');
    this.pauseMenu = document.getElementById('pause-menu');
    this.settingsMenu = document.getElementById('settings-menu');
    this.loadingScreen = document.getElementById('loading');
    this._settingsFrom = null; // tracks where settings was opened from

    // Button handlers
    document.getElementById('btn-play').addEventListener('click', () => {
      this._requestPlayState();
    });
    document.getElementById('btn-resume').addEventListener('click', () => {
      this._requestPlayState();
    });
    document.getElementById('btn-back-to-title').addEventListener('click', () => {
      this.setState('title');
    });
    document.getElementById('btn-new-world').addEventListener('click', () => {
      document.dispatchEvent(new Event('new-world'));
    });

    // Texture Editor from title screen
    document.getElementById('btn-edit-textures-title').addEventListener('click', () => {
      document.dispatchEvent(new Event('open-texture-editor'));
    });

    // Settings buttons
    document.getElementById('btn-settings-title').addEventListener('click', () => {
      this._settingsFrom = 'title';
      this.setState('settings');
    });
    document.getElementById('btn-settings-pause').addEventListener('click', () => {
      this._settingsFrom = 'paused';
      this.setState('settings');
    });
    document.getElementById('btn-settings-back').addEventListener('click', () => {
      this.setState(this._settingsFrom || 'title');
    });

    // Pointer lock change: if lock lost while playing, transition to paused
    document.addEventListener('pointerlockchange', () => {
      if (this.isTouch) return;
      const locked = document.pointerLockElement === this.canvas;
      if (locked && (this.state === 'title' || this.state === 'paused' || this.state === 'inventory' || this.state === 'crafting')) {
        this.setState('playing');
      } else if (!locked && this.state === 'playing') {
        if (this._inventoryRequested) {
          this._inventoryRequested = false;
          this.setState('inventory');
        } else if (this._craftingRequested) {
          this._craftingRequested = false;
          this.setState('crafting');
        } else {
          this.setState('paused');
        }
      }
    });

    // Touch pause event from touch controls
    document.addEventListener('touch-pause', () => {
      if (this.isTouch && this.state === 'playing') {
        this.player.active = false;
        this.setState('paused');
      }
    });

    // E key: toggle inventory
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyE') {
        if (this.state === 'playing') {
          this.openInventory();
        } else if (this.state === 'inventory') {
          document.dispatchEvent(new CustomEvent('inventory-close'));
        }
      }
      // ESC while in inventory → go to paused
      if (e.code === 'Escape' && this.state === 'inventory') {
        document.dispatchEvent(new CustomEvent('inventory-close'));
        // After closing inventory, go to paused instead of playing
        this._pauseAfterInventory = true;
      }
      // ESC while in crafting → close crafting and go to paused
      if (e.code === 'Escape' && this.state === 'crafting') {
        document.dispatchEvent(new Event('crafting-close'));
        this.setState('paused');
      }
    });

    // Listen for inventory-close event
    document.addEventListener('inventory-close', () => {
      this.closeInventory();
    });

    // Listen for inventory button event (hotbar dots / touch)
    document.addEventListener('touch-inventory', () => {
      if (this.state === 'playing') {
        this.openInventory();
      }
    });

    // Crafting table events
    document.addEventListener('open-crafting', () => {
      if (this.state === 'playing') {
        this.openCrafting();
      }
    });
    document.addEventListener('crafting-close', () => {
      this.closeCrafting();
    });
  }

  openInventory() {
    if (this.isTouch) {
      this.player.active = false;
      this.setState('inventory');
    } else {
      this._inventoryRequested = true;
      document.exitPointerLock();
    }
  }

  openCrafting() {
    if (this.isTouch) {
      this.player.active = false;
      this.setState('crafting');
    } else {
      this._craftingRequested = true;
      document.exitPointerLock();
    }
  }

  closeCrafting() {
    if (this.state !== 'crafting') return;
    if (this.isTouch) {
      this.player.active = true;
      this.setState('playing');
    } else {
      this.canvas.requestPointerLock();
    }
  }

  closeInventory() {
    if (this.state !== 'inventory') return;
    if (this._pauseAfterInventory) {
      this._pauseAfterInventory = false;
      if (this.isTouch) {
        this.setState('paused');
      } else {
        // On desktop, we're already unlocked; go to paused
        this.setState('paused');
      }
      return;
    }
    if (this.isTouch) {
      this.player.active = true;
      this.setState('playing');
    } else {
      this.canvas.requestPointerLock();
      // Transition to 'playing' happens in pointerlockchange listener
    }
  }

  setState(state) {
    this.state = state;

    // Hide all overlays
    this.loadingScreen.classList.add('hidden');
    this.titleScreen.classList.add('hidden');
    this.pauseMenu.classList.add('hidden');
    this.settingsMenu.classList.add('hidden');

    // Show the correct overlay
    switch (state) {
      case 'loading':
        this.loadingScreen.classList.remove('hidden');
        break;
      case 'title':
        this.titleScreen.classList.remove('hidden');
        break;
      case 'paused':
        this.pauseMenu.classList.remove('hidden');
        break;
      case 'settings':
        this.settingsMenu.classList.remove('hidden');
        break;
      case 'playing':
        // All overlays hidden
        break;
      case 'inventory':
        // All menu overlays hidden; inventory overlay managed externally
        break;
      case 'crafting':
        // All menu overlays hidden; crafting overlay managed externally
        break;
    }

    // Toggle HUD visibility — keep hotbar visible during inventory/crafting
    document.body.classList.toggle('game-active', state === 'playing' || state === 'inventory' || state === 'crafting');

    // Dispatch state change for touch controls
    document.dispatchEvent(new CustomEvent('game-state-change', { detail: { state } }));
  }

  _requestPlayState() {
    if (this.isTouch) {
      this.player.active = true;
      this.setState('playing');
    } else {
      this.canvas.requestPointerLock();
      // Transition happens in pointerlockchange listener once lock is confirmed
    }
  }
}
