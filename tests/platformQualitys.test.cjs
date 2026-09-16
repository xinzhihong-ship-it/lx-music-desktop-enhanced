const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

const loadTs = path => {
  const source = fs.readFileSync(path, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const loadedModule = { exports: {} }
  new Function('module', 'exports', 'require', compiled)(loadedModule, loadedModule.exports, require)
  return loadedModule.exports
}

const { PLATFORM_QUALITYS, getPlatformQuality, getPlatformQualities, platformQualityBySoftware } = loadTs('src/common/quality/platformQualitys.ts')
const { QUALITYS } = loadTs('src/common/constants.ts')

const LANG_NAMES = ['zh-cn', 'zh-tw', 'en-us']
const langs = Object.fromEntries(LANG_NAMES.map(name => [name, JSON.parse(fs.readFileSync(`src/lang/${name}.json`, 'utf8'))]))

// 各平台真实存在的档位码，来自对平台接口与官方客户端的核对。字典漏掉任何一档，
// 音质测试就会少测一档、设置页对照表也会少一行，所以这里逐个锁死。
const OBSERVED_IDS = {
  kw: ['48', '128', '320', '2000', '4000', '20201', '20900', '11000', '25000'],
  kg: ['128', '320', 'flac', 'high', 'viper_clear', 'viper_tape', 'viper_atmos', 'dolby'],
  tx: [
    'size_48aac', 'size_128mp3', 'size_320mp3', 'size_flac', 'size_hires',
    'size_new0', 'size_new1', 'size_new2', 'size_new3', 'size_new5', 'size_new7', 'size_new9',
    'size_dolby', 'size_dts',
  ],
  wy: ['l', 'm', 'h', 'sq', 'hr', 'je', 'jm', 'sk', 'db'],
  mg: ['LQ', 'PQ', 'HQ', 'SQ', 'ZQ24', 'ZQ32', 'Z3D', 'I3D'],
}

test('字典覆盖全部实测档位码，且顺序为从低到高', () => {
  assert.deepEqual(Object.keys(PLATFORM_QUALITYS).sort(), Object.keys(OBSERVED_IDS).sort())
  for (const [source, ids] of Object.entries(OBSERVED_IDS)) {
    assert.deepEqual(getPlatformQualities(source).map(entry => entry.id), ids, `${source} 的档位码或顺序不一致`)
  }
})

test('每个平台内的档位码唯一', () => {
  for (const [source, entries] of Object.entries(PLATFORM_QUALITYS)) {
    const ids = entries.map(entry => entry.id)
    assert.equal(new Set(ids).size, ids.length, `${source} 存在重复档位码`)
  }
})

test('软件档位合法，档位名与说明在三份语言文件里都有文案', () => {
  for (const [source, entries] of Object.entries(PLATFORM_QUALITYS)) {
    for (const entry of entries) {
      if (entry.softwareQuality != null) {
        assert.ok(
          QUALITYS.includes(entry.softwareQuality),
          `${source}/${entry.id} 的软件档位 ${entry.softwareQuality} 不在 QUALITYS 里`,
        )
      }
      for (const key of [entry.nameKey, entry.noteKey].filter(Boolean)) {
        for (const name of LANG_NAMES) {
          const text = langs[name][key]
          assert.equal(typeof text, 'string', `${name}.json 缺少 ${key}`)
          assert.ok(text.length > 0, `${name}.json 的 ${key} 是空串`)
        }
      }
    }
  }
})

test('规格自洽：无损必有位深要求，可判定的有损必有码率区间', () => {
  for (const [source, entries] of Object.entries(PLATFORM_QUALITYS)) {
    for (const entry of entries) {
      const { lossless, minBits, minBitrate, maxBitrate, verifiable } = entry.spec
      assert.equal(typeof verifiable, 'boolean', `${source}/${entry.id} 缺少 verifiable`)
      if (lossless) {
        assert.ok(minBits >= 16, `${source}/${entry.id} 是无损档位却没有合理的位深要求`)
        continue
      }
      if (!verifiable) continue
      assert.equal(typeof minBitrate, 'number', `${source}/${entry.id} 缺少码率下限`)
      assert.equal(typeof maxBitrate, 'number', `${source}/${entry.id} 缺少码率上限`)
      assert.ok(minBitrate < maxBitrate, `${source}/${entry.id} 的码率区间颠倒`)
    }
  }
})

test('专有编码档位不可证：全景声 / DTS / 3D 都标为 verifiable=false', () => {
  for (const [source, id] of [
    ['kg', 'viper_atmos'], ['kg', 'dolby'], ['wy', 'db'], ['wy', 'sk'],
    ['tx', 'size_dolby'], ['tx', 'size_dts'], ['tx', 'size_new9'],
    ['kw', '11000'], ['kw', '25000'], ['mg', 'Z3D'], ['mg', 'I3D'],
  ]) {
    assert.equal(getPlatformQuality(source, id).spec.verifiable, false, `${source}/${id} 应标为不可证`)
  }
})

test('按软件档位反查：多对一返回全部，新旧 24bit 键互通，无字典的平台返回空', () => {
  // 网易的 hires 对应 hr 与 jyeffect
  assert.deepEqual(platformQualityBySoftware('wy', 'hires').map(entry => entry.id), ['hr', 'je'])
  // 旧键 flac24bit 反查同一组
  assert.deepEqual(platformQualityBySoftware('wy', 'flac24bit').map(entry => entry.id), ['hr', 'je'])
  // 酷狗的 master 对应蝰蛇超清与蝰蛇母带
  assert.deepEqual(platformQualityBySoftware('kg', 'master').map(entry => entry.id), ['viper_clear', 'viper_tape'])
  // 网易的 flac 只对应 sq
  assert.deepEqual(platformQualityBySoftware('wy', 'flac').map(entry => entry.id), ['sq'])
  // 平台专有档位（softwareQuality 为 null）不参与反查
  assert.deepEqual(platformQualityBySoftware('tx', 'atmos').map(entry => entry.id), ['size_new2', 'size_dolby'])
  // git / bili 没有平台档位表
  assert.deepEqual(platformQualityBySoftware('git', 'flac'), [])
  assert.deepEqual(getPlatformQualities('bili'), [])
})

test('getPlatformQuality 命中与未命中', () => {
  assert.equal(getPlatformQuality('kg', 'viper_clear').nameKey, 'quality_platform_kg_viper_clear')
  assert.equal(getPlatformQuality('tx', 'size_new0').softwareQuality, 'master')
  assert.equal(getPlatformQuality('mg', 'ZQ24').softwareQuality, 'hires')
  assert.equal(getPlatformQuality('mg', 'PQ').softwareQuality, '128k')
  assert.equal(getPlatformQuality('kg', 'not-exist'), undefined)
  assert.equal(getPlatformQuality('git', 'flac'), undefined)
})

test('平台专有档位不映射到软件档位（软件里没有对应档）', () => {
  for (const [source, id] of [
    ['kw', '48'], ['tx', 'size_48aac'], ['mg', 'LQ'],
    ['tx', 'size_new7'], ['wy', 'sk'],
  ]) {
    assert.equal(getPlatformQuality(source, id).softwareQuality, null, `${source}/${id} 不该有软件档位`)
  }
})

test('网易的档位归属与官方 level 键一致（je 是高清臻音不是全景声）', () => {
  // je（jyeffect）实测 96kHz/24bit 无损，与 QQ 的 size_hires 同源，归 hires
  assert.equal(getPlatformQuality('wy', 'je').softwareQuality, 'hires')
  assert.equal(getPlatformQuality('wy', 'je').spec.minBits, 24)
  // db（dolby）才是杜比全景声
  assert.equal(getPlatformQuality('wy', 'db').softwareQuality, 'atmos')
  // m（higher）是 192k，不是 128k
  assert.equal(getPlatformQuality('wy', 'm').softwareQuality, '192k')
})
