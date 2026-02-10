export class Menu {
  constructor(canvas, player) {
    this.canvas = canvas;
    this.player = player;
    this.state = 'loading';
    this.isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

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

    // Pointer lock change: if lock lost while playing, transition to paused
    document.addEventListener('pointerlockchange', () => {
      if (this.isTouch) return;
      const locked = document.pointerLockElement === this.canvas;
      if (locked && (this.state === 'title' || this.state === 'paused')) {
        this.setState('playing');
      } else if (!locked && this.state === 'playing') {
        this.setState('paused');
      }
    });

    // Touch pause event from touch controls
    document.addEventListener('touch-pause', () => {
      if (this.isTouch && this.state === 'playing') {
        this.player.active = false;
        this.setState('paused');
      }
    });
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
    }

    // Toggle HUD visibility
    document.body.classList.toggle('game-active', state === 'playing');

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
