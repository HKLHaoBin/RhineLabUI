export class TerminalAudio {
  private _enabled = false;
  private context?: AudioContext;
  private bedGain?: GainNode;
  private bedOscillators: OscillatorNode[] = [];

  get enabled() {
    return this._enabled;
  }

  set enabled(value: boolean) {
    this._enabled = value;
    if (this.context) this.syncBed();
  }

  prime() {
    try {
      this.ensureContext();
      this.syncBed();
    } catch {
      /* Audio is optional; the terminal remains fully interactive. */
    }
  }

  play(type: "tick" | "open" | "confirm" | "back" = "tick") {
    if (!this._enabled) return;
    try {
      const c = this.ensureContext();
      this.syncBed();
      const osc = c.createOscillator(),
        gain = c.createGain();
      osc.type = "sine";
      const frequency = { tick: 760, open: 420, confirm: 960, back: 320 }[type];
      osc.frequency.setValueAtTime(frequency, c.currentTime);
      osc.frequency.exponentialRampToValueAtTime(
        frequency * (type === "open" ? 1.8 : 0.7),
        c.currentTime + 0.13,
      );
      gain.gain.setValueAtTime(0.0001, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.035, c.currentTime + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(c.destination);
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

  private syncBed() {
    if (!this.context) return;
    if (!this._enabled) {
      this.setBedLevel(0.0001, 0.4);
      return;
    }
    this.ensureBed();
    this.setBedLevel(1, 1.8);
  }

  private ensureBed() {
    if (this.bedGain || !this.context) return;
    const c = this.context;
    const master = c.createGain();
    master.gain.value = 0.0001;
    master.connect(c.destination);
    for (const partial of [
      { frequency: 98, gain: 0.009 },
      { frequency: 147.2, gain: 0.0055 },
      { frequency: 294.6, gain: 0.0022 },
    ]) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = partial.frequency;
      gain.gain.value = partial.gain;
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      this.bedOscillators.push(osc);
    }
    this.bedGain = master;
  }

  private setBedLevel(value: number, seconds: number) {
    if (!this.bedGain || !this.context) return;
    const now = this.context.currentTime;
    const current = Math.max(this.bedGain.gain.value, 0.0001);
    this.bedGain.gain.cancelScheduledValues(now);
    this.bedGain.gain.setValueAtTime(current, now);
    this.bedGain.gain.exponentialRampToValueAtTime(
      Math.max(value, 0.0001),
      now + seconds,
    );
  }
}
