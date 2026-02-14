// Procedurally generated ambient music inspired by Minecraft's calm soundtrack.
// Piano-like tones via additive synthesis, algorithmic reverb, melodic motifs,
// evolving pad harmony, stereo panning, and expressive dynamics.

const PENTATONIC = [0, 2, 4, 7, 9]; // semitones from root

// Pad voicings as scale-degree indices (0-4 within pentatonic)
const VOICINGS = [
  [0, 2, 4],  // 1-3-5 (e.g. C-E-A)
  [0, 1, 3],  // 1-2-4 (e.g. C-D-G) — suspended
  [1, 3, 4],  // 2-4-5 (e.g. D-G-A)
  [3, 0, 2],  // 4-1-3 (e.g. G-C-E)
  [4, 1, 3],  // 5-2-4 (e.g. A-D-G)
];

// Rhythm templates — relative note durations for motif playback
const RHYTHMS = [
  [2, 1, 3, 2],
  [1, 1, 2, 4],
  [3, 1, 2, 2],
  [4, 2, 2],
  [2, 2, 1, 3],
  [1, 3, 2, 2],
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Convert a pentatonic scale degree + octave offset into Hz
function noteFreq(rootFreq, scaleDegree, octaveOffset) {
  const idx = ((scaleDegree % 5) + 5) % 5;
  const semitones = PENTATONIC[idx] + octaveOffset * 12;
  return rootFreq * Math.pow(2, semitones / 12);
}

export class AmbientMusic {
  constructor() {
    this._ctx = null;
    this._masterGain = null;
    this._dryGain = null;
    this._reverbGain = null;
    this._convolver = null;
    this._volume = 0.25;
    this._playing = false;
    this._pieceTimeout = null;
    this._paused = false;
    this._enabled = localStorage.getItem('ambientMusic') !== 'false';

    if (this._enabled) this._schedulePiece(4 + Math.random() * 6);

    document.addEventListener('game-state-change', (e) => {
      const state = e.detail.state;
      if (state === 'playing') this._resume();
      else if (state === 'paused' || state === 'title') this._pause();
    });
  }

  get enabled() { return this._enabled; }

  setEnabled(on) {
    this._enabled = on;
    localStorage.setItem('ambientMusic', on);
    if (on) {
      if (!this._playing) this._schedulePiece(2 + Math.random() * 4);
    } else {
      clearTimeout(this._pieceTimeout);
      // Fade out and stop
      if (this._masterGain && this._ctx) {
        this._masterGain.gain.setValueAtTime(this._masterGain.gain.value, this._ctx.currentTime);
        this._masterGain.gain.linearRampToValueAtTime(0, this._ctx.currentTime + 2);
      }
      this._playing = false;
    }
  }

  // ── Audio graph setup ──

  _ensureContext() {
    if (!this._ctx) {
      this._ctx = new AudioContext();

      this._masterGain = this._ctx.createGain();
      this._masterGain.gain.value = this._volume;
      this._masterGain.connect(this._ctx.destination);

      // Dry bus (direct signal)
      this._dryGain = this._ctx.createGain();
      this._dryGain.gain.value = 0.5;
      this._dryGain.connect(this._masterGain);

      // Reverb bus (convolution)
      this._convolver = this._ctx.createConvolver();
      this._convolver.buffer = this._createReverbIR(4.0, 2.0);
      this._reverbGain = this._ctx.createGain();
      this._reverbGain.gain.value = 0.5;
      this._convolver.connect(this._reverbGain);
      this._reverbGain.connect(this._masterGain);
    }
    if (this._ctx.state === 'suspended') this._ctx.resume();
    return this._ctx;
  }

  // Generate a stereo impulse response: pre-delay, early reflections, decaying tail
  _createReverbIR(duration, decay) {
    const ctx = this._ctx;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * duration);
    const buf = ctx.createBuffer(2, len, rate);
    const preDelay = Math.floor(rate * 0.015);
    const earlyEnd = Math.floor(rate * 0.08);

    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);

      // Early reflections (15-80 ms): sparse impulses
      for (let i = preDelay; i < Math.min(earlyEnd, len); i++) {
        if (Math.random() < 0.03) {
          data[i] = (Math.random() * 2 - 1) * 0.6;
        }
      }

      // Late reverb (80 ms+): dense noise with exponential decay
      for (let i = earlyEnd; i < len; i++) {
        const env = Math.pow(1 - i / len, decay);
        data[i] = (Math.random() * 2 - 1) * env;
      }

      // Simple lowpass smoothing to soften the tail
      let prev = 0;
      for (let i = 0; i < len; i++) {
        data[i] = prev * 0.35 + data[i] * 0.65;
        prev = data[i];
      }
    }

    return buf;
  }

  // ── Transport ──

  _pause() {
    this._paused = true;
    if (this._masterGain && this._ctx) {
      this._masterGain.gain.setValueAtTime(this._masterGain.gain.value, this._ctx.currentTime);
      this._masterGain.gain.linearRampToValueAtTime(0, this._ctx.currentTime + 2);
    }
  }

  _resume() {
    this._paused = false;
    if (this._masterGain && this._ctx) {
      this._masterGain.gain.setValueAtTime(this._masterGain.gain.value, this._ctx.currentTime);
      this._masterGain.gain.linearRampToValueAtTime(this._volume, this._ctx.currentTime + 2);
    }
  }

  _schedulePiece(delaySec) {
    clearTimeout(this._pieceTimeout);
    if (!this._enabled) return;
    this._pieceTimeout = setTimeout(() => {
      if (!this._enabled) return;
      if (this._paused) {
        this._schedulePiece(5);
        return;
      }
      this._playPiece();
    }, delaySec * 1000);
  }

  // ── Piano-like note (additive synthesis) ──

  _playNote(freq, time, duration, velocity, pan) {
    const ctx = this._ctx;

    // Harmonics mimic a soft piano: fundamental + overtones
    // Higher partials decay faster, slight inharmonicity for realism
    const harmonics = [1, 2, 3, 4, 5, 6, 8];
    const amps      = [1, 0.40, 0.15, 0.08, 0.04, 0.02, 0.008];
    const decayMul  = [1, 1.5, 2.2, 3.0, 4.0, 5.0, 7.0];

    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;

    // Note-level envelope: soft hammer attack → sustain → long release
    const noteGain = ctx.createGain();
    noteGain.gain.setValueAtTime(0, time);
    noteGain.gain.linearRampToValueAtTime(velocity, time + 0.01);
    noteGain.gain.exponentialRampToValueAtTime(velocity * 0.35, time + duration * 0.3);
    noteGain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    for (let h = 0; h < harmonics.length; h++) {
      const hFreq = freq * harmonics[h];
      if (hFreq > 12000) continue;

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = hFreq;
      // Slight inharmonicity on upper partials (real piano strings)
      if (h > 0) osc.detune.value = h * 0.7 * (Math.random() < 0.5 ? 1 : -1);

      const hGain = ctx.createGain();
      const hDur = Math.max(duration / decayMul[h], 0.2);
      hGain.gain.setValueAtTime(amps[h], time);
      hGain.gain.exponentialRampToValueAtTime(0.0001, time + hDur);

      osc.connect(hGain);
      hGain.connect(noteGain);
      osc.start(time);
      osc.stop(time + duration + 1);
    }

    // Brightness follows velocity (louder = brighter)
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2500 + velocity * 3000;
    filter.Q.value = 0.5;

    noteGain.connect(filter);
    filter.connect(panner);
    // Send to both dry and reverb buses
    panner.connect(this._dryGain);
    panner.connect(this._convolver);
  }

  // ── Motif generation ──

  _generateMotif(length) {
    const motif = [];
    let deg = pick([0, 2, 4]);
    let oct = 0;
    motif.push({ deg, oct });

    for (let i = 1; i < length; i++) {
      // 70 % stepwise, 30 % small leap
      if (Math.random() < 0.7) {
        deg += Math.random() < 0.5 ? 1 : -1;
      } else {
        deg += pick([-2, 2, -3, 3]);
      }
      // Wrap into adjacent octaves
      if (deg < 0)  { deg += 5; oct = Math.max(oct - 1, -1); }
      if (deg > 4)  { deg -= 5; oct = Math.min(oct + 1, 1); }
      motif.push({ deg, oct });
    }
    return motif;
  }

  // ── Piece composition ──

  _playPiece() {
    const ctx = this._ensureContext();
    this._playing = true;

    const now = ctx.currentTime;
    const pieceDuration = 40 + Math.random() * 35; // 40-75 s

    // Root frequency for this piece (C3–A3)
    const rootFreq = pick([130.81, 146.83, 164.81, 174.61, 196.00, 220.00]);

    // Pick 2-3 voicings that will crossfade during the pad
    const voicingCount = 2 + Math.floor(Math.random() * 2);
    const pool = [...VOICINGS];
    const usedVoicings = [];
    for (let i = 0; i < voicingCount; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      usedVoicings.push(pool.splice(idx, 1)[0]);
    }

    this._playPad(ctx, now, pieceDuration, rootFreq, usedVoicings);
    this._playMelody(ctx, now, pieceDuration, rootFreq);
    this._playBassLine(ctx, now, pieceDuration, rootFreq);

    // Next piece after a long silence (60-180 s)
    this._schedulePiece(pieceDuration + 60 + Math.random() * 120);
    setTimeout(() => { this._playing = false; }, pieceDuration * 1000);
  }

  // ── Evolving pad ──

  _playPad(ctx, startTime, duration, rootFreq, voicings) {
    const sectionDur = duration / voicings.length;
    const crossfade = 5;

    for (let v = 0; v < voicings.length; v++) {
      const voicing = voicings[v];
      const secStart = startTime + v * sectionDur;
      const secEnd   = secStart + sectionDur + crossfade;
      const fadeIn  = v === 0 ? 7 : crossfade;
      const fadeOut = v === voicings.length - 1 ? 9 : crossfade;

      for (let i = 0; i < voicing.length; i++) {
        const freq = noteFreq(rootFreq, voicing[i], 1);
        const pan = (i / (voicing.length - 1 || 1)) * 0.5 - 0.25;

        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.detune.value = (Math.random() - 0.5) * 5;

        // Subtle vibrato LFO
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.12 + Math.random() * 0.1;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 2;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.detune);
        lfo.start(secStart);
        lfo.stop(secEnd + 1);

        // Slow filter sweep for movement
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(350, secStart);
        filter.frequency.linearRampToValueAtTime(900, secStart + sectionDur * 0.5);
        filter.frequency.linearRampToValueAtTime(450, secEnd);
        filter.Q.value = 0.5;

        const panner = ctx.createStereoPanner();
        panner.pan.value = pan;

        const gain = ctx.createGain();
        const vol = 0.045;
        gain.gain.setValueAtTime(0, secStart);
        gain.gain.linearRampToValueAtTime(vol, secStart + fadeIn);
        gain.gain.setValueAtTime(vol, secEnd - fadeOut);
        gain.gain.linearRampToValueAtTime(0, secEnd);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(panner);
        panner.connect(this._dryGain);
        panner.connect(this._convolver);

        osc.start(secStart);
        osc.stop(secEnd + 1);
      }
    }
  }

  // ── Melody with motifs ──

  _playMelody(ctx, startTime, duration, rootFreq) {
    let t = startTime + 4 + Math.random() * 5;
    const endTime = startTime + duration - 10;
    const beatLen = 1.3 + Math.random() * 0.5; // tempo ~1.3-1.8 s per beat

    while (t < endTime) {
      const motifLen = 3 + Math.floor(Math.random() * 3);
      const motif = this._generateMotif(motifLen);
      const rhythm = pick(RHYTHMS);
      const repeats = 1 + Math.floor(Math.random() * 3); // 1-3 repeats

      for (let rep = 0; rep < repeats && t < endTime; rep++) {
        for (let n = 0; n < motif.length && t < endTime; n++) {
          const { deg, oct } = motif[n];
          const freq = noteFreq(rootFreq, deg, oct + 1);
          const noteDur = rhythm[n % rhythm.length] * beatLen;

          // Phrase-level dynamics: crescendo to midpoint then decrescendo
          const pos = n / motif.length;
          const curve = 1 - Math.abs(pos - 0.4) * 1.2;
          const velocity = (0.06 + Math.random() * 0.03) * Math.max(curve, 0.35);

          const pan = (Math.random() - 0.5) * 0.6;

          this._playNote(freq, t, noteDur + 2.5, velocity, pan);
          t += noteDur;
        }

        // Mutate one note before next repeat for variation
        if (rep < repeats - 1) {
          const mi = Math.floor(Math.random() * motif.length);
          motif[mi].deg = ((motif[mi].deg + pick([-1, 1, 2])) % 5 + 5) % 5;
          t += beatLen * (0.5 + Math.random());
        }
      }

      // Breathing space between phrases
      t += 3 + Math.random() * 5;
    }
  }

  // ── Deep bass ──

  _playBassLine(ctx, startTime, duration, rootFreq) {
    let t = startTime + 8 + Math.random() * 8;
    const endTime = startTime + duration - 12;

    while (t < endTime) {
      // Root or fifth, one octave below
      const bassFreq = rootFreq * (Math.random() < 0.65 ? 0.5 : 0.75);
      const noteDur = 6 + Math.random() * 8;

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = bassFreq;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.04, t + 3);
      gain.gain.setValueAtTime(0.04, t + noteDur - 4);
      gain.gain.linearRampToValueAtTime(0, t + noteDur);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 220;
      filter.Q.value = 0.3;

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this._dryGain);

      osc.start(t);
      osc.stop(t + noteDur + 0.5);

      t += noteDur + 8 + Math.random() * 12;
    }
  }
}
