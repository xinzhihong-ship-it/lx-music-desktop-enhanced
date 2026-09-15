<template lang="pug">
material-modal(:show="show" teleport="#view" width="min(900px, calc(100vw - 28px))" min-width="0" max-width="min(900px, calc(100vw - 28px))" height="min(760px, calc(100vh - 150px))" max-height="calc(100vh - 150px)" @close="handleClose")
  main(:class="$style.main")
    div(:class="$style.titleBar")
      div
        h2 {{ $t('user_api_test__title') }}
        p(:class="$style.tip") 本次结果只代表当前歌曲样本和本次请求，不代表音源的永久能力。
      span(:class="[$style.runBadge, { [$style.runBadgeActive]: busy }]") {{ runState }}

    div(ref="body" :class="$style.body")
      section(:class="$style.section")
        div(:class="$style.sectionHead")
          div
            h3 音源
            p(:class="$style.sectionHint") 选择测试对象，不会改变当前播放音源。
          div(:class="$style.sectionMeta")
            span {{ selectedApis.length }} / {{ apiList.length }} 已选择
            base-checkbox(id="source_test_select_all" :model-value="isAllSelected" label="全选" :disabled="busy || !apiList.length" @update:model-value="toggleAll")
        div(v-if="apiList.length" :class="$style.sourceList")
          div(v-for="api in apiList" :key="api.id" :class="[$style.sourceRow, { [$style.selected]: selectedApis.includes(api.id) }]")
            base-checkbox(:id="`source_test_api_${api.id}`" v-model="selectedApis" :value="api.id" :disabled="busy" :aria-label="apiLabel(api)")
            div(:class="$style.sourceInfo")
              div(:class="$style.sourceName")
                strong {{ api.name }}
                span(v-if="api.version" :class="$style.version") {{ /^\d/.test(api.version) ? `v${api.version}` : api.version }}
                span(v-if="api.id === currentApiId" :class="$style.currentBadge") 当前使用
              p {{ api.description || '自定义音源' }}
        p(v-else :class="$style.empty") 暂无已导入的自定义音源，请先导入音源。

      section(:class="$style.section")
        div(:class="$style.sectionHead")
          div
            h3 测试平台与关键词
            p(:class="$style.sectionHint") 每个平台只搜索一次，按音源脚本声明逐档请求；平台原生档位名称可能不同，实际以探测规格为准。关键词可只填歌名，也可写成「歌名 歌手」锁定版本；没填的平台会跳过。
          span(:class="$style.sectionMetaText") {{ selectedPlatforms.length }} 个平台
        div(:class="$style.bulkRow")
          base-input(v-model="bulkKeyword" :class="$style.bulkInput" placeholder="统一填写关键词（歌名，或 歌名 歌手）" :trim="false" :disabled="busy" @submit="applyKeywordsToAll")
          base-btn(:class="$style.bulkBtn" :disabled="busy || !bulkKeyword.trim()" @click="applyKeywordsToAll") 全部应用
          base-btn(:class="$style.bulkBtn" :disabled="busy" @click="clearKeywords") 清空
        div(:class="$style.platformGrid")
          div(v-for="platform in platforms" :key="platform.id" :class="[$style.platformCard, { [$style.platformSelected]: selectedPlatforms.includes(platform.id) }]")
            div(:class="$style.platformHead")
              base-checkbox(:id="`source_test_platform_${platform.id}`" v-model="selectedPlatforms" :value="platform.id" :label="platform.name" :disabled="busy")
              span(:class="$style.platformState") {{ selectedPlatforms.includes(platform.id) ? '启用' : '跳过' }}
            base-input(v-model="keywords[platform.id]" :class="$style.keyword" placeholder="歌名，或 歌名 歌手" :trim="false" :disabled="busy || !selectedPlatforms.includes(platform.id)")
        details(:class="$style.advanced")
          summary
            span 高级设置
            span(:class="$style.advancedHint") 请求超时与间隔
          div(:class="$style.settings")
            label
              span 单步超时（秒）
              base-input(v-model="settings.testTimeoutSeconds" type="number" :disabled="busy")
            label
              span 音源间隔（秒）
              base-input(v-model="settings.sourceIntervalSeconds" type="number" :disabled="busy")
            label
              span 音质间隔（秒）
              base-input(v-model="settings.qualityIntervalSeconds" type="number" :disabled="busy")

      section(ref="resultsSection" :class="$style.section")
        div(:class="$style.sectionHead")
          div
            h3 测试结果
            p(:class="$style.sectionHint") 展开每个音源可查看平台状态、请求档位与实际档位。
          span(v-if="results.length" :class="$style.sectionMetaText") {{ results.length }} 条记录
        div(v-if="results.length" ref="resultList" :class="$style.resultList")
          details(v-for="group in groupedResults" :key="group.apiId" :class="$style.resultGroup" :open="expandedGroups.includes(group.apiId)" @toggle="toggleGroup(group.apiId, $event)")
            summary(:class="$style.resultGroupHead")
              div(:class="$style.groupInfo")
                strong {{ group.apiName }}
                p(:class="$style.groupSpec") {{ groupSummaryText(group) }}
              div(:class="$style.groupMeta")
                span(:class="$style.groupCount") {{ group.rows.length }} 档
            div(:class="$style.resultRows")
              div(v-for="block in platformBlocks(group)" :key="`${block.platformId}-${block.platformName}`" :class="$style.platformBlock")
                div(:class="$style.platformHead")
                  span(:class="$style.platformName") {{ block.platformName || '初始化' }}
                  span(:class="[$style.platformState, $style[`state_${block.state}`]]") {{ block.stateLabel }}
                p(v-if="block.keyword || block.song" :class="$style.platformSong") {{ blockKeywordText(block) }}
                div(:class="$style.platformMeta")
                  span(:class="$style.bestQualityLabel") 实际最高音质
                  span(:class="[$style.tierChip, $style.tierChipLarge]" :style="tierChipStyle(block.bestTier)" :data-suspected="block.bestSuspected ? '1' : null") {{ block.bestText }}
                  span(:class="$style.platformSummary") {{ block.summaryText }}
                div(:class="$style.tierRows")
                  div(v-for="(result, index) in block.rows" :key="`${result.quality}-${index}`" :class="$style.tierRow")
                    span(:class="[$style.tierChip, $style.tierChipRequest]" :style="tierChipStyle(result.quality)") {{ tierLabel(result.quality) }}
                    span(:class="$style.tierArrow") →
                    span(:class="[$style.tierChip, $style[`kind_${result.kind}`]]" :style="result.tier && result.kind !== 'unknown' ? tierChipStyle(result.tier) : null") {{ actualText(result) }}
                    span(:class="$style.tierDetail") {{ result.detail }}
        p(v-else :class="$style.empty") 选择音源和平台后开始测试，结果会保留在本次应用会话中。

    div(:class="$style.footer")
      div(:class="$style.progressArea")
        div(:class="$style.progressText") {{ busy ? progressText || '准备测试…' : stopped ? `已停止，已记录 ${results.length} 项` : results.length ? `已记录 ${results.length} 项` : '尚未开始' }}
        div(:class="$style.progressTrack" aria-hidden="true")
          span(:class="$style.progressFill" :style="{ width: progressPercent + '%' }")
      div(:class="$style.footerActions")
        base-btn(:class="$style.footerBtn" :disabled="!busy" @click="stopTest") 停止
        base-btn(:class="$style.footerBtn" :disabled="busy || !canStart" @click="startTest") {{ busy ? '测试中…' : '开始测试' }}
        base-btn(:class="$style.footerBtn" :disabled="!results.length" @click="copyResults") 复制日志
