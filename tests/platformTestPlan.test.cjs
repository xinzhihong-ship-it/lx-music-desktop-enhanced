const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

const loadTs = (path, shims = {}) => {
  const source = fs.readFileSync(path, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const loadedModule = { exports: {} }
  const requireShim = id => (id in shims ? shims[id] : require(id))
  new Function('module', 'exports', 'require', compiled)(loadedModule, loadedModule.exports, requireShim)
  return loadedModule.exports
}

const platformQualitys = loadTs('src/common/quality/platformQualitys.ts')
const actualQuality = loadTs('src/renderer/core/player/actualQuality.ts')
const { buildPlatformTestPlan } = loadTs('src/renderer/core/quality/platformQualityVerdict.ts', {
  '@common/quality/platformQualitys': platformQualitys,
  '@renderer/core/player/actualQuality': actualQuality,
})

const planFor = (source, declaredQualitys, hasMusicUrl = true) => buildPlatformTestPlan({ source, declaredQualitys, hasMusicUrl })

test('计划的档位与顺序完全取自平台档位表', () => {
  const plan = planFor('kg', ['128k', '320k', 'flac', 'hires', 'master'], true)
  assert.deepEqual(plan.map(row => row.qualityId), [
    '128', '320', 'flac', 'high', 'viper_clear', 'viper_tape', 'viper_atmos', 'dolby',
  ])
})

test('脚本声明过的档位可测，未声明的标为 source_not_declared', () => {
  const plan = planFor('kg', ['128k', '320k'])
  const byId = Object.fromEntries(plan.map(row => [row.qualityId, row]))
  assert.equal(byId['128'].requestable, true)
  assert.equal(byId['320'].requestable, true)
  assert.equal(byId['flac'].requestable, false)
  assert.equal(byId['flac'].reason, 'source_not_declared')
})

test('平台专有档位（软件里没有对应档）标为 platform_proprietary', () => {
  const plan = planFor('tx', ['128k', '320k', 'flac', 'hires', 'master'])
  const byId = Object.fromEntries(plan.map(row => [row.qualityId, row]))
  for (const id of ['size_48aac', 'size_new7', 'size_new9', 'size_dts']) {
    assert.equal(byId[id].requestable, false, `${id} 不该可测`)
    assert.equal(byId[id].reason, 'platform_proprietary', `${id} 的原因应为平台专有`)
  }
})

test('脚本没有 musicUrl 能力时整表都不可测', () => {
  const plan = planFor('kg', ['128k', '320k', 'flac'], false)
  assert.ok(plan.length > 0)
  for (const row of plan) {
    assert.equal(row.requestable, false)
    assert.equal(row.reason, 'no_music_url')
  }
})

test('24bit 无损的新旧键互通：脚本声明 flac24bit 也能测 hires 档', () => {
  const plan = planFor('kg', ['128k', 'flac24bit'])
  const hires = plan.find(row => row.qualityId === 'high')
  assert.equal(hires.requestable, true)
  assert.equal(hires.requestType, 'hires')

  // 脚本声明 hires 时，网易落到 hires 的两个档位（Hi-Res 与高清臻音）都可测
  const reversed = planFor('wy', ['128k', 'hires'])
  assert.equal(reversed.find(row => row.qualityId === 'hr').requestable, true)
  assert.equal(reversed.find(row => row.qualityId === 'je').requestable, true)
  // 没声明 flac 时无损档不可测
  assert.equal(reversed.find(row => row.qualityId === 'sq').reason, 'source_not_declared')
})

test('脚本声明了字典外的档位时补兜底行，用软件档位规则判定', () => {
  const plan = planFor('kg', ['128k', '320k', 'ape'], true)
  const fallback = plan.find(row => row.qualityId === '')
  assert.ok(fallback, '应有一条兜底行')
  assert.equal(fallback.requestType, 'ape')
  assert.equal(fallback.spec, null)
  assert.equal(fallback.requestable, true)
})

test('兜底行不会与平台档位表已有档位重复', () => {
  const plan = planFor('tx', ['128k', '320k', 'flac', 'hires', 'atmos', 'atmos_plus', 'master'], true)
  assert.equal(plan.filter(row => row.qualityId === '').length, 0)
})

test('平台专有档位的软件档位为空，不会被当成可请求', () => {
  const plan = planFor('mg', ['128k', '320k', 'flac', 'hires', 'master'])
  const lq = plan.find(row => row.qualityId === 'LQ')
  assert.equal(lq.requestType, null)
  assert.equal(lq.requestable, false)
  assert.equal(lq.reason, 'platform_proprietary')
})

test('每行都带上了平台档位名与规格，供结果行展示', () => {
  const plan = planFor('wy', ['128k', '320k', 'flac', 'hires', 'master'])
  for (const row of plan) {
    assert.ok(row.nameKey.startsWith('quality_platform_wy_'), `${row.qualityId} 缺少档位名`)
    assert.ok(row.spec, `${row.qualityId} 缺少规格`)
  }
})
