import { sineBedScore, type SineOrnament, type SineVoice } from "./sine-bed-score";

const SILENT = 0.0001;
/** Settled pad after the source fade-in. t=0 is silence, so loops wrap here. */
const LOOP_IN = 1.5;
/** Last seconds of the score morph toward LOOP_IN instead of fading to a hole. */
const LOOP_BLEND = 3.6;
const LOOP_SPAN = sineBedScore.duration - LOOP_IN;

function lerp(a: number, b: number, x: number) {
  return a + (b - a) * x;
}

function cosine(x: number) {
  return 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));
}

function sampleVoice(voice: SineVoice, time: number) {
  const times = voice.t;
  if (time <= times[0]) return { freq: voice.freq[0], amp: voice.amp[0] };
  const last = times.length - 1;
  if (time >= times[last]) return { freq: voice.freq[last], amp: voice.amp[last] };
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (times[mid] <= time) low = mid;
    else high = mid;
  }
  const span = Math.max(times[high] - times[low], 1e-6);
  const mix = (time - times[low]) / span;
  return {
    freq: lerp(voice.freq[low], voice.freq[high], mix),
    amp: lerp(voice.amp[low], voice.amp[high], mix),
  };
}

function scoreTime(playTime: number) {
  return LOOP_IN + (((playTime % LOOP_SPAN) + LOOP_SPAN) % LOOP_SPAN);
}

function sampleLoopedVoice(voice: SineVoice, playTime: number) {
  const local = scoreTime(playTime);
  const current = sampleVoice(voice, local);
  const blendStart = sineBedScore.duration - LOOP_BLEND;
  if (local < blendStart) return current;
  const target = sampleVoice(voice, LOOP_IN);
  const mix = cosine((local - blendStart) / LOOP_BLEND);
  return {
    freq: lerp(current.freq, target.freq, mix),
    amp: lerp(current.amp, target.amp, mix),
  };
}

export type AudioPrefs = {
  sfx: boolean;
  music: boolean;
  sfxVolume: number;
  musicVolume: number;
};

export class TerminalAudio {
  private sfxOn = true;
  private musicOn = true;
  private sfxVol = 1;
  private musicVol = 1;
  private context?: AudioContext;
  private sfxGain?: GainNode;
  private musicGain?: GainNode;
  private voices: { osc: OscillatorNode; gain: GainNode }[] = [];
  private origin = 0;
  private filled = 0;
  private pump = 0;
  private generation = 0;

  apply(prefs: AudioPrefs) {
    const wasMusic = this.musicOn;
    this.sfxOn = prefs.sfx;
    this.musicOn = prefs.music;
    this.sfxVol = Math.min(1, Math.max(0, prefs.sfxVolume));
    this.musicVol = Math.min(1, Math.max(0, prefs.musicVolume));
    if (!this.context) return;
    this.rampBus(this.sfxGain, this.sfxOn ? this.sfxVol : 0, 0.08);
    if (!this.musicOn) {
      this.fadeOutBed();
      return;
    }
    if (!this.voices.length) {
      this.syncBed();
      return;
    }
    if (!wasMusic) this.syncBed();
    else this.rampBus(this.musicGain, this.musicVol, 0.08);
  }

  prime() {
    try {
      this.ensureGraph();
      this.rampBus(this.sfxGain, this.sfxOn ? this.sfxVol : 0, 0.05);
      if (this.musicOn) this.syncBed();
    } catch {
      /* Audio is optional; the terminal remains fully interactive. */
    }
  }

