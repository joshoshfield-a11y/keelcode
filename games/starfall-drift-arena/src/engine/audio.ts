/**
 * WebAudio synthesized SFX + generative music bed. Zero audio assets.
 *
 * Owning knowledge: KB `core/06-audio.md` (the XANDRIA `engine/core/Audio.ts`
 * reference pattern, reimplemented): bus model — sfxBus/musicBus feed a
 * shared compressor into master into destination; music bed kept low
 * (0.6-ish), mute hits master only, voice cap with quietest-steal replaced
 * here by a simple cap-and-drop since SFX are short.
 *
 * - `resume()` must be called from a user gesture (autoplay lockout); the
 *   context is created lazily there, never at import time.
 * - SFX ids: 'shoot' | 'hit' | 'pickup' | 'jump' | 'die' | 'ui'. Unknown ids
 *   are ignored (not an error; demo code can probe freely).
 * - `setIntensity(0..1)` drives the generative music layer (note density +
 *   music bus level), ramped, never jumped.
 * - Pitch wobble per playback uses `Math.random()` — explicitly cosmetic per
 *   the engine's RNG discipline; the sim never depends on it.
 */

export interface AudioSys {
  /** Create/resume the AudioContext. Call from a user gesture. */
  resume(): void;
  play(id: string, opts?: { volume?: number }): void;
  setIntensity(x: number): void;
  setMuted(m: boolean): void;
}

const MAX_VOICES = 24;
const PENTA = [0, 3, 5, 7, 10, 12, 15]; // minor pentatonic, two octaves-ish
const MUSIC_ROOT = 110; // A2

function envGain(ctx: AudioContext, t0: number, peak: number, dur: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  return g;
}

export function createAudio(): AudioSys {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let sfxBus: GainNode | null = null;
  let musicBus: GainNode | null = null;
  let muted = false;
  let intensity = 0.5;
  let voices = 0;

  // Generative music scheduler state (lookahead scheduler per KB 06).
  let musicTimer: number | null = null;
  let nextNoteTime = 0;
  let stepIdx = 0;

  function tone(
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    vol: number,
    t0: number,
    dest: AudioNode,
  ): void {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(f0, 1), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
    const g = envGain(ctx, t0, vol, dur);
    osc.connect(g);
    g.connect(dest);
    osc.onended = () => {
      voices--;
      osc.disconnect();
      g.disconnect();
    };
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noise(dur: number, cutoff: number, vol: number, t0: number, dest: AudioNode): void {
    if (!ctx) return;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1; // cosmetic
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = cutoff;
    const g = envGain(ctx, t0, vol, dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(dest);
    src.onended = () => {
      voices--;
      src.disconnect();
      filt.disconnect();
      g.disconnect();
    };
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  function schedulePluck(t0: number, semitone: number, vol: number, bass: boolean): void {
    if (!ctx || !musicBus) return;
    const f = MUSIC_ROOT * Math.pow(2, semitone / 12);
    voices++;
    tone(bass ? 'sine' : 'triangle', f, f * 0.995, bass ? 0.5 : 0.32, vol, t0, musicBus);
  }

  function musicTick(): void {
    if (!ctx) return;
    // Schedule everything falling in the next 250 ms on the audio clock.
    while (nextNoteTime < ctx.currentTime + 0.25) {
      const t0 = Math.max(nextNoteTime, ctx.currentTime + 0.01);
      const density = 0.25 + 0.75 * intensity;
      if (Math.random() < density) {
        const semi = PENTA[Math.floor(Math.random() * PENTA.length)];
        schedulePluck(t0, semi + 12, 0.16, false);
      }
      if (stepIdx % 8 === 0) {
        schedulePluck(t0, 0, 0.22, true);
      }
      stepIdx++;
      nextNoteTime += 0.24;
    }
  }

  function startMusic(): void {
    if (musicTimer !== null || !ctx) return;
    nextNoteTime = ctx.currentTime + 0.1;
    stepIdx = 0;
    musicTimer = window.setInterval(musicTick, 120);
  }

  function playSfx(id: string, volume: number): void {
    if (!ctx || !sfxBus) return;
    const t = ctx.currentTime;
    const wob = 1 + (Math.random() * 0.08 - 0.04); // cosmetic pitch variety
    voices++;
    switch (id) {
      case 'shoot':
        tone('square', 880 * wob, 180, 0.12, 0.4 * volume, t, sfxBus);
        break;
      case 'hit':
        noise(0.14, 1400, 0.5 * volume, t, sfxBus);
        voices++;
        tone('sine', 190 * wob, 60, 0.14, 0.5 * volume, t, sfxBus);
        break;
      case 'pickup':
        tone('sine', 660 * wob, 660 * wob, 0.07, 0.4 * volume, t, sfxBus);
        voices++;
        tone('sine', 990 * wob, 990 * wob, 0.1, 0.4 * volume, t + 0.07, sfxBus);
        break;
      case 'jump':
        tone('sine', 230 * wob, 680, 0.18, 0.35 * volume, t, sfxBus);
        break;
      case 'die':
        tone('sawtooth', 420 * wob, 48, 0.5, 0.5 * volume, t, sfxBus);
        break;
      case 'ui':
        tone('sine', 1250 * wob, 1250 * wob, 0.05, 0.3 * volume, t, sfxBus);
        break;
      default:
        voices--; // unknown id: no voice spent
        break;
    }
  }

  const sys: AudioSys = {
    resume(): void {
      if (!ctx) {
        ctx = new AudioContext();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 1;

        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.ratio.value = 3;
        comp.attack.value = 0.003;
        comp.release.value = 0.25;

        sfxBus = ctx.createGain();
        sfxBus.gain.value = 0.9;
        musicBus = ctx.createGain();
        musicBus.gain.value = 0.3 + 0.5 * intensity;

        sfxBus.connect(comp);
        musicBus.connect(comp);
        comp.connect(master);
        master.connect(ctx.destination);

        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible' && ctx) void ctx.resume();
        });

        startMusic();
      }
      void ctx.resume();
    },

    play(id: string, opts?: { volume?: number }): void {
      if (!ctx || muted) return;
      if (voices >= MAX_VOICES) return; // cap: drop, never steal a player sound path here
      playSfx(id, opts?.volume ?? 1);
    },

    setIntensity(x: number): void {
      intensity = x < 0 ? 0 : x > 1 ? 1 : x;
      if (ctx && musicBus) {
        // Ramp over ~2s: intensity changes glide, they never jump.
        musicBus.gain.setTargetAtTime(0.3 + 0.5 * intensity, ctx.currentTime, 0.7);
      }
    },

    setMuted(m: boolean): void {
      muted = m;
      if (ctx && master) {
        master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.02);
      }
    },
  };

  return sys;
}
