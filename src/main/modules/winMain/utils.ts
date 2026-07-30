// import fs from 'fs'
import path from 'node:path'
import { type WindowSize, windowSizeList } from '@common/config'
import { nativeImage } from 'electron'
import { createTaskBarButtonDefinitions } from './taskBarButtons'

export const getWindowSizeInfo = (windowSizeId: number | string): WindowSize => {
  return windowSizeList.find(i => i.id == windowSizeId) ?? windowSizeList[0]
}

const getIconPath = (name: string): Electron.NativeImage => {
  return nativeImage.createFromPath(path.join(global.staticPath, 'images/taskbar', name + '.png'))
}

export const createTaskBarButtons = ({
  empty = false,
  collect = false,
  play = false,
  next = true,
  prev = true,
}: LX.TaskBarButtonFlags, onClick: (action: LX.Player.StatusButtonActions) => void): Electron.ThumbarButton[] => {
  return createTaskBarButtonDefinitions({ empty, collect, play, next, prev }, onClick).map(button => ({
    icon: getIconPath(button.icon),
    click: button.click,
    tooltip: button.tooltip,
    flags: button.disabled ? ['nobackground', 'disabled'] : ['nobackground'],
  }))
}
