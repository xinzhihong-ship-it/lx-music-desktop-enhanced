import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { getBundledMacMpvAppNames } from '../src/common/utils/mpvCompatibility.js'

const require = createRequire(import.meta.url)
const { getRequiredMacMpvPaths, validateMacMpvRuntimes } = require('../build-config/mpv-runtime.js')

test('macOS 15 keeps the legacy compatible MPV runtime', () => {
  assert.deepEqual(getBundledMacMpvAppNames('24.6.0', 'arm64'), ['mpv.app'])
})

test('new Apple Silicon macOS uses only the native MPV runtime', () => {
  assert.deepEqual(getBundledMacMpvAppNames('25.0.0', 'arm64'), ['mpv-macos26.app'])
  assert.deepEqual(getBundledMacMpvAppNames('26.0.0', 'arm64'), ['mpv-macos26.app'])
  assert.deepEqual(getBundledMacMpvAppNames('26.0.0', 'x64'), ['mpv.app'])
})

test('arm64 macOS packages require both old and new system MPV runtimes', () => {
  assert.deepEqual(getRequiredMacMpvPaths('arm64'), [
    path.join('mpv.app', 'Contents', 'MacOS', 'mpv'),
    path.join('mpv-macos26.app', 'Contents', 'MacOS', 'mpv'),
  ])

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-mpv-runtime-'))
  try {
    const legacyPath = path.join(root, 'mpv.app', 'Contents', 'MacOS', 'mpv')
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true })
    fs.writeFileSync(legacyPath, '')
    assert.throws(
      () => validateMacMpvRuntimes(root, 'arm64'),
      /mpv-macos26\.app/,
    )

    const modernPath = path.join(root, 'mpv-macos26.app', 'Contents', 'MacOS', 'mpv')
    fs.mkdirSync(path.dirname(modernPath), { recursive: true })
    fs.writeFileSync(modernPath, '')
    assert.doesNotThrow(() => validateMacMpvRuntimes(root, 'arm64'))
    assert.doesNotThrow(() => validateMacMpvRuntimes(root, 'x64'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
