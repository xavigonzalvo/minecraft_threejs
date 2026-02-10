export class Menu {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = 'loading';

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
      const locked = document.pointerLockElement === this.canvas;
      if (locked && (this.state === 'title' || this.state === 'paused')) {
        this.setState('playing');
      } else if (!locked && this.state === 'playing') {
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
  }

  _requestPlayState() {
    this.canvas.requestPointerLock();
    // Transition happens in pointerlockchange listener once lock is confirmed
  }
}
