class SoundEngine {
  private ctx: AudioContext | null = null;
  public muted = false;

  private getCtx(): AudioContext | null {
    if (this.muted) return null;
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private tone(
    freq: number,
    duration: number,
    type: OscillatorType = 'sine',
    gainVal = 0.08,
    delay = 0,
    slideToFreq?: number
  ) {
    const ctx = this.getCtx();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideToFreq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideToFreq), now + duration);
    }

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(gainVal, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  public countdown() {
    this.tone(520, 0.11, 'triangle', 0.07);
  }

  public start() {
    this.tone(523.25, 0.12, 'triangle', 0.08, 0);
    this.tone(659.25, 0.14, 'triangle', 0.08, 0.08);
    this.tone(783.99, 0.22, 'triangle', 0.09, 0.16);
  }

  public huntersReleased() {
    this.tone(330, 0.15, 'sawtooth', 0.05, 0, 240);
    this.tone(440, 0.18, 'sawtooth', 0.05, 0.1, 330);
  }

  public dash() {
    this.tone(280, 0.14, 'sine', 0.07, 0, 620);
  }

  public pickup() {
    this.tone(587.33, 0.1, 'sine', 0.08, 0);
    this.tone(880, 0.16, 'sine', 0.08, 0.07);
  }

  public weaponPickup() {
    this.tone(440, 0.1, 'triangle', 0.09, 0);
    this.tone(659.25, 0.12, 'triangle', 0.09, 0.07);
    this.tone(987.77, 0.2, 'triangle', 0.1, 0.15);
  }

  public guardKilled() {
    this.tone(660, 0.12, 'sawtooth', 0.09, 0, 180);
    this.tone(220, 0.2, 'triangle', 0.08, 0.08, 90);
  }

  public portal() {
    this.tone(420, 0.22, 'triangle', 0.07, 0, 960);
  }

  public hit() {
    this.tone(180, 0.25, 'sawtooth', 0.09, 0, 75);
  }

  public victory() {
    this.tone(523.25, 0.12, 'triangle', 0.08, 0);
    this.tone(659.25, 0.12, 'triangle', 0.08, 0.1);
    this.tone(783.99, 0.14, 'triangle', 0.09, 0.2);
    this.tone(1046.5, 0.32, 'triangle', 0.1, 0.32);
  }

  public defeat() {
    this.tone(392, 0.16, 'sawtooth', 0.06, 0);
    this.tone(349.23, 0.16, 'sawtooth', 0.06, 0.14);
    this.tone(293.66, 0.3, 'sawtooth', 0.06, 0.28);
  }
}

export const soundFX = new SoundEngine();
