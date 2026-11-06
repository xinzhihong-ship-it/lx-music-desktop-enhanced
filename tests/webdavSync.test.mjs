import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeWebDAVPath,
  getWebDAVFilePath,
  hashSyncData,
  decideWebDAVSync,
  getWebDAVUploadSettings,
  pickWebDAVDownloadSettings,
  WEBDAV_PLATFORM_SETTING_KEYS,
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

const platformKeys = ['player.playEngine', 'player.mpv.path', 'player.mediaDeviceId', 'download.savePath']

test('platform-specific settings are never uploaded to WebDAV', () => {
  assert.deepEqual([...WEBDAV_PLATFORM_SETTING_KEYS].sort(), [...platformKeys].sort())
  const local = {
    'player.playEngine': 'audirvana', 'player.mpv.path': '/opt/homebrew/bin/mpv', 'player.mediaDeviceId': 'coreaudio/BuiltIn', 'download.savePath': '/Users/me/Music',
    'sync.webdav.password': 'secret', 'network.gitcodeMusicAccessToken': 'token', 'sync.webdav.lastListHash': 'abc',
    'player.playQuality': 'flac', 'common.theme': 'dark',
  }
  const uploaded = getWebDAVUploadSettings(local)
  for (const key of [...platformKeys, 'sync.webdav.password', 'network.gitcodeMusicAccessToken', 'sync.webdav.lastListHash']) assert.equal(key in uploaded, false, key)
  assert.deepEqual(uploaded, { 'player.playQuality': 'flac', 'common.theme': 'dark' })
  assert.equal(local['player.playEngine'], 'audirvana', 'input must not be mutated')
})

test('platform-specific settings from the cloud never overwrite local ones (incl. files uploaded by older versions)', () => {
  const local = {
    'player.playEngine': 'electron', 'player.mpv.path': 'C:\mpv\mpv.exe', 'player.mediaDeviceId': 'wasapi/{x}', 'download.savePath': 'D:\Music',
    'player.playQuality': '320k', 'common.isAgreePact': true, 'sync.webdav.url': 'https://dav.example/', 'common.theme': 'light',
  }
  const remote = {
    'player.playEngine': 'audirvana', 'player.mpv.path': '/opt/homebrew/bin/mpv', 'player.mediaDeviceId': 'coreaudio/BuiltIn', 'download.savePath': '/Users/me/Music',
    'player.playQuality': 'flac', 'common.isAgreePact': false, 'sync.webdav.url': 'https://evil.example/', 'common.theme': 'dark', 'unknown.key': 1,
  }
  assert.deepEqual(pickWebDAVDownloadSettings(remote, local), { 'player.playQuality': 'flac', 'common.theme': 'dark' })
})
