import { BlockType } from './blocks.js';

// Material categories for sound mapping
const MATERIAL_STONE = 'stone';
const MATERIAL_DIRT = 'dirt';
const MATERIAL_WOOD = 'wood';
const MATERIAL_SAND = 'sand';
const MATERIAL_GLASS = 'glass';

const BLOCK_MATERIAL = {
  [BlockType.STONE]: MATERIAL_STONE,
  [BlockType.COBBLESTONE]: MATERIAL_STONE,
  [BlockType.COAL_ORE]: MATERIAL_STONE,
  [BlockType.IRON_ORE]: MATERIAL_STONE,
  [BlockType.BEDROCK]: MATERIAL_STONE,
  [BlockType.BRICK]: MATERIAL_STONE,

  [BlockType.DIRT]: MATERIAL_DIRT,
  [BlockType.GRASS]: MATERIAL_DIRT,
  [BlockType.SNOW]: MATERIAL_DIRT,
  [BlockType.OAK_LEAVES]: MATERIAL_DIRT,

  [BlockType.SAND]: MATERIAL_SAND,
  [BlockType.GRAVEL]: MATERIAL_SAND,

  [BlockType.OAK_LOG]: MATERIAL_WOOD,
  [BlockType.OAK_PLANKS]: MATERIAL_WOOD,

  [BlockType.GLASS]: MATERIAL_GLASS,
};

function getMaterial(blockType) {
  return BLOCK_MATERIAL[blockType] || MATERIAL_STONE;
}

export class Sound {
  constructor() {
    this._ctx = null;
    this._volume = 0.3;
    this._lastHitTime = 0;
    this._hitInterval = 0.25; // seconds between hit sounds

    this._initOnInteraction = this._initOnInteraction.bind(this);
    document.addEventListener('mousedown', this._initOnInteraction, { once: true });
    document.addEventListener('touchstart', this._initOnInteraction, { once: true });

    document.addEventListener('mining-progress', (e) => this._onMiningProgress(e));
    document.addEventListener('block-break', (e) => this._onBlockBreak(e));
  }

  _initOnInteraction() {
    if (this._ctx) return;
    this._ctx = new AudioContext();
  }

  _ensureContext() {
    if (!this._ctx) {
      this._ctx = new AudioContext();
    }
    if (this._ctx.state === 'suspended') {
      this._ctx.resume();
    }
    return this._ctx;
  }

  // Play a hit sound: short noise burst filtered by material
  _playHit(material) {
    const ctx = this._ensureContext();
    const now = ctx.currentTime;
    const duration = 0.05;

    // Noise buffer
    const bufferSize = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Filter based on material
    const filter = ctx.createBiquadFilter();
    const pitchVariation = 0.85 + Math.random() * 0.3;

    switch (material) {
      case MATERIAL_STONE:
        filter.type = 'highpass';
        filter.frequency.value = 800 * pitchVariation;
        filter.Q.value = 1.0;
        break;
      case MATERIAL_DIRT:
        filter.type = 'lowpass';
        filter.frequency.value = 400 * pitchVariation;
        filter.Q.value = 0.5;
        break;
      case MATERIAL_WOOD:
        filter.type = 'lowpass';
        filter.frequency.value = 400 * pitchVariation;
        filter.Q.value = 0.5;
        break;
      case MATERIAL_SAND:
        filter.type = 'bandpass';
        filter.frequency.value = 1200 * pitchVariation;
        filter.Q.value = 0.3;
        break;
      case MATERIAL_GLASS:
        filter.type = 'highpass';
        filter.frequency.value = 2000 * pitchVariation;
        filter.Q.value = 3.0;
        break;
    }

    // Gain envelope
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this._volume * 0.6, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    source.start(now);
    source.stop(now + duration);
  }

  // Play a break sound: longer burst with pitch drop
  _playBreak(material) {
    const ctx = this._ensureContext();
    const now = ctx.currentTime;
    const duration = 0.15;

    // Noise buffer
    const bufferSize = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Filter with frequency drop for "crumbling" feel
    const filter = ctx.createBiquadFilter();

    switch (material) {
      case MATERIAL_STONE:
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1200, now);
        filter.frequency.exponentialRampToValueAtTime(300, now + duration);
        filter.Q.value = 1.0;
        break;
      case MATERIAL_DIRT:
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(600, now);
        filter.frequency.exponentialRampToValueAtTime(150, now + duration);
        filter.Q.value = 0.5;
        break;
      case MATERIAL_WOOD:
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(600, now);
        filter.frequency.exponentialRampToValueAtTime(150, now + duration);
        filter.Q.value = 0.5;
        break;
      case MATERIAL_SAND:
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1800, now);
        filter.frequency.exponentialRampToValueAtTime(600, now + duration);
        filter.Q.value = 0.3;
        break;
      case MATERIAL_GLASS:
        // Glass shatter: high frequency burst
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(3000, now);
        filter.frequency.exponentialRampToValueAtTime(800, now + duration);
        filter.Q.value = 4.0;
        break;
    }

    // Gain envelope — louder than hit, with decay
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this._volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    source.start(now);
    source.stop(now + duration);
  }

  _onMiningProgress(e) {
    const { active, blockType } = e.detail;
    if (!active || blockType === undefined) return;

    const now = performance.now() / 1000;
    if (now - this._lastHitTime >= this._hitInterval) {
      this._lastHitTime = now;
      this._playHit(getMaterial(blockType));
    }
  }

  _onBlockBreak(e) {
    const blockType = e.detail?.blockType;
    this._playBreak(getMaterial(blockType));
  }
}
