const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

// Use actual host output catalogs in a disposable profile; do not start playback.
module.exports = async({ win, output }) => {
  const checks = []
  const js = code => win.webContents.executeJavaScript(code, true)
  const until = async(code, message) => {
    const deadline = Date.now() + 20000
    while (!(await js(code))) {
      if (Date.now() > deadline) throw new Error(message)
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
  const pass = name => { checks.push(name); console.log('PASS audio device:', name) }
  await js(`(() => {
    const find = node => {
      if (!node || typeof node !== 'object') return
      if (node.component) {
        if (node.component.type.name==='SettingPlay') return node.component
        const match=find(node.component.subTree);if(match)return match
      }
      if (Array.isArray(node.children)) for(const child of node.children){const match=find(child);if(match)return match}
    }
    window.__audioDeviceTest={router:document.querySelector('#root').__vue_app__.config.globalProperties.$router,find:()=>find(document.querySelector('#root')._vnode)}
  })()`)
  const openPlayback = async() => {
    await js("window.__audioDeviceTest.router.push('/setting')")
    await until("document.querySelector('[data-view=Setting] [role=tab]') != null", 'Settings did not mount')
    await js("[...document.querySelectorAll('[data-view=Setting] [role=tab]')].find(e=>e.textContent.trim()===window.i18n.t('setting__play')).click()")
    await until('Boolean(window.__audioDeviceTest.find())', 'Playback settings did not mount')
  }
  const switchEngine = async engine => {
    await js('document.querySelector(\'#basic_play_engine\').nextElementSibling.querySelector(\'.label-content\').click()')
    await until("document.querySelector('#basic_play_engine').nextElementSibling.querySelector('.selection-list') != null", 'Engine menu did not open')
    await js(`(() => {const label=window.__audioDeviceTest.find().setupState.playEngineList.find(item=>item.id===${JSON.stringify(engine)}).label;[...document.querySelector('#basic_play_engine').nextElementSibling.querySelectorAll('li')].find(e=>e.textContent.trim()===label).click()})()`)
    await until(`window.lxData.appSetting['player.playEngine']===${JSON.stringify(engine)}`, 'Engine switch did not finish')
  }
  const selected = () => js(`(() => {
    const state=window.__audioDeviceTest.find().setupState
    const id=state.mediaDeviceId
    const option=state.mediaDevices.find(item=>item.deviceId===id)
    const setting=window.lxData.appSetting
    return {engine:setting['player.playEngine'],id,label:option?.label,preference:{label:setting['player.mediaDeviceLabel'],electronLabel:setting['player.mediaDeviceLabel.electron'],mpvLabel:setting['player.mediaDeviceLabel.mpv'],electron:setting['player.mediaDeviceId.electron'],mpv:setting['player.mediaDeviceId.mpv']}}
  })()`)
  const capture = async name => {
    await js("document.querySelector('#play_mediaDevice').scrollIntoView({block:'center'})")
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG())
  }
  try {
    await js("window.lxData.updateSetting({'player.playEngine':'mpv','player.mediaDeviceId':'default','player.mediaDeviceLabel':'','player.mediaDeviceId.electron':'','player.mediaDeviceId.mpv':''})")
    await openPlayback()
    await until("document.querySelector('#play_mediaDevice').nextElementSibling.querySelectorAll('select option').length>1", 'MPV output devices did not load')
    const pairs = await js(`(async() => {
      const normalize=(label,chrome=false)=>(chrome?label.replace(/\\s+\\((?:[0-9a-f]{4}:[0-9a-f]{4}|virtual|built-in|aggregate|bluetooth|hdmi|displayport|airplay|thunderbolt|pci)\\)\\s*$/i,''):label).trim().replace(/\\s+/g,' ').toLowerCase()
      const chrome=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audiooutput'&&!['default','communications'].includes(d.deviceId)&&d.label)
      const native=[...document.querySelector('#play_mediaDevice').nextElementSibling.querySelectorAll('select option')].map(e=>({id:e.value,label:e.textContent.trim()}))
      window.__audioDeviceTest.catalog={chrome:chrome.map(d=>({id:d.deviceId,label:d.label})),native,allChrome:(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audiooutput').map(d=>({id:d.deviceId,label:d.label}))}
      return [...document.querySelector('#play_mediaDevice').nextElementSibling.querySelectorAll('select option')].filter(e=>e.value!=='default').flatMap(option=>{
        const matches=chrome.filter(d=>normalize(d.label,true)===normalize(option.textContent))
        return matches.length===1?[{label:option.textContent.trim(),electronLabel:matches[0].label,mpv:option.value,electron:matches[0].deviceId}]:[]
      }).sort((a,b)=>a.label.localeCompare(b.label))
    })()`)
    fs.writeFileSync(path.join(output, 'audio-device-catalog.json'), JSON.stringify(await js('window.__audioDeviceTest.catalog'), null, 2))
    assert.ok(pairs.length > 0, 'No shared named output was available for real-device verification')
    const first = pairs[0]
    await js(`(() => {const select=document.querySelector('#play_mediaDevice').nextElementSibling.querySelector('select');select.value=${JSON.stringify(first.mpv)};select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await until(`window.lxData.appSetting['player.mediaDeviceId']===${JSON.stringify(first.mpv)}`, 'Initial output selection did not save')
    // Simulate upgrading an old profile that only contains a native MPV ID.
    await js("window.lxData.updateSetting({'player.mediaDeviceLabel':'','player.mediaDeviceId.electron':'','player.mediaDeviceId.mpv':''});window.__audioDeviceTest.router.push('/search')")
    await openPlayback()
    await until(`window.lxData.appSetting['player.mediaDeviceId.mpv']===${JSON.stringify(first.mpv)}`, 'Legacy native output was not remembered')
    assert.equal((await selected()).label, first.label)
    pass('An existing MPV hardware selection remains visible when playback settings reopen')

    await switchEngine('electron')
    await until(`window.lxData.appSetting['player.mediaDeviceId']===${JSON.stringify(first.electron)}`, 'MPV output did not map to the same Chromium device')
    let state = await selected()
    assert.equal(state.label, first.electronLabel)
    assert.equal(state.preference.mpv, first.mpv)
    await capture('audio-device-electron')
    pass('MPV to built-in playback keeps the same real output with its Chromium ID')

    await switchEngine('mpv')
    await until(`window.lxData.appSetting['player.mediaDeviceId']===${JSON.stringify(first.mpv)}`, 'Built-in output did not return to the original MPV device')
    state = await selected()
    assert.equal(state.label, first.label)
    assert.equal(state.preference.electron, first.electron)
    await capture('audio-device-mpv')
    pass('Built-in to MPV playback restores the original native output without blanking the selection')

    await switchEngine('electron')
    const next = pairs[1] ?? first
    await js("document.querySelector('#play_mediaDevice').nextElementSibling.querySelector('.label-content').click()")
    await until("document.querySelector('#play_mediaDevice').nextElementSibling.querySelector('.selection-list') != null", 'Built-in device menu did not open')
    await js(`[...document.querySelector('#play_mediaDevice').nextElementSibling.querySelectorAll('li')].find(e=>e.textContent.trim()===${JSON.stringify(next.electronLabel)}).click()`)
    await until(`window.lxData.appSetting['player.mediaDeviceId.electron']===${JSON.stringify(next.electron)}`, 'Changed built-in output did not bind and save')
    await switchEngine('mpv')
    await until(`window.lxData.appSetting['player.mediaDeviceId']===${JSON.stringify(next.mpv)}`, 'The newly selected output was lost when switching to MPV')
    await switchEngine('electron')
    await until(`window.lxData.appSetting['player.mediaDeviceId']===${JSON.stringify(next.electron)}`, 'The newly selected output was lost on return to built-in playback')
    state = await selected()
    assert.equal(state.label, next.electronLabel)
    const snapshot = { result: 'PASS', checks: [...checks], original: first, current: state, testedNewChoice: next.mpv !== first.mpv }
    fs.writeFileSync(path.join(output, 'audio-device-persistence.json'), JSON.stringify(snapshot, null, 2))
    pass('Changing the real output updates both engine mappings and retains the new choice on return')
  } finally {
    await js('delete window.__audioDeviceTest')
  }
  fs.writeFileSync(path.join(output, 'audio-device-verification.json'), JSON.stringify({ result: 'PASS', checks }, null, 2))
  return checks
}
