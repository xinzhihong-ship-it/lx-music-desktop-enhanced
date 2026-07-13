import registerUserApi from './userApi'
import registerWinMain from './winMain'
import registerHotKey from './hotKey'
import registerTray from './tray'
import registerAppMenu from './appMenu'
import registerWinLyric from './winLyric'
import registerCommonRenderers from './commonRenderers'
import registerAccount from './account'
import registerMusicRecognition from './musicRecognition'

let isRegistered = false
export default () => {
  if (isRegistered) return
  isRegistered = true
  registerUserApi()
  registerCommonRenderers()
  registerWinMain()
  registerHotKey()
  registerTray()
  registerAppMenu()
  registerWinLyric()
  registerAccount()
  registerMusicRecognition()
}
