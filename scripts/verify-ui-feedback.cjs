const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

// Run against the built renderer; use disposable rows and observe its playback event.
module.exports = async({ win, output }) => {
  const checks = []
  const js = code => win.webContents.executeJavaScript(code, true)
  const until = async(code, message) => {
    const deadline = Date.now() + 12000
    while (!(await js(code))) {
      if (Date.now() > deadline) throw new Error(message)
      await new Promise(resolve => setTimeout(resolve, 40))
    }
  }
  const pass = name => { checks.push(name); console.log('PASS feedback:', name) }
  const clickAt = (x, y, clickCount = 1) => {
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y })
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', x, y, clickCount })
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', x, y, clickCount })
  }
  const click = async selector => {
    const point = await js(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e || e.disabled) throw Error('Unavailable control');const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)} })()`)
    clickAt(point.x, point.y)
  }
  const capture = async name => {
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG())
  }
  await js(`(() => {
    window.__feedbackRouter = document.querySelector('#root').__vue_app__.config.globalProperties.$router
    window.__feedbackFind = predicate => {
      const seen = new Set()
      const walk = node => {
        if (!node || typeof node !== 'object' || seen.has(node)) return
        seen.add(node)
        if (node.component) {
          if (predicate(node.component)) return node.component
          const found = walk(node.component.subTree)
          if (found) return found
        }
        if (Array.isArray(node.children)) for (const child of node.children) { const found=walk(child);if(found)return found }
      }
      return walk(document.querySelector('#root')._vnode)
    }
    return Boolean(window.__feedbackRouter)
  })()`)

  try {
    await js("window.__feedbackRouter.push({path:'/songList/list',query:{source:'kw',tagId:'',sortId:'hot',page:'1'}})")
    await until("window.__feedbackRouter.currentRoute.value.name==='SongList' && [...document.querySelectorAll('#view button')].some(e=>e.textContent==='打开歌单')", 'Playlist controls did not mount')
    const layouts = []
    for (const width of [1280, 828]) {
      win.setContentSize(width, width === 828 ? 610 : 830)
      await until(`innerWidth===${width}`, 'Window did not resize')
      await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const bounds = await js(`(() => {
        const button=[...document.querySelectorAll('#view button')].find(e=>e.textContent==='打开歌单')
        const selection=button.parentElement.querySelector('.label-content')
        const a=button.getBoundingClientRect(),b=selection.getBoundingClientRect(),view=document.querySelector('[data-view=SongList]').getBoundingClientRect()
        return {width:innerWidth,button:{top:a.top,bottom:a.bottom,left:a.left,right:a.right,height:a.height},selection:{top:b.top,bottom:b.bottom,left:b.left,right:b.right,height:b.height},view:{left:view.left,right:view.right}}
      })()`)
      assert.ok(Math.abs(bounds.button.height - bounds.selection.height) < 1, 'Playlist control heights differ: ' + JSON.stringify(bounds))
      assert.ok(Math.abs(bounds.button.top - bounds.selection.top) < 1, 'Playlist controls are misaligned: ' + JSON.stringify(bounds))
      assert.ok(bounds.selection.left - bounds.button.right >= 8, 'Playlist controls overlap')
      assert.ok(bounds.button.left >= bounds.view.left && bounds.selection.right <= bounds.view.right, 'Playlist controls overflow')
      layouts.push(bounds)
      await capture('playlist-controls-' + width)
    }
    fs.writeFileSync(path.join(output, 'playlist-controls.json'), JSON.stringify(layouts, null, 2))
    pass('Playlist controls are aligned, equally sized and separated at 1280px and 828px')
    win.setContentSize(1280, 830)
    await until('innerWidth===1280', 'Window did not restore')

    await js('window.__feedbackListRoute=window.__feedbackRouter.currentRoute.value.fullPath')
    await js("window.__feedbackRouter.push({path:'/songList/detail',query:{source:'kw',id:'ui-feedback-fixture',fromName:'SongList'}})")
    await until("window.__feedbackRouter.currentRoute.value.name==='SongListDetail' && !document.querySelector('#toolbar button').disabled", 'Playlist detail did not mount')
    await click('#toolbar button')
    await until('window.__feedbackRouter.currentRoute.value.fullPath===window.__feedbackListRoute', 'Toolbar back returned to the playlist detail instead of its list')
    await until("!document.querySelectorAll('#toolbar button')[1].disabled", 'Forward did not become available')
    await click('#toolbar button:nth-child(2)')
    await until("window.__feedbackRouter.currentRoute.value.name==='SongListDetail'", 'Forward did not reopen the detail')
    await click('#toolbar button')
    await until('window.__feedbackRouter.currentRoute.value.fullPath===window.__feedbackListRoute', 'Back failed after forward navigation')
    pass('Toolbar back leaves playlist detail, preserves list filters and works after forward navigation')

    await js("window.__feedbackRouter.push({path:'/search',query:{source:'kw',type:'songlist',text:'保留搜索条件',page:'2'}})")
    await js('window.__feedbackSearchRoute=window.__feedbackRouter.currentRoute.value.fullPath')
    await js("window.__feedbackRouter.push({path:'/songList/detail',query:{source:'kw',id:'ui-feedback-search-fixture',fromName:'Search'}})")
    await until("window.__feedbackRouter.currentRoute.value.name==='SongListDetail'", 'Search playlist detail did not mount')
    await click('#toolbar button')
    await until('window.__feedbackRouter.currentRoute.value.fullPath===window.__feedbackSearchRoute', 'Back lost the original search query')
    pass('Returning from a searched playlist preserves its source, keyword, type and page')

    await js("window.lxData.updateSetting({'list.isClickPlayList':true})")
    await until("window.lxData.appSetting['list.isClickPlayList']===true", 'Playback setting did not update')
    await js("window.__feedbackRouter.push({path:'/search',query:{source:'kw',type:'music',text:'交互回归验证'}})")
    await until("Boolean(window.__feedbackFind(c=>c.type.name==='MaterialOnlineList'))", 'Search rows did not mount')
    await js(`(() => {
      const instance=window.__feedbackFind(c=>c.type.name==='MaterialOnlineList')
      window.__feedbackOnline=instance
      window.__feedbackParent=instance.parent
      instance.parent.scope.stop()
      window.__feedbackPlays=[]
      instance.vnode.props.onPlayList=index=>window.__feedbackPlays.push(index)
      Object.assign(instance.props,{list:[{id:'ui-name-click',name:'搜索结果：歌名后半部分也能双击播放的验证曲目',singer:'回归歌手',source:'kw',interval:'03:20',meta:{songId:'ui-name-click',albumName:'回归专辑',_qualitys:{}}}],total:1,limit:30,noItem:'',checkApiSource:false,searchByField:true})
      instance.update()
    })()`)
    for (const actions of [true, false]) {
      await js(`window.__feedbackOnline.setupState.actionButtonsVisible=${actions};window.__feedbackOnline.update()`)
      await until("document.querySelector('#view .list-item .name [aria-label]') != null", 'Fixture title did not render')
      const before = await js('window.__feedbackRouter.currentRoute.value.fullPath')
      const point = await js('(() => {const e=document.querySelector(\'#view .list-item .name [aria-label]\');const r=e.getBoundingClientRect();return {x:Math.floor(r.right-4),y:Math.round(r.top+r.height/2)}})()')
      const count = await js('window.__feedbackPlays.length')
      clickAt(point.x, point.y, 1)
      await new Promise(resolve => setTimeout(resolve, 50))
      assert.equal(await js('window.__feedbackRouter.currentRoute.value.fullPath'), before, 'Single-clicking a song title started another search')
      clickAt(point.x, point.y, 2)
      await until(`window.__feedbackPlays.length===${count + 1}`, 'Double-clicking the end of the title did not request playback')
      assert.equal(await js('window.__feedbackRouter.currentRoute.value.fullPath'), before, 'Double-clicking the title changed the search')
      const start = await js('(() => {const r=document.querySelector(\'#view .list-item .name\').getBoundingClientRect();return {x:Math.round(r.left+5),y:Math.round(r.top+r.height/2)}})()')
      clickAt(start.x, start.y, 1)
      clickAt(start.x, start.y, 2)
      await until(`window.__feedbackPlays.length===${count + 2}`, 'Double-clicking the front of the title did not request playback')
    }
    await capture('search-title-playback')
    pass('Both search row layouts play from the front and end of the title without starting another search')

    const count = await js('window.__feedbackPlays.length')
    await js("document.querySelector('#view .list-item button[aria-label=回归歌手]').click()")
    await until("window.__feedbackRouter.currentRoute.value.query.text==='回归歌手'", 'Artist search stopped working')
    await js("document.querySelector('#view .list-item button[aria-label=回归专辑]').click()")
    await until("window.__feedbackRouter.currentRoute.value.query.text==='回归专辑'", 'Album search stopped working')
    assert.equal(await js('window.__feedbackPlays.length'), count)
    pass('Artist and album search remain available and do not request playback')
  } finally {
    await js("(async()=>{if(window.__feedbackParent) await window.__feedbackRouter.push('/setting');delete window.__feedbackFind;delete window.__feedbackOnline;delete window.__feedbackParent;delete window.__feedbackRouter;delete window.__feedbackPlays;delete window.__feedbackListRoute;delete window.__feedbackSearchRoute})()")
  }
  fs.writeFileSync(path.join(output, 'feedback-verification.json'), JSON.stringify({ result: 'PASS', checks }, null, 2))
  return checks
}
