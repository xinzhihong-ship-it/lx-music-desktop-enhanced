<template>
  <material-modal :show="modelValue" teleport="#root" min-width="360px" max-width="420px" @close="handleClose">
    <main :class="$style.main">
      <div :class="$style.titleRow">
        <h2 :class="$style.title">歌曲基调设置</h2>
        <button
          type="button"
          :class="$style.popoutBtn"
          title="弹出独立悬浮窗口（不受主界面尺寸限制，支持置顶）"
          @click="handlePopout"
        >
          🗗 独立窗口
        </button>
      </div>

      <div :class="$style.songInfo">
        <span :class="$style.songName">{{ musicName }}</span>
        <span v-if="musicSinger" :class="$style.songSinger"> - {{ musicSinger }}</span>
      </div>

      <div :class="$style.section">
        <div :class="$style.labelRow">
          <span :class="$style.sectionLabel">当前基调：</span>
          <span :class="$style.currentBadge">
            {{ effectiveLabel }}
            <span :class="[$style.sourceTag, $style[currentSource]]">{{ sourceText }}</span>
          </span>
        </div>
      </div>

      <div v-if="showAnalyzingHint" :class="$style.analyzingHint">
        正在分析这首歌的基调，结果出来后会自动填入下面的编辑器
      </div>

      <div :class="$style.modeSwitch">
        <button
          type="button"
          :class="[$style.modeBtn, { [$style.modeActive]: mode === 'whole' }]"
          @click="switchMode('whole')"
        >整首统一</button>
        <button
          type="button"
          :class="[$style.modeBtn, { [$style.modeActive]: mode === 'segments' }]"
          @click="switchMode('segments')"
        >分段设置</button>
      </div>

      <div v-if="mode === 'segments'" :class="$style.section">
        <div :class="$style.sectionLabel">时间段（点选后在下方改这一段，双击时间可改换调时刻）：</div>
        <div :class="$style.segmentList">
          <div
            v-for="(segment, index) in segments"
            :key="index"
            :class="[
              $style.segmentRow,
              {
                [$style.segmentActive]: index === selectedIndex,
                [$style.segmentPlaying]: index === currentPlayingIndex,
              },
            ]"
            @click="selectSegment(index)"
            @dblclick="startEditTime(index)"
          >
            <span v-if="index === currentPlayingIndex" :class="$style.playingDot" title="当前播放进度所在段落">▶</span>
            <input
              v-if="editingIndex === index"
              ref="timeInputRef"
              v-model="editingValue"
              :class="$style.segmentTimeInput"
              placeholder="0:00"
              @click.stop
              @keydown.enter.prevent="commitTimeEdit"
              @keydown.esc.prevent="cancelTimeEdit"
              @blur="commitTimeEdit"
            />
            <span v-else :class="$style.segmentTime">{{ formatTime(segment.at) }}</span>
            <span :class="$style.segmentKey">{{ segmentLabel(segment) }}</span>
            <button
              v-if="segments.length > 1"
              type="button"
              :class="$style.segmentRemove"
              title="删除这一段"
              @click.stop="removeSegment(index)"
            >×</button>
          </div>
        </div>
        <div :class="$style.segmentActions">
          <button
            type="button"
            :class="[$style.smallBtn, { [$style.smallBtnDisabled]: playbackAtExistingSegment }]"
            :disabled="playbackAtExistingSegment"
            :title="playbackAtExistingSegment ? '这一秒已经是某个分段的起点，双击它可以改时间' : '以当前播放位置作为新分段的起点'"
            @click="addSegmentFromPlayback"
          >
            {{ playbackAtExistingSegment
              ? `当前位置 ${formatTime(playbackSeconds)} 已是分段起点`
              : `＋ 在当前位置 ${formatTime(playbackSeconds)} 新增一段` }}
          </button>
        </div>
        <div v-if="timeEditError" :class="$style.errorHint">{{ timeEditError }}</div>
        <div v-else-if="prefilledFromAnalysis" :class="$style.hint">
          已按音频分析预填，可直接改换调时刻和调性
        </div>
      </div>

      <div :class="$style.section">
        <div :class="$style.sectionLabel">{{ mode === 'whole' ? '选择主音 (Key)：' : `第 ${selectedIndex + 1} 段主音：` }}</div>
        <div :class="$style.noteGrid">
          <button
            v-for="note in noteOptions"
            :key="note.value"
            type="button"
            :class="[$style.noteBtn, { [$style.active]: selectedKey === note.value }]"
            @click="pickNote(note.value)"
          >
            {{ note.label }}
          </button>
        </div>
      </div>

      <div :class="$style.section">
        <div :class="$style.sectionLabel">{{ mode === 'whole' ? '选择调式 (Scale)：' : `第 ${selectedIndex + 1} 段调式：` }}</div>
        <div :class="$style.scaleRow">
          <button
            v-for="scale in scaleOptions"
            :key="scale.value"
            type="button"
            :class="[$style.scaleBtn, { [$style.active]: selectedScale === scale.value }]"
            @click="pickScale(scale.value)"
          >
            {{ scale.label }}
          </button>
        </div>
      </div>

      <div :class="$style.section">
        <div :class="$style.speedHeader">
          <span :class="$style.sectionLabel">电音深度 / 速度 (Retune Speed)：</span>
          <span :class="$style.speedValue">{{ retuneSpeed }}</span>
        </div>
        <div :class="$style.sliderRow">
          <input
            v-model.number="retuneSpeed"
            type="range"
            min="0"
            max="100"
            step="1"
            :class="$style.slider"
            title="0为最硬电音瞬吸附，20为流行微调(默认推荐)，50~100为自然慢速"
          />
          <div :class="$style.quickSpeeds">
            <button type="button" :class="[$style.quickBtn, { [$style.quickActive]: retuneSpeed === 0 }]" @click="retuneSpeed = 0">0 强电音</button>
            <button type="button" :class="[$style.quickBtn, { [$style.quickActive]: retuneSpeed === 20 }]" @click="retuneSpeed = 20">20 流行</button>
            <button type="button" :class="[$style.quickBtn, { [$style.quickActive]: retuneSpeed === 50 }]" @click="retuneSpeed = 50">50 自然</button>
          </div>
        </div>
        <div v-if="!retuneSpeedAuto" :class="$style.speedNote">
          {{ 'macOS 上宿主不允许外部程序直接改插件参数，此值需在机架里设定一次后固定（基调与转调仍全自动跟播）。' }}
        </div>
      </div>

      <div v-if="mode === 'whole'" :class="$style.section">
        <label :class="$style.rememberLabel">
          <input v-model="remember" type="checkbox" :class="$style.checkbox" />
          <span>记住这首歌就这个基调（下次播放直接采用）</span>
        </label>
      </div>

      <div :class="$style.footer">
        <label :class="$style.syncPluginLabel" title="全局设置：开启后对所有歌曲生效，任何正在播放或切换的歌曲，其调性与实时转调都会自动同步给系统内挂载的 Auto-Tune 电音插件">
          <input v-model="isPluginSyncEnabled" type="checkbox" :class="$style.checkbox" />
          <span>全局同步机架 (Auto-Tune)</span>
        </label>
        <div :class="$style.footerBtns">
          <base-btn :class="$style.btnSecondary" @click="handleReanalyze">重新分析</base-btn>
          <base-btn v-if="isCustom" :class="$style.btnSecondary" @click="handleReset">恢复自动识别</base-btn>
          <base-btn :class="$style.btnPrimary" @click="handleSave">保存并应用</base-btn>
        </div>
      </div>
    </main>
  </material-modal>
