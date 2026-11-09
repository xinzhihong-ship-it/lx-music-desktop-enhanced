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

const fixture = Array.from({ length: 30 }, (_, i) => ({
  id: `issue27-${i}`, name: `Fixture ${i}`, version: '1.0.0',
  description: 'Local verification fixture', author: 'test',
  allowShowUpdateAlert: false, importSource: { type: 'local' },
  script: `/**\n * @name Fixture ${i}\n * @version 1.0.0\n */\nlx.send(lx.EVENT_NAMES.inited, { status: true, sources: {} })`,
}))
const expected = fixture.map(source => source.id)
;[expected[0], expected[1]] = [expected[1], expected[0]]
;[expected[28], expected[29]] = [expected[29], expected[28]]
expected.unshift(expected.splice(3, 1)[0])
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
const timeout = setTimeout(() => { console.error('Issue 27 UI verification timed out'); app.exit(1) }, 120000)
app.on('browser-window-created', (_event, win) => {
  // Keep verification windows from taking focus on the user's desktop.
  win.show = () => {}
  win.showInactive = () => {}
  win.webContents.setBackgroundThrottling(false)
  win.webContents.on('did-finish-load', () => {
    if (started || !win.webContents.getURL().includes('/index.html?')) return
    started = true
    verify(win).then(() => { clearTimeout(timeout); app.exit(0) }).catch(async err => {
      fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG())
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
  win.setContentSize(1180, 1100)
  await js("document.querySelector('#left a[href=\"#/setting\"]').click()")
  await until("[...document.querySelectorAll('#view button')].some(e => e.textContent.trim() === '自定义源管理')", 'Source manager unavailable')
  await js("[...document.querySelectorAll('#view button')].find(e => e.textContent.trim() === '自定义源管理').click()")
  await until("document.querySelectorAll('button[aria-label^=\"上移 Fixture\"]').length === 30", 'Sources did not render')
  if (!restart) {
    assert.equal(await js("document.querySelector('button[aria-label=\"上移 Fixture 0\"]').disabled"), true)
    assert.equal(await js("document.querySelector('button[aria-label=\"下移 Fixture 29\"]').disabled"), true)
    await js("document.querySelector('button[aria-label=\"下移 Fixture 0\"]').click()")
    await until("document.querySelector('button[aria-label^=\"上移 Fixture\"]').getAttribute('aria-label') === '上移 Fixture 1'", 'Down move failed')
    await js("document.querySelector('button[aria-label=\"上移 Fixture 29\"]').click()")
    await until("[...document.querySelectorAll('button[aria-label^=\"上移 Fixture\"]')][28].getAttribute('aria-label') === '上移 Fixture 29'", 'Up move failed')
    const drag = async(fromId, toId, after = false) => {
      const nextIds = (await apiList()).map(source => source.id).filter(id => id !== fromId)
      nextIds.splice(nextIds.indexOf(toId) + (after ? 1 : 0), 0, fromId)
      const points = await js(`(() => {
        const from = document.querySelector('li[data-api-id="${fromId}"] .user-api-drag-handle').getBoundingClientRect();
        const to = document.querySelector('li[data-api-id="${toId}"]').getBoundingClientRect();
        const list = document.querySelector('li[data-api-id="${fromId}"]').parentElement.getBoundingClientRect();
        if (from.top < list.top || from.bottom > list.bottom || to.top < list.top) throw Error('Drag fixture is not visible');
        // Stay away from the scroll edge when selecting a visible insertion position.
        return { x: Math.round(from.x + from.width / 2), y: Math.round(from.y + from.height / 2), targetY: Math.round(to.top + to.height * (${after} ? 0.6 : 0.4)) };
      })()`)
      // Await Chromium's real input pipeline; native events can be dropped by hidden windows.
      if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3')
      const mouse = params => win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', params)
      await mouse({ type: 'mouseMoved', x: points.x, y: points.y })
      await mouse({ type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, x: points.x, y: points.y })
      await new Promise(resolve => setTimeout(resolve, 100))
      for (let step = 1; step <= 12; step++) {
        await mouse({ type: 'mouseMoved', button: 'left', buttons: 1, x: points.x, y: Math.round(points.y + (points.targetY - points.y) * step / 12) })
        await new Promise(resolve => setTimeout(resolve, 35))
      }
      await mouse({ type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, x: points.x, y: points.targetY })
      await until(`JSON.stringify([...document.querySelectorAll('li[data-api-id]')].map(e => e.dataset.apiId)) === ${JSON.stringify(JSON.stringify(nextIds))}`, 'Real mouse drag did not update source order')
      await js('new Promise(resolve => setTimeout(resolve, 300))')
      assert.equal(await js("document.querySelectorAll('.sortable-fallback, .sortable-chosen').length"), 0)
    }
    await drag('issue27-3', 'issue27-1')
    // Closing/reopening mounts a new list; drag support must follow that lifecycle.
    await js("document.querySelector('.user-api-drag-handle').closest('main').parentElement.querySelector('header button').click()")
    await until("!document.querySelector('.user-api-drag-handle')", 'Source manager did not close')
    await js("[...document.querySelectorAll('#view button')].find(e => e.textContent.trim() === '自定义源管理').click()")
    await until("document.querySelectorAll('.user-api-drag-handle').length === 30", 'Source manager did not reopen')
    await drag('issue27-2', 'issue27-3')
    await drag('issue27-2', 'issue27-0', true)
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
  assert.equal(await js(`document.querySelector(${JSON.stringify(selector)}).max`), '')
  if (!restart) {
    for (const [value, expectedValue] of [['21', 21], ['999', 999], ['0', 1], ['50', 50]]) {
      await js(`(() => {const e=document.querySelector(${JSON.stringify(selector)}); e.value=${JSON.stringify(value)}; e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
      await until(`window.lxData.appSetting['player.playErrorApiSourceCount'] === ${expectedValue}`, 'Source count normalization failed')
    }
  }
  assert.equal(await js("window.lxData.appSetting['player.playErrorApiSourceCount']"), 50)
  await until(`JSON.parse(require('fs').readFileSync(${JSON.stringify(path.join(data, 'config_v2.json'))}, 'utf8')).setting['player.playErrorApiSourceCount'] === 50`, 'Setting was not persisted')
  await js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`)
  if (!restart) fs.writeFileSync(path.join(output, 'source-limit.png'), (await win.webContents.capturePage()).toPNG())
  console.log('PASS Issue 27:', restart ? 'separate app restart preserves 30 sources, drag order and count 50' : 'real mouse drag, reopened modal drag, arrows, IPC, 30 source scripts, active selection, persisted order and count above 20')
}

process.env.NODE_ENV = 'production'
require(path.join(root, 'dist', 'main.js'))
