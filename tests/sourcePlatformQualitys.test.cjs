const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

// 平台可用档位集合按 ikun-music-desktop 的口径收敛：24bit 无损归入 hires，
// 不再声明 flac24bit / 192k。改动这里的集合必须同步更新该测试。
const expected = {
  kw: ['128k', '320k', 'flac', 'hires', 'atmos', 'atmos_plus', 'master'],
  kg: ['128k', '320k', 'flac', 'hires', 'atmos', 'master'],
  tx: ['128k', '320k', 'flac', 'hires', 'atmos', 'atmos_plus', 'master'],
  wy: ['128k', '320k', 'flac', 'hires', 'atmos', 'master'],
  mg: ['128k', '320k', 'flac', 'hires'],
  git: ['128k', '320k', 'flac', 'hires', 'atmos', 'atmos_plus', 'master', 'ape', 'wav'],
  local: [],
}

const readSupportQualitys = () => {
  const source = fs.readFileSync('src/main/modules/userApi/renderer/preload.js', 'utf8')
  const match = source.match(/const supportQualitys = (\{[\s\S]*?\n\})/)
  assert.ok(match, 'supportQualitys not found in preload.js')
  return new Function(`return ${match[1]}`)()
}

test('custom source platform quality sets follow the ikun vocabulary', () => {
  assert.deepEqual(readSupportQualitys(), expected)
})

test('the git fallback source keeps the same vocabulary, without legacy keys', () => {
  const source = fs.readFileSync('src/common/constants.ts', 'utf8')
  const match = source.match(/git: \[([^\]]*)\]/)
  assert.ok(match, 'git quality list not found in constants.ts')
  const list = match[1].split(',').map(item => item.trim().replace(/^'|'$/g, '')).filter(Boolean)
  assert.deepEqual(list, expected.git)
  assert.ok(!list.includes('flac24bit') && !list.includes('192k'))
})