</template>

<script>
import { userApi } from '@renderer/store'
import { clipboardWriteText } from '@common/utils/electron'
import { toNewMusicInfo } from '@common/utils/tools'
import musicSdk from '@renderer/utils/musicSdk'
import { buildTestTierList, describeActualQuality, summarizeTierResults } from '@renderer/core/player/actualQuality'
import { getTestUserApiSources, probeAudioSource, sendTestUserApiRequest, stopTestUserApis } from '@renderer/utils/ipc'

const platforms = [
  { id: 'kw', name: '酷我' },
  { id: 'kg', name: '酷狗' },
  { id: 'tx', name: 'QQ' },
  { id: 'wy', name: '网易' },
  { id: 'mg', name: '咪咕' },
]

const qualityNames = {
  master: '臻品母带',
  atmos_plus: '臻品音质2.0',
  atmos: '臻品音质',
  hires: 'Hires 无损24-Bit',
  flac24bit: 'Hires 无损24-Bit',
  flac: 'FLAC 无损',
  '320k': '320K 高音',
  '192k': '优质 192K',
  '128k': '128K 普音',
  ape: 'APE',
  wav: 'WAV',
}
// 档位标签配色，区分方式与手机版检测页一致。
const qualityColors = {
  master: '#9b59b6',
  atmos_plus: '#e74c3c',
  atmos: '#e67e22',
  hires: '#ff6b6b',
  flac24bit: '#ff6b6b',
  flac: '#4ecdc4',
  '320k': '#45b7d1',
  '192k': '#45b7d1',
  '128k': '#95a5a6',
  ape: '#4ecdc4',
  wav: '#4ecdc4',
}

// 关键词只保存用户自己填写的值；v1 键里存的是旧版本的预填默认值，读取时丢弃。
const KEYWORDS_STORAGE_KEY = 'lx_music_source_test_keywords_v2'
const KEYWORDS_STORAGE_KEY_V1 = 'lx_music_source_test_keywords'
const SETTINGS_STORAGE_KEY = 'lx_music_source_test_settings'
const wait = async ms => await new Promise(resolve => setTimeout(resolve, ms))

