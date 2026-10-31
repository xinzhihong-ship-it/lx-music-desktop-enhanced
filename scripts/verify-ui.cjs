const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

// Exercise the built application, with real Vue, router, IPC and saved settings.
module.exports = ({ app, output, profile, beforeVerify }) => {
  let started = false
  const timeout = setTimeout(() => { console.error('UI verification timed out'); app.exit(1) }, 90000)
  app.on('browser-window-created', (_event, win) => {
    win.webContents.on('did-finish-load', () => {
      if (started || !win.webContents.getURL().includes('/index.html?')) return
      started = true
      verify(win).then(() => { clearTimeout(timeout); app.exit(0) }).catch(error => {
        console.error(error)
        clearTimeout(timeout)
        app.exit(1)
      })
    })
  })

  async function verify(win) {
    await beforeVerify?.(win)
    const checks = []
    const js = source => win.webContents.executeJavaScript(source, true)
    const until = async(source, message) => {
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) {
        if (await js(source)) return
        await new Promise(resolve => setTimeout(resolve, 60))
      }
      throw new Error(message)
    }
    const pass = name => { checks.push(name); console.log('PASS UI:', name) }
    const key = name => {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: name })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: name })
    }
    const capture = async name => {
      await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const state = await js("({ view: document.querySelector('[data-view]')?.getAttribute('data-view'), theme: window.lxData.appSetting['theme.id'], width: innerWidth, height: innerHeight })")
      const image = await win.webContents.capturePage()
      const buffer = Buffer.from(image.resize({ width: 1440 }).toPNG())
      fs.writeFileSync(path.join(output, name + '.png'), buffer)
      fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify(state, null, 2))
    }
    await until("document.querySelectorAll('#left nav a').length >= 7 && typeof window.lxData?.updateSetting === 'function'", 'App did not mount')
    win.setContentSize(1280, 830)
    win.show()
    win.focus()
    await js("window.lxData.updateSetting({'theme.id':'easy_light','common.playBarProgressStyle':'middle'})")
    await until("getComputedStyle(document.documentElement).getPropertyValue('--color-main-background').trim() === '#ffffff'", 'Light theme did not apply')
    await capture('home-light')
    pass('Application starts with the new shell and light theme')

    await js("document.querySelector('#toolbar button[aria-label=\"切换到深色主题\"]').click()")
    await until("getComputedStyle(document.documentElement).getPropertyValue('--color-main-background').trim() === '#1c231e'", 'Dark theme did not apply')
    await capture('home-dark')
    pass('Toolbar changes the actual saved theme through IPC')

    await js("document.querySelector('#left a[href=\"#/setting\"]').click()")
    await until("document.querySelector('[data-view=Setting] button[role=tab]') != null", 'Settings did not open')
    await capture('settings-dark')
    const old = await js('JSON.stringify(window.lxData.appSetting)')
    const before = await js("(() => { const e=[...document.querySelectorAll('#view [role=switch]')].find(e=>e.getAttribute('aria-disabled')!=='true' && e.getClientRects().length); if(!e) throw Error('No enabled switch'); window.__uiSwitch=e; e.focus(); return e.getAttribute('aria-checked') })()")
    key('Space')
    await until(`window.__uiSwitch.getAttribute('aria-checked') !== ${JSON.stringify(before)}`, 'Switch did not respond to Space')
    const updated = JSON.parse(await js('JSON.stringify(window.lxData.appSetting)'))
    assert.ok(Object.keys(updated).some(k => typeof updated[k] === 'boolean' && updated[k] !== JSON.parse(old)[k]))
    key('Space')
    await until(`window.__uiSwitch.getAttribute('aria-checked') === ${JSON.stringify(before)}`, 'Switch could not be restored')
    pass('Keyboard toggles a real setting and can restore it')

    await js("document.querySelector('#toolbar button[aria-label=\"切换到浅色主题\"]').click()")
    await until("getComputedStyle(document.documentElement).getPropertyValue('--color-main-background').trim() === '#ffffff'", 'Light theme did not return')
    await capture('settings-light')

    const sampleNames = ['光线经过窗边', '慢慢走', '海岸线', '风的回信', '日落之前', '留白']
    const fixtureTracks = Array.from({ length: 400 }, (_, index) => ({
      id: 'ui-verification-' + index,
      name: `${sampleNames[index % sampleNames.length]} · ${String(index + 1).padStart(3, '0')}`,
      singer: '界面验证曲目',
      source: 'local',
      interval: '00:04',
      meta: { filePath: path.join(profile, 'ui-silence.wav'), ext: 'wav', albumName: '本地测试音乐' },
    }))
    const sampleRate = 8000
    const pcmBytes = sampleRate * 4 * 2
    const wav = Buffer.alloc(44 + pcmBytes)
    wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcmBytes, 4); wav.write('WAVEfmt ', 8)
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28)
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcmBytes, 40)
    fs.writeFileSync(path.join(profile, 'ui-silence.wav'), wav)
    await global.lx.event_list.list_music_overwrite('default', fixtureTracks)
    await js("document.querySelector('#left a[href=\"#/list\"]').click()")
    await until("document.querySelector('[data-view=List] .default-list') != null", 'Library did not mount')
    await js("document.querySelector('[data-view=List] .default-list').click()")
    await until(`document.querySelector('#view').textContent.includes(${JSON.stringify(fixtureTracks[0].name)})`, 'Fixture tracks did not render through the database')
    await capture('library-light')
    await js("(() => {const e=document.querySelector('#view .music-list-scroll'); if(!e) throw Error('Missing virtual list'); e.scrollTop=e.scrollHeight; e.dispatchEvent(new Event('scroll'))})()")
    await until(`document.querySelector('#view').textContent.includes(${JSON.stringify(fixtureTracks[399].name)})`, 'Virtual list did not reach the last track')
    pass('A real database-backed 400-track list renders and scrolls to the last song')

    const routes = [['/list', 'List'], ['/download', 'Download'], ['/platformMusic', 'PlatformMusic'], ['/musicRecognition', 'MusicRecognition'], ['/leaderboard', 'Leaderboard'], ['/songList/list', 'SongList'], ['/search', 'Search']]
    for (const [route, name] of routes) {
      const clicked = await js(`(() => {const a=document.querySelector('#left a[href="#${route}"]'); if(!a) return false; a.click(); return true})()`)
      if (!clicked && route === '/download') continue // respects the existing download enable setting
      assert.ok(clicked, 'Missing navigation: ' + route)
      await until(`document.querySelector('[data-view="${name}"]') != null`, 'Route did not mount: ' + route)
      assert.ok(await js("document.querySelector('#player') != null"), 'Player disappeared on ' + route)
      if (name === 'MusicRecognition') await capture('recognition-light')
      if (name === 'Download') await capture('downloads-light')
    }
    pass('All enabled navigation routes mount while the player stays available')

    await until("document.querySelectorAll('#view [role=tablist]')[0]?.querySelectorAll('[role=tab]').length > 1", 'Platform tabs did not mount')
    const previous = await js("(() => {const t=document.querySelector('#view [role=tablist]'); const e=t.querySelector('[aria-selected=true]') || t.querySelector('[role=tab]'); e.focus(); return e.textContent})()")
    key('Right')
    await until(`document.querySelector('#view [role=tablist] [aria-selected=true]')?.textContent !== ${JSON.stringify(previous)}`, 'Arrow key did not switch platform tab')
    assert.ok(await js("document.activeElement?.getAttribute('role') === 'tab'"))
    pass('Pill tabs support arrow-key selection and preserve keyboard focus')

    win.setContentSize(828, 610)
    await until('window.innerWidth === 828', 'Compact window did not resize')
    for (const mode of ['mini', 'middle', 'full']) {
      await js(`window.lxData.updateSetting({'common.playBarProgressStyle':'${mode}'})`)
      await until("document.querySelectorAll('#player button[aria-label]').length >= 3", 'Playback controls did not mount')
      const bounds = await js("[...document.querySelectorAll('#player button[aria-label]')].map(e=>{const r=e.getBoundingClientRect();return {label:e.getAttribute('aria-label'),left:r.left,right:r.right}})")
      assert.ok(bounds.every(r => r.left >= 0 && r.right <= 829), mode + ' player controls overflow at 828px: ' + JSON.stringify(bounds))
    }
    await capture('compact-light')
    pass('All three player layouts fit the smallest supported window')

    await js("window.lxData.updateSetting({'theme.id':'green'})")
    await until("getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() === 'rgb(77, 175, 124)'", 'Existing theme did not apply')
    pass('An existing theme still applies after the redesign')
    await js("window.lxData.updateSetting({'theme.id':'easy_light','common.playBarProgressStyle':'middle'})")
    await until("getComputedStyle(document.documentElement).getPropertyValue('--color-main-background').trim() === '#ffffff'", 'Preview theme did not finish saving')
    win.setContentSize(1280, 830)
    checks.push(...await require('./verify-ui-feedback.cjs')({ win, output }))
    const configFile = path.join(profile, 'LxDatas', 'config_v2.json')
    const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'))
    assert.equal(saved.setting['theme.id'], 'easy_light')
    const result = { result: 'PASS', checks, screenshots: fs.readdirSync(output).filter(f => f.endsWith('.png')), profile }
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
  }
}