</template>

<script>
import { ref, computed, watch, nextTick } from '@common/utils/vueTools'
import { musicInfo } from '@renderer/store/player/state'
import { syncKeyToPlugin } from '@renderer/utils/musicKey'
import {
  songKeyInfo,
  isKeyAnalyzing,
  effectiveSongKey,
  playbackSeconds,
  isPluginSyncEnabled,
  retuneSpeed,
  isRetuneSpeedAutomationSupported,
  saveCurrentSongKey,
  saveCurrentSongKeyTimeline,
  clearCurrentSongKey,
  updateCurrentSongKey,
  openIndependentSongKeyWindow,
} from '@renderer/store/player/songKey'

export default {
  props: {
    modelValue: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const noteOptions = [
      { label: 'C', value: 'C' },
      { label: 'C#/Db', value: 'C#' },
      { label: 'D', value: 'D' },
      { label: 'D#/Eb', value: 'D#' },
      { label: 'E', value: 'E' },
      { label: 'F', value: 'F' },
      { label: 'F#/Gb', value: 'F#' },
      { label: 'G', value: 'G' },
      { label: 'G#/Ab', value: 'G#' },
      { label: 'A', value: 'A' },
      { label: 'A#/Bb', value: 'A#' },
      { label: 'B', value: 'B' },
    ]

    const scaleOptions = [
      { label: '大调 (Major / 1=X)', value: 'major' },
      { label: '小调 (Minor / 6=X)', value: 'minor' },
    ]

    const selectedKey = ref('C')
    const selectedScale = ref('major')
    const remember = ref(true)

    /** 'whole' = 整首一个调；'segments' = 按时间段各是一个调 */
    const mode = ref('whole')
    const segments = ref([])
    const selectedIndex = ref(0)
    const prefilledFromAnalysis = ref(false)

    const formatTime = (seconds) => {
      const total = Math.max(0, Math.floor(seconds || 0))
      const mm = Math.floor(total / 60)
      const ss = total % 60
      return `${mm}:${String(ss).padStart(2, '0')}`
    }

    const segmentLabel = (segment) => {
      const key = segment?.key ?? 'C'
      const scale = segment?.scale ?? 'major'
      return scale === 'minor' ? `${key}m 小调` : `1=${key} 大调`
    }

    /** 用户是否已经动过编辑器：动过之后就不能再被迟到的分析结果覆盖 */
    const touched = ref(false)

    /** 打开弹窗时把已有的调性（用户设的 / 分析出来的）灌进编辑器 */
    const hydrate = () => {
      const info = songKeyInfo.value
      selectedKey.value = info?.key ?? 'C'
      selectedScale.value = info?.scale ?? 'major'

      const timeline = info?.timeline
      if (timeline?.length) {
        segments.value = timeline.map((segment) => ({ at: segment.at, key: segment.key, scale: segment.scale }))
        prefilledFromAnalysis.value = info.source !== 'user'
        // 有转调就直接进分段模式，用户多半是来改换调点的
        mode.value = timeline.length > 1 && info.source !== 'user' ? 'segments' : 'whole'
      } else {
        segments.value = [{ at: 0, key: selectedKey.value, scale: selectedScale.value }]
        prefilledFromAnalysis.value = false
        mode.value = 'whole'
      }

      // 打开时优先定位到当前正在播放的那一段，而非死板重置到第 0 段
      let initialIdx = 0
      if (segments.value.length) {
        for (let i = 0; i < segments.value.length; i++) {
          if (segments.value[i].at <= playbackSeconds.value) initialIdx = i
          else break
        }
      }
      selectedIndex.value = initialIdx
      touched.value = false
      userSelectedSegment.value = false
      syncFromSegment(initialIdx)
    }

    const userSelectedSegment = ref(false)

    /** 当前播放进度处于哪一段 */
    const currentPlayingIndex = computed(() => {
      if (!segments.value.length) return 0
      let idx = 0
      for (let i = 0; i < segments.value.length; i++) {
        if (segments.value[i].at <= playbackSeconds.value) idx = i
        else break
      }
      return idx
    })

    // 焦点跟随播放进度动态切换（除非用户手动锁定了某一段进行编辑，或者已经设定了整首统一不变）
    watch(currentPlayingIndex, (curIdx) => {
      if (mode.value === 'whole' && (!songKeyInfo.value?.timeline?.length || touched.value)) return
      if (!userSelectedSegment.value && !touched.value) {
        selectedIndex.value = curIdx
        syncFromSegment(curIdx)
      }
    })

    // 播放中当前基调变化时（实时转调跟播触发），双模式网格同步高亮正在播放的音名
    watch(effectiveSongKey, (current) => {
      if (!touched.value && !userSelectedSegment.value && current) {
        selectedKey.value = current.key
        selectedScale.value = current.scale
        if (mode.value === 'segments') {
          selectedIndex.value = currentPlayingIndex.value
        }
      }
    })

    const pickNote = (value) => {
      touched.value = true
      selectedKey.value = value
      // 点击音名立即同步宿主机架插件，毫秒级试听/切调
      if (isPluginSyncEnabled.value) {
        void syncKeyToPlugin({
          key: value,
          scale: selectedScale.value,
          label: selectedScale.value === 'minor' ? `${value}m 小调` : `1=${value} 大调`,
        })
      }
    }

    const pickScale = (value) => {
      touched.value = true
      selectedScale.value = value
      // 点击调式立即同步宿主机架插件
      if (isPluginSyncEnabled.value) {
        void syncKeyToPlugin({
          key: selectedKey.value,
          scale: value,
          label: value === 'minor' ? `${selectedKey.value}m 小调` : `1=${selectedKey.value} 大调`,
        })
      }
    }

    const syncFromSegment = (index) => {
      const segment = segments.value[index]
      if (!segment) return
      selectedKey.value = segment.key
      selectedScale.value = segment.scale
    }

    const selectSegment = (index) => {
      userSelectedSegment.value = true
      selectedIndex.value = index
      syncFromSegment(index)
      if (isPluginSyncEnabled.value && segments.value[index]) {
        const seg = segments.value[index]
        void syncKeyToPlugin({
          key: seg.key,
          scale: seg.scale,
          label: seg.scale === 'minor' ? `${seg.key}m 小调` : `1=${seg.key} 大调`,
        })
      }
    }

    /** 网格里改调时，同步回当前选中的那一段 */
    watch([selectedKey, selectedScale], ([key, scale]) => {
      if (mode.value !== 'segments') return
      const segment = segments.value[selectedIndex.value]
      if (!segment) return
      segment.key = key
      segment.scale = scale
    })

    const switchMode = (next) => {
      touched.value = true
      mode.value = next
      if (next === 'segments') {
        // 从整首模式切过来时，至少有一段
        if (!segments.value.length) {
          segments.value = [{ at: 0, key: selectedKey.value, scale: selectedScale.value }]
        }
        selectedIndex.value = 0
        syncFromSegment(0)
      }
    }

    /** 当前位置是否已经是某个分段的起点（此时"新增"没有意义） */
    const playbackAtExistingSegment = computed(() =>
      segments.value.some((segment) => segment.at === Math.floor(playbackSeconds.value || 0)))

    const addSegmentFromPlayback = () => {
      touched.value = true
      const at = Math.max(0, Math.floor(playbackSeconds.value || 0))
      // 同一秒已有分段就改成选它，避免制造重复段
      const existing = segments.value.findIndex((segment) => segment.at === at)
      if (existing >= 0) {
        selectSegment(existing)
        return
      }
      segments.value.push({ at, key: selectedKey.value, scale: selectedScale.value })
      segments.value.sort((a, b) => a.at - b.at)
      selectSegment(segments.value.findIndex((segment) => segment.at === at))
    }

    const removeSegment = (index) => {
      if (segments.value.length <= 1) return
      touched.value = true
      segments.value.splice(index, 1)
      // 删掉第一段后，新的第一段必须从 0 开始
      if (segments.value.length) segments.value[0].at = 0
      selectSegment(Math.min(index, segments.value.length - 1))
    }

    // ── 双击改换调时刻 ──────────────────────────────────────────
    const editingIndex = ref(-1)
    const editingValue = ref('')
    const timeEditError = ref('')
    const timeInputRef = ref(null)

    /** 接受 "1:36" 或 "96"（纯秒数），非法输入返回 null */
    const parseTime = (text) => {
      const value = String(text ?? '').trim()
      if (!value) return null
      const colon = /^(\d{1,3}):([0-5]?\d)$/.exec(value)
      if (colon) return Number(colon[1]) * 60 + Number(colon[2])
      const plain = /^(\d{1,5})$/.exec(value)
      if (plain) return Number(plain[1])
      return null
    }

    const startEditTime = (index) => {
      touched.value = true
      timeEditError.value = ''
      editingIndex.value = index
      editingValue.value = formatTime(segments.value[index]?.at)
      void nextTick(() => {
        const input = Array.isArray(timeInputRef.value) ? timeInputRef.value[0] : timeInputRef.value
        input?.focus?.()
        input?.select?.()
      })
    }

    const cancelTimeEdit = () => {
      editingIndex.value = -1
      editingValue.value = ''
      timeEditError.value = ''
    }

    const commitTimeEdit = () => {
      const index = editingIndex.value
      if (index < 0) return
      const parsed = parseTime(editingValue.value)
      if (parsed == null) {
        timeEditError.value = '时间格式不对，请填 1:36 或 96 这样的写法'
        return
      }
      const segment = segments.value[index]
      if (!segment) {
        cancelTimeEdit()
        return
      }
      // 第一段永远代表"从头开始"，不允许改
      segment.at = index === 0 ? 0 : parsed
      // 改完时间要重排，并让选中态跟着这一段走
      segments.value.sort((a, b) => a.at - b.at)
      editingIndex.value = -1
      editingValue.value = ''
      timeEditError.value = ''
      selectSegment(segments.value.indexOf(segment))
    }

    watch(
      () => props.modelValue,
      (show) => {
        if (show) hydrate()
      },
    )

    // 弹窗开着的时候分析结果才回来（很常见：刚切歌就点开标签）。
    // 用户还没动过就自动补进去，动过就绝不覆盖。
    watch(songKeyInfo, () => {
      if (!props.modelValue || touched.value) return
      hydrate()
    })

    const showAnalyzingHint = computed(() =>
      props.modelValue && isKeyAnalyzing.value && !songKeyInfo.value && !touched.value)

    const musicName = computed(() => musicInfo.name || '当前歌曲')
    const musicSinger = computed(() => musicInfo.singer || '')

    const isCustom = computed(() => songKeyInfo.value?.source === 'user')

    const currentSource = computed(() => songKeyInfo.value?.source ?? 'analysis')
    const sourceText = computed(() => {
      switch (songKeyInfo.value?.source) {
        case 'user':
          return '已记忆'
        case 'database':
          return '经典谱库'
        case 'analysis':
        default:
          return '音频分析'
      }
    })

    const effectiveLabel = computed(() => effectiveSongKey.value?.label ?? '未识别')

    const handleClose = () => {
      emit('update:modelValue', false)
    }

    const handlePopout = () => {
      openIndependentSongKeyWindow()
      handleClose()
    }

    const handleSave = async() => {
      if (mode.value === 'segments') {
        await saveCurrentSongKeyTimeline(segments.value.map((segment) => ({ ...segment })))
      } else {
        await saveCurrentSongKey(selectedKey.value, selectedScale.value)
      }
      handleClose()
    }

    const handleReset = async() => {
      await clearCurrentSongKey()
      handleClose()
    }

    const handleReanalyze = async() => {
      handleClose()
      await updateCurrentSongKey(true)
    }

    return {
      noteOptions,
      scaleOptions,
      selectedKey,
      selectedScale,
      pickNote,
      pickScale,
      showAnalyzingHint,
      remember,
      isPluginSyncEnabled,
      retuneSpeed,
      retuneSpeedAuto: isRetuneSpeedAutomationSupported,
      mode,
      segments,
      selectedIndex,
      currentPlayingIndex,
      prefilledFromAnalysis,
      playbackSeconds,
      formatTime,
      segmentLabel,
      selectSegment,
      switchMode,
      addSegmentFromPlayback,
      playbackAtExistingSegment,
      removeSegment,
      editingIndex,
      editingValue,
      timeEditError,
      timeInputRef,
      startEditTime,
      commitTimeEdit,
      cancelTimeEdit,
      musicName,
      musicSinger,
      isCustom,
      currentSource,
      sourceText,
      effectiveLabel,
      handleClose,
      handlePopout,
      handleSave,
      handleReset,
      handleReanalyze,
    }
  },
}
</script>

