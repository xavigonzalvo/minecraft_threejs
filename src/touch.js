const JOYSTICK_RADIUS = 50;
const DEAD_ZONE = 0.15;
const CAMERA_SENSITIVITY = 0.004;
const SPLIT = 0.5;

export class TouchControls {
  static isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  constructor(player, interaction, canvas) {
    this.player = player;
    this.interaction = interaction;
    this.canvas = canvas;

    this.joystickTouch = null;
    this.cameraTouch = null;
    this.buttonTouches = {};
    this.joystickDisplacement = { x: 0, y: 0 };
    this.lastCameraPos = { x: 0, y: 0 };

    this._buildDOM();
    this._bindEvents();
    this.hide();
  }

  _buildDOM() {
    const container = document.createElement('div');
    container.id = 'touch-controls';
    Object.assign(container.style, {
      position: 'fixed', inset: '0',
      zIndex: '50', pointerEvents: 'none',
      display: 'none',
    });

    // ── Camera look pad (left side) ──
    const cameraPad = document.createElement('div');
    cameraPad.id = 'touch-camera-pad';
    Object.assign(cameraPad.style, {
      position: 'absolute', left: '30px', bottom: '30px',
      width: '130px', height: '130px',
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.08)',
      border: '2px solid rgba(255,255,255,0.2)',
      pointerEvents: 'auto',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    });
    const cameraIcon = document.createElement('div');
    Object.assign(cameraIcon.style, {
      width: '40px', height: '40px',
      borderRadius: '50%',
      border: '2px solid rgba(255,255,255,0.25)',
      background: 'rgba(255,255,255,0.1)',
    });
    cameraPad.appendChild(cameraIcon);
    container.appendChild(cameraPad);

