import test from 'node:test'
import assert from 'node:assert/strict'
import { filterMusicRows } from '../src/renderer/utils/filterMusicRows.ts'
import { createTaskBarButtonDefinitions } from '../src/main/modules/winMain/taskBarButtons.ts'
import { createExportSetting, preserveAgreement } from '../src/renderer/utils/exportSetting.ts'
import { reactive } from 'vue'

const musics = [
  { name: '晴天', singer: '周杰伦', meta: { albumName: '叶惠美' } },
  { name: 'Red', singer: 'Taylor Swift', meta: { albumName: 'Red' } },
  { name: '后来', singer: '刘若英', meta: { albumName: '我等你' } },
]

test('music list filter matches name, singer, and album while preserving source indexes', () => {
  assert.deepEqual(filterMusicRows(musics, ' taylor ').map(({ index }) => index), [1])
  assert.deepEqual(filterMusicRows(musics, '叶惠美').map(({ index }) => index), [0])
  assert.deepEqual(filterMusicRows(musics, '后来').map(({ index }) => index), [2])
  assert.deepEqual(filterMusicRows(musics, '').map(({ index }) => index), [0, 1, 2])
})

test('taskbar buttons dispatch collect, transport, and playback actions', () => {
  const actions = []
  const buttons = createTaskBarButtonDefinitions({}, action => actions.push(action))
  buttons.forEach(button => button.click())
  assert.deepEqual(actions, ['collect', 'prev', 'play', 'next'])

  actions.length = 0
  const activeButtons = createTaskBarButtonDefinitions({ collect: true, play: true }, action => actions.push(action))
  activeButtons[0].click()
  activeButtons[2].click()
  assert.deepEqual(actions, ['unCollect', 'pause'])
})

test('empty taskbar state disables every button', () => {
  assert.equal(createTaskBarButtonDefinitions({ empty: true }, () => {}).every(button => button.disabled), true)
})

test('setting export removes nested Vue proxies and the GitCode token', () => {
  const setting = reactive({
    'network.gitcodeMusicAccessToken': 'DO_NOT_EXPORT',
    nested: { values: ['one', 'two'] },
  })
  const exported = createExportSetting(setting)
  assert.doesNotThrow(() => structuredClone(exported))
  assert.equal(exported['network.gitcodeMusicAccessToken'], '')
  assert.deepEqual(exported.nested.values, ['one', 'two'])
})

test('setting import preserves the current agreement state', () => {
  assert.equal(preserveAgreement({ 'common.isAgreePact': false }, true)['common.isAgreePact'], true)
  assert.equal(preserveAgreement({ 'common.isAgreePact': true }, false)['common.isAgreePact'], false)
})
