import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { normalizePlayErrorApiSourceCount } from '../src/common/utils/playErrorStrategy.ts'
import { getRecoveryApiIds } from '../src/common/utils/playbackRecovery.ts'

const profile = mkdtempSync(path.join(tmpdir(), 'lx-issue27-'))
globalThis.lxDataPath = profile
registerHooks({
  resolve(specifier, context, nextResolve) {
    const files = {
      './config': '../src/main/modules/userApi/config/index.ts',
      '@common/constants': '../src/common/constants.ts',
      '@main/utils/store': '../src/main/utils/store.ts',
    }
    if (files[specifier]) return { url: new URL(files[specifier], import.meta.url).href, shortCircuit: true }
    const mocks = {
      '@common/utils': 'export const log = { info() {}, error() {} }',
      electron: 'export const dialog = {}; export const shell = {}',
    }
    if (mocks[specifier]) return { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const api = await import('../src/main/modules/userApi/utils.ts')
test.after(() => { rmSync(profile, { recursive: true, force: true }) })

test('source order persists with scripts, metadata and WebDAV export intact', async() => {
  const scripts = Object.fromEntries(['a', 'b', 'c'].map(id => [id, `/**\n * @name Source ${id}\n * @version 1.0.0\n */\n// fixture ${id}`]))
  await api.overwriteUserApiData({
    list: ['a', 'b', 'c'].map(id => ({ id, name: `Source ${id}`, version: '1.0.0', allowShowUpdateAlert: id == 'b', importSource: { type: 'local' } })),
    scripts,
  })
  api.moveApi('c', -1)
  api.moveApi('c', -1)
  assert.deepEqual(api.getUserApis().map(source => source.id), ['c', 'a', 'b'])
  const persisted = JSON.parse(readFileSync(path.join(profile, 'user_api.json'), 'utf8')).userApis
  assert.deepEqual(persisted.map(source => source.id), ['c', 'a', 'b'])
  assert.equal(persisted[2].allowShowUpdateAlert, true)
  assert.ok(persisted.every(source => source.script.startsWith('gz_')))
  const exported = await api.getUserApiData()
  assert.deepEqual(exported.list.map(source => source.id), ['c', 'a', 'b'])
  assert.deepEqual(exported.scripts, scripts)
  api.moveApi('c', 1)
  assert.deepEqual(api.getUserApis().map(source => source.id), ['a', 'c', 'b'])

  const before = readFileSync(path.join(profile, 'user_api.json'), 'utf8')
  for (const [id, direction] of [['a', -1], ['b', 1], ['deleted', 1]]) api.moveApi(id, direction)
  for (const direction of [0, 2, NaN, '1', undefined]) assert.throws(() => api.moveApi('a', direction), /Invalid/)
  assert.throws(() => api.moveApi(null, 1), /Invalid/)
  assert.equal(readFileSync(path.join(profile, 'user_api.json'), 'utf8'), before)

  const added = await api.importApi('/**\n * @name Added later\n */\n// fixture d', { type: 'local' })
  api.moveApi('a', 1)
  assert.deepEqual(api.getUserApis().map(source => source.id), ['c', 'a', 'b', added.id])
  assert.deepEqual(getRecoveryApiIds('b', api.getUserApis().map(source => source.id), 20), ['b', added.id, 'c', 'a'])
})

test('up to 20 additional sources can be tried, bounded by available distinct sources', () => {
  assert.equal(normalizePlayErrorApiSourceCount(undefined), 2)
  assert.equal(normalizePlayErrorApiSourceCount('bad'), 2)
  assert.equal(normalizePlayErrorApiSourceCount(0), 1)
  assert.equal(normalizePlayErrorApiSourceCount('20'), 20)
  assert.equal(normalizePlayErrorApiSourceCount(19.9), 19)
  assert.equal(normalizePlayErrorApiSourceCount(21), 20)
  assert.equal(normalizePlayErrorApiSourceCount(999), 20)
  const ids = Array.from({ length: 20 }, (_, index) => `source-${index}`)
  const result = getRecoveryApiIds(ids[18], ids, normalizePlayErrorApiSourceCount(20))
  assert.equal(result.length, 20)
  assert.equal(new Set(result).size, 20)
  assert.deepEqual(result, [...ids.slice(18), ...ids.slice(0, 18)])
  assert.deepEqual(getRecoveryApiIds('a', ['a', 'b', 'a'], 20), ['a', 'b'])
  const moreIds = Array.from({ length: 25 }, (_, index) => `source-${index}`)
  assert.deepEqual(getRecoveryApiIds(moreIds[0], moreIds, normalizePlayErrorApiSourceCount(999)), moreIds.slice(0, 21))
})
