const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { startHost } = require('./client.cjs')

// PCM frame encoding: planar stereo [L...][R...] in little-endian f32.
function encodePcm(outputs) {
  const frames = outputs[0].length
  const payload = Buffer.allocUnsafe(frames * outputs.length * 4)
  for (let channel = 0; channel < outputs.length; channel++) {
    const samples = outputs[channel]
    const offset = channel * frames * 4
    for (let i = 0; i < frames; i++) {
      const value = Number(samples[i])
      payload.writeFloatLE(Number.isFinite(value) ? value : 0, offset + i * 4)
    }
  }
  return payload
}

function decodePcm(payload, frames) {
  const left = Buffer.from(payload.subarray(0, frames * 4))
  const right = Buffer.from(payload.subarray(frames * 4, frames * 8))
  return [
    new Float32Array(left.buffer, left.byteOffset, frames),
    new Float32Array(right.buffer, right.byteOffset, frames),
  ]
}

class Vst3Chain {
  constructor(executable, stateDirectory) {
    this.executable = executable
    this.stateDirectory = stateDirectory
    this.host = null
    this.slots = []
    this.sampleRate = 48000
    // Control operations remain serialized. Audio processing is coalesced separately so a slow
    // plugin/editor never creates an unbounded queue of obsolete audio blocks.
    this.serial = Promise.resolve()
    this.processBusy = false
    this.pendingProcess = null
  }

  run(action) {
    const result = this.serial.then(action)
    this.serial = result.catch(() => {})
    return result
  }

  dryResult(inputs) {
    return {
      outputs: inputs,
      latencySamples: this.status().latencySamples,
      bypassed: true,
    }
  }

  dropPendingProcess() {
    if (!this.pendingProcess) return
    const pending = this.pendingProcess
    this.pendingProcess = null
    pending.resolve(this.dryResult(pending.inputs))
  }

  finishProcess() {
    this.processBusy = false
    const pending = this.pendingProcess
    this.pendingProcess = null
    if (!pending) return
    const next = this.process(pending.inputs)
    next.then(pending.resolve, pending.reject)
  }

