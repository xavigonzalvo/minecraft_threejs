const JOYSTICK_RADIUS = 50;
const DEAD_ZONE = 0.15;
const CAMERA_SENSITIVITY = 0.004;
const SPLIT = 0.4;
const TAP_MAX_DIST = 12;    // px — finger drift allowed for a tap/hold
const HOLD_DELAY = 400;     // ms — how long before hold starts breaking

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

    // Camera touch tracking for tap/hold detection
    this.cameraTouchStart = { x: 0, y: 0, time: 0 };
    this.cameraMoved = false;
    this.holdTimer = null;
    this.isBreaking = false;

    this.interaction.isTouch = true;

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

    // ── Movement joystick (left side, always visible) ──
    const joystickBase = document.createElement('div');
    joystickBase.id = 'touch-joystick-base';
    Object.assign(joystickBase.style, {
      position: 'absolute', left: '30px', bottom: '30px',
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
    });

    joystickBase.appendChild(joystickThumb);
    container.appendChild(joystickBase);

    // ── Jump button (right side, bottom) ──
    const btnJump = this._createButton('touch-btn-jump', '&#x25B3;', {
      position: 'absolute', right: '24px', bottom: '30px',
      width: '72px', height: '72px', borderRadius: '50%',
      fontSize: '28px',
    });
    container.appendChild(btnJump);

    // ── Crouch button (right side, above jump) ──
    const btnCrouch = this._createButton('touch-btn-crouch', '&#x25BD;', {
      position: 'absolute', right: '24px', bottom: '116px',
      width: '64px', height: '64px', borderRadius: '50%',
      fontSize: '24px',
    });
    container.appendChild(btnCrouch);

    // ── Pause button (top-right) ──
    const btnPause = this._createButton('touch-btn-pause', '&#x2016;', {
      position: 'absolute', right: '16px', top: '16px',
      width: '44px', height: '44px', borderRadius: '8px',
      fontSize: '18px',
    });
    container.appendChild(btnPause);

    document.body.appendChild(container);

    this.container = container;
    this.joystickBase = joystickBase;
    this.joystickThumb = joystickThumb;
    this.btnJump = btnJump;
    this.btnCrouch = btnCrouch;
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

  _isHotbar(el) {
    const hotbar = document.getElementById('hotbar');
    return hotbar && hotbar.contains(el);
  }

  _startHoldTimer() {
    this._clearHoldTimer();
    this.holdTimer = setTimeout(() => {
      if (!this.cameraMoved) {
        this.isBreaking = true;
        this.interaction._mouseDown[0] = true;
      }
    }, HOLD_DELAY);
  }

  _clearHoldTimer() {
    if (this.holdTimer !== null) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  _onTouchStart(e) {
    if (this.container.style.display === 'none') return;

    for (const touch of e.changedTouches) {
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      if (!el) continue;

      // Let hotbar taps pass through
      if (this._isHotbar(el)) continue;

      // Buttons first
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
      if (el === this.btnCrouch || this.btnCrouch.contains(el)) {
        e.preventDefault();
        this.buttonTouches[touch.identifier] = 'crouch';
        this.player.keys['ShiftLeft'] = true;
        this.player.sprinting = false;
        continue;
      }

      // Movement joystick — touch on joystick or left zone
      if (this.joystickTouch === null) {
        const onJoystick = el === this.joystickBase || this.joystickBase.contains(el);
        const inLeftZone = touch.clientX < window.innerWidth * SPLIT && !this._isButton(el);
        if (onJoystick || inLeftZone) {
          e.preventDefault();
          this.joystickTouch = touch.identifier;
          const jRect = this.joystickBase.getBoundingClientRect();
          this.joystickOriginX = jRect.left + jRect.width / 2;
          this.joystickOriginY = jRect.top + jRect.height / 2;
          this.joystickDisplacement = { x: 0, y: 0 };
          this._updateJoystickThumb(0, 0);
          continue;
        }
      }

      // Camera look — anywhere on right side (not on buttons)
      if (this.cameraTouch === null && touch.clientX >= window.innerWidth * SPLIT && !this._isButton(el)) {
        e.preventDefault();
        this.cameraTouch = touch.identifier;
        this.lastCameraPos = { x: touch.clientX, y: touch.clientY };
        this.cameraTouchStart = { x: touch.clientX, y: touch.clientY, time: performance.now() };
        this.cameraMoved = false;
        this.isBreaking = false;
        this.interaction._touchScreenPos = { x: touch.clientX, y: touch.clientY };
        this._startHoldTimer();
        continue;
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

        // Check if finger moved too far for tap/hold
        if (!this.cameraMoved) {
          const totalDx = touch.clientX - this.cameraTouchStart.x;
          const totalDy = touch.clientY - this.cameraTouchStart.y;
          if (Math.sqrt(totalDx * totalDx + totalDy * totalDy) > TAP_MAX_DIST) {
            this.cameraMoved = true;
            this._clearHoldTimer();
            this.interaction._touchScreenPos = null;
            // If already breaking, stop
            if (this.isBreaking) {
              this.interaction._mouseDown[0] = false;
              this.isBreaking = false;
            }
          }
        }
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
        this._clearHoldTimer();

        // Stop breaking if it was active
        if (this.isBreaking) {
          this.interaction._mouseDown[0] = false;
          this.isBreaking = false;
        }

        // Tap to place: short touch without much movement
        if (!this.cameraMoved) {
          const elapsed = performance.now() - this.cameraTouchStart.time;
          if (elapsed < HOLD_DELAY) {
            // Quick tap → place block at finger position
            this.interaction.placeBlockAtScreen(this.cameraTouchStart.x, this.cameraTouchStart.y);
          }
        }

        this.interaction._touchScreenPos = null;
        this.cameraTouch = null;
        continue;
      }

      const btn = this.buttonTouches[touch.identifier];
      if (btn) {
        if (btn === 'jump') this.player.keys['Space'] = false;
        if (btn === 'crouch') this.player.keys['ShiftLeft'] = false;
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
      if (!this.player.keys['ShiftLeft']) {
        this.player.sprinting = mag > 0.9;
      }
    } else {
      this.player.keys['KeyW'] = false;
      this.player.keys['KeyS'] = false;
      this.player.keys['KeyA'] = false;
      this.player.keys['KeyD'] = false;
      if (!this.player.keys['ShiftLeft']) {
        this.player.sprinting = false;
      }
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
    this._clearHoldTimer();
    if (this.isBreaking) {
      this.interaction._mouseDown[0] = false;
      this.isBreaking = false;
    }
    this.interaction._touchScreenPos = null;
    this.player.keys['KeyW'] = false;
    this.player.keys['KeyS'] = false;
    this.player.keys['KeyA'] = false;
    this.player.keys['KeyD'] = false;
    this.player.keys['Space'] = false;
    this.player.keys['ShiftLeft'] = false;
    this.player.sprinting = false;
    this.interaction._mouseDown[0] = false;
    this.interaction._mouseDown[2] = false;
  }
}