    // ── Movement joystick (right side) ──
    const joystickBase = document.createElement('div');
    joystickBase.id = 'touch-joystick-base';
    Object.assign(joystickBase.style, {
      position: 'absolute', right: '30px', bottom: '30px',
      width: '130px', height: '130px',
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.08)',
      border: '2px solid rgba(255,255,255,0.2)',
      pointerEvents: 'auto',
    });

    const joystickThumb = document.createElement('div');
    joystickThumb.id = 'touch-joystick-thumb';
    Object.assign(joystickThumb.style, {
      position: 'absolute',
      width: '50px', height: '50px',
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.4)',
      border: '2px solid rgba(255,255,255,0.5)',
      left: '50%', top: '50%',
      transform: 'translate(-50%, -50%)',
      transition: 'none',
    });

    joystickBase.appendChild(joystickThumb);
    container.appendChild(joystickBase);

    // ── Jump button ──
    const btnJump = this._createButton('touch-btn-jump', '&#x25B3;', {
      position: 'absolute', left: '180px', bottom: '30px',
      width: '64px', height: '64px', borderRadius: '50%',
      fontSize: '26px',
    });
    container.appendChild(btnJump);

    // ── Break button ──
    const btnBreak = this._createButton('touch-btn-break', '&#x2692;', {
      position: 'absolute', left: '180px', bottom: '110px',
      width: '56px', height: '56px', borderRadius: '50%',
      fontSize: '20px',
    });
    container.appendChild(btnBreak);

    // ── Place button ──
    const btnPlace = this._createButton('touch-btn-place', '&#x25A3;', {
      position: 'absolute', left: '248px', bottom: '64px',
      width: '56px', height: '56px', borderRadius: '50%',
      fontSize: '20px',
    });
    container.appendChild(btnPlace);

    // ── Pause button ──
    const btnPause = this._createButton('touch-btn-pause', '&#x2016;', {
      position: 'absolute', right: '16px', top: '16px',
      width: '44px', height: '44px', borderRadius: '8px',
      fontSize: '18px',
    });
    container.appendChild(btnPause);

    document.body.appendChild(container);

    this.container = container;
    this.cameraPad = cameraPad;
    this.joystickBase = joystickBase;
    this.joystickThumb = joystickThumb;
    this.btnJump = btnJump;
    this.btnBreak = btnBreak;
    this.btnPlace = btnPlace;
    this.btnPause = btnPause;
  }

  _createButton(id, html, styles) {
    const btn = document.createElement('div');
    btn.id = id;
    Object.assign(btn.style, {
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(255,255,255,0.15)',
      border: '2px solid rgba(255,255,255,0.3)',
      color: 'rgba(255,255,255,0.7)',
      pointerEvents: 'auto',
      userSelect: 'none', webkitUserSelect: 'none',
      ...styles,
    });
    btn.innerHTML = html;
    return btn;
  }

  _bindEvents() {
    document.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    document.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
    document.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: false });
    document.addEventListener('touchcancel', (e) => this._onTouchEnd(e), { passive: false });
  }

  _isButton(el) {
    return el && el.id && el.id.startsWith('touch-btn');
  }

  _onTouchStart(e) {
    if (this.container.style.display === 'none') return;

    for (const touch of e.changedTouches) {
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      if (!el) continue;

      // Check buttons first
      if (el === this.btnPause || this.btnPause.contains(el)) {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('touch-pause'));
        continue;
      }
      if (el === this.btnJump || this.btnJump.contains(el)) {
        e.preventDefault();
        this.buttonTouches[touch.identifier] = 'jump';
        this.player.keys['Space'] = true;
        continue;
      }
      if (el === this.btnBreak || this.btnBreak.contains(el)) {
        e.preventDefault();
        this.buttonTouches[touch.identifier] = 'break';
        this.interaction._mouseDown[0] = true;
        continue;
      }
      if (el === this.btnPlace || this.btnPlace.contains(el)) {
        e.preventDefault();
        this.buttonTouches[touch.identifier] = 'place';
        this.interaction._mouseDown[2] = true;
        continue;
      }

      // Movement joystick — touch on the joystick base or right half
      if (this.joystickTouch === null) {
        const jRect = this.joystickBase.getBoundingClientRect();
        const inJoystick = (el === this.joystickBase || this.joystickBase.contains(el))
          || (touch.clientX >= window.innerWidth * SPLIT && !this._isButton(el)
              && touch.clientY > window.innerHeight * 0.5);
        if (inJoystick) {
          e.preventDefault();
          this.joystickTouch = touch.identifier;
          // Use center of joystick base as origin
          this.joystickOriginX = jRect.left + jRect.width / 2;
          this.joystickOriginY = jRect.top + jRect.height / 2;
          this.joystickDisplacement = { x: 0, y: 0 };
          this._updateJoystickThumb(0, 0);
          continue;
        }
      }

      // Camera look — touch on camera pad or left half
      if (this.cameraTouch === null) {
        const inCamera = (el === this.cameraPad || this.cameraPad.contains(el))
          || (touch.clientX < window.innerWidth * SPLIT && !this._isButton(el));
        if (inCamera) {
          e.preventDefault();
          this.cameraTouch = touch.identifier;
          this.lastCameraPos = { x: touch.clientX, y: touch.clientY };
          continue;
        }
      }
    }
  }

  _onTouchMove(e) {
    if (this.container.style.display === 'none') return;

    for (const touch of e.changedTouches) {
      if (touch.identifier === this.joystickTouch) {
        e.preventDefault();
        let dx = touch.clientX - this.joystickOriginX;
        let dy = touch.clientY - this.joystickOriginY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > JOYSTICK_RADIUS) {
          dx = (dx / dist) * JOYSTICK_RADIUS;
          dy = (dy / dist) * JOYSTICK_RADIUS;
        }
        this.joystickDisplacement = { x: dx / JOYSTICK_RADIUS, y: dy / JOYSTICK_RADIUS };
        this._updateJoystickThumb(dx, dy);
        continue;
      }

      if (touch.identifier === this.cameraTouch) {
        e.preventDefault();
        const dx = touch.clientX - this.lastCameraPos.x;
        const dy = touch.clientY - this.lastCameraPos.y;
        this.player.yaw -= dx * CAMERA_SENSITIVITY;
        this.player.pitch -= dy * CAMERA_SENSITIVITY;
        this.player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.player.pitch));
        this.lastCameraPos = { x: touch.clientX, y: touch.clientY };
        continue;
      }
    }
  }

  _onTouchEnd(e) {
    if (this.container.style.display === 'none') return;

    for (const touch of e.changedTouches) {
      if (touch.identifier === this.joystickTouch) {
        this.joystickTouch = null;
        this.joystickDisplacement = { x: 0, y: 0 };
        this._updateJoystickThumb(0, 0);
        this.player.keys['KeyW'] = false;
        this.player.keys['KeyS'] = false;
        this.player.keys['KeyA'] = false;
        this.player.keys['KeyD'] = false;
        this.player.sprinting = false;
        continue;
      }

      if (touch.identifier === this.cameraTouch) {
        this.cameraTouch = null;
        continue;
      }

      const btn = this.buttonTouches[touch.identifier];
      if (btn) {
        if (btn === 'jump') this.player.keys['Space'] = false;
        if (btn === 'break') this.interaction._mouseDown[0] = false;
        if (btn === 'place') this.interaction._mouseDown[2] = false;
        delete this.buttonTouches[touch.identifier];
      }
    }
  }

  _updateJoystickThumb(dx, dy) {
    this.joystickThumb.style.left = `calc(50% + ${dx}px)`;
    this.joystickThumb.style.top = `calc(50% + ${dy}px)`;
  }

  update(dt) {
    if (this.container.style.display === 'none') return;

    const dx = this.joystickDisplacement.x;
    const dy = this.joystickDisplacement.y;
    const mag = Math.sqrt(dx * dx + dy * dy);

    if (mag > DEAD_ZONE) {
      this.player.keys['KeyW'] = dy < -DEAD_ZONE;
      this.player.keys['KeyS'] = dy > DEAD_ZONE;
      this.player.keys['KeyA'] = dx < -DEAD_ZONE;
      this.player.keys['KeyD'] = dx > DEAD_ZONE;
      this.player.sprinting = mag > 0.9;
    } else {
      this.player.keys['KeyW'] = false;
      this.player.keys['KeyS'] = false;
      this.player.keys['KeyA'] = false;
      this.player.keys['KeyD'] = false;
      this.player.sprinting = false;
    }
  }

  show() {
    this.container.style.display = 'block';
  }

  hide() {
    this.container.style.display = 'none';
    this._resetState();
  }

  _resetState() {
    this.joystickTouch = null;
    this.cameraTouch = null;
    this.buttonTouches = {};
    this.joystickDisplacement = { x: 0, y: 0 };
    this._updateJoystickThumb(0, 0);
    this.player.keys['KeyW'] = false;
    this.player.keys['KeyS'] = false;
    this.player.keys['KeyA'] = false;
    this.player.keys['KeyD'] = false;
    this.player.keys['Space'] = false;
    this.player.sprinting = false;
    this.interaction._mouseDown[0] = false;
    this.interaction._mouseDown[2] = false;
  }
}