  async saveSlot(slot, host = this.host) {
    // A crashed helper cannot save; retain its last successful on-disk snapshot.
    if (!host || host.closed || !slot.enabled) return
    const { state } = await host.request({ command: 'save_state', plugin_id: slot.id })
    await fs.mkdir(this.stateDirectory, { recursive: true })
    const target = path.join(this.stateDirectory, `${slot.id}.json`)
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, JSON.stringify({ path: slot.path, state }), { mode: 0o600, flag: 'wx' })
      await fs.rename(temporary, target)
    } finally { await fs.unlink(temporary).catch(() => {}) }
  }

  async readSlotState(entry) {
    try {
      const saved = JSON.parse(await fs.readFile(path.join(this.stateDirectory, `${entry.id}.json`), 'utf8'))
      return saved.path === entry.path ? saved.state : undefined
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      return undefined
    }
  }

  isSameChain(entries, sampleRate) {
    return !!this.host && !this.host.closed &&
      this.sampleRate === sampleRate &&
      this.slots.length === entries.length &&
      entries.every((entry, index) => {
        const slot = this.slots[index]
        return slot.id === entry.id && slot.path === entry.path && slot.enabled === entry.enabled
      })
  }

  configure(entries, sampleRate, allowedPaths) {
    // Blocks already waiting for the old chain should never be processed after a reconfigure.
    this.dropPendingProcess()
    return this.run(async() => {
      if (!Array.isArray(entries) || entries.length > 16 || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000) {
        throw new Error('Invalid VST3 chain or sample rate')
      }
      const ids = new Set()
      for (const entry of entries) {
        if (!entry || typeof entry.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(entry.id) || ids.has(entry.id) ||
          typeof entry.enabled !== 'boolean' || !allowedPaths.has(entry.path)) throw new Error('Invalid or unapproved VST3 plugin')
        ids.add(entry.id)
      }
      if (this.isSameChain(entries, sampleRate)) return this.status()

      const oldHost = this.host
      const oldSlots = this.slots
      let nextHost = null
      let createdHost = false
      try {
        // Save current editor/parameter state before replacing the native instances. A failed
        // replacement never touches the old host, so playback can continue with the old chain.
        if (oldHost) {
          for (const slot of oldSlots) await this.saveSlot(slot, oldHost)
        }

        const specs = []
        for (const entry of entries) {
          if (!entry.enabled) continue
          specs.push({
            id: entry.id,
            path: entry.path,
            sample_rate: sampleRate,
            block_size: 512,
            state: await this.readSlotState(entry),
          })
        }

        if (specs.length) {
          // load_chain is atomic inside the native helper: it builds every new instance first and
          // swaps the shared chain only after all plugins succeed. Reuse a healthy helper so
          // reordering/toggling does not create another process or duplicate its runtime state.
          if (oldHost && !oldHost.closed) nextHost = oldHost
          else {
            nextHost = await startHost(this.executable, 60000)
            createdHost = true
          }
          const loaded = await nextHost.request({ command: 'load_chain', plugins: specs })
          const loadedById = new Map((loaded.plugins ?? []).map(plugin => [plugin.id, plugin]))
          for (const entry of entries) {
            if (entry.enabled && !loadedById.has(entry.id)) {
              throw new Error(`VST3 host did not load plugin '${entry.id}'`)
            }
          }

          this._loadedPlugins = loadedById
        } else {
          this._loadedPlugins = new Map()
        }

        // The complete replacement has succeeded. Only tear down the previous process when a
        // crashed/absent helper forced us to create a replacement.
        if (oldHost && oldHost !== nextHost) oldHost.close()
        this.host = nextHost
        this.slots = entries.map(entry => {
          const loaded = this._loadedPlugins.get(entry.id)
          return {
            ...entry,
            host: entry.enabled ? nextHost : null,
            info: loaded?.info,
            latency: Number(loaded?.latency_samples) || 0,
          }
        })
        this.sampleRate = sampleRate
        this._loadedPlugins = null
        return this.status()
      } catch (error) {
        if (createdHost) nextHost?.close()
        this._loadedPlugins = null
        throw error
      }
    })
  }

  status() {
    return {
      sampleRate: this.sampleRate,
      latencySamples: this.slots.reduce((sum, slot) => sum + (slot.enabled ? slot.latency : 0), 0),
      slots: this.slots.map(({ id, path, enabled, latency, info }) => ({ id, path, enabled, latency, info })),
    }
  }

  process(inputs) {
    if (!this.host || !this.slots.some(slot => slot.enabled)) {
      return Promise.resolve({ outputs: inputs, latencySamples: 0 })
    }

    if (this.processBusy) {
      // Keep only the newest block. Every superseded caller gets an immediate dry result, so the
      // AudioWorklet never waits for audio that is already too old to play.
      if (this.pendingProcess) {
        this.pendingProcess.resolve(this.dryResult(this.pendingProcess.inputs))
      }
      return new Promise((resolve, reject) => {
        this.pendingProcess = { inputs, resolve, reject }
      })
    }

    this.processBusy = true
    const result = this.run(async() => {
      const host = this.host
      if (!host || host.closed || !this.slots.some(slot => slot.enabled)) {
        return { outputs: inputs, latencySamples: 0 }
      }
      const frames = inputs[0]?.length
      if (!Number.isInteger(frames) || frames <= 0 || frames > 4096 || inputs.length !== 2 || inputs.some(channel => channel.length !== frames)) {
        throw new Error('Invalid VST3 audio buffer')
      }
      const response = await host.request({ command: 'process_binary', frames }, encodePcm(inputs))
      const processResult = response.result
      const latencyById = new Map((processResult.latencies ?? []).map(item => [item.id, Number(item.latency_samples) || 0]))
      for (const slot of this.slots) {
        if (latencyById.has(slot.id)) slot.latency = latencyById.get(slot.id)
      }
      return {
        outputs: decodePcm(response.payload, frames),
        latencySamples: Number(processResult.latency_samples) || 0,
      }
    })
    // Attach both branches explicitly; an unobserved finally() promise would turn a host error
    // into an unhandled rejection while the original caller is handling it.
    result.then(() => this.finishProcess(), () => this.finishProcess())
    return result
  }

  editor(id, open) {
    this.dropPendingProcess()
    return this.run(async() => {
      if (!this.host || this.host.closed || !this.slots.find(slot => slot.id === id && slot.enabled)) throw new Error('Plugin is not active')
      await this.host.request({ command: 'editor', plugin_id: id, open })
      if (!open) await this.saveSlot(this.slots.find(slot => slot.id === id), this.host)
    })
  }

  save() {
    return this.run(async() => {
      for (const slot of this.slots) await this.saveSlot(slot, this.host)
    })
  }

  reset() {
    this.dropPendingProcess()
    return this.run(async() => {
      if (this.host && !this.host.closed) await this.host.request({ command: 'reset' })
    })
  }

  close() {
    this.dropPendingProcess()
    return this.run(async() => {
      // Capture after earlier configure tasks finish, otherwise their new host can leak.
      const host = this.host
      this.host = null
      try {
        if (host && !host.closed) {
          for (const slot of this.slots) await this.saveSlot(slot, host)
        }
      } finally {
        host?.close()
        this.slots = []
      }
    })
  }
}

module.exports = { Vst3Chain }
