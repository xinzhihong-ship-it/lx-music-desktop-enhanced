import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { runInNewContext } from 'node:vm'

const state = globalThis.__issue22 = { details: new Map(), requests: [], failHash: null }
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('/kg/musicInfo.js')) {
      const source = specifier === '../../index'
        ? 'export const decodeName = x => x; export const formatPlayTime = x => String(x); export const sizeFormate = x => String(x)'
        : specifier === './util'
          ? `export const createHttpFetch = async (url, options) => {
              globalThis.__issue22.requests.push(options.body.data)
              if (options.body.data.some(item => item.hash === globalThis.__issue22.failHash)) throw new Error('network failure')
              return options.body.data.map(({ hash }) => globalThis.__issue22.details.get(hash) ?? [])
            }`
          : null
      if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
test.after(() => hooks.deregister())
const { getMusicInfos, getPlaylistMusicInfos, getMusicInfoRaw } = await import('../src/renderer/utils/musicSdk/kg/musicInfo.js')

// Execute the actual Vue loader, without mounting the UI or replacing its mapping logic.
const vueSource = await readFile(new URL('../src/renderer/views/PlatformMusic/index.vue', import.meta.url), 'utf8')
const loaderSource = vueSource.slice(vueSource.indexOf('const loadPlaylistDetails = async('), vueSource.indexOf('\nconst selectDaily'))
  .replace('source: LX.Account.Source', 'source')
  .replace('tracks: LX.Account.PlaylistTrackInfo[]', 'tracks')
  .replace('new Array<any>', 'new Array')
  .replace('const missing: Array<{ index: number, id: string }> = []', 'const missing = []')
  .replace('new Map<string, any>', 'new Map')
const createLoader = (loadDailyDetails = () => { throw new Error('unexpected daily loader') }) => runInNewContext(
  `${loaderSource}\nloadPlaylistDetails`, { getKgPlaylistMusicInfos: getPlaylistMusicInfos, loadDailyDetails },
)
const detail = (id, hash, qualityHash = `hq-${id}`) => ({
  songname: `song-${id}`,
  author_name: 'artist',
  album_info: { album_name: 'album', album_id: 1 },
  audio_info: {
    audio_id: id, hash, hash_320: qualityHash,
    filesize: '1234', filesize_320: '5678', filesize_flac: '0', filesize_high: '0', timelength: '180000',
  },
})
const reset = () => { state.details.clear(); state.requests.length = 0; state.failHash = null }

test('267 首在线酷狗歌曲跨三个详情批次，100 首不同音质 hash 仍完整且按歌单排序', async() => {
  reset()
  const tracks = Array.from({ length: 267 }, (_, index) => ({ id: `playlist-${index}`, removeId: String(index + 1) }))
  tracks.forEach((track, index) => state.details.set(track.id, [detail(index + 1, index < 100 ? `default-${index}` : track.id, track.id)]))
  const loaded = await createLoader()('kg', tracks)
  assert.equal(loaded.filter(Boolean).length, 267)
  assert.deepEqual(Array.from(loaded, song => song.hash), tracks.map(track => track.id))
  assert.equal(loaded[0].types[0].hash, 'default-0')
  assert.equal(loaded[0]._types['320k'].hash, 'playlist-0')
  assert.deepEqual(state.requests.map(batch => batch.length), [100, 100, 67])
  // The UI uses this hash to look up the original fileid for removal.
  const fileIds = new Map(tracks.map(track => [track.id, track.removeId]))
  assert.equal(fileIds.get(loaded[0].hash), '1')
  assert.equal(fileIds.get(loaded[266].hash), '267')
})

test('酷狗缺失一首详情时保留空位，后续歌曲不会错位或消失', async() => {
  reset()
  state.details.set('first', [detail(1, 'default-first')])
  state.details.set('missing', [])
  state.details.set('last', [detail(3, 'default-last')])
  const loaded = await createLoader()('kg', [{ id: 'first' }, { id: 'missing' }, { id: 'last' }])
  assert.equal(loaded.length, 3)
  assert.equal(loaded[0].hash, 'first')
  assert.equal(loaded[1], undefined)
  assert.equal(loaded[2].hash, 'last')
  assert.equal(loaded[2].name, 'song-3')
})

test('详情批次边界的空候选不会让下一批歌曲错位', async() => {
  reset()
  const tracks = Array.from({ length: 201 }, (_, index) => ({ id: `track-${index}` }))
  tracks.forEach((track, index) => {
    if (index !== 99 && index !== 100) state.details.set(track.id, [detail(index + 1, `default-${index}`)])
  })
  const loaded = await createLoader()('kg', tracks)
  assert.equal(loaded.filter(Boolean).length, 199)
  assert.equal(loaded[99], undefined)
  assert.equal(loaded[100], undefined)
  assert.equal(loaded[101].name, 'song-102')
  assert.equal(loaded[200].hash, 'track-200')
  assert.deepEqual(state.requests.map(batch => batch.length), [100, 100, 1])
})

test('详情批次请求失败仍向界面抛错，不把网络错误当作空歌单', async() => {
  reset()
  state.failHash = 'failed'
  await assert.rejects(createLoader()('kg', [{ id: 'failed' }]), /network failure/)
})

test('酷狗相同 audio_id 的不同 hash 和缺失 audio_id 的歌曲不会互相去重', async() => {
  reset()
  state.details.set('hq', [detail(7, 'base', 'hq')])
  state.details.set('base', [detail(7, 'base', 'hq')])
  state.details.set('no-id-1', [detail(undefined, 'base-1')])
  state.details.set('no-id-2', [detail(undefined, 'base-2')])
  const loaded = await createLoader()('kg', ['hq', 'base', 'no-id-1', 'no-id-2'].map(id => ({ id })))
  assert.equal(loaded.filter(Boolean).length, 4)
  assert.equal(loaded[2].songmid, 'no-id-1')
  assert.equal(loaded[3].songmid, 'no-id-2')
})

test('酷狗原有通用详情接口保持默认 hash 和 audio_id 去重行为', async() => {
  reset()
  state.details.set('hq', [detail(7, 'base', 'hq')])
  state.details.set('base', [detail(7, 'base', 'hq')])
  const loaded = await getMusicInfos([{ hash: 'hq' }, { hash: 'base' }])
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].hash, 'base')
  assert.equal((await getMusicInfoRaw('hq')).audio_info.hash, 'base')
})

for (const source of ['tx', 'wy', 'bili']) {
  test(`${source} 歌单继续使用原详情加载器，保留内嵌详情与缺失歌曲的位置`, async() => {
    reset()
    let received
    const embedded = { songmid: 'embedded', name: 'already loaded' }
    const last = { songmid: 'last', name: 'last song' }
    const loader = createLoader(async (actualSource, ids) => {
      received = { source: actualSource, ids: Array.from(ids) }
      return [last]
    })
    const loaded = await loader(source, [{ id: 'embedded', detail: embedded }, { id: 'missing' }, { id: 'last' }])
    assert.deepEqual(received, { source, ids: ['missing', 'last'] })
    assert.equal(loaded[0], embedded)
    assert.equal(loaded[1], undefined)
    assert.equal(loaded[2], last)
    assert.equal(state.requests.length, 0)
  })
}