  play(type: "tick" | "open" | "confirm" | "back" = "tick") {
    if (!this.sfxOn || this.sfxVol <= 0) return;
    try {
      const c = this.ensureGraph();
      if (this.musicOn && !this.voices.length) this.syncBed();
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      const frequency = { tick: 760, open: 420, confirm: 960, back: 320 }[type];
      osc.frequency.setValueAtTime(frequency, c.currentTime);
      osc.frequency.exponentialRampToValueAtTime(
        frequency * (type === "open" ? 1.8 : 0.7),
        c.currentTime + 0.13,
      );
      const peak = 0.035 * this.sfxVol;
      gain.gain.setValueAtTime(SILENT, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(Math.max(peak, SILENT), c.currentTime + 0.008);
      gain.gain.exponentialRampToValueAtTime(SILENT, c.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(this.sfxGain!);
      osc.start();
      osc.stop(c.currentTime + 0.2);
    } catch {
      /* Audio is optional; the terminal remains fully interactive. */
    }
  }

  private ensureContext() {
    this.context ??= new AudioContext();
    if (this.context.state === "suspended") void this.context.resume();
    return this.context;
  }

  private ensureGraph() {
    const c = this.ensureContext();
    if (!this.sfxGain) {
      this.sfxGain = c.createGain();
      this.sfxGain.gain.value = this.sfxOn ? Math.max(this.sfxVol, SILENT) : SILENT;
      this.sfxGain.connect(c.destination);
    }
    if (!this.musicGain) {
      this.musicGain = c.createGain();
      this.musicGain.gain.value = SILENT;
      this.musicGain.connect(c.destination);
    }
    return c;
  }

  private syncBed() {
    if (!this.musicOn || !this.context) return;
    if (!this.voices.length) {
      this.startBed();
      return;
    }
    this.filled = Math.max(this.filled, this.context.currentTime - this.origin);
    this.rampBus(this.musicGain, this.musicVol, 0.8);
    this.scheduleAhead();
  }

  private startBed() {
    const c = this.ensureGraph();
    const master = this.musicGain!;
    this.voices = sineBedScore.voices.map((voice) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      const first = sampleLoopedVoice(voice, 0);
      osc.type = "sine";
      osc.frequency.value = Math.max(first.freq, 20);
      gain.gain.value = SILENT;
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      return { osc, gain };
    });
    this.origin = c.currentTime + 0.04;
    this.filled = 0;
    this.generation += 1;
    for (let index = 0; index < this.voices.length; index++) {
      const first = sampleLoopedVoice(sineBedScore.voices[index], 0);
      const at = this.origin;
      this.voices[index].osc.frequency.setValueAtTime(Math.max(first.freq, 20), at);
      this.voices[index].gain.gain.setValueAtTime(Math.max(first.amp, SILENT), at);
    }
    this.rampBus(master, this.musicVol, 1.7);
    this.scheduleAhead();
  }

  private fadeOutBed() {
    this.rampBus(this.musicGain, 0, 0.45);
    window.clearTimeout(this.pump);
  }

  private rampBus(node: GainNode | undefined, value: number, seconds: number) {
    if (!node || !this.context) return;
    const now = this.context.currentTime;
    const current = Math.max(node.gain.value, SILENT);
    const target = Math.max(value, SILENT);
    node.gain.cancelScheduledValues(now);
    node.gain.setValueAtTime(current, now);
    node.gain.exponentialRampToValueAtTime(target, now + Math.max(seconds, 0.02));
  }

  private scheduleAhead() {
    if (!this.context || !this.musicOn || !this.voices.length) return;
    const generation = this.generation;
    const nowScore = Math.max(0, this.context.currentTime - this.origin);
    const target = nowScore + 4;
    while (this.filled < target) {
      const start = this.filled;
      this.scheduleSlice(start, start + 1.25);
      this.filled = start + 1.25;
    }
    window.clearTimeout(this.pump);
    this.pump = window.setTimeout(() => {
      if (generation !== this.generation) return;
      this.scheduleAhead();
    }, 700);
  }

  private scheduleSlice(from: number, to: number) {
    const c = this.context;
    if (!c) return;
    const step = 0.1;
    for (let index = 0; index < this.voices.length; index++) {
      const voice = sineBedScore.voices[index];
      const nodes = this.voices[index];
      for (let time = from; time <= to + 1e-6; time += step) {
        const at = this.origin + time;
        if (at < c.currentTime - 0.03) continue;
        const sample = sampleLoopedVoice(voice, time);
        nodes.osc.frequency.linearRampToValueAtTime(Math.max(sample.freq, 20), at);
        nodes.gain.gain.linearRampToValueAtTime(Math.max(sample.amp, SILENT), at);
      }
    }
    const firstLoop = Math.floor(from / LOOP_SPAN);
    const lastLoop = Math.floor(to / LOOP_SPAN);
    for (let loop = firstLoop; loop <= lastLoop; loop++) {
      for (const event of sineBedScore.ornaments) {
        if (event.t < LOOP_IN || event.t > sineBedScore.duration - LOOP_BLEND) continue;
        const abs = loop * LOOP_SPAN + (event.t - LOOP_IN);
        if (abs < from || abs > to) continue;
        this.spawnOrnament(this.origin + abs, event);
      }
    }
  }

  private spawnOrnament(when: number, event: SineOrnament) {
    const c = this.context;
    if (!c || !this.musicGain || when < c.currentTime - 0.02) return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = event.freq;
    gain.gain.setValueAtTime(SILENT, when);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(event.amp, SILENT),
      when + Math.min(0.04, event.dur * 0.3),
    );
    gain.gain.exponentialRampToValueAtTime(SILENT, when + event.dur);
    osc.connect(gain);
    gain.connect(this.musicGain);
    osc.start(when);
    osc.stop(when + event.dur + 0.02);
  }
}
