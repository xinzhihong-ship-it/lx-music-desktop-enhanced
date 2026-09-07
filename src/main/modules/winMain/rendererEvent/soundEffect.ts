import { STORE_NAMES } from '@common/constants'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { mainOn, mainHandle } from '@common/mainIpc'
import getStore from '@main/utils/store'

const MAX_PRESETS = 31
const MAX_NAME_LENGTH = 20
const filterSources = new Set([
  'bright-hall.wav',
  'cardiod-35-10-spread.wav',
  'cinema-diningroom.wav',
  'dining-living-true-stereo.wav',
  'feedback-spring.wav',
  'filter-telephone.wav',
  'living-bedroom-leveled.wav',
  'matrix-reverb1.wav',
  'matrix-reverb2.wav',
  'medium-room1.wav',
  's2_r4_bd.wav',
  's3_r1_bd.wav',
  'spreader50-65ms.wav',
  'tim-omni-35-10-magnetic.wav',
])
const isBoundedText = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= MAX_NAME_LENGTH && !/[\0\r\n]/.test(value)
const isFiniteGain = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= -15 && value <= 15
const normalizeEqPresets = (value: unknown): LX.SoundEffect.EQPreset[] => {
  if (!Array.isArray(value)) return []
  return value.filter((preset): preset is LX.SoundEffect.EQPreset => (
    preset != null &&
    isBoundedText(preset.id) &&
    isBoundedText(preset.name) &&
    ['hz31', 'hz62', 'hz125', 'hz250', 'hz500', 'hz1000', 'hz2000', 'hz4000', 'hz8000', 'hz16000'].every(key => isFiniteGain(preset[key as keyof LX.SoundEffect.EQPreset]))
  )).slice(0, MAX_PRESETS)
}
const normalizeConvolutionPresets = (value: unknown): LX.SoundEffect.ConvolutionPreset[] => {
  if (!Array.isArray(value)) return []
  return value.filter((preset): preset is LX.SoundEffect.ConvolutionPreset => (
    preset != null &&
    isBoundedText(preset.id) &&
    isBoundedText(preset.name) &&
    typeof preset.source === 'string' &&
    filterSources.has(preset.source) &&
    typeof preset.mainGain === 'number' && Number.isFinite(preset.mainGain) && preset.mainGain >= 0 && preset.mainGain <= 50 &&
    typeof preset.sendGain === 'number' && Number.isFinite(preset.sendGain) && preset.sendGain >= 0 && preset.sendGain <= 50
  )).slice(0, MAX_PRESETS)
}

export default () => {
  mainHandle<LX.SoundEffect.EQPreset[]>(WIN_MAIN_RENDERER_EVENT_NAME.get_sound_effect_eq_preset, async() => {
    return normalizeEqPresets(getStore(STORE_NAMES.SOUND_EFFECT).get('eqPreset'))
  })
  mainOn<LX.SoundEffect.EQPreset[]>(WIN_MAIN_RENDERER_EVENT_NAME.save_sound_effect_eq_preset, ({ params }) => {
    getStore(STORE_NAMES.SOUND_EFFECT).set('eqPreset', normalizeEqPresets(params))
  })

  mainHandle<LX.SoundEffect.ConvolutionPreset[]>(WIN_MAIN_RENDERER_EVENT_NAME.get_sound_effect_convolution_preset, async() => {
    return normalizeConvolutionPresets(getStore(STORE_NAMES.SOUND_EFFECT).get('convolutionPreset'))
  })
  mainOn<LX.SoundEffect.ConvolutionPreset[]>(WIN_MAIN_RENDERER_EVENT_NAME.save_sound_effect_convolution_preset, ({ params }) => {
    getStore(STORE_NAMES.SOUND_EFFECT).set('convolutionPreset', normalizeConvolutionPresets(params))
  })

  // mainHandle<LX.SoundEffect.PitchShifterPreset[]>(WIN_MAIN_RENDERER_EVENT_NAME.get_sound_effect_pitch_shifter_preset, async() => {
  //   return getStore(STORE_NAMES.SOUND_EFFECT).get('pitchShifterPreset') as LX.SoundEffect.PitchShifterPreset[] | null ?? []
  // })
  // mainOn<LX.SoundEffect.PitchShifterPreset[]>(WIN_MAIN_RENDERER_EVENT_NAME.save_sound_effect_pitch_shifter_preset, ({ params }) => {
  //   getStore(STORE_NAMES.SOUND_EFFECT).set('pitchShifterPreset', params)
  // })
}
