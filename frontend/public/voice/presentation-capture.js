class PresentationCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate / 50);
    this.mic = new Float32Array(this.size);
    this.speaker = new Float32Array(this.size);
    this.offset = 0;
  }

  process(inputs, outputs) {
    const mic = inputs[0]?.[0];
    const speaker = inputs[1]?.[0];
    const count = outputs[0]?.[0]?.length ?? 128;
    for (let i = 0; i < count; i++) {
      this.mic[this.offset] = mic?.[i] ?? 0;
      this.speaker[this.offset] = speaker?.[i] ?? 0;
      if (++this.offset === this.size) {
        this.port.postMessage({ mic: this.mic, speaker: this.speaker }, [this.mic.buffer, this.speaker.buffer]);
        this.mic = new Float32Array(this.size);
        this.speaker = new Float32Array(this.size);
        this.offset = 0;
      }
    }
    // Output stays silent. The microphone is never routed to the host's speakers.
    return true;
  }
}

registerProcessor("presentation-capture", PresentationCapture);
