export class Menu {
  constructor(canvas, player) {
    this.canvas = canvas;
    this.player = player;
    this.state = 'loading';
    this.isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this._inventoryRequested = false;

    this.titleScreen = document.getElementById('title-screen');
    this.pauseMenu = document.getElementById('pause-menu');
    this.loadingScreen = document.getElementById('loading');

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

    // Pointer lock change: if lock lost while playing, transition to paused
    document.addEventListener('pointerlockchange', () => {
      if (this.isTouch) return;
      const locked = document.pointerLockElement === this.canvas;
      if (locked && (this.state === 'title' || this.state === 'paused' || this.state === 'inventory')) {
        this.setState('playing');
      } else if (!locked && this.state === 'playing') {
        if (this._inventoryRequested) {
          this._inventoryRequested = false;
          this.setState('inventory');
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
      case 'playing':
        // All overlays hidden
        break;
      case 'inventory':
        // All menu overlays hidden; inventory overlay managed externally
        break;
    }

    // Toggle HUD visibility — keep hotbar visible during inventory
    document.body.classList.toggle('game-active', state === 'playing' || state === 'inventory');

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
