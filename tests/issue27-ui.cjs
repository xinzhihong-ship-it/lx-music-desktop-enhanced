// Run after npm run build: electron tests/issue27-ui.cjs
// Run again with LX_ISSUE27_RESTART=1 to check persistence across app processes.
const { app } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'build', 'issue27-ui')
const profile = path.join(output, 'profile')
const data = path.join(profile, 'LxDatas')
const restart = process.env.LX_ISSUE27_RESTART === '1'
fs.mkdirSync(data, { recursive: true })
app.setAppPath(root)
app.setName('LX Issue 27 Verification')
app.setPath('userData', profile)
app.setAsDefaultProtocolClient = () => false
app.removeAsDefaultProtocolClient = () => false

const fixture = Array.from({ length: 20 }, (_, i) => ({
  id: `issue27-${i}`, name: `Fixture ${i}`, version: '1.0.0',
  description: 'Local verification fixture', author: 'test',
  allowShowUpdateAlert: false, importSource: { type: 'local' },
  script: `/**\n * @name Fixture ${i}\n * @version 1.0.0\n */\nlx.send(lx.EVENT_NAMES.inited, { status: true, sources: {} })`,
}))
const expected = fixture.map(source => source.id)
;[expected[0], expected[1]] = [expected[1], expected[0]]
;[expected[18], expected[19]] = [expected[19], expected[18]]
if (!restart) {
  fs.writeFileSync(path.join(data, 'user_api.json'), JSON.stringify({ userApis: fixture }))
  fs.writeFileSync(path.join(data, 'config_v2.json'), JSON.stringify({
    version: '2.1.0', setting: {
      version: '2.1.0', 'common.isAgreePact': true, 'common.langId': 'zh-cn',
      'common.windowSizeId': 4, 'common.isShowAnimation': false, 'common.showChangeLog': false,
      'common.tryAutoUpdate': false, 'tray.enable': false, 'search.isShowHotSearch': false,
      'player.startupAutoPlay': false, 'common.apiSource': 'issue27-10',
      'player.autoSkipOnError': true, 'player.playErrorStrategy': 'auto',
    },
  }))
}
const nativeSource = path.join(root, 'build-config', 'lib', `qrc_decode_electron-v${process.versions.modules}-${process.platform}-${process.arch}.node`)
if (fs.existsSync(nativeSource)) {
  fs.mkdirSync(path.join(root, 'build', 'Release'), { recursive: true })
  fs.copyFileSync(nativeSource, path.join(root, 'build', 'Release', 'qrc_decode.node'))
}

let started = false
const timeout = setTimeout(() => { console.error('Issue 27 UI verification timed out'); app.exit(1) }, 90000)
app.on('browser-window-created', (_event, win) => {
  // Keep verification windows from taking focus on the user's desktop.
  win.show = () => {}
  win.showInactive = () => {}
  win.webContents.on('did-finish-load', () => {
    if (started || !win.webContents.getURL().includes('/index.html?')) return
    started = true
    verify(win).then(() => { clearTimeout(timeout); app.exit(0) }).catch(err => {
      console.error(err); clearTimeout(timeout); app.exit(1)
    })
  })
})

async function verify(win) {
  const js = source => win.webContents.executeJavaScript(source, true)
  const until = async(source, message) => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      if (await js(source)) return
      await new Promise(resolve => setTimeout(resolve, 70))
    }
    throw new Error(message)
  }
  const apiList = () => js("require('electron').ipcRenderer.invoke('winMain_get_user_api_list')")
  await until("typeof window.lxData?.updateSetting === 'function' && document.querySelector('#left a[href=\"#/setting\"]')", 'App did not mount')
  win.setContentSize(1180, 780)
  await js("document.querySelector('#left a[href=\"#/setting\"]').click()")
  await until("[...document.querySelectorAll('#view button')].some(e => e.textContent.trim() === '自定义源管理')", 'Source manager unavailable')
  await js("[...document.querySelectorAll('#view button')].find(e => e.textContent.trim() === '自定义源管理').click()")
  await until("document.querySelectorAll('button[aria-label^=\"上移 Fixture\"]').length === 20", 'Sources did not render')
  if (!restart) {
    assert.equal(await js("document.querySelector('button[aria-label=\"上移 Fixture 0\"]').disabled"), true)
    assert.equal(await js("document.querySelector('button[aria-label=\"下移 Fixture 19\"]').disabled"), true)
    await js("document.querySelector('button[aria-label=\"下移 Fixture 0\"]').click()")
    await until("document.querySelector('button[aria-label^=\"上移 Fixture\"]').getAttribute('aria-label') === '上移 Fixture 1'", 'Down move failed')
    await js("document.querySelector('button[aria-label=\"上移 Fixture 19\"]').click()")
    await until("[...document.querySelectorAll('button[aria-label^=\"上移 Fixture\"]')][18].getAttribute('aria-label') === '上移 Fixture 19'", 'Up move failed')
  }
  assert.deepEqual((await apiList()).map(source => source.id), expected)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, 'user_api.json'))).userApis.map(source => source.id), expected)
  assert.equal(await js("window.lxData.appSetting['common.apiSource']"), 'issue27-10')
  const exported = await js("require('electron').ipcRenderer.invoke('winMain_get_user_api_data')")
  assert.deepEqual(exported.list.map(source => source.id), expected)
  for (const source of fixture) assert.equal(exported.scripts[source.id], source.script)
  if (!restart) fs.writeFileSync(path.join(output, 'source-order.png'), (await win.webContents.capturePage()).toPNG())
  await js("document.querySelector('button[aria-label^=\"上移 Fixture\"]').closest('main').parentElement.querySelector('header button').click()")
  await js("document.querySelector('[role=tab][aria-label=\"播放设置\"]').click()")
  const selector = 'input[aria-label="最多尝试的自定义音源数"]'
  await until(`document.querySelector(${JSON.stringify(selector)})`, 'Source limit input missing')
  assert.equal(await js(`document.querySelector(${JSON.stringify(selector)}).max`), '20')
  if (!restart) {
    for (const [value, expectedValue] of [['20', 20], ['21', 20], ['0', 1], ['20', 20]]) {
      await js(`(() => {const e=document.querySelector(${JSON.stringify(selector)}); e.value=${JSON.stringify(value)}; e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
      await until(`window.lxData.appSetting['player.playErrorApiSourceCount'] === ${expectedValue}`, 'Source count normalization failed')
    }
  }
  assert.equal(await js("window.lxData.appSetting['player.playErrorApiSourceCount']"), 20)
  await until(`JSON.parse(require('fs').readFileSync(${JSON.stringify(path.join(data, 'config_v2.json'))}, 'utf8')).setting['player.playErrorApiSourceCount'] === 20`, 'Setting was not persisted')
  if (!restart) fs.writeFileSync(path.join(output, 'source-limit.png'), (await win.webContents.capturePage()).toPNG())
  console.log('PASS Issue 27:', restart ? 'separate app restart preserves source order and count 20' : 'real Vue controls, IPC, source scripts, active selection, persisted order, boundaries and count 20')
}

process.env.NODE_ENV = 'production'
require(path.join(root, 'dist', 'main.js'))
