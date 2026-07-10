import { onBeforeUnmount, watch } from '@common/utils/vueTools'
import {
  onPlaying,
  onPause,
  onEnded,
  onError,
  onLoadeddata,
  onLoadstart,
  onCanplay,
  onEmptied,
  onWaiting,
  onSeeked,
  getErrorCode,
} from '@renderer/plugins/player'
import { appSetting } from '@renderer/store/setting'


export default () => {
  let rOnPlaying = onPlaying(() => {
    window.app_event.playerPlaying()
    window.app_event.play()
  })
  let rOnPause = onPause(() => {
    window.app_event.playerPause()
    window.app_event.pause()
  })
  let rOnEnded = onEnded(() => {
    console.log('onEnded')
    window.app_event.playerEnded()
    // window.app_event.pause()
  })
  let rOnError = onError(() => {
    console.log('onError')
    const errorCode = getErrorCode()
    window.app_event.error(errorCode)
    window.app_event.playerError(errorCode)
  })
  let rOnLoadeddata = onLoadeddata(() => {
    console.log('onLoadeddata')
    window.app_event.playerLoadeddata()
  })
  let rOnLoadstart = onLoadstart(() => {
    console.log('onLoadstart')
    window.app_event.playerLoadstart()
  })
  let rOnCanplay = onCanplay(() => {
    console.log('onCanplay')
    window.app_event.playerCanplay()
  })
  let rOnEmptied = onEmptied(() => {
    console.log('onEmptied')
    window.app_event.playerEmptied()
    // window.app_event.stop()
  })
  let rOnWaiting = onWaiting(() => {
    console.log('onWaiting')
    // 内置引擎在缓冲时不应真正暂停 audio，否则 seek/缓冲结束后会停在暂停状态。
    // 只需要显示缓冲状态并启动缓冲超时检测。
    window.app_event.playerWaiting()
  })
  let rOnSeeked = onSeeked(() => {
    console.log('onSeeked')
    window.app_event.playerSeeked()
  })

  const subscribeEvents = () => {
    rOnPlaying?.()
    rOnPause?.()
    rOnEnded?.()
    rOnError?.()
    rOnLoadeddata?.()
    rOnLoadstart?.()
    rOnCanplay?.()
    rOnEmptied?.()
    rOnWaiting?.()
    rOnSeeked?.()

    rOnPlaying = onPlaying(() => {
      window.app_event.playerPlaying()
      window.app_event.play()
    })
    rOnPause = onPause(() => {
      window.app_event.playerPause()
      window.app_event.pause()
    })
    rOnEnded = onEnded(() => {
      console.log('onEnded')
      window.app_event.playerEnded()
    })
    rOnError = onError(() => {
      console.log('onError')
      const errorCode = getErrorCode()
      window.app_event.error(errorCode)
      window.app_event.playerError(errorCode)
    })
    rOnLoadeddata = onLoadeddata(() => {
      console.log('onLoadeddata')
      window.app_event.playerLoadeddata()
    })
    rOnLoadstart = onLoadstart(() => {
      console.log('onLoadstart')
      window.app_event.playerLoadstart()
    })
    rOnCanplay = onCanplay(() => {
      console.log('onCanplay')
      window.app_event.playerCanplay()
    })
    rOnEmptied = onEmptied(() => {
      console.log('onEmptied')
      window.app_event.playerEmptied()
    })
    rOnWaiting = onWaiting(() => {
      console.log('onWaiting')
      window.app_event.playerWaiting()
    })
    rOnSeeked = onSeeked(() => {
      console.log('onSeeked')
      window.app_event.playerSeeked()
    })
  }

  watch(() => appSetting['player.playEngine'], subscribeEvents)

  onBeforeUnmount(() => {
    rOnPlaying?.()
    rOnPause?.()
    rOnEnded?.()
    rOnError?.()
    rOnLoadeddata?.()
    rOnLoadstart?.()
    rOnCanplay?.()
    rOnEmptied?.()
    rOnWaiting?.()
    rOnSeeked?.()
  })
}
