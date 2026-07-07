export class AudioSystem {
  private ctx: AudioContext | null = null;
  private isPlaying = false;
  private masterGain: GainNode | null = null;
  private ambientNoise: AudioBufferSourceNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private lfo: OscillatorNode | null = null;
  private bubbleInterval: number | null = null;

  async init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.5; // overall volume
      this.masterGain.connect(this.ctx.destination);
      
      await this.startAmbient();
      this.scheduleBubbles();
      this.isPlaying = true;
    } catch (e) {
      console.error("Failed to initialize AudioSystem:", e);
    }
  }

  private async startAmbient() {
    if (!this.ctx || !this.masterGain) return;
    
    // Create Pink/Brown Noise buffer for the deep rumble
    const bufferSize = this.ctx.sampleRate * 2; // 2 seconds
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    
    // Generate simple brown-ish noise
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + (0.02 * white)) / 1.02;
      lastOut = output[i];
      output[i] *= 3.5; // Compensate for gain loss
    }

    this.ambientNoise = this.ctx.createBufferSource();
    this.ambientNoise.buffer = noiseBuffer;
    this.ambientNoise.loop = true;

    // Filter to make it sound underwater
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 150; // Deep sound
    this.filter.Q.value = 1;

    // LFO to modulate filter cutoff for "waves/movement"
    this.lfo = this.ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = 0.05; // Very slow
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 80; // Sweep frequency +/- 80Hz
    
    this.lfo.connect(lfoGain);
    lfoGain.connect(this.filter.frequency);

    this.ambientNoise.connect(this.filter);
    
    // Slight panning to give space
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = 0;

    this.filter.connect(panner);
    panner.connect(this.masterGain);

    this.ambientNoise.start();
    this.lfo.start();
  }

  private scheduleBubbles() {
    const playNext = () => {
      if (!this.isPlaying || !this.ctx || !this.masterGain) return;
      this.playBubble();
      // Random interval between 2s and 6s
      this.bubbleInterval = window.setTimeout(playNext, 2000 + Math.random() * 4000);
    };
    playNext();
  }

  playBubble() {
    if (!this.ctx || !this.masterGain || this.ctx.state !== 'running') return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sine';
    
    const now = this.ctx.currentTime;
    
    // Bubble sound envelope
    const duration = 0.05 + Math.random() * 0.04; // 50-90ms
    const maxGain = 0.1 + Math.random() * 0.2;
    
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(maxGain, now + duration * 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    
    // Frequency sweep upwards for a popping sound
    const baseFreq = 300 + Math.random() * 500;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * (1.5 + Math.random()), now + duration);

    // Pan bubbles randomly
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = -0.8 + Math.random() * 1.6;

    osc.connect(gain);
    gain.connect(panner);
    panner.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + duration);
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  stop() {
    if (this.ambientNoise) {
      this.ambientNoise.stop();
      this.ambientNoise.disconnect();
    }
    if (this.lfo) {
      this.lfo.stop();
      this.lfo.disconnect();
    }
    if (this.bubbleInterval !== null) {
      clearTimeout(this.bubbleInterval);
    }
    this.isPlaying = false;
  }
}