<style lang="less" module>
.main {
  padding: 16px 20px 0;
  color: var(--color-font);
  // 公共 Modal 的 .content 是 overflow:hidden 且没有 max-height，
  // 分段一多弹窗就会超出窗口被直接裁掉。这里自己兜住高度并允许滚动，
  // 底部按钮用 sticky 钉住，保证任何段数下都点得到「保存并应用」。
  max-height: calc(100vh - 110px);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.titleRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.title {
  font-size: 16px;
  font-weight: bold;
}

.popoutBtn {
  border: 1px solid var(--color-primary-light-800-alpha-400);
  background: transparent;
  color: var(--color-primary);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
  transition: all .15s ease;
  display: flex;
  align-items: center;
  gap: 4px;

  &:hover {
    background-color: var(--color-primary-light-900-alpha-300);
    border-color: var(--color-primary);
  }
}

.songInfo {
  font-size: 13px;
  color: var(--color-font-label);
  margin-bottom: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.songName {
  font-weight: 500;
  color: var(--color-font);
}

.section {
  margin-bottom: 16px;
}

// 整首统一 / 分段设置 切换
.analyzingHint {
  margin-bottom: 12px;
  padding: 8px 10px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--color-primary);
  background-color: var(--color-primary-light-800-alpha-300);
}

.modeSwitch {
  display: flex;
  gap: 6px;
  margin-bottom: 16px;
  padding: 3px;
  border-radius: 5px;
  background-color: var(--color-primary-light-900-alpha-300);
}

.modeBtn {
  flex: 1;
  height: 26px;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  color: var(--color-font-label);
  background-color: transparent;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-font);
  }

  &.modeActive {
    color: var(--color-primary);
    background-color: var(--color-main-background);
    box-shadow: 0 1px 2px rgb(0 0 0 / 12%);
  }
}

