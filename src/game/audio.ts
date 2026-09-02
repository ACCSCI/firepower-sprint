import type { WeaponType } from './types';

type LegacySoundName = 'shot' | 'hit-1' | 'hit-2' | 'hurt' | 'defeat' | 'boss-defeat' | 'upgrade' | 'select' | 'lose' | 'victory';
type ProSoundName = 'pistol-1' | 'pistol-2' | 'rifle-1' | 'rifle-2' | 'gatling-burst' | 'run-steps' | 'enemy-hit' | 'enemy-defeat' | 'gate-positive' | 'gate-negative' | 'boss-roar' | 'boss-phase';
type SoundName = LegacySoundName | ProSoundName;

interface PlayOptions {
  volume: number;
  rateVariation?: number;
  baseRate?: number;
  pan?: number;
  delay?: number;
}

const LEGACY_URLS: Record<LegacySoundName, string> = {
  shot: './audio/shot.ogg', 'hit-1': './audio/hit-1.ogg', 'hit-2': './audio/hit-2.ogg',
  hurt: './audio/hurt.ogg', defeat: './audio/defeat.ogg', 'boss-defeat': './audio/boss-defeat.ogg',
  upgrade: './audio/upgrade.ogg', select: './audio/select.ogg', lose: './audio/lose.ogg', victory: './audio/victory.ogg',
};
const PRO_URLS: Record<ProSoundName, string> = {
  'pistol-1': './audio/pro/pistol-1.ogg', 'pistol-2': './audio/pro/pistol-2.ogg',
  'rifle-1': './audio/pro/rifle-1.ogg', 'rifle-2': './audio/pro/rifle-2.ogg',
  'gatling-burst': './audio/pro/gatling-burst.ogg', 'run-steps': './audio/pro/run-steps.ogg',
  'enemy-hit': './audio/pro/enemy-hit.ogg', 'enemy-defeat': './audio/pro/enemy-defeat.ogg',
  'gate-positive': './audio/pro/gate-positive.ogg', 'gate-negative': './audio/pro/gate-negative.ogg',
  'boss-roar': './audio/pro/boss-roar.ogg', 'boss-phase': './audio/pro/boss-phase.ogg',
};
const SOUND_URLS: Record<SoundName, string> = { ...LEGACY_URLS, ...PRO_URLS };
const WEAPON_VARIANTS: Record<WeaponType, readonly SoundName[]> = {
  pistol: ['pistol-1', 'pistol-2'], rifle: ['rifle-1', 'rifle-2'], gatling: ['gatling-burst'],
};

