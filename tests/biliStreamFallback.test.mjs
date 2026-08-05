import assert from 'node:assert/strict'
import test from 'node:test'
import { getStreamUrls, pickStreamUrl } from '../src/renderer/utils/musicSdk/bili/stream.js'

test('Bilibili stream candidates keep the primary URL and deduplicated backups', () => {
  assert.deepEqual(getStreamUrls({
    baseUrl: 'primary',
    backupUrl: ['backup-1', 'primary', 'backup-2'],
    backup_url: ['backup-3'],
  }), ['primary', 'backup-1', 'backup-2', 'backup-3'])
})

test('refresh playback advances through Bilibili stream candidates', () => {
  const urls = ['primary', 'backup-1', 'backup-2']
  assert.deepEqual(pickStreamUrl(urls, false), { url: 'primary', index: 0 })
  assert.deepEqual(pickStreamUrl(urls, true, 0), { url: 'backup-1', index: 1 })
  assert.deepEqual(pickStreamUrl(urls, true, 1), { url: 'backup-2', index: 2 })
  assert.deepEqual(pickStreamUrl(urls, true, 2), { url: 'backup-2', index: 2 })
})