.segmentList {
  max-height: 168px;
  overflow-y: auto;
  border-radius: 5px;
  background-color: var(--color-primary-light-900-alpha-300);
}

.segmentRow {
  display: flex;
  align-items: center;
  height: 30px;
  padding: 0 8px;
  font-size: 12px;
  cursor: pointer;
  border-left: 2px solid transparent;
  transition: background-color 0.15s ease;

  &:hover {
    background-color: var(--color-primary-light-800-alpha-300);
  }

  &.segmentActive {
    border-left-color: var(--color-primary);
    background-color: var(--color-primary-light-800-alpha-400);
    color: var(--color-primary);
  }

  &.segmentPlaying:not(.segmentActive) {
    background-color: var(--color-primary-light-900-alpha-200);
    border-left-color: var(--color-primary-alpha-400);
  }
}

.playingDot {
  font-size: 9px;
  color: var(--color-primary);
  margin-right: 4px;
  flex: none;
}

.segmentTime {
  width: 46px;
  flex: none;
  font-variant-numeric: tabular-nums;
  color: var(--color-font-label);
}

.segmentActive .segmentTime {
  color: var(--color-primary);
}

.segmentTimeInput {
  width: 46px;
  flex: none;
  height: 20px;
  padding: 0 4px;
  border: 1px solid var(--color-primary);
  border-radius: 3px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--color-font);
  background-color: var(--color-main-background);
  outline: none;
}

