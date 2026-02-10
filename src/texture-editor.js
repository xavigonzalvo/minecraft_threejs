import { TEXTURE_FILES, BlockData, BlockType } from './blocks.js';

const TEX_SIZE = 16;
const ATLAS_COLS = 16;

export class TextureEditor {
  constructor(atlas, rebuildCallback) {
    this.atlas = atlas;
    this.rebuildCallback = rebuildCallback;

    // Collect unique texture names
    this.textureNames = [];
    const seen = new Set();
    for (const faces of Object.values(TEXTURE_FILES)) {
      for (const name of Object.values(faces)) {
        if (!seen.has(name)) { seen.add(name); this.textureNames.push(name); }
      }
    }

    // State
    this.images = {};          // name -> ImageBitmap
    this.currentName = null;
    this.editCanvas = null;
    this.editCtx = null;
    this.tool = 'pencil';
    this.selectedColor = '#ff0000';
    this.zoom = 20;
    this.offset = { x: 0, y: 0 };
    this.isDrawing = false;
    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.history = [];
    this.historyIndex = -1;

    this._buildDOM();
    this._loadAllImages();
    this._bindEvents();
  }

  // ── Image loading ──

  async _loadAllImages() {
    await Promise.all(this.textureNames.map(async (name) => {
      const img = new Image();
      // Use saved version from localStorage if available
      const saved = localStorage.getItem('tex:' + name);
      if (saved) {
        img.src = saved;
      } else {
        img.crossOrigin = 'anonymous';
        img.src = `/textures/${name}.png`;
      }
      await img.decode();
      this.images[name] = img;
    }));
    this._applySavedToAtlas();
    this._populateSidebar();
  }

  _applySavedToAtlas() {
    const atlasCtx = this.atlas.canvas.getContext('2d');
    atlasCtx.imageSmoothingEnabled = false;

    let idx = 0;
    for (const btStr of Object.keys(BlockData)) {
      const bt = Number(btStr);
      if (bt === BlockType.AIR) continue;
      const faces = TEXTURE_FILES[bt];
      if (!faces) continue;

      if (faces.all) {
        if (localStorage.getItem('tex:' + faces.all)) {
          const col = idx % ATLAS_COLS;
          const row = Math.floor(idx / ATLAS_COLS);
          atlasCtx.clearRect(col * TEX_SIZE, row * TEX_SIZE, TEX_SIZE, TEX_SIZE);
          atlasCtx.drawImage(this.images[faces.all], col * TEX_SIZE, row * TEX_SIZE, TEX_SIZE, TEX_SIZE);
        }
        idx++;
      } else {
        for (const face of ['top', 'bottom', 'side']) {
          if (localStorage.getItem('tex:' + faces[face])) {
            const col = idx % ATLAS_COLS;
            const row = Math.floor(idx / ATLAS_COLS);
            atlasCtx.clearRect(col * TEX_SIZE, row * TEX_SIZE, TEX_SIZE, TEX_SIZE);
            atlasCtx.drawImage(this.images[faces[face]], col * TEX_SIZE, row * TEX_SIZE, TEX_SIZE, TEX_SIZE);
          }
          idx++;
        }
      }
    }

    this.atlas.texture.needsUpdate = true;
  }

  // ── DOM construction ──

  _buildDOM() {
    // Overlay container
    this.overlay = document.getElementById('texture-editor-overlay');

    // Sidebar
    this.sidebar = document.createElement('div');
    this.sidebar.className = 'te-sidebar';
    const header = document.createElement('div');
    header.className = 'te-sidebar-header';
    header.textContent = 'Textures';
    this.sidebar.appendChild(header);
    this.fileList = document.createElement('div');
    this.fileList.className = 'te-file-list';
    this.sidebar.appendChild(this.fileList);

    // Main area
    const main = document.createElement('div');
    main.className = 'te-main';

    // Toolbar
    this.toolbar = this._buildToolbar();
    main.appendChild(this.toolbar);

    // Canvas container
    this.canvasContainer = document.createElement('div');
    this.canvasContainer.className = 'te-canvas-container';
    this.displayCanvas = document.createElement('canvas');
    this.displayCanvas.className = 'te-display-canvas';
    this.canvasContainer.appendChild(this.displayCanvas);
    main.appendChild(this.canvasContainer);

    this.overlay.appendChild(this.sidebar);
    this.overlay.appendChild(main);
  }