export default {
  props: {
    show: { type: Boolean, default: false },
    currentApiId: { type: String, default: '' },
  },
  emits: ['update:show'],
  data() {
    return {
      userApi,
      platforms,
      apiList: userApi.list,
      selectedApis: [],
      selectedPlatforms: platforms.map(item => item.id),
      keywords: Object.fromEntries(platforms.map(item => [item.id, ''])),
      bulkKeyword: '',
      settings: {
        testTimeoutSeconds: '20',
        sourceIntervalSeconds: '0.5',
        qualityIntervalSeconds: '0.5',
      },
      results: [],
      // 本次测试实际用到的关键词（按平台记录），用于结果里显示搜索对象。
      keywordsUsed: {},
      busy: false,
      stopped: false,
      progressText: '',
      progressCount: 0,
      progressTotal: 0,
      taskId: '',
      runToken: 0,
      expandedGroups: [],
      searchCache: Object.create(null),
    }
  },
  computed: {
    isAllSelected() {
      return this.apiList.length > 0 && this.selectedApis.length === this.apiList.length
    },
    canStart() {
      // 至少要有一个填了歌名的平台，否则测试跑不出任何结果。
      return this.selectedApis.length > 0 && this.selectedPlatforms.some(id => String(this.keywords[id] || '').trim())
    },
    groupedResults() {
      const groups = []
      const groupMap = new Map()
      for (const result of this.results) {
        let group = groupMap.get(result.apiId)
        if (!group) {
          group = { apiId: result.apiId, apiName: result.apiName, song: result.song, rows: [] }
          groupMap.set(result.apiId, group)
          groups.push(group)
        }
        if (!group.song && result.song) group.song = result.song
        group.rows.push(result)
      }
      return groups
    },
    progressPercent() {
      if (this.busy) return this.progressTotal ? Math.min(100, Math.round(this.progressCount / this.progressTotal * 100)) : 0
      return this.results.length ? 100 : 0
    },
    runState() {
      if (this.busy) return '测试中'
      if (this.stopped) return '已停止'
      return this.results.length ? '已完成' : '待开始'
    },
  },
  watch: {
    show(value) {
      if (!value) {
        this.stopTest()
        return
      }
      this.apiList = userApi.list
      // The modal stays mounted between openings.  Reset the outer scroll
      // position so reopening it never leaves the source selector clipped in
      // the middle of the form.
      this.$nextTick(() => {
        this.$refs.body?.scrollTo({ top: 0, behavior: 'auto' })
      })
      if (!this.selectedApis.length) {
        const current = this.apiList.find(api => api.id === this.currentApiId)
        this.selectedApis = [current?.id || this.apiList[0]?.id].filter(Boolean)
      }
      this.loadSettings()
    },
    'userApi.list': {
      deep: true,
      handler(list) {
        this.apiList = list
        const available = new Set(list.map(api => api.id))
        this.selectedApis = this.selectedApis.filter(id => available.has(id))
        if (!this.selectedApis.length && list.length && !this.busy) {
          const current = list.find(api => api.id === this.currentApiId)
          this.selectedApis = [current?.id || list[0].id]
        }
      },
    },
    keywords: {
      deep: true,
      handler() {
        this.saveSettings()
      },
    },
    settings: {
      deep: true,
      handler() {
        this.saveSettings()
      },
    },
  },
  methods: {
    apiLabel(api) {
      if (!api.version) return api.name
      return api.name + ' (' + (/^\d/.test(api.version) ? 'v' : '') + api.version + ')'
    },
    loadSettings() {
      try {
        // 旧版本会预填默认歌名并把预填值一起保存，换用新键避免把它当成用户填写的歌名恢复出来。
        localStorage.removeItem(KEYWORDS_STORAGE_KEY_V1)
        const savedKeywords = JSON.parse(localStorage.getItem(KEYWORDS_STORAGE_KEY) ?? '{}')
        const savedSettings = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}')
        this.platforms.forEach(platform => {
          if (typeof savedKeywords[platform.id] === 'string') this.keywords[platform.id] = savedKeywords[platform.id]
        })
        Object.assign(this.settings, savedSettings)
      } catch {}
    },
    saveSettings() {
      localStorage.setItem(KEYWORDS_STORAGE_KEY, JSON.stringify(this.keywords))
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.settings))
    },
    toggleAll(value) {
      this.selectedApis = value ? this.apiList.map(api => api.id) : []
    },
    // 一键把同一个歌名填给所有平台；「清空」用于换歌时一次性清掉。
    applyKeywordsToAll() {
      const keyword = String(this.bulkKeyword || '').trim()
      if (!keyword) return
      for (const platform of this.platforms) this.keywords[platform.id] = keyword
    },
    clearKeywords() {
      for (const platform of this.platforms) this.keywords[platform.id] = ''
      this.bulkKeyword = ''
    },
    handleClose() {
      this.stopTest()
      this.$emit('update:show', false)
    },
    addResult(result) {
      this.results.push(result)
      if (result.apiId && !this.expandedGroups.includes(result.apiId)) this.expandedGroups.push(result.apiId)
    },
    scrollResultsIntoView() {
      this.$nextTick(() => {
        const body = this.$refs.body
        const resultsSection = this.$refs.resultsSection
        if (!body || !resultsSection) return
        const resultList = this.$refs.resultList
        if (resultList) resultList.scrollTop = 0
        const top = Math.max(0, resultsSection.offsetTop - 4)
        body.scrollTo({ top, behavior: 'smooth' })
      })
    },
    isRunActive(runToken) {
      return this.busy && !this.stopped && this.runToken === runToken
    },
    errorMessage(error) {
      let message = String(error?.message || error || '未知错误')
      message = message.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/i, '')
      message = message.replace(/https?:\/\/[^\s"'<>]+/gi, '[地址已隐藏]')
      message = message.replace(/("?(?:api[-_ ]?key|access[-_ ]?token|authorization|cookie|sign|ekey|purl)"?\s*[:=]\s*)[^,}\s]+/gi, '$1[已隐藏]')
      const codeMatches = [...message.matchAll(/(?:"?code"?|statusCode)\s*[:=]\s*(\d+)/gi)]
        .map(match => Number(match[1]))
        .filter(Number.isFinite)
      const code = codeMatches.reduce((last, value) => value > 0 ? value : last, 0)
      // User API responses often include a large diagnostic JSON payload. Keep
      // the platform error code visible without filling every result row with
      // trace IDs and request metadata.
      if (code && /(?:获取URL失败|未获取到URL|请求失败)/.test(message)) return `请求失败（代码 ${code}）`
      if (message.length > 320) {
        return `${message.slice(0, 180)}${code ? `（代码 ${code}）` : ''}…详情已收起`
      }
      return message
    },
    toggleGroup(apiId, event) {
      if (event?.target?.open) {
        if (!this.expandedGroups.includes(apiId)) this.expandedGroups.push(apiId)
      } else {
        this.expandedGroups = this.expandedGroups.filter(id => id !== apiId)
      }
    },
    resultBase(api, platform, quality, song) {
      return {
        taskId: this.taskId,
        apiId: api.id,
        apiName: api.name,
        platformId: platform.id,
        platformName: platform.name,
        quality,
        qualityLabel: qualityNames[quality] || quality,
        song,
      }
    },
    normalizeSongInfo(songInfo, platform) {
      // Search SDKs return the legacy song shape, while the normal playback
      // path converts it to MusicInfo before calling a user API.  Use that
      // same conversion here; high-quality scripts commonly read the
      // platform-specific fields under meta (strMediaMid, hash, copyrightId,
      // and quality metadata) and will reject an old search result.
      const name = songInfo?.name || songInfo?.songName || songInfo?.title || songInfo?.filename || '未知歌曲'
      const singer = songInfo?.singer || songInfo?.artist || songInfo?.artistName || '未知歌手'
      const songmid = songInfo?.songmid || songInfo?.songId || songInfo?.musicId || songInfo?.id || ''
      const legacySongInfo = {
        ...songInfo,
        name,
        singer,
        source: platform.id,
        songmid,
        interval: songInfo?.interval || '',
        albumName: songInfo?.albumName || songInfo?.album || '',
        albumId: songInfo?.albumId || '',
        img: songInfo?.img || songInfo?.pic || '',
        lrc: songInfo?.lrc || null,
        typeUrl: songInfo?.typeUrl || {},
        // `toNewMusicInfo` normalizes legacy quality metadata in place for
        // older flac32bit entries.  Clone the entries so a diagnostic run
        // cannot mutate the SDK search result (or a later playback request).
        types: Array.isArray(songInfo?.types)
          ? songInfo.types.map(type => type && typeof type === 'object' ? { ...type } : type)
          : [],
        _types: songInfo?._types && typeof songInfo._types === 'object'
          ? Object.fromEntries(Object.entries(songInfo._types).map(([key, value]) => [key, value && typeof value === 'object' ? { ...value } : value]))
          : {},
      }
      // Keep legacy top-level fields as harmless compatibility extras, but
      // let the canonical modern fields (especially id and meta) win.
      return { ...legacySongInfo, ...toNewMusicInfo(legacySongInfo) }
    },
    async requestMusicUrl(apiId, platformId, songInfo, quality, taskId) {
      const requestKey = `${taskId}_${apiId}_${platformId}_${quality}_${Math.random().toString(36).slice(2)}`
      const result = await sendTestUserApiRequest({
        apiId,
        requestKey,
        data: {
          source: platformId,
          action: 'musicUrl',
          info: { type: quality, musicInfo: { ...songInfo } },
        },
      })
      return result?.data?.url || ''
    },
    getSearchResult(platform) {
      const cached = this.searchCache[platform.id]
      if (cached) return cached
      const keyword = String(this.keywords[platform.id] || '').trim()
      if (!keyword) {
        const error = Promise.resolve().then(() => { throw new Error('关键词为空') })
        this.searchCache[platform.id] = error
        return error
      }
      const sdk = musicSdk[platform.id]
      const timeout = (this.numberSetting('testTimeoutSeconds') || 20) * 1000
      const search = Promise.race([
        sdk.musicSearch.search(keyword, 1, 1),
        wait(timeout).then(() => { throw new Error('测试超时') }),
      ])
      this.searchCache[platform.id] = search
      return search
    },
    formatProbe(probe) {
      const fields = []
      if (probe.format) fields.push(probe.format.toUpperCase())
      else if (probe.formatHint) fields.push(`后缀提示 ${probe.formatHint.toUpperCase()}`)
      if (probe.sampleRate) fields.push(`${probe.sampleRate / 1000}kHz`)
      if (probe.bitsPerSample) fields.push(`${probe.bitsPerSample}bit`)
      if (probe.contentLength) fields.push(`${(probe.contentLength / 1024 / 1024).toFixed(2)}MB`)
      if (fields.length) return fields.join(' · ')
      return '规格无法确认'
    },
    qualityLabel(quality) {
      return qualityNames[quality] || quality
    },
    tierSummary(group) {
      return summarizeTierResults(group.rows.map(row => ({ kind: row.kind ?? 'failed', tier: row.tier ?? null })))
    },
    tierLabel(key) {
      if (!key) return '—'
      return qualityNames[key] || key
    },
    tierChipStyle(key) {
      const color = qualityColors[key]
      return color ? { backgroundColor: color, borderColor: color, color: '#fff' } : null
    },
    actualText(result) {
      if (result.kind === 'failed') return result.statusLabel && result.statusLabel !== '失败' ? result.statusLabel : '获取失败'
      if (result.kind === 'unsupported') return '不支持'
      if (result.kind === 'unknown') return '无法确认'
      const label = this.tierLabel(result.tier)
      return result.kind === 'downgrade' ? `降级 ${label}` : label
    },
    summaryText(summary) {
      const parts = [`通过 ${summary.passed}`, `降级 ${summary.downgraded}`]
      if (summary.unknown) parts.push(`无法确认 ${summary.unknown}`)
      if (summary.unsupported) parts.push(`不支持 ${summary.unsupported}`)
      parts.push(`错误 ${summary.failed}`)
      return parts.join(' · ')
    },
    groupSummaryText(group) {
      return this.summaryText(this.tierSummary(group))
    },
    // 最高音质按平台各算各的：优先取该平台通过的档位，没有通过时取降级里最高的并标疑似。
    bestQualityText(summary) {
      if (!summary.bestTier) return '未知'
      const label = this.tierLabel(summary.bestTier)
      return summary.bestSuspected ? `疑似 ${label}` : label
    },
    blockKeywordText(block) {
      const parts = []
      if (block.keyword) parts.push(`搜索：${block.keyword}`)
      if (block.song) parts.push(`找到：${block.song}`)
      return parts.join(' · ')
    },
    // 按平台分块，平台状态与手机版一致：[OK] 有通过、[FAIL] 全部失败/不支持、[WARN] 其余。
    platformBlocks(group) {
      const blocks = []
      const map = new Map()
      for (const row of group.rows) {
        const key = row.platformId || ''
        let block = map.get(key)
        if (!block) {
          block = { platformId: key, platformName: row.platformName || '', rows: [] }
          map.set(key, block)
          blocks.push(block)
        }
        block.rows.push(row)
      }
      for (const block of blocks) {
        const summary = summarizeTierResults(block.rows.map(row => ({ kind: row.kind ?? 'failed', tier: row.tier ?? null })))
        block.keyword = this.keywordsUsed[block.platformId] || ''
        block.song = block.rows.find(row => row.song)?.song ?? ''
        block.bestTier = summary.bestTier
        block.bestSuspected = summary.bestSuspected
        block.bestText = this.bestQualityText(summary)
        block.summaryText = this.summaryText(summary)
        if (summary.passed > 0) {
          block.state = 'ok'
          block.stateLabel = '[OK]'
        } else if (block.rows.every(row => row.kind === 'failed' || row.kind === 'unsupported')) {
          block.state = 'fail'
          block.stateLabel = '[FAIL]'
        } else {
          block.state = 'warn'
          block.stateLabel = '[WARN]'
        }
      }
      return blocks
    },
    markProgress() {
      this.progressCount = Math.min(this.progressCount + 1, this.progressTotal || Number.MAX_SAFE_INTEGER)
    },
    async testOneApi(api, capabilities, runToken, taskId) {
      const stepTimeout = (this.numberSetting('testTimeoutSeconds') || 20) * 1000
      for (const platform of this.platforms) {
        if (!this.isRunActive(runToken)) return
        if (!this.selectedPlatforms.includes(platform.id)) continue
        // 没填歌名的平台直接跳过，不产出「关键词为空」的失败记录。
        if (!String(this.keywords[platform.id] || '').trim()) continue
        this.keywordsUsed[platform.id] = String(this.keywords[platform.id] || '').trim()
        this.progressText = `${api.name} · ${platform.name} · ${this.searchCache[platform.id] ? '使用已固定歌曲' : '搜索'}`
        let searchResult
        try {
          searchResult = await this.getSearchResult(platform)
        } catch (error) {
          if (!this.isRunActive(runToken)) return
          this.addResult({ ...this.resultBase(api, platform, '', ''), status: 'failed', statusLabel: '失败', kind: 'failed', tier: null, detail: `搜索失败：${this.errorMessage(error)}` })
          this.markProgress()
          if (this.errorMessage(error).includes('测试超时')) {
            stopTestUserApis([api.id])
            return
          }
          continue
        }
        const songInfo = searchResult?.list?.[0]
        const song = songInfo ? `${songInfo.name || songInfo.songName || '未知歌曲'} - ${songInfo.singer || songInfo.artist || '未知歌手'}` : ''
        if (!songInfo) {
          if (!this.isRunActive(runToken)) return
          this.addResult({ ...this.resultBase(api, platform, '', ''), status: 'failed', statusLabel: '失败', kind: 'failed', tier: null, detail: '搜索结果为空' })
          this.markProgress()
          continue
        }
        const platformCapability = capabilities?.[platform.id]
        const hasMusicUrl = platformCapability?.actions?.includes('musicUrl')
        // 同一档位的别名键（hires / flac24bit）只保留一个，避免重复测试同一档。
        const qualityList = hasMusicUrl ? buildTestTierList(platformCapability?.qualitys || []) : []
        if (!qualityList.length) {
          if (!this.isRunActive(runToken)) return
          this.addResult({ ...this.resultBase(api, platform, '', song), status: 'unsupported', statusLabel: '不支持', kind: 'unsupported', tier: null, detail: hasMusicUrl ? '该音源未声明可测试的音质档位' : '该音源未声明此平台的音乐地址能力' })
          this.markProgress()
          continue
        }
        const testSongInfo = this.normalizeSongInfo(songInfo, platform)
        for (const quality of qualityList) {
          if (!this.isRunActive(runToken)) return
          this.progressText = `${api.name} · ${platform.name} · ${qualityNames[quality] || quality}`
          try {
            const operation = (async() => {
              const url = await this.requestMusicUrl(api.id, platform.id, testSongInfo, quality, taskId)
              if (!url) throw new Error('未返回有效地址')
              return { url, probe: await probeAudioSource(url) }
            })()
            const { probe } = await Promise.race([
              operation,
              wait(stepTimeout).then(() => { throw new Error('测试超时') }),
            ])
            const detail = this.formatProbe(probe)
            if (!this.isRunActive(runToken)) return
            if (probe.error != null || (probe.httpStatus != null && probe.httpStatus >= 400) || !probe.bytesRead) {
              this.addResult({ ...this.resultBase(api, platform, quality, song), status: 'failed', statusLabel: '失败', kind: 'failed', tier: null, detail: probe.error ?? (probe.httpStatus ? `HTTP ${probe.httpStatus}` : '未读取到音频数据') })
            } else {
              const isSpecialRequest = ['atmos', 'atmos_plus'].includes(quality)
              const isAmbiguousContainer = probe.format === 'm4a' || probe.format === 'matroska'
              // A container magic/header alone is not proof that the response
              // contains playable audio.  Require parsed audio metadata before
              // calling a request successful or labelling it a downgrade.
              const hasAudioEvidence = probe.sampleRate != null
              // 用与播放栏相同的换算规则判定档位，避免测试结论和界面显示互相矛盾。
              const verdict = describeActualQuality({ probe, interval: testSongInfo.interval, requested: quality })
              const uncertainContainer = isAmbiguousContainer && hasAudioEvidence && verdict.detected == null
              // 专有档位（全景声等）无法仅凭容器证明，即使容器可解析也不判定为已获取。
              const unverifiable = isSpecialRequest || uncertainContainer || !hasAudioEvidence || verdict.detected == null
              const status = verdict.downgraded ? 'warning' : unverifiable ? 'unknown' : 'success'
              const statusLabel = verdict.downgraded ? '疑似降级' : unverifiable ? '无法确认' : '已获取'
              const detailParts = [detail]
              if (isSpecialRequest) detailParts.push('专有档位无法仅凭文件确认')
              else if (uncertainContainer) detailParts.push(`${String(probe.format).toUpperCase()} 容器无法仅凭采样率确认编码`)
              detailParts.push(verdict.downgraded
                ? `实测档位：${this.qualityLabel(verdict.quality)}`
                : verdict.detected == null || isSpecialRequest
                  ? '实测档位：无法确认'
                  : `规格符合：${this.qualityLabel(verdict.quality)}`)
              const verdictKind = verdict.downgraded ? 'downgrade' : unverifiable ? 'unknown' : 'pass'
              this.addResult({ ...this.resultBase(api, platform, quality, song), actualFormat: probe.format, actualSampleRate: probe.sampleRate, actualContentLength: probe.contentLength, status, statusLabel, kind: verdictKind, tier: verdictKind === 'unknown' ? null : verdict.quality, detail: detailParts.join(' · ') })
            }
            this.markProgress()
          } catch (error) {
            if (!this.isRunActive(runToken)) return
            this.addResult({ ...this.resultBase(api, platform, quality, song), status: 'failed', statusLabel: '失败', kind: 'failed', tier: null, detail: this.errorMessage(error) })
            this.markProgress()
            if (this.errorMessage(error).includes('测试超时')) {
              stopTestUserApis([api.id])
              // The request/probe operation may still be unwinding after the
              // timeout.  Stop this source's script and move to the next
              // source instead of recreating the same runtime for every
              // remaining quality tier.
              return
            }
          }
          await wait(this.numberSetting('qualityIntervalSeconds') * 1000)
        }
        await wait(this.numberSetting('sourceIntervalSeconds') * 1000)
      }
    },
    numberSetting(key) {
      const value = Number(this.settings[key])
      return Number.isFinite(value) && value >= 0 ? Math.min(value, 60) : 0
    },
    async startTest() {
      if (this.busy || !this.canStart) return
      this.saveSettings()
      this.busy = true
      this.stopped = false
      this.results = []
      this.keywordsUsed = {}
      const body = this.$refs.body
      if (body) body.scrollTo({ top: 0, behavior: 'auto' })
      this.progressCount = 0
      this.progressTotal = 0
      const runToken = ++this.runToken
      this.taskId = `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
      const taskId = this.taskId
      this.searchCache = Object.create(null)
      try {
        const capabilities = {}
        for (const apiId of this.selectedApis) {
          if (!this.isRunActive(runToken)) break
          try {
            Object.assign(capabilities, await getTestUserApiSources([apiId]))
          } catch (error) {
            if (!this.isRunActive(runToken)) break
            const api = this.apiList.find(item => item.id === apiId)
            this.addResult({ taskId, apiId, apiName: api?.name || apiId, platformId: '', platformName: '', quality: '', qualityLabel: '', song: '', status: 'failed', statusLabel: '初始化失败', kind: 'failed', tier: null, detail: this.errorMessage(error) })
            stopTestUserApis([apiId])
          }
        }
        this.progressTotal = this.selectedApis.reduce((total, apiId) => {
          const sourceCapabilities = capabilities[apiId] || {}
          return total + this.selectedPlatforms.reduce((sourceTotal, platformId) => {
            const platformCapability = sourceCapabilities[platformId]
            const count = platformCapability?.actions?.includes('musicUrl')
              ? platformCapability.qualitys?.length || 0
              : 0
            return sourceTotal + Math.max(1, count)
          }, 0)
        }, 0)
        for (const apiId of this.selectedApis) {
          if (!this.isRunActive(runToken)) break
          const api = this.apiList.find(item => item.id === apiId)
          if (api && capabilities[apiId]) await this.testOneApi(api, capabilities[apiId], runToken, taskId)
          await wait(this.numberSetting('sourceIntervalSeconds') * 1000)
        }
      } catch (error) {
        if (this.isRunActive(runToken)) this.addResult({ taskId, apiId: '', apiName: '测试', platformId: '', platformName: '', quality: '', qualityLabel: '', song: '', status: 'failed', statusLabel: '失败', kind: 'failed', tier: null, detail: this.errorMessage(error) })
      } finally {
        if (this.runToken === runToken) {
          this.runToken++
          this.busy = false
          this.progressText = ''
          stopTestUserApis()
          if (this.results.length) this.scrollResultsIntoView()
        }
      }
    },
    stopTest() {
      if (!this.busy) return
      this.stopped = true
      this.runToken++
      this.busy = false
      stopTestUserApis()
      this.progressText = '已停止'
    },
    copyResults() {
      const text = this.results.map(result => `${result.apiName} | ${result.platformName} | ${this.tierLabel(result.quality)} --> ${this.actualText(result)} | ${result.detail}${result.song ? ` | ${result.song}` : ''}`).join('\n')
      clipboardWriteText(text)
    },
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  width: min(900px, 92vw);
  max-height: 88vh;
  padding: 15px;
  display: flex;
  flex-flow: column nowrap;
  min-height: 0;
  color: var(--color-font);
  h2 { text-align: center; font-size: 16px; line-height: 1.3; }
  h3 { font-size: 14px; margin-bottom: 8px; }
}
.tip, .muted { color: var(--color-font-label); font-size: 12px; line-height: 1.45; }
.tip { margin: 8px 0 12px; }
.section { margin-top: 12px; min-height: 0; }
.toolbar, .resultHeader, .footer { display: flex; align-items: center; gap: 10px; }
.toolbar { justify-content: space-between; }
.apiList { display: flex; flex-wrap: wrap; gap: 5px 14px; padding: 8px; border-radius: @radius-border; background: var(--color-primary-background-hover); }
.platformGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px 12px; }
.platformItem { display: flex; align-items: center; gap: 8px; min-width: 0; }
.keyword { flex: 1; min-width: 80px; }
.advanced { margin-top: 10px; font-size: 12px; color: var(--color-font-label); summary { cursor: pointer; user-select: none; } }
.settings { display: flex; flex-wrap: wrap; gap: 8px 15px; padding-top: 8px; label { display: flex; align-items: center; gap: 6px; } }
.settings :global(input) { width: 65px; }
.resultHeader { justify-content: space-between; }
.testing { color: var(--color-warning); font-size: 12px; }
.results { overflow: auto; max-height: 32vh; padding: 8px; border-radius: @radius-border; background: var(--color-primary-background-hover); }
.result { padding: 8px 5px; border-bottom: 1px solid var(--color-divider); font-size: 12px; line-height: 1.45; &:last-child { border-bottom: 0; } p { color: var(--color-font-label); word-break: break-word; } }
.resultTitle { display: flex; justify-content: space-between; gap: 8px; strong { min-width: 0; word-break: break-word; } }
.success .resultTitle span { color: var(--color-success); }
.warning .resultTitle span { color: var(--color-warning); }
.failed .resultTitle span { color: var(--color-error); }
.unsupported .resultTitle span { color: var(--color-font-label); }
.unknown .resultTitle span { color: var(--color-font-label); }
.footer { justify-content: flex-end; margin-top: 14px; }
.footerBtn { min-width: 78px; }
@media (max-width: 620px) { .platformGrid { grid-template-columns: 1fr; } .main { width: 92vw; } .results { max-height: 38vh; } }

/* The test view is a full-height workspace inside material-modal.  Keep the
   controls grouped as cards so the dense diagnostic data remains readable. */
.main {
  width: 100%;
  height: 100%;
  max-height: none;
  padding: 0;
  display: flex;
  flex-flow: column nowrap;
  min-height: 0;
  color: var(--color-font);
}
.titleBar {
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--color-primary-alpha-900);
  h2 { margin: 0; text-align: left; font-size: 16px; line-height: 1.35; font-weight: 600; }
}
.tip, .sectionHint, .empty { color: var(--color-font-label); font-size: 12px; line-height: 1.5; }
.tip { margin: 5px 0 0; }
.runBadge { flex: none; padding: 4px 9px; border-radius: 12px; background: var(--color-primary-background-hover); color: var(--color-font-label); font-size: 12px; line-height: 1.2; }
.runBadgeActive { color: var(--color-primary-font); background: var(--color-primary-background-active); }
.body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 14px 18px 4px; }
.section { margin: 0 0 14px; min-height: 0; }
.sectionHead { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.sectionHead h3 { margin: 0; font-size: 14px; line-height: 1.35; font-weight: 600; }
.sectionHint { margin: 3px 0 0; }
.sectionMeta, .sectionMetaText { flex: none; display: flex; align-items: center; gap: 9px; color: var(--color-font-label); font-size: 12px; }
.sectionMetaText { display: block; }
.sourceList, .platformGrid, .resultList { border: 1px solid var(--color-primary-alpha-900); border-radius: @radius-border; background: var(--color-primary-background-hover); }
.sourceList { display: flex; flex-direction: column; gap: 5px; padding: 6px; }
.sourceRow { display: flex; align-items: flex-start; gap: 10px; min-width: 0; padding: 9px 10px; border: 1px solid transparent; border-radius: @radius-border; background: var(--color-content-background); transition: background-color .2s ease, border-color .2s ease; }
.sourceRow.selected { border-color: var(--color-primary-alpha-500); background: var(--color-primary-background-active); }
.sourceInfo { min-width: 0; flex: 1; }
.sourceName { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-width: 0; font-size: 13px; line-height: 1.35; }
.sourceName strong { min-width: 0; word-break: break-word; }
.sourceInfo p { margin: 3px 0 0; color: var(--color-font-label); font-size: 12px; line-height: 1.35; word-break: break-word; }
.version, .currentBadge, .groupCount { color: var(--color-font-label); font-size: 11px; }
.currentBadge { padding: 2px 6px; border-radius: 10px; color: var(--color-primary-font); background: var(--color-primary-background); }
.empty { margin: 0; padding: 16px; text-align: center; border: 1px dashed var(--color-primary-alpha-900); border-radius: @radius-border; }
.platformGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; padding: 6px; }
.platformCard { min-width: 0; padding: 9px 10px; border: 1px solid transparent; border-radius: @radius-border; background: var(--color-content-background); transition: background-color .2s ease, border-color .2s ease; }
.platformSelected { border-color: var(--color-primary-alpha-500); background: var(--color-primary-background-active); }
.platformHead { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 7px; }
.platformState { flex: none; color: var(--color-font-label); font-size: 11px; }
.platformSelected .platformState { color: var(--color-primary-font); }
.keyword { width: 100%; min-width: 0; box-sizing: border-box; }
.bulkRow { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
.bulkInput { flex: 1; min-width: 0; box-sizing: border-box; }
.bulkBtn { flex: none; min-width: 74px; }
.advanced { margin-top: 8px; padding: 9px 10px; border: 1px solid var(--color-primary-alpha-900); border-radius: @radius-border; color: var(--color-font-label); font-size: 12px; }
.advanced summary { display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none; list-style: none; }
.advanced summary::-webkit-details-marker { display: none; }
.advanced summary:before { content: '›'; display: inline-block; margin-right: 6px; color: var(--color-primary-font); transition: transform .2s ease; }
.advanced[open] summary:before { transform: rotate(90deg); }
.advancedHint { margin-left: auto; color: var(--color-font-label); }
.settings { display: flex; flex-wrap: wrap; gap: 8px 15px; padding-top: 10px; }
.settings label { display: flex; align-items: center; gap: 7px; }
.settings :global(input) { width: 64px; }
.resultList { max-height: 320px; overflow: auto; padding: 6px; }
.resultGroup + .resultGroup { margin-top: 8px; }
.resultGroup { overflow: hidden; border: 1px solid var(--color-primary-alpha-900); border-radius: @radius-border; background: var(--color-content-background); }
.resultGroupHead { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 9px 10px; background: var(--color-primary-background-hover); cursor: pointer; list-style: none; }
.resultGroupHead::-webkit-details-marker { display: none; }
.resultGroupHead:before { content: '›'; flex: none; margin: 0 5px 0 0; color: var(--color-primary-font); transition: transform .2s ease; }
.resultGroup[open] > .resultGroupHead:before { transform: rotate(90deg); }
.resultGroupHead > div:first-of-type { flex: 1; min-width: 0; }
.resultGroupHead strong { font-size: 13px; line-height: 1.35; }
.resultGroupHead p { margin: 3px 0 0; color: var(--color-font-label); font-size: 11px; line-height: 1.35; word-break: break-word; }
.groupSpec { color: var(--color-primary-font) !important; }
.groupMeta { display: flex; flex: none; align-items: flex-end; flex-direction: column; gap: 4px; padding-top: 2px; text-align: right; }
.groupCount { color: var(--color-font-label); font-size: 11px; white-space: nowrap; }
.groupInfo { flex: 1; min-width: 0; }
.groupMeta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.bestQualityLabel { color: var(--color-font-label); font-size: 11px; white-space: nowrap; }
.platformMeta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 5px 10px; border-top: 1px solid var(--color-primary-alpha-900); }
.platformSummary { color: var(--color-font-label); font-size: 11px; }
.tierChip { display: inline-flex; align-items: center; padding: 1px 6px; border: 1px solid transparent; border-radius: 3px; font-size: 11px; line-height: 16px; white-space: nowrap; color: var(--color-font); background: var(--color-primary-background-hover); }
.tierChipLarge { padding: 2px 8px; font-size: 12px; line-height: 18px; font-weight: 600; }
.tierChip[data-suspected] { border-style: dashed; }
.tierChipRequest { color: var(--color-font); background: var(--color-primary-background-hover); }
.platformBlock + .platformBlock { border-top: 1px solid var(--color-primary-alpha-900); }
.platformHead { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; background: var(--color-primary-background-hover); }
.platformName { font-size: 12px; font-weight: 600; color: var(--color-font); }
.platformState { font-size: 11px; font-weight: 600; }
.platformSong { margin: 0; padding: 4px 10px 0; color: var(--color-font-label); font-size: 11px; line-height: 1.4; word-break: break-word; }
.state_ok { color: #2e9e5b; }
.state_warn { color: #b97800; }
.state_fail { color: #c94a4a; }
.tierRows { display: flex; flex-direction: column; }
.tierRow { display: grid; grid-template-columns: auto 12px auto minmax(0, 1fr); align-items: start; gap: 6px; padding: 6px 10px; border-top: 1px solid var(--color-primary-alpha-900); font-size: 12px; line-height: 1.4; }
.tierArrow { color: var(--color-font-label); text-align: center; }
.tierDetail { min-width: 0; color: var(--color-font-label); word-break: break-word; }
.kind_unknown, .kind_unsupported, .kind_failed { color: var(--color-font-label); background: transparent; border-color: var(--color-primary-alpha-900); }
.footer { flex: none; display: flex; align-items: flex-end; gap: 16px; margin-top: 0; padding: 11px 18px 14px; border-top: 1px solid var(--color-primary-alpha-900); background: var(--color-content-background); }
.progressArea { flex: 1; min-width: 0; }
.progressText { overflow: hidden; color: var(--color-font-label); font-size: 12px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.progressTrack { height: 3px; margin-top: 7px; overflow: hidden; border-radius: 3px; background: var(--color-primary-background-hover); }
.progressFill { display: block; height: 100%; border-radius: inherit; background: var(--color-primary); transition: width .25s ease; }
.footerActions { display: flex; flex: none; gap: 8px; }
.footerBtn { min-width: 78px; }
@media (max-width: 680px) {
  .titleBar { padding: 15px 14px 12px; }
  .body { padding: 12px 12px 3px; }
  .sectionHead { align-items: flex-start; flex-direction: column; gap: 5px; }
  .sectionMeta { align-self: stretch; justify-content: space-between; }
  .platformGrid { grid-template-columns: 1fr; }
  .resultGroupHead { flex-direction: column; }
  .groupMeta { align-items: flex-start; text-align: left; }
  .groupCount { white-space: normal; }
  .tierRow { grid-template-columns: auto 12px auto minmax(0, 1fr); gap: 4px; }
  .footer { align-items: stretch; flex-direction: column; gap: 10px; padding: 10px 12px 12px; }
  .footerActions { justify-content: flex-end; }
}
</style>