.smallBtnDisabled {
  cursor: default;
  color: var(--color-font-label);
  border-color: var(--color-primary-light-200-alpha-500);
  opacity: 0.75;

  &:hover {
    background-color: transparent;
  }
}

.errorHint {
  margin-top: 8px;
  font-size: 11px;
  color: var(--color-btn-close);
}

.segmentKey {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.segmentRemove {
  flex: none;
  width: 20px;
  height: 20px;
  margin-left: 4px;
  padding: 0;
  border: none;
  border-radius: 3px;
  font-size: 14px;
  line-height: 1;
  color: var(--color-font-label);
  background-color: transparent;
  cursor: pointer;

  &:hover {
    color: var(--color-btn-close);
    background-color: var(--color-primary-light-800-alpha-500);
  }
}

.segmentActions {
  margin-top: 8px;
}

.smallBtn {
  padding: 4px 10px;
  border: 1px dashed var(--color-primary-alpha-400);
  border-radius: 4px;
  font-size: 12px;
  color: var(--color-primary);
  background-color: transparent;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background-color: var(--color-primary-light-800-alpha-300);
  }
}

.hint {
  margin-top: 8px;
  font-size: 11px;
  color: var(--color-font-label);
}

.sectionLabel {
  font-size: 12px;
  color: var(--color-font-label);
  margin-bottom: 8px;
}