  _buildToolbar() {
    const bar = document.createElement('div');
    bar.className = 'te-toolbar';

    const tools = [
      { id: 'pencil', label: '✏️', title: 'Pencil' },
      { id: 'eraser', label: '🧹', title: 'Eraser' },
      { id: 'pan',    label: '✋', title: 'Pan' },
      { id: 'picker', label: '💧', title: 'Color Picker' },
    ];

    this.toolBtns = {};
    for (const t of tools) {
      const btn = document.createElement('button');
      btn.className = 'te-tool-btn' + (t.id === this.tool ? ' active' : '');
      btn.textContent = t.label;
      btn.title = t.title;
      btn.addEventListener('click', () => this._setTool(t.id));
      bar.appendChild(btn);
      this.toolBtns[t.id] = btn;
    }

    // Separator
    bar.appendChild(this._sep());

    // Undo / Redo
    const undoBtn = document.createElement('button');
    undoBtn.className = 'te-tool-btn';
    undoBtn.textContent = '↩';
    undoBtn.title = 'Undo';
    undoBtn.addEventListener('click', () => this._undo());
    bar.appendChild(undoBtn);

    const redoBtn = document.createElement('button');
    redoBtn.className = 'te-tool-btn';
    redoBtn.textContent = '↪';
    redoBtn.title = 'Redo';
    redoBtn.addEventListener('click', () => this._redo());
    bar.appendChild(redoBtn);

    bar.appendChild(this._sep());

    // Color input
    this.colorInput = document.createElement('input');
    this.colorInput.type = 'color';
    this.colorInput.value = this.selectedColor;
    this.colorInput.title = 'Color';
    this.colorInput.className = 'te-color-input';
    this.colorInput.addEventListener('input', (e) => { this.selectedColor = e.target.value; });
    bar.appendChild(this.colorInput);

    bar.appendChild(this._sep());

    // Save
    const saveBtn = document.createElement('button');
    saveBtn.className = 'te-tool-btn te-save-btn';
    saveBtn.textContent = '💾 Save';
    saveBtn.addEventListener('click', () => this._save());
    bar.appendChild(saveBtn);

    // Spacer
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    bar.appendChild(spacer);

    // Close
    const closeBtn = document.createElement('button');
    closeBtn.className = 'te-tool-btn te-close-btn';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', () => this.hide());
    bar.appendChild(closeBtn);

    return bar;
  }

  _sep() {
    const s = document.createElement('div');
    s.className = 'te-sep';
    return s;
  }

  _populateSidebar() {
    this.fileList.innerHTML = '';
    for (const name of this.textureNames) {
      const item = document.createElement('div');
      item.className = 'te-file-item';
      item.dataset.name = name;

      const thumb = document.createElement('canvas');
      thumb.width = 16; thumb.height = 16;
      thumb.className = 'te-thumb';
      const tCtx = thumb.getContext('2d');
      tCtx.imageSmoothingEnabled = false;
      if (this.images[name]) tCtx.drawImage(this.images[name], 0, 0);

      const label = document.createElement('span');
      label.textContent = name;

      item.appendChild(thumb);
      item.appendChild(label);
      item.addEventListener('click', () => this._selectTexture(name));
      this.fileList.appendChild(item);
    }

    // Auto-select first
    if (this.textureNames.length > 0) {
      this._selectTexture(this.textureNames[0]);
    }
  }

  // ── Texture selection ──

  _selectTexture(name) {
    this.currentName = name;
    const img = this.images[name];
    if (!img) return;

    // Highlight sidebar item
    for (const el of this.fileList.querySelectorAll('.te-file-item')) {
      el.classList.toggle('active', el.dataset.name === name);
    }

    // Create edit canvas from image
    this.editCanvas = document.createElement('canvas');
    this.editCanvas.width = img.naturalWidth || img.width;
    this.editCanvas.height = img.naturalHeight || img.height;
    this.editCtx = this.editCanvas.getContext('2d', { willReadFrequently: true });
    this.editCtx.imageSmoothingEnabled = false;
    this.editCtx.drawImage(img, 0, 0);

    // Reset view
    this.offset = { x: 0, y: 0 };
    this._fitZoom();

    // Reset history
    const initialData = this.editCtx.getImageData(0, 0, this.editCanvas.width, this.editCanvas.height);
    this.history = [initialData];
    this.historyIndex = 0;

    this._render();
  }

  // ── Tools ──

  _setTool(id) {
    this.tool = id;
    for (const [key, btn] of Object.entries(this.toolBtns)) {
      btn.classList.toggle('active', key === id);
    }
  }

  _fitZoom() {
    if (!this.editCanvas) return;
    const cw = this.canvasContainer.clientWidth;
    const ch = this.canvasContainer.clientHeight;
    if (cw === 0 || ch === 0) return; // container not visible yet
    const fitZoom = Math.min(
      (cw * 0.8) / this.editCanvas.width,
      (ch * 0.8) / this.editCanvas.height,
      40
    );
    this.zoom = Math.max(1, Math.floor(fitZoom));
  }

  // ── Rendering ──

