const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { startHost } = require('./client.cjs')

class Vst3Chain {
  constructor(executable, stateDirectory) {
    this.executable = executable
    this.stateDirectory = stateDirectory
    this.slots = []
    this.sampleRate = 48000
    this.serial = Promise.resolve()
    this.queued = 0
  }

  run(action) {
    // Above the dry-passthrough threshold in process() this is a last-resort guard;
    // reaching it means requests are being issued without any pacing at all.
    if (this.queued >= 96) return Promise.reject(new Error('VST3 processing queue overflow'))
    this.queued++
    const result = this.serial.then(action)
    this.serial = result.catch(() => {}).finally(() => { this.queued-- })
    return result
  }

  async saveSlot(slot) {
    // A crashed helper cannot save; retain its last successful on-disk snapshot.
    if (!slot.host || slot.host.closed) return
    const { state } = await slot.host.request({ command: 'save_state' })
    await fs.mkdir(this.stateDirectory, { recursive: true })
    const target = path.join(this.stateDirectory, `${slot.id}.json`)
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, JSON.stringify({ path: slot.path, state }), { mode: 0o600, flag: 'wx' })
      await fs.rename(temporary, target)
    } finally { await fs.unlink(temporary).catch(() => {}) }
  }

  configure(entries, sampleRate, allowedPaths) {
    return this.run(async () => {
      if (!Array.isArray(entries) || entries.length > 16 || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000) {
        throw new Error('Invalid VST3 chain or sample rate')
      }
      const ids = new Set()
      for (const entry of entries) {
        if (!entry || typeof entry.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(entry.id) || ids.has(entry.id)
          || typeof entry.enabled !== 'boolean' || !allowedPaths.has(entry.path)) throw new Error('Invalid or unapproved VST3 plugin')
        ids.add(entry.id)
      }
      // Preserve the active chain when loading a replacement fails.
      const next = []
      const created = []
      try {
        for (const entry of entries) {
          const existing = this.slots.find(slot => slot.id === entry.id && slot.path === entry.path)
          if (existing && !existing.host?.closed && this.sampleRate === sampleRate && (!!existing.host === entry.enabled)) {
            next.push({ ...existing, enabled: entry.enabled })
            continue
          }
          if (existing?.host) await this.saveSlot(existing)
          const slot = { ...entry, host: null, latency: 0 }
          next.push(slot)
          if (!entry.enabled) continue
          let state
          try {
            const saved = JSON.parse(await fs.readFile(path.join(this.stateDirectory, `${entry.id}.json`), 'utf8'))
            if (saved.path === entry.path) state = saved.state
          } catch (error) { if (error.code !== 'ENOENT') throw error }
          slot.host = await startHost(this.executable, 60000)
          created.push(slot.host)
          const loaded = await slot.host.request({ command: 'load', path: entry.path, sample_rate: sampleRate, block_size: 512, state })
          slot.latency = loaded.latency_samples
          slot.info = loaded.info
        }
        for (const slot of this.slots) {
          if (slot.host && !next.some(item => item.host === slot.host)) await this.saveSlot(slot)
        }
      } catch (error) {
        for (const host of created) host.close()
        throw error
      }
      for (const slot of this.slots) {
        if (slot.host && !next.some(item => item.host === slot.host)) slot.host.close()
      }
      this.slots = next
      this.sampleRate = sampleRate
      return this.status()
    })
  }

  status() {
    return {
      sampleRate: this.sampleRate,
      latencySamples: this.slots.reduce((sum, slot) => sum + (slot.host ? slot.latency : 0), 0),
      slots: this.slots.map(({ id, path, enabled, latency, info }) => ({ id, path, enabled, latency, info })),
    }
  }

  process(inputs) {
    // Host busy (plugin editor loading a preset, heavy UI work): answer dry passthrough
    // instead of queueing behind the stall, so playback keeps running effect-less until
    // the main thread frees up. A dead host is still caught by request errors.
    if (this.queued >= 48) {
      this._bypassed = true
      return Promise.resolve({ outputs: inputs, latencySamples: this.status().latencySamples, bypassed: true })
    }
    this._bypassed = false
    return this.run(async () => {
      if (!Array.isArray(inputs) || inputs.length !== 2 || inputs.some(channel => !Array.isArray(channel)
        || channel.length !== 512 || channel.some(sample => typeof sample !== 'number' || !Number.isFinite(sample)))) {
        throw new Error('Invalid VST3 stereo block')
      }
      let outputs = inputs
      for (const slot of this.slots) {
        if (!slot.host) continue
        const result = await slot.host.request({ command: 'process', inputs: outputs })
        outputs = result.outputs
        slot.latency = result.latency_samples
      }
      return { outputs, latencySamples: this.status().latencySamples }
    })
  }

  editor(id, open) {
    return this.run(async () => {
      const slot = this.slots.find(slot => slot.id === id)
      if (!slot?.host || typeof open !== 'boolean') throw new Error('Plugin is not active')
      await slot.host.request({ command: 'editor', open })
      if (!open) await this.saveSlot(slot)
    })
  }

  save() {
    return this.run(async () => {
      for (const slot of this.slots) await this.saveSlot(slot)
    })
  }

  reset() {
    return this.run(async () => {
      for (const slot of this.slots) {
        if (slot.host) await slot.host.request({ command: 'reset' })
      }
    })
  }

  close() {
    return this.run(async () => {
      try { for (const slot of this.slots) await this.saveSlot(slot) }
      finally {
        for (const slot of this.slots) slot.host?.close()
        this.slots = []
      }
    })
  }
}

module.exports = { Vst3Chain }