.labelRow {
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 1;

  .sectionLabel {
    margin-bottom: 0;
    line-height: 1;
    display: inline-flex;
    align-items: center;
  }
}

.speedHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.speedValue {
  font-size: 13px;
  font-weight: bold;
  color: var(--color-primary);
  font-variant-numeric: tabular-nums;
}

.sliderRow {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.slider {
  width: 100%;
  height: 4px;
  border-radius: 2px;
  accent-color: var(--color-primary);
  cursor: pointer;
}

.speedNote {
  margin-top: 8px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-font-label);
  background-color: var(--color-primary-light-900-alpha-200);
  border-radius: 4px;
  padding: 6px 8px;
}

.quickSpeeds {
  display: flex;
  gap: 8px;
}

.quickBtn {
  flex: 1;
  padding: 3px 0;
  border: 1px solid var(--color-primary-light-800-alpha-400);
  background: transparent;
  color: var(--color-font-label);
  border-radius: 3px;
  font-size: 11px;
  cursor: pointer;
  transition: all .15s ease;

  &:hover {
    color: var(--color-primary);
    border-color: var(--color-primary);
  }

  &.quickActive {
    color: #fff;
    background-color: var(--color-primary);
    border-color: var(--color-primary);
    font-weight: bold;
  }
}

.currentBadge {
  font-weight: 600;
  font-size: 13px;
  color: var(--color-primary);
  display: inline-flex;
  align-items: center;
  line-height: 1;
}

