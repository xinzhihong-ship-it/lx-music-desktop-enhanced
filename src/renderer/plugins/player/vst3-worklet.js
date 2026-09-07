/* global AudioWorkletProcessor, registerProcessor */
const BLOCK = 512
// Keep four 512-frame blocks of intentional bridge latency. The native chain is now a single
// bounded helper request; this is half the old delay while leaving room for normal IPC jitter.
const DELAY = 2048
const CAPACITY = 32768
// Plugin editors share the host's control thread with PCM processing, so presets and UI
// interaction can stall blocks. Missing blocks play as silence; the main process coalesces
// pending audio to the newest block and answers superseded blocks with dry passthrough. A dead
// host is still reported via request errors, so only protocol/host failures pause playback.

class Vst3Processor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const requested = options?.processorOptions?.bufferFrames
    this.delay = [1024, 2048, 4096, 8192, 16384].includes(requested) ? requested : DELAY
    this.input = [new Float32Array(BLOCK), new Float32Array(BLOCK)]
    this.output = [new Float32Array(CAPACITY), new Float32Array(CAPACITY)]
    this.tags = new Int32Array(CAPACITY / BLOCK).fill(-1)
    this.frame = 0
    this.epoch = 0
    this.active = false
    this.fault = false
    this.port.onmessage = ({ data }) => {
      if (data.action === 'reset') {
        if ([1024, 2048, 4096, 8192, 16384].includes(data.bufferFrames)) this.delay = data.bufferFrames
        this.epoch = data.epoch
        this.frame = 0
        this.tags.fill(-1)
        this.input.forEach(channel => channel.fill(0))
        this.active = data.active
        this.fault = false
        return
      }
      if (data.epoch !== this.epoch || this.fault) return
      const start = data.sequence * BLOCK + this.delay
      if (!Number.isInteger(data.sequence) || !Array.isArray(data.outputs) || data.outputs.length !== 2 ||
        data.outputs.some(channel => channel.length !== BLOCK || channel.some(sample => !Number.isFinite(sample)))) {
        this.fail()
        return
      }
      // A late block whose playhead already passed is superseded by the gap — drop it.
      if (start < this.frame) return
      if (start >= this.frame + CAPACITY) {
        this.fail()
        return
      }
      for (let channel = 0; channel < 2; channel++) this.output[channel].set(data.outputs[channel], start % CAPACITY)
      this.tags[(start % CAPACITY) / BLOCK] = data.sequence
    }
  }

  fail() {
    if (!this.fault) this.port.postMessage({ action: 'fault', epoch: this.epoch })
    this.fault = true
  }

  process(inputs, outputs) {
    const destination = outputs[0]
    if (!destination?.length) return true
    destination.forEach(channel => channel.fill(0))
    if (!this.active || this.fault) return true
    const source = inputs[0]
    for (let i = 0; i < destination[0].length; i++) {
      const offset = this.frame % BLOCK
      this.input[0][offset] = source?.[0]?.[i] ?? 0
      this.input[1][offset] = source?.[1]?.[i] ?? this.input[0][offset]
      if (this.frame >= this.delay) {
        const sequence = Math.floor((this.frame - this.delay) / BLOCK)
        const index = this.frame % CAPACITY
        if (this.tags[Math.floor(index / BLOCK)] !== sequence) {
          // Block not processed in time (host busy with the plugin UI): stay silent and
          // keep playing; dry passthrough from the main process covers longer stalls.
        } else {
          for (let channel = 0; channel < destination.length; channel++) destination[channel][i] = this.output[Math.min(channel, 1)][index]
        }
      }
      this.frame++
      if (this.frame % BLOCK === 0) {
        const channels = this.input.map(channel => channel.slice())
        this.port.postMessage({ action: 'process', epoch: this.epoch, sequence: this.frame / BLOCK - 1, inputs: channels }, channels.map(channel => channel.buffer))
      }
    }
    return true
  }
}

registerProcessor('lx-vst3', Vst3Processor)
