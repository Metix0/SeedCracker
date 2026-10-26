/**
 * Fully procedural audio (Web Audio API, no sound files).
 *
 *  - Orb pickups play rising pentatonic notes, so collecting a ring plays a melody.
 *  - Smashes are glassy inharmonic "crystal" partials, brighter and longer in chains.
 *  - The ambient score is a set of persistent oscillators (pad, bass, arp, hats, kick)
 *    whose layers fade in with the multiplier and whose key/chords change with the phase.
 *  - Frequently used voices are pooled & retriggered (no node creation per pickup).
 */

interface Bell { o1: OscillatorNode; o2: OscillatorNode; g: GainNode; g2: GainNode }
interface Crystal { o: OscillatorNode[]; g: GainNode[]; }

const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

interface Key { root: number; chords: number[][]; penta: number[] }
const KEYS: Key[] = [
  { root: 57, chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [3, 7, 10, 14], [-2, 2, 5, 10]], penta: [0, 3, 5, 7, 10] },
  { root: 60, chords: [[0, 4, 7, 11], [5, 9, 12, 16], [2, 5, 9, 12], [7, 11, 14, 17]], penta: [0, 2, 4, 7, 9] },
  { root: 55, chords: [[0, 3, 7, 10], [5, 9, 12, 15], [-2, 2, 5, 9], [3, 7, 10, 14]], penta: [0, 3, 5, 7, 10] },
  { root: 62, chords: [[0, 4, 7, 14], [-3, 0, 4, 7], [5, 9, 12, 16], [2, 5, 9, 12]], penta: [0, 2, 4, 7, 9] },
  { root: 58, chords: [[0, 3, 7, 10], [-4, 0, 3, 8], [-2, 2, 5, 9], [-5, -1, 2, 7]], penta: [0, 3, 5, 7, 10] },
  { root: 64, chords: [[0, 4, 7, 11], [-3, 0, 4, 9], [-7, -3, 0, 4], [-5, -1, 2, 7]], penta: [0, 2, 4, 7, 9] },
  { root: 53, chords: [[0, 3, 7, 11], [-4, 0, 3, 8], [-7, -4, 0, 3], [-5, -1, 2, 7]], penta: [0, 3, 5, 7, 10] },
];

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private reverb!: ConvolverNode;
  private revSend!: GainNode;
  private detune!: ConstantSourceNode;
  private noise!: AudioBuffer;
  private bells: Bell[] = [];
  private bellIdx = 0;
  private crystals: Crystal[] = [];
  private crystalIdx = 0;
  private hiss!: GainNode;
  private hissFilter!: BiquadFilterNode;

  // music voices
  private pad: OscillatorNode[] = [];
  private padFilter!: BiquadFilterNode;
  private padGain!: GainNode;
  private bass!: OscillatorNode; private bassGain!: GainNode;
  private arp!: OscillatorNode; private arpGain!: GainNode; private arpFilter!: BiquadFilterNode;
  private hat!: GainNode;
  private kick!: OscillatorNode; private kickGain!: GainNode;
  private layerGains: GainNode[] = [];

  private nextTime = 0;
  private step16 = 0;
  private bar = 0;
  private beatTimes = new Float64Array(8);
  private beatIdx = 0;

  musicVol = 0.7;
  sfxVol = 0.9;
  private intensity = 0;
  private keyIdx = 0;
  private tempoMul = 1;
  private slow = false;
  private bpm = 96;
  private started = false;
  private fallbackT0 = performance.now();

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture (Safari / iPadOS requirement). */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.build();
      }
      if (this.ctx.state !== 'running') void this.ctx.resume();
      // iOS: play a silent buffer inside the gesture
      const b = this.ctx.createBuffer(1, 1, 22050);
      const s = this.ctx.createBufferSource();
      s.buffer = b;
      s.connect(this.ctx.destination);
      s.start(0);
      if (!this.started) this.startMusic();
    } catch {
      /* audio is optional */
    }
  }

  suspend(): void {
    try { if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend(); } catch { /* ignore */ }
  }

  resume(): void {
    try { if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume(); } catch { /* ignore */ }
  }

  setVolumes(music: number, sfx: number): void {
    this.musicVol = music;
    this.sfxVol = sfx;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(music * 0.55, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(sfx * 0.9, t, 0.05);
  }

  private build(): void {
    const c = this.ctx!;
    this.master = c.createGain();
    this.master.gain.value = 0.9;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master.connect(comp);
    comp.connect(c.destination);

    this.musicBus = c.createGain();
    this.sfxBus = c.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);

    // reverb
    this.reverb = c.createConvolver();
    this.reverb.buffer = this.impulse(2.6);
    this.revSend = c.createGain();
    this.revSend.gain.value = 0.5;
    this.revSend.connect(this.reverb);
    this.reverb.connect(this.master);

    // noise buffer
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.detune = c.createConstantSource();
    this.detune.offset.value = 0;
    this.detune.start();

    // bell voices (orb notes)
    for (let i = 0; i < 14; i++) {
      const o1 = c.createOscillator(), o2 = c.createOscillator();
      o1.type = 'sine'; o2.type = 'triangle';
      const g = c.createGain(), g2 = c.createGain();
      g.gain.value = 0; g2.gain.value = 0;
      o1.connect(g); o2.connect(g2);
      g.connect(this.sfxBus); g2.connect(this.sfxBus);
      g.connect(this.revSend); g2.connect(this.revSend);
      o1.start(); o2.start();
      this.bells.push({ o1, o2, g, g2 });
    }
    // crystal voices (smashes)
    for (let i = 0; i < 6; i++) {
      const o: OscillatorNode[] = [], g: GainNode[] = [];
      for (let k = 0; k < 4; k++) {
        const osc = c.createOscillator();
        osc.type = 'sine';
        const gg = c.createGain();
        gg.gain.value = 0;
        osc.connect(gg);
        gg.connect(this.sfxBus);
        gg.connect(this.revSend);
        osc.start();
        o.push(osc); g.push(gg);
      }
      this.crystals.push({ o, g });
    }
    // persistent noise hiss channel (smash sparkle / whooshes)
    const ns = c.createBufferSource();
    ns.buffer = this.noise;
    ns.loop = true;
    this.hissFilter = c.createBiquadFilter();
    this.hissFilter.type = 'bandpass';
    this.hissFilter.frequency.value = 6000;
    this.hissFilter.Q.value = 0.8;
    this.hiss = c.createGain();
    this.hiss.gain.value = 0;
    ns.connect(this.hissFilter);
    this.hissFilter.connect(this.hiss);
    this.hiss.connect(this.sfxBus);
    this.hiss.connect(this.revSend);
    ns.start();

    this.buildMusic();
    this.setVolumes(this.musicVol, this.sfxVol);
  }

  private impulse(sec: number): AudioBuffer {
    const c = this.ctx!;
    const len = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return b;
  }

  private buildMusic(): void {
    const c = this.ctx!;
    const layer = (): GainNode => {
      const g = c.createGain();
      g.gain.value = 0;
      g.connect(this.musicBus);
      g.connect(this.revSend);
      this.layerGains.push(g);
      return g;
    };
    // L0 pad
    const L0 = layer();
    this.padFilter = c.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 700;
    this.padFilter.Q.value = 0.6;
    this.padGain = c.createGain();
    this.padGain.gain.value = 0.11;
    this.padFilter.connect(this.padGain);
    this.padGain.connect(L0);
    for (let i = 0; i < 8; i++) {
      const o = c.createOscillator();
      o.type = i % 2 === 0 ? 'sawtooth' : 'triangle';
      o.detune.value = (i % 2 === 0 ? -7 : 7);
      this.detune.connect(o.detune);
      o.connect(this.padFilter);
      o.start();
      this.pad.push(o);
    }
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = c.createGain();
    lfoG.gain.value = 260;
    lfo.connect(lfoG);
    lfoG.connect(this.padFilter.frequency);
    lfo.start();

    // L1 bass
    const L1 = layer();
    this.bass = c.createOscillator();
    this.bass.type = 'triangle';
    this.bassGain = c.createGain();
    this.bassGain.gain.value = 0;
    this.detune.connect(this.bass.detune);
    this.bass.connect(this.bassGain);
    this.bassGain.connect(L1);
    this.bass.start();

    // L2 arp
    const L2 = layer();
    this.arp = c.createOscillator();
    this.arp.type = 'triangle';
    this.arpFilter = c.createBiquadFilter();
    this.arpFilter.type = 'lowpass';
    this.arpFilter.frequency.value = 3200;
    this.arpGain = c.createGain();
    this.arpGain.gain.value = 0;
    this.detune.connect(this.arp.detune);
    this.arp.connect(this.arpFilter);
    this.arpFilter.connect(this.arpGain);
    this.arpGain.connect(L2);
    this.arp.start();

    // L3 hats
    const L3 = layer();
    const hs = c.createBufferSource();
    hs.buffer = this.noise;
    hs.loop = true;
    const hf = c.createBiquadFilter();
    hf.type = 'highpass';
    hf.frequency.value = 7500;
    this.hat = c.createGain();
    this.hat.gain.value = 0;
    hs.connect(hf);
    hf.connect(this.hat);
    this.hat.connect(L3);
    hs.start();

    // L4 kick
    const L4 = layer();
    this.kick = c.createOscillator();
    this.kick.type = 'sine';
    this.kickGain = c.createGain();
    this.kickGain.gain.value = 0;
    this.kick.connect(this.kickGain);
    this.kickGain.connect(L4);
    this.kick.start();
  }

  private startMusic(): void {
    if (!this.ctx) return;
    this.started = true;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.applyChord(this.ctx.currentTime, 0);
    this.applyIntensity();
    window.setInterval(this.schedule, 25);
  }

  /** music layers follow the multiplier (0..10) */
  setIntensity(mult: number): void {
    if (mult === this.intensity) return;
    this.intensity = mult;
    this.applyIntensity();
  }

  private applyIntensity(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const m = this.intensity;
    const lv = [1, m >= 2 ? 1 : 0, m >= 3 ? 1 : 0, m >= 5 ? 1 : 0, m >= 7 ? 1 : 0];
    for (let i = 0; i < this.layerGains.length; i++) this.layerGains[i].gain.setTargetAtTime(lv[i], t, 0.8);
    this.padFilter.frequency.setTargetAtTime(700 + m * 160, t, 1.0);
  }

  setPhase(phase: number): void {
    this.keyIdx = (phase - 1) % KEYS.length;
    this.bpm = 96 + Math.min(30, (phase - 1) * 4);
  }

  setPrism(on: boolean): void {
    this.tempoMul = on ? 1.28 : 1;
  }

  setSlow(on: boolean): void {
    this.slow = on;
    if (!this.ctx) return;
    this.detune.offset.setTargetAtTime(on ? -500 : 0, this.ctx.currentTime, on ? 0.15 : 0.3);
  }

  stopMusic(fade = 1.2): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const g of this.layerGains) g.gain.setTargetAtTime(0, t, fade / 3);
  }

  restoreMusic(): void {
    this.applyIntensity();
  }

  private beatDur(): number {
    return 60 / (this.bpm * this.tempoMul * (this.slow ? 0.7 : 1));
  }

  /** 0..1 pulse on every beat (for the core / background) */
  beat(): number {
    if (!this.ctx || this.ctx.state !== 'running') {
      const p = ((performance.now() - this.fallbackT0) / 625) % 1;
      return Math.exp(-p * 5);
    }
    const now = this.ctx.currentTime;
    let latest = -1;
    for (let i = 0; i < 8; i++) {
      const b = this.beatTimes[i];
      if (b <= now && b > latest) latest = b;
    }
    if (latest < 0) return 0;
    return Math.exp(-((now - latest) / this.beatDur()) * 5);
  }

  private schedule = (): void => {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    while (this.nextTime < c.currentTime + 0.12) {
      this.scheduleStep(this.nextTime);
      this.nextTime += this.beatDur() / 4;
    }
  };

  private applyChord(t: number, idx: number): void {
    const key = KEYS[this.keyIdx];
    const ch = key.chords[idx % key.chords.length];
    for (let i = 0; i < this.pad.length; i++) {
      const n = key.root - 12 + ch[(i >> 1) % ch.length] + (i >= 6 ? 12 : 0);
      this.pad[i].frequency.setTargetAtTime(midi(n), t, 0.12);
    }
    this.bass.frequency.setValueAtTime(midi(key.root - 24 + ch[0]), t);
  }

  private scheduleStep(t: number): void {
    const s = this.step16;
    const key = KEYS[this.keyIdx];
    const ch = key.chords[this.bar % key.chords.length];
    if (s === 0) this.applyChord(t, this.bar);
    if (s % 4 === 0) {
      this.beatTimes[this.beatIdx] = t;
      this.beatIdx = (this.beatIdx + 1) % 8;
      // bass pulse
      const bg = this.bassGain.gain;
      bg.cancelScheduledValues(t);
      bg.setValueAtTime(0.0001, t);
      bg.linearRampToValueAtTime(0.32, t + 0.012);
      bg.exponentialRampToValueAtTime(0.0001, t + this.beatDur() * 0.9);
      // kick
      const kg = this.kickGain.gain;
      kg.cancelScheduledValues(t);
      kg.setValueAtTime(0.0001, t);
      kg.linearRampToValueAtTime(0.75, t + 0.004);
      kg.exponentialRampToValueAtTime(0.0001, t + 0.28);
      this.kick.frequency.cancelScheduledValues(t);
      this.kick.frequency.setValueAtTime(140, t);
      this.kick.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    }
    // arp (16ths, pattern over chord tones)
    const n = key.root + ch[ARP_PATTERN[s % 8] % ch.length] + (s >= 8 ? 12 : 0);
    this.arp.frequency.setValueAtTime(midi(n), t);
    const ag = this.arpGain.gain;
    ag.cancelScheduledValues(t);
    ag.setValueAtTime(0.0001, t);
    ag.linearRampToValueAtTime(0.09, t + 0.006);
    ag.exponentialRampToValueAtTime(0.0001, t + 0.16);
    // hats on off-beats
    if (s % 4 === 2) {
      const hg = this.hat.gain;
      hg.cancelScheduledValues(t);
      hg.setValueAtTime(0.0001, t);
      hg.linearRampToValueAtTime(0.12, t + 0.002);
      hg.exponentialRampToValueAtTime(0.0001, t + 0.05);
    }
    this.step16 = (s + 1) % 16;
    if (this.step16 === 0) this.bar = (this.bar + 1) % 64;
  }

  // ------------------------------------------------------------------ SFX

  private bellNote(freq: number, vol: number, decay: number, when = 0): void {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const v = this.bells[this.bellIdx];
    this.bellIdx = (this.bellIdx + 1) % this.bells.length;
    const t = c.currentTime + when;
    const g = v.g.gain, g2 = v.g2.gain;
    g.cancelScheduledValues(t); g2.cancelScheduledValues(t);
    g.setValueAtTime(0, t); g2.setValueAtTime(0, t);
    v.o1.frequency.setValueAtTime(freq, t);
    v.o2.frequency.setValueAtTime(freq * 2, t);
    g.linearRampToValueAtTime(vol, t + 0.005);
    g2.linearRampToValueAtTime(vol * 0.18, t + 0.005);
    g.exponentialRampToValueAtTime(0.0001, t + decay);
    g2.exponentialRampToValueAtTime(0.0001, t + decay * 0.5);
  }

  /** Orb pickup: n-th note of the combo on the pentatonic scale. */
  collect(n: number): void {
    const key = KEYS[this.keyIdx];
    const span = 15;
    const k = n % (span * 2);
    const i = k < span ? k : span * 2 - k;
    const deg = key.penta[i % 5] + 12 * Math.floor(i / 5);
    this.bellNote(midi(key.root + 12 + deg), 0.2, 0.55);
  }

  private crystal(base: number, vol: number, decay: number): void {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const v = this.crystals[this.crystalIdx];
    this.crystalIdx = (this.crystalIdx + 1) % this.crystals.length;
    const t = c.currentTime;
    const ratios = CRYSTAL_RATIOS;
    for (let k = 0; k < 4; k++) {
      const g = v.g[k].gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(0, t);
      v.o[k].frequency.setValueAtTime(base * ratios[k] * (1 + (Math.random() - 0.5) * 0.01), t);
      const a = vol * CRYSTAL_AMPS[k];
      g.linearRampToValueAtTime(a, t + 0.003);
      g.exponentialRampToValueAtTime(0.0001, t + decay * CRYSTAL_DECAYS[k]);
    }
    const h = this.hiss.gain;
    h.cancelScheduledValues(t);
    h.setValueAtTime(0, t);
    this.hissFilter.frequency.setValueAtTime(5000 + base, t);
    h.linearRampToValueAtTime(vol * 0.5, t + 0.002);
    h.exponentialRampToValueAtTime(0.0001, t + 0.09 + decay * 0.08);
  }

  smash(size: number, chain: number): void {
    const key = KEYS[this.keyIdx];
    const c = Math.min(chain, 8);
    const base = midi(key.root + 24 + key.penta[c % 5] + (c >= 5 ? 12 : 0)) * (size > 90 ? 0.5 : 1);
    this.crystal(base, 0.16 + c * 0.03, 0.55 + c * 0.12);
    if (chain >= 2) {
      // chains add a quick sparkling arpeggio, longer the longer the chain
      for (let i = 0; i < Math.min(chain, 6); i++) {
        this.bellNote(midi(key.root + 24 + key.penta[i % 5] + 12 * Math.floor(i / 5) + 12), 0.08 + 0.01 * c, 0.4, i * 0.045);
      }
    }
  }

  /** Low double thump while the spark falls towards the core; louder when closer. */
  heartbeat(level: number): void {
    const v = 0.18 + 0.32 * level;
    this.oneShot('sine', 75, 42, 0.16, v, 400);
    this.oneShot('sine', 70, 40, 0.14, v * 0.7, 400, 0.17);
  }

  nearMiss(): void {
    this.whoosh(1800, 5500, 0.18, 0.16);
  }

  thread(): void {
    const key = KEYS[this.keyIdx];
    this.bellNote(midi(key.root + 24), 0.2, 0.9);
    this.bellNote(midi(key.root + 31), 0.16, 0.9, 0.07);
    this.bellNote(midi(key.root + 36), 0.14, 1.1, 0.14);
  }

  multUp(level: number): void {
    const key = KEYS[this.keyIdx];
    for (let i = 0; i < 5; i++) this.bellNote(midi(key.root + 12 + key.penta[i] + (level > 5 ? 12 : 0)), 0.16, 0.9, i * 0.05);
    this.whoosh(300, 4000, 0.6, 0.18);
    this.oneShot('sawtooth', midi(key.root - 12), midi(key.root), 0.5, 0.08, 1800);
  }

  multDown(): void {
    const key = KEYS[this.keyIdx];
    this.oneShot('triangle', midi(key.root + 7), midi(key.root - 5), 0.35, 0.12, 1500);
  }

  phase(): void {
    const key = KEYS[this.keyIdx];
    this.oneShot('sine', midi(key.root - 24), midi(key.root - 24), 3.2, 0.4, 600);
    this.oneShot('triangle', midi(key.root - 12), midi(key.root - 12), 2.6, 0.18, 1200);
    this.whoosh(200, 2500, 1.4, 0.2);
  }

  booster(type: number): void {
    const key = KEYS[this.keyIdx];
    const pat = type === 0 ? [0, 4, 7, 12, 16, 19] : [0, 7, 12, 19];
    for (let i = 0; i < pat.length; i++) this.bellNote(midi(key.root + 24 + pat[i]), 0.14, 0.7, i * 0.04);
    if (type === 0) this.whoosh(400, 9000, 0.9, 0.22);
    if (type === 6) this.oneShot('sawtooth', 60, 30, 1.6, 0.25, 900);
  }

  warn(): void {
    this.oneShot('square', 880, 880, 0.12, 0.05, 2500);
    this.oneShot('square', 660, 660, 0.12, 0.05, 2500, 0.16);
  }

  laser(): void {
    this.oneShot('sawtooth', 1400, 180, 0.45, 0.16, 3500);
    this.noiseHit(0.35, 5000, 0.18);
  }

  heatWarn(): void {
    this.oneShot('sawtooth', 70, 160, 1.6, 0.16, 900);
  }

  heatBurst(): void {
    this.oneShot('sawtooth', 220, 50, 0.6, 0.22, 1600);
    this.noiseHit(0.5, 1200, 0.3);
  }

  mineBoom(): void {
    this.oneShot('sine', 120, 35, 0.8, 0.5, 400);
    this.noiseHit(0.7, 900, 0.35);
  }

  shieldBreak(): void {
    this.crystal(520, 0.3, 1.2);
    this.noiseHit(0.4, 3000, 0.25);
  }

  death(): void {
    this.oneShot('sawtooth', 300, 40, 1.8, 0.3, 1400);
    this.oneShot('sine', 90, 28, 1.6, 0.6, 300);
    this.noiseHit(1.4, 2200, 0.45);
    this.stopMusic(2.4);
  }

  countdown(final: boolean): void {
    this.bellNote(final ? 1318.5 : 880, 0.22, final ? 0.7 : 0.25);
  }

  ui(): void {
    this.bellNote(1567.98, 0.08, 0.12);
  }

  private oneShot(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, cutoff: number, when = 0): void {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.sfxBus); g.connect(this.revSend);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseHit(dur: number, cutoff: number, vol: number): void {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(80, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfxBus); g.connect(this.revSend);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  private whoosh(f0: number, f1: number, dur: number, vol: number): void {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfxBus); g.connect(this.revSend);
    s.start(t);
    s.stop(t + dur + 0.05);
  }
}

const ARP_PATTERN = [0, 2, 1, 3, 2, 1, 3, 2];
const CRYSTAL_RATIOS = [1, 2.756, 5.404, 8.933];
const CRYSTAL_AMPS = [1, 0.55, 0.32, 0.18];
const CRYSTAL_DECAYS = [1, 0.7, 0.45, 0.3];