.sourceTag {
  margin-left: 8px;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: normal;
  display: inline-flex;
  align-items: center;
  line-height: 1.4;

  &.user {
    color: #fff;
    background-color: var(--color-primary);
  }
  &.database {
    color: #fff;
    background-color: #2e7d32;
  }
  &.analysis {
    color: var(--color-font-label);
    background-color: var(--color-primary-light-900-alpha-300);
  }
}

.noteGrid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.noteBtn {
  padding: 6px 0;
  font-size: 12px;
  border: 1px solid var(--color-btn-border);
  background-color: var(--color-btn-background);
  color: var(--color-font);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  &.active {
    background-color: var(--color-primary);
    border-color: var(--color-primary);
    color: #fff;
    font-weight: bold;
  }
}

.scaleRow {
  display: flex;
  gap: 10px;
}

.scaleBtn {
  flex: 1;
  padding: 8px 0;
  font-size: 12px;
  border: 1px solid var(--color-btn-border);
  background-color: var(--color-btn-background);
  color: var(--color-font);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  &.active {
    background-color: var(--color-primary);
    border-color: var(--color-primary);
    color: #fff;
    font-weight: bold;
  }
}

.rememberLabel,
.syncPluginLabel {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-font);
  cursor: pointer;
}

.checkbox {
  cursor: pointer;
}

.footer {
  position: sticky;
  bottom: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  // 负外边距让吸底条铺满弹窗宽度，遮住滚上来的内容
  margin: 20px -20px 0;
  padding: 12px 20px 16px;
  background-color: var(--color-content-background);
  box-shadow: 0 -6px 10px -6px rgb(0 0 0 / 18%);
}

.footerBtns {
  display: flex;
  align-items: center;
  gap: 10px;
}

.btnPrimary {
  min-width: 90px;
}

.btnSecondary {
  min-width: 90px;
}
</style>
