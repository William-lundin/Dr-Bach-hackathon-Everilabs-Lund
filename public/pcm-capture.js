class Pcm16CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(512);
    this.sampleCount = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (output) output.fill(0);
    if (!input) return true;

    let offset = 0;
    while (offset < input.length) {
      const count = Math.min(input.length - offset, this.samples.length - this.sampleCount);
      this.samples.set(input.subarray(offset, offset + count), this.sampleCount);
      this.sampleCount += count;
      offset += count;

      if (this.sampleCount === this.samples.length) {
        const pcm = new Int16Array(this.samples.length);
        for (let index = 0; index < this.samples.length; index += 1) {
          const sample = Math.max(-1, Math.min(1, this.samples[index]));
          pcm[index] = sample < 0 ? sample * 32768 : sample * 32767;
        }
        this.port.postMessage(pcm.buffer, [pcm.buffer]);
        this.sampleCount = 0;
      }
    }

    return true;
  }
}

registerProcessor("pcm16-capture", Pcm16CaptureProcessor);
