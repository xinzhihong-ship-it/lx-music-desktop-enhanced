import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeWebDAVPath,
  getWebDAVFilePath,
  hashSyncData,
  decideWebDAVSync,
} from '../src/common/utils/webdavSync.ts'

test('normalizes safe WebDAV paths', () => {
  assert.equal(normalizeWebDAVPath(' /LX_Music/backup/ '), '/LX_Music/backup')
  assert.equal(getWebDAVFilePath('/', 'playlists.json'), '/playlists.json')
  assert.equal(getWebDAVFilePath('/LX_Music/', 'playlists.json'), '/LX_Music/playlists.json')
  assert.throws(() => normalizeWebDAVPath('/LX_Music/../secret'))
})

test('hash is deterministic and changes with synced data', () => {
  assert.equal(hashSyncData({ list: [1, 2] }), hashSyncData({ list: [1, 2] }))
  assert.notEqual(hashSyncData({ list: [1, 2] }), hashSyncData({ list: [2, 1] }))
})

test('chooses a safe playlist sync direction', () => {
  const decide = values => decideWebDAVSync({
    hasRemote: true,
    hasLocalData: true,
    lastHash: 'base',
    localHash: 'base',
    remoteHash: 'base',
    ...values,
  })
  assert.equal(decide({ hasRemote: false }), 'upload')
  assert.equal(decide({ lastHash: '', localHash: 'local', remoteHash: 'remote' }), 'conflict')
  assert.equal(decide({ lastHash: '', localHash: 'same', remoteHash: 'same' }), 'none')
  assert.equal(decide({ lastHash: '', hasLocalData: false, remoteHash: 'remote' }), 'download')
  assert.equal(decide({ localHash: 'local' }), 'upload')
  assert.equal(decide({ remoteHash: 'remote' }), 'download')
  assert.equal(decide({ localHash: 'local', remoteHash: 'remote' }), 'conflict')
  assert.equal(decide({}), 'none')
})
