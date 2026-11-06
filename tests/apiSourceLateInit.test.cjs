const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// #4：错误恢复中被放弃（超时撤销）的音源切换，其迟到的初始化结果 / 失败都不能再改变当前音源，
// 也不能写回设置；临时切换（persist: false）任何时候都不写回设置。

const load = deps => {
  const exports = {}
  const file = path.join(__dirname, '../src/renderer/core/apiSource.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { exports, require: id => { if (!(id in deps)) throw new Error('unmocked ' + id); return deps[id] }, console: { log() {} }, window: deps.window }, { filename: file })
  return exports
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

const harness = () => {
  const pending = new Map()
  const persisted = []
  const store = { apiSource: { value: null }, qualityList: { value: {} }, userApi: { status: true, message: '' } }
  const appSetting = { 'common.apiSource': 'user_api_A' }
  const window = { lx: { apiInitPromise: [Promise.resolve(true), true, () => {}] } }
  const apiSource = load({
    window,
    '@renderer/store': store,
    '@renderer/store/setting': { appSetting, setApiSource: id => { persisted.push(id); appSetting['common.apiSource'] = id } },
    '@renderer/utils/ipc': { setUserApi: async id => { const d = deferred(); pending.set(id, d); return d.promise } },
    '@renderer/utils/musicSdk': { supportQuality: {} },
    '@renderer/utils/musicSdk/api-source-info': [{ id: 'kw', disabled: false }],
    '@common/constants': { ALWAYS_SUPPORTED_SOURCE_QUALITYS: {} },
  })
  return { apiSource, store, appSetting, persisted, pending }
}

test('#4 a late successful init of an abandoned switch does not become the active source', async() => {
  const h = harness()
  const switchB = h.apiSource.setUserApi('user_api_B', { persist: false })
  const restoreA = h.apiSource.setUserApi('user_api_A') // 超时撤销：切回用户音源
  h.pending.get('user_api_A').resolve()
  await restoreA
  h.pending.get('user_api_B').resolve() // B 迟到地初始化完成
  await switchB
  await flush()
  assert.equal(h.store.apiSource.value, 'user_api_A')
  assert.equal(h.apiSource.getRequestedApiId(), 'user_api_A')
  assert.equal(h.persisted.includes('user_api_B'), false)
  assert.equal(h.appSetting['common.apiSource'], 'user_api_A')
})

test('#4 a late failure of an abandoned switch does not trigger the fallback source', async() => {
  const h = harness()
  const switchB = h.apiSource.setUserApi('user_api_B', { persist: false })
  const restoreA = h.apiSource.setUserApi('user_api_A')
  h.pending.get('user_api_A').resolve()
  await restoreA
  h.pending.get('user_api_B').reject(new Error('init failed'))
  await switchB
  await flush()
  assert.equal(h.store.apiSource.value, 'user_api_A', 'must not fall back to a built-in source')
  assert.deepEqual(h.persisted, [])
})

test('#4 a temporary switch (persist: false) never writes the setting, even when it succeeds', async() => {
  const h = harness()
  const switchB = h.apiSource.setUserApi('user_api_B', { persist: false })
  h.pending.get('user_api_B').resolve()
  await switchB
  assert.equal(h.store.apiSource.value, 'user_api_B')
  assert.deepEqual(h.persisted, [])
  assert.equal(h.appSetting['common.apiSource'], 'user_api_A')
})
