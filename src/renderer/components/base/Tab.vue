<template>
  <ul :class="[$style.list, $style[align]]" role="tablist">
    <li v-for="(item, index) in list" :key="item[itemKey]" :class="$style.listItem" role="presentation">
      <button
        type="button" :class="[$style.label, { [$style.active]: modelValue == item[itemKey] }]"
        role="tab" :tabindex="index === activeIndex ? 0 : -1"
        :aria-label="item[itemLabel]" ignore-tip :aria-selected="modelValue == item[itemKey]"
        @click="handleToggle(item[itemKey])" @keydown="handleKeydown($event, index)"
      >{{ item[itemLabel] }}</button>
    </li>
  </ul>
</template>

<script>
import { computed } from '@common/utils/vueTools'

export default {
  props: {
    list: { type: Array, default: () => [] },
    align: { type: String, default: 'left' },
    itemKey: { type: String, default: 'id' },
    itemLabel: { type: String, default: 'label' },
    modelValue: { type: [String, Number], default: '' },
  },
  emits: ['update:modelValue', 'change'],
  setup(props, { emit }) {
    const activeIndex = computed(() => Math.max(0, props.list.findIndex(item => item[props.itemKey] == props.modelValue)))
    const handleToggle = id => {
      if (id == props.modelValue) return
      emit('update:modelValue', id)
      emit('change', id)
    }
    const handleKeydown = (event, index) => {
      let next
      switch (event.key) {
        case 'ArrowRight': next = (index + 1) % props.list.length; break
        case 'ArrowLeft': next = (index - 1 + props.list.length) % props.list.length; break
        case 'Home': next = 0; break
        case 'End': next = props.list.length - 1; break
        default: return
      }
      event.preventDefault()
      handleToggle(props.list[next][props.itemKey])
      event.currentTarget.closest('[role="tablist"]').querySelectorAll('[role="tab"]')[next]?.focus()
    }
    return { activeIndex, handleToggle, handleKeydown }
  },
}
</script>

<style lang="less" module>
.list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
  padding: 4px;
  border: 1px solid var(--ui-border);
  border-radius: 20px;
  background: var(--ui-canvas);
  max-width: 100%;
  &.left { justify-content: flex-start; }
  &.center { justify-content: center; }
  &.right { justify-content: flex-end; }
}
.listItem { display: block; min-width: 0; }
.label {
  display: block;
  padding: 6px 12px;
  min-height: 29px;
  border: 0;
  border-radius: 16px;
  background: transparent;
  color: var(--ui-muted);
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
  cursor: pointer;
  transition: background .2s var(--ui-ease), color .2s ease;
  &:hover { color: var(--ui-text); background: var(--ui-hover); }
  &.active { color: var(--color-primary-font); background: var(--ui-surface); box-shadow: 0 2px 6px rgba(0, 0, 0, .04); font-weight: 600; }
}
</style>
