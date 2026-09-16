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
const { QUALITYS } = loadTs('src/common/constants.ts')
const { qualityShortLabel, qualityFullLabel, platformQualityTip } = loadTs('src/renderer/core/quality/labels.ts', {
  '@common/quality/platformQualitys': platformQualitys,
})

const LANG_NAMES = ['zh-cn', 'zh-tw', 'en-us']
const langs = Object.fromEntries(LANG_NAMES.map(name => [name, JSON.parse(fs.readFileSync(`src/lang/${name}.json`, 'utf8'))]))
const translateWith = lang => key => lang[key] ?? key
const t = translateWith(langs['zh-cn'])

test('每个软件档位在三份语言里都有短标签与完整名', () => {
  for (const quality of QUALITYS) {
    for (const name of LANG_NAMES) {
      const tr = translateWith(langs[name])
      assert.ok(qualityShortLabel(tr, quality).length > 0, `${name}: ${quality} 的短标签为空`)
      assert.ok(qualityFullLabel(tr, quality).length > 0, `${name}: ${quality} 的完整名为空`)
    }
  }
})

test('新旧 24bit 键共用同一套标签', () => {
  for (const name of LANG_NAMES) {
    const tr = translateWith(langs[name])
    assert.equal(qualityShortLabel(tr, 'hires'), qualityShortLabel(tr, 'flac24bit'))
    assert.equal(qualityFullLabel(tr, 'hires'), qualityFullLabel(tr, 'flac24bit'))
  }
})

test('有 i18n 键的档位不会回落到键名', () => {
  // ape / wav 没有 i18n 键，按协议名展示；128k 没有列表短标签，按档位名展示
  const raw = new Set(['ape', 'wav', '128k', '192k'])
  for (const quality of QUALITYS) {
    if (raw.has(quality)) continue
    assert.notEqual(qualityShortLabel(t, quality), quality, `${quality} 的短标签回落到键名`)
    assert.notEqual(qualityFullLabel(t, quality), quality, `${quality} 的完整名回落到键名`)
  }
})

test('未知档位原样返回，不吞掉信息', () => {
  assert.equal(qualityFullLabel(t, 'whatever'), 'whatever')
  assert.equal(qualityShortLabel(t, 'whatever'), 'whatever')
})

test('平台对照提示列出各平台自己的档位名', () => {
  const tip = platformQualityTip(t, 'flac')
  const lines = tip.split('\n')
  assert.ok(lines.length >= 4, '主要档位应能对上至少四个平台')
  for (const line of lines) assert.ok(line.includes('：'), `对照行缺少平台名前缀：${line}`)
  // 每个平台的叫法不同，无损这一档酷狗叫「无损音质」、网易叫「无损」
  assert.ok(tip.includes('无损音质'), '应包含酷狗的叫法')
})

test('主要档位在各平台的对照都不为空', () => {
  // 通用档位五个平台都有
  for (const quality of ['hires', 'flac', '320k', '128k', 'master', 'atmos']) {
    const lines = platformQualityTip(t, quality).split('\n')
    assert.ok(lines.length >= 4, `${quality} 的平台对照过少：${lines.length} 条`)
  }
  // 平台专有档位只有部分平台提供（臻品音质2.0 目前只有酷我与 QQ）
  for (const quality of ['atmos_plus']) {
    assert.ok(platformQualityTip(t, quality).split('\n').length >= 2, `${quality} 的平台对照过少`)
  }
})

test('平台专有说明会跟在对应档位后面', () => {
  // 酷狗的蝰蛇母带有「部分曲目会回落 320K」的说明
  const tip = platformQualityTip(t, 'master')
  assert.ok(tip.includes('蝰蛇母带'), '母带档应列出酷狗的蝰蛇母带')
  assert.ok(tip.includes('回落'), '蝰蛇母带应带上回落说明')
})
