// Run with Electron after `npm run build`. This preview has its own local data.
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const profile = path.join(app.getPath('temp'), process.env.LX_UI_VERIFY === '1' ? 'lx-music-easyui-test' : 'lx-music-easyui-preview')
const output = path.join(root, 'build', 'ui-review')
fs.mkdirSync(profile, { recursive: true })
fs.mkdirSync(output, { recursive: true })
app.setAppPath(root)
app.setName('LX Music UI Preview')
app.setPath('userData', profile)
// Previewing a local branch must not replace the user's lxmusic: URL handler.
app.setAsDefaultProtocolClient = () => false
app.removeAsDefaultProtocolClient = () => false

const nativeDir = path.join(root, 'build', 'Release')
const nativeName = `qrc_decode_electron-v${process.versions.modules}-${process.platform}-${process.arch}.node`
const nativeSource = path.join(root, 'build-config', 'lib', nativeName)
if (fs.existsSync(nativeSource)) {
  fs.mkdirSync(nativeDir, { recursive: true })
  fs.copyFileSync(nativeSource, path.join(nativeDir, 'qrc_decode.node'))
}

if (process.env.LX_UI_VERIFY === '1') {
  const configDir = path.join(profile, 'LxDatas')
  fs.mkdirSync(configDir, { recursive: true })
  // Only the disposable test profile skips the first-run agreement dialog.
  fs.writeFileSync(path.join(configDir, 'config_v2.json'), JSON.stringify({
    version: '2.1.0',
    setting: {
      version: '2.1.0',
      'common.isAgreePact': true,
      'common.langId': 'zh-cn',
      'common.windowSizeId': 4,
      'common.isShowAnimation': false,
      'common.startInFullscreen': false,
      'common.transparentWindow': false,
      'common.showChangeLog': false,
      'common.tryAutoUpdate': false,
      'tray.enable': false,
      'theme.id': 'easy_light',
      'theme.lightId': 'easy_light',
      'theme.darkId': 'easy_dark',
      'search.isShowHotSearch': false,
      'download.enable': true,
      'player.isSavePlayTime': false,
      'player.startupAutoPlay': false,
    },
  }))
  require('./verify-ui.cjs')({ app, output, profile })
}

process.env.NODE_ENV = 'production'
require(path.join(root, 'dist', 'main.js'))
