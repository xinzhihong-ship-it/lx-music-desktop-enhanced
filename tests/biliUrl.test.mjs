import assert from 'node:assert/strict'
import test from 'node:test'
import { parseBiliVideoUrl } from '../src/renderer/utils/musicSdk/bili/url.js'

test('parses bilibili video urls and page number', () => {
  assert.deepEqual(parseBiliVideoUrl('https://www.bilibili.com/video/BV1xx411c7mD/?p=2'), {
    videoId: 'BV1xx411c7mD',
    page: 2,
  })
  assert.deepEqual(parseBiliVideoUrl('av123456'), { videoId: 'av123456', page: 1 })
})

test('recognizes opaque b23.tv short urls for redirect resolution', () => {
  const parsed = parseBiliVideoUrl('https://b23.tv/abc123')
  assert.equal(parsed.shortUrl, 'https://b23.tv/abc123')
  assert.equal(parsed.page, 1)
})

test('rejects non-bilibili urls', () => {
  assert.equal(parseBiliVideoUrl('https://example.com/video/BV1xx411c7mD'), null)
})