  _render() {
    const canvas = this.displayCanvas;
    const container = this.canvasContainer;
    if (!container) return;

    // Match display canvas size to container
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);

    if (!this.editCanvas) return;

    const ew = this.editCanvas.width;
    const eh = this.editCanvas.height;
    const cx = w / 2;
    const cy = h / 2;

    ctx.save();
    ctx.translate(cx + this.offset.x, cy + this.offset.y);
    ctx.scale(this.zoom, this.zoom);

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-ew / 2, -eh / 2, ew, eh);

    // Draw edit canvas
    ctx.drawImage(this.editCanvas, -ew / 2, -eh / 2);

    // Grid overlay when zoomed in enough
    if (this.zoom > 8) {
      ctx.strokeStyle = 'rgba(128, 128, 128, 0.4)';
      ctx.lineWidth = 1 / this.zoom;
      ctx.beginPath();
      for (let x = 0; x <= ew; x++) {
        ctx.moveTo(-ew / 2 + x, -eh / 2);
        ctx.lineTo(-ew / 2 + x, eh / 2);
      }
      for (let y = 0; y <= eh; y++) {
        ctx.moveTo(-ew / 2, -eh / 2 + y);
        ctx.lineTo(ew / 2, -eh / 2 + y);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  // ── Coordinate transform ──

  _screenToWorld(sx, sy) {
    const canvas = this.displayCanvas;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const ew = this.editCanvas.width;
    const eh = this.editCanvas.height;

    const x = (sx - (cx + this.offset.x)) / this.zoom + ew / 2;
    const y = (sy - (cy + this.offset.y)) / this.zoom + eh / 2;
    return { x: Math.floor(x), y: Math.floor(y) };
  }

  // ── Input events ──

  _bindEvents() {
    const c = this.displayCanvas;

    c.addEventListener('mousedown', (e) => this._onMouseDown(e));
    c.addEventListener('mousemove', (e) => this._onMouseMove(e));
    c.addEventListener('mouseup', () => this._onMouseUp());
    c.addEventListener('mouseleave', () => this._onMouseUp());
    c.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });

    // Touch support
    c.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      const rect = c.getBoundingClientRect();
      this._onMouseDown({ offsetX: t.clientX - rect.left, offsetY: t.clientY - rect.top, button: 0, clientX: t.clientX, clientY: t.clientY });
    }, { passive: false });
    c.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      const rect = c.getBoundingClientRect();
      this._onMouseMove({ offsetX: t.clientX - rect.left, offsetY: t.clientY - rect.top, clientX: t.clientX, clientY: t.clientY });
    }, { passive: false });
    c.addEventListener('touchend', (e) => { e.preventDefault(); this._onMouseUp(); }, { passive: false });

    // Keyboard shortcuts
    this._keyHandler = (e) => {
      if (this.overlay.style.display === 'none') return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') { e.preventDefault(); this._undo(); }
        if (e.key === 'y') { e.preventDefault(); this._redo(); }
      }
    };
    document.addEventListener('keydown', this._keyHandler);

    // Resize observer to keep display canvas sized
    this._resizeObserver = new ResizeObserver(() => this._render());
    this._resizeObserver.observe(this.canvasContainer);

    // HUD button
    const btn = document.getElementById('btn-edit-textures');
    if (btn) btn.addEventListener('click', () => this.show());
  }

  _onMouseDown(e) {
    if (!this.editCanvas) return;

    if (this.tool === 'pan' || e.button === 1) {
      this.isDragging = true;
      this.dragStart = { x: e.clientX, y: e.clientY };
    } else if (this.tool === 'picker') {
      this._paint(e.offsetX, e.offsetY);
    } else {
      this.isDrawing = true;
      this._paint(e.offsetX, e.offsetY);
    }
  }

  _onMouseMove(e) {
    if (this.isDragging) {
      this.offset.x += e.clientX - this.dragStart.x;
      this.offset.y += e.clientY - this.dragStart.y;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this._render();
    } else if (this.isDrawing) {
      this._paint(e.offsetX, e.offsetY);
    }
  }

  _onMouseUp() {
    if (this.isDrawing) {
      this._saveToHistory();
    }
    this.isDrawing = false;
    this.isDragging = false;
  }

  _onWheel(e) {
    e.preventDefault();
    const newZoom = Math.max(1, Math.min(100, this.zoom - e.deltaY * 0.1));
    this.zoom = newZoom;
    this._render();
  }

  // ── Painting ──

  _paint(sx, sy) {
    if (!this.editCanvas || this.tool === 'pan') return;

    const { x, y } = this._screenToWorld(sx, sy);
    const ew = this.editCanvas.width;
    const eh = this.editCanvas.height;

    if (x < 0 || x >= ew || y < 0 || y >= eh) return;

    if (this.tool === 'picker') {
      const pixel = this.editCtx.getImageData(x, y, 1, 1).data;
      const hex = '#' + [pixel[0], pixel[1], pixel[2]].map(c => c.toString(16).padStart(2, '0')).join('');
      this.selectedColor = hex;
      this.colorInput.value = hex;
      return;
    }

    if (this.tool === 'eraser') {
      this.editCtx.clearRect(x, y, 1, 1);
    } else {
      this.editCtx.fillStyle = this.selectedColor;
      this.editCtx.fillRect(x, y, 1, 1);
    }
    this._render();
  }

  // ── History ──

  _saveToHistory() {
    if (!this.editCanvas) return;
    const imageData = this.editCtx.getImageData(0, 0, this.editCanvas.width, this.editCanvas.height);
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(imageData);
    this.historyIndex = this.history.length - 1;
  }

  _undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.editCtx.putImageData(this.history[this.historyIndex], 0, 0);
      this._render();
    }
  }

  _redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.editCtx.putImageData(this.history[this.historyIndex], 0, 0);
      this._render();
    }
  }

  // ── Save to atlas ──

  _save() {
    if (!this.editCanvas || !this.currentName) return;

    const atlasCtx = this.atlas.canvas.getContext('2d');
    atlasCtx.imageSmoothingEnabled = false;

    // Build reverse map: texture name -> list of atlas slot indices
    // Replicate the same iteration order as TextureAtlas.load()
    let idx = 0;
    for (const btStr of Object.keys(BlockData)) {
      const bt = Number(btStr);
      if (bt === BlockType.AIR) continue;
      const faces = TEXTURE_FILES[bt];
      if (!faces) continue;

      if (faces.all) {
        if (faces.all === this.currentName) {
          const col = idx % ATLAS_COLS;
          const row = Math.floor(idx / ATLAS_COLS);
          atlasCtx.clearRect(col * TEX_SIZE, row * TEX_SIZE, TEX_SIZE, TEX_SIZE);
          atlasCtx.drawImage(this.editCanvas, col * TEX_SIZE, row * TEX_SIZE, TEX_SIZE, TEX_SIZE);
        }
        idx++;
      } else {
        for (const face of ['top', 'bottom', 'side']) {
          if (faces[face] === this.currentName) {
            const col = idx % ATLAS_COLS;
            const row = Math.floor(idx / ATLAS_COLS);
            atlasCtx.clearRect(col * TEX_SIZE, row * TEX_SIZE, TEX_SIZE, TEX_SIZE);
            atlasCtx.drawImage(this.editCanvas, col * TEX_SIZE, row * TEX_SIZE, TEX_SIZE, TEX_SIZE);
          }
          idx++;
        }
      }
    }

    // Mark texture for GPU re-upload
    this.atlas.texture.needsUpdate = true;

    // Persist to localStorage and update stored image
    const dataURL = this.editCanvas.toDataURL('image/png');
    localStorage.setItem('tex:' + this.currentName, dataURL);
    const updatedImg = new Image();
    updatedImg.src = dataURL;
    this.images[this.currentName] = updatedImg;

    // Update sidebar thumbnail
    const item = this.fileList.querySelector(`.te-file-item[data-name="${this.currentName}"]`);
    if (item) {
      const thumb = item.querySelector('.te-thumb');
      const tCtx = thumb.getContext('2d');
      tCtx.clearRect(0, 0, 16, 16);
      tCtx.imageSmoothingEnabled = false;
      tCtx.drawImage(this.editCanvas, 0, 0, 16, 16);
    }

    // Rebuild all chunk meshes so the world updates
    if (this.rebuildCallback) {
      this.rebuildCallback();
    }

    this._snackbar(`Saved "${this.currentName}"`);
  }

  _snackbar(text) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText =
      'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
      'background:#2a6041;color:#fff;padding:8px 20px;border-radius:4px;' +
      'font:14px "Segoe UI",monospace;z-index:600;opacity:1;transition:opacity .4s';
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; }, 1500);
    setTimeout(() => el.remove(), 2000);
  }

  // ── Show / Hide ──

  show() {
    this.overlay.style.display = 'flex';
    // Hide the pause menu while editor is open
    const pauseMenu = document.getElementById('pause-menu');
    if (pauseMenu) pauseMenu.classList.add('hidden');
    // Recalculate zoom now that the container has layout dimensions
    requestAnimationFrame(() => {
      if (this.currentName) this._fitZoom();
      this._render();
    });
  }

  hide() {
    this.overlay.style.display = 'none';
    // Return to pause menu so the player can resume from there
    const pauseMenu = document.getElementById('pause-menu');
    if (pauseMenu) pauseMenu.classList.remove('hidden');
  }
}