export class GameAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private compressor?: DynamicsCompressorNode;
  private readonly buffers = new Map<SoundName, AudioBuffer>();
  private readonly lastPlayed = new Map<string, number>();
  private readonly lastWeaponVariant = new Map<WeaponType, number>();
  private muted = localStorage.getItem('power-path-muted') === 'true';
  private hitVariant = 0;
  private runRequested = false;
  private runSource?: AudioBufferSourceNode;
  private runGain?: GainNode;

  get isMuted(): boolean { return this.muted; }

  start(): void {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      this.compressor = this.context.createDynamicsCompressor();
      this.master.gain.value = this.muted ? 0 : 0.42;
      this.compressor.threshold.value = -18;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 5;
      this.compressor.attack.value = 0.004;
      this.compressor.release.value = 0.16;
      this.master.connect(this.compressor);
      this.compressor.connect(this.context.destination);
      void this.loadSounds();
    }
    void this.context.resume();
    this.syncRunLoop();
  }

  toggleMuted(): boolean {
    this.muted = !this.muted;
    localStorage.setItem('power-path-muted', String(this.muted));
    if (this.context && this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.42, this.context.currentTime, 0.015);
    if (!this.muted) this.syncRunLoop();
    return this.muted;
  }

  shot(weapon: WeaponType, crewCount = 1): void {
    const settings = {
      pistol: { volume: 0.31, rate: 1.04, variation: 0.035, interval: 0.055 },
      rifle: { volume: 0.36, rate: 1, variation: 0.025, interval: 0.038 },
      gatling: { volume: 0.29, rate: 1, variation: 0.018, interval: 0.075 },
    }[weapon];
    if (!this.canPlay(`weapon:${weapon}`, settings.interval)) return;
    const played = this.play(this.pickWeaponVariant(weapon), {
      volume: settings.volume, rateVariation: settings.variation, baseRate: settings.rate,
      pan: (Math.random() * 2 - 1) * 0.08,
    });
    const maxLayers = weapon === 'gatling' ? 1 : 3;
    const layers = Math.min(maxLayers, Math.max(0, Math.floor(crewCount) - 1));
    for (let i = 0; played && i < layers; i += 1) {
      this.play(this.pickWeaponVariant(weapon), {
        volume: settings.volume * (0.34 - i * 0.055), rateVariation: settings.variation + 0.025,
        baseRate: settings.rate + 0.015 * i, pan: (i % 2 ? 1 : -1) * (0.16 + i * 0.08), delay: 0.012 + i * 0.011,
      });
    }
    if (!played && !this.play('shot', { volume: settings.volume, rateVariation: 0.045, baseRate: settings.rate })) {
      this.tone(weapon === 'gatling' ? 150 : 230, 100, 0.05, 'square', 0.07);
    }
  }

  /** Starts or stops the seamless running loop. Safe to call every frame. */
  run(active: boolean): void {
    if (this.runRequested === active) return;
    this.runRequested = active;
    this.syncRunLoop();
  }

  gate(negative: boolean): void {
    if (!this.canPlay('gate', 0.12)) return;
    if (!this.play(negative ? 'gate-negative' : 'gate-positive', { volume: negative ? 0.56 : 0.62, rateVariation: 0.015 })) {
      this.tone(negative ? 180 : 430, negative ? 62 : 880, negative ? 0.2 : 0.18, negative ? 'sawtooth' : 'triangle', 0.12);
    }
  }

  bossRoar(): void {
    if (this.canPlay('boss-roar', 1.4) && !this.play('boss-roar', { volume: 0.86, rateVariation: 0.015 })) this.tone(92, 38, 0.48, 'sawtooth', 0.18);
  }

  bossPhase(): void {
    if (this.canPlay('boss-phase', 0.8) && !this.play('boss-phase', { volume: 0.82, rateVariation: 0.012 })) this.tone(74, 190, 0.36, 'square', 0.16);
  }

  /** Synthesized sub-bass blast and filtered impact noise; requires no downloaded asset. */
  bomb(): void {
    if (!this.context || !this.master || this.muted || !this.canPlay('bomb', 0.3)) return;
    const context = this.context;
    const now = context.currentTime;

    const rumble = context.createOscillator();
    const rumbleGain = context.createGain();
    rumble.type = 'sine';
    rumble.frequency.setValueAtTime(92, now);
    rumble.frequency.exponentialRampToValueAtTime(31, now + 0.58);
    rumbleGain.gain.setValueAtTime(0.001, now);
    rumbleGain.gain.exponentialRampToValueAtTime(0.78, now + 0.012);
    rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.62);
    rumble.connect(rumbleGain); rumbleGain.connect(this.master);
    rumble.start(now); rumble.stop(now + 0.64);

    const duration = 0.46;
    const noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const noise = noiseBuffer.getChannelData(0);
    for (let index = 0; index < noise.length; index += 1) {
      const decay = 1 - index / noise.length;
      noise[index] = (Math.random() * 2 - 1) * decay * decay;
    }
    const impact = context.createBufferSource();
    const lowpass = context.createBiquadFilter();
    const impactGain = context.createGain();
    impact.buffer = noiseBuffer;
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(920, now);
    lowpass.frequency.exponentialRampToValueAtTime(105, now + duration);
    lowpass.Q.value = 0.72;
    impactGain.gain.setValueAtTime(0.72, now);
    impactGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    impact.connect(lowpass); lowpass.connect(impactGain); impactGain.connect(this.master);
    impact.start(now); impact.stop(now + duration);
  }

  hit(): void {
    if (!this.canPlay('enemy-hit', 0.032)) return;
    if (this.play('enemy-hit', { volume: 0.34, rateVariation: 0.07, pan: (Math.random() * 2 - 1) * 0.18 })) return;
    const legacy: SoundName = this.hitVariant++ % 2 === 0 ? 'hit-1' : 'hit-2';
    if (!this.play(legacy, { volume: 0.34, rateVariation: 0.08 })) this.tone(105, 55, 0.06, 'sawtooth', 0.08);
  }

  defeat(boss: boolean): void {
    if (!this.canPlay(boss ? 'boss-defeat' : 'enemy-defeat', 0.08)) return;
    const played = this.play(boss ? 'boss-defeat' : 'enemy-defeat', {
      volume: boss ? 0.82 : 0.45, rateVariation: boss ? 0 : 0.055, pan: boss ? 0 : (Math.random() * 2 - 1) * 0.2,
    });
    if (played || (!boss && this.play('defeat', { volume: 0.42, rateVariation: 0.06 }))) return;
    this.tone(boss ? 72 : 115, 38, boss ? 0.32 : 0.15, 'sawtooth', boss ? 0.2 : 0.1);
  }

  upgrade(): void { if (!this.play('upgrade', { volume: 0.65, rateVariation: 0.02 })) this.tone(420, 780, 0.16, 'sine', 0.12); }
  hurt(): void { if (!this.play('hurt', { volume: 0.58, rateVariation: 0.04 })) this.tone(90, 45, 0.18, 'sawtooth', 0.13); }
  select(): void { if (!this.play('select', { volume: 0.62 })) this.tone(360, 520, 0.08, 'sine', 0.09); }
  lose(): void { this.run(false); if (!this.play('lose', { volume: 0.7 })) this.tone(220, 70, 0.3, 'sawtooth', 0.13); }
  victory(): void {
    this.run(false);
    if (this.play('victory', { volume: 0.78 })) return;
    [0, 0.12, 0.24].forEach((delay, i) => window.setTimeout(() => this.tone([523, 659, 784][i], [659, 784, 1046][i], 0.22, 'triangle', 0.12), delay * 1000));
  }

  private async loadSounds(): Promise<void> {
    if (!this.context) return;
    await Promise.all(Object.entries(SOUND_URLS).map(async ([name, url]) => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Audio request failed: ${response.status}`);
        const decoded = await this.context?.decodeAudioData(await response.arrayBuffer());
        if (decoded) this.buffers.set(name as SoundName, decoded);
      } catch (error) { console.warn(`Unable to load ${name} sound; using synthesized fallback.`, error); }
    }));
    this.syncRunLoop();
  }

  private pickWeaponVariant(weapon: WeaponType): SoundName {
    const variants = WEAPON_VARIANTS[weapon];
    if (variants.length === 1) return variants[0];
    const previous = this.lastWeaponVariant.get(weapon) ?? -1;
    let next = Math.floor(Math.random() * variants.length);
    if (next === previous) next = (next + 1) % variants.length;
    this.lastWeaponVariant.set(weapon, next);
    return variants[next];
  }

  private canPlay(key: string, interval: number): boolean {
    if (!this.context || !this.master || this.muted) return true;
    const now = this.context.currentTime;
    if (now - (this.lastPlayed.get(key) ?? -Infinity) < interval) return false;
    this.lastPlayed.set(key, now);
    return true;
  }

  private play(name: SoundName, options: PlayOptions): boolean {
    if (!this.context || !this.master || this.muted) return true;
    const buffer = this.buffers.get(name);
    if (!buffer) return false;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    source.buffer = buffer;
    source.playbackRate.value = (options.baseRate ?? 1) + (Math.random() * 2 - 1) * (options.rateVariation ?? 0);
    gain.gain.value = options.volume;
    panner.pan.value = Math.max(-1, Math.min(1, options.pan ?? 0));
    source.connect(gain); gain.connect(panner); panner.connect(this.master);
    source.start(this.context.currentTime + (options.delay ?? 0));
    return true;
  }

  private syncRunLoop(): void {
    if (!this.context || !this.master) return;
    if (!this.runRequested) {
      if (this.runGain) this.runGain.gain.setTargetAtTime(0, this.context.currentTime, 0.035);
      if (this.runSource) {
        const oldSource = this.runSource;
        window.setTimeout(() => { try { oldSource.stop(); } catch { /* already stopped */ } }, 120);
      }
      this.runSource = undefined; this.runGain = undefined;
      return;
    }
    if (this.runSource || this.muted) return;
    const buffer = this.buffers.get('run-steps');
    if (!buffer) return;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    source.buffer = buffer; source.loop = true;
    gain.gain.setValueAtTime(0.001, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.14, this.context.currentTime + 0.08);
    panner.pan.value = -0.04;
    source.connect(gain); gain.connect(panner); panner.connect(this.master); source.start();
    this.runSource = source; this.runGain = gain;
  }

  private tone(from: number, to: number, duration: number, type: OscillatorType, volume: number): void {
    if (!this.context || !this.master || this.muted) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain); gain.connect(this.master); oscillator.start(now); oscillator.stop(now + duration);
  }
}
