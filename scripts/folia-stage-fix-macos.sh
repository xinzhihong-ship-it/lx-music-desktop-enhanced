#!/bin/bash
# 给 macOS 版 Folia 0.7.28 补上舞台模式的一处缺陷（测试「推送到 Folia 歌词舞台」用；Folia 官方修复后就不需要了）。
#
# 缺陷：外部播放器经 Stage API 推送的歌词，Folia 只更新了行号和进度，没把时间交给歌词动画
#      （src/components/app/playback/bridges/usePlaybackVisualizerBridge.ts 的 stage 分支漏了 showLyricTime），
#      所以翻译、进度会动，原文大字和逐字动画不出现。
# 做法：在 app.asar 里原地替换一段等长的代码：补上 m(e)（即 showLyricTime(nextTime)），
#      同一段里 5 处字符串比较的 === 换成 ==（两边都是字符串，结果不变）以保持长度，asar 的目录与偏移都不动。
#      Folia 的 macOS 包没有整包签名、也没开 asar 完整性校验，改动后照常启动。
#
# 用法：
#   bash folia-stage-fix-macos.sh            补上
#   bash folia-stage-fix-macos.sh restore    改回原样
#   FOLIA_APP=/路径/Folia.app bash folia-stage-fix-macos.sh   Folia 不在「应用程序」里时
set -euo pipefail

APP="${FOLIA_APP:-/Applications/Folia.app}"
ASAR="$APP/Contents/Resources/app.asar"
BIN="$APP/Contents/MacOS/Folia"
ACTION="${1:-patch}"

if [ "$ACTION" != "patch" ] && [ "$ACTION" != "restore" ]; then
  echo "用法：bash $0 [restore]"
  exit 2
fi
if [ ! -f "$ASAR" ] || [ ! -x "$BIN" ]; then
  echo "没找到 $APP。请先打开 Folia 的 dmg，把 Folia.app 拖进「应用程序」再运行本脚本。"
  exit 1
fi

# 先退出 Folia：运行中改文件不会生效
if pgrep -x Folia >/dev/null 2>&1; then
  echo "正在退出 Folia…"
  osascript -e 'quit app "Folia"' >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -x Folia >/dev/null 2>&1 || break
    sleep 1
  done
  pkill -x Folia >/dev/null 2>&1 || true
  sleep 1
fi

# 去掉下载隔离属性（Folia 官方文档的做法），否则 macOS 会拦下未签名的应用
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

PATCHER="$(mktemp -t folia-stage-fix).cjs"
trap 'rm -f "$PATCHER"' EXIT
cat > "$PATCHER" <<'JS'
// Electron 当 Node 运行时 fs 会把 .asar 当目录读；这里要按普通文件改它
process.noAsar = true
const fs = require('fs')
const [asarPath, action] = process.argv.slice(2)
const ORIGINAL = Buffer.from('else if(v===`stage`&&o===`lyrics`&&s){let e=l(),t=c.current,n=y===W.PLAYING&&e>=t.endTimeSec;cd.set(e),h(w?Al(w.lines,e):-1),n&&(!s.clock&&(r===`one`||r===`all`)')
const FIXED = Buffer.from('else if(v==`stage`&&o==`lyrics`&&s){let e=l(),t=c.current,n=y==W.PLAYING&&e>=t.endTimeSec;cd.set(e),m(e),h(w?Al(w.lines,e):-1),n&&(!s.clock&&(r==`one`||r==`all`)')
if (ORIGINAL.length !== FIXED.length) throw new Error('internal: lengths differ')
const [from, to] = action === 'restore' ? [FIXED, ORIGINAL] : [ORIGINAL, FIXED]

const data = fs.readFileSync(asarPath)
const find = needle => {
  const hits = []
  for (let i = data.indexOf(needle); i !== -1; i = data.indexOf(needle, i + 1)) hits.push(i)
  return hits
}
const fromHits = find(from)
const toHits = find(to)
if (fromHits.length === 0 && toHits.length === 1) {
  console.log(action === 'restore' ? '已经是原样，无需还原。' : '已经补过了，无需再补。')
  process.exit(0)
}
if (fromHits.length !== 1 || toHits.length !== 0) {
  console.error(`没找到要改的位置（${fromHits.length}/${toHits.length}）。本脚本只适用于 Folia 0.7.28，请确认安装的版本，文件没有改动。`)
  process.exit(1)
}
const fd = fs.openSync(asarPath, 'r+')
try {
  fs.writeSync(fd, to, 0, to.length, fromHits[0])
} finally {
  fs.closeSync(fd)
}
const check = Buffer.alloc(to.length)
const fd2 = fs.openSync(asarPath, 'r')
fs.readSync(fd2, check, 0, check.length, fromHits[0])
fs.closeSync(fd2)
if (!check.equals(to)) {
  console.error('写入后核对失败，请重新安装 Folia。')
  process.exit(1)
}
console.log(action === 'restore' ? '已改回原样。' : '已补上：舞台模式的原文大字与逐字动画会正常显示。')
JS

# 借 Folia 自带的 Electron 当 Node 运行，Mac 上不用另装 Node
ELECTRON_RUN_AS_NODE=1 ELECTRON_NO_ASAR=1 "$BIN" "$PATCHER" "$ASAR" "$ACTION"
echo "完成，可以打开 Folia 了。"
