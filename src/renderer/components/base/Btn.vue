<template>
  <button
    :class="[$style.btn, {[$style.min]: min}, {[$style.outline]: outline}]"
    type="button"
    tabindex="0"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>

<script>
export default {
  props: {
    min: {
      type: Boolean,
    },
    outline: {
      type: Boolean,
      default: false,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
  },
}
</script>


<style lang="less" module>
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 34px; padding: 8px 16px; border: 1px solid var(--ui-border); border-radius: 18px; background: var(--color-button-background); color: var(--color-button-font); font-size: 12px; line-height: 1.4; cursor: pointer; transition: background .2s ease, transform .2s var(--ui-ease), border-color .2s;
  &:hover:not(:disabled) { background: var(--color-button-background-hover); border-color: var(--color-primary-alpha-600); }
  &:active:not(:disabled) { background: var(--color-button-background-active); transform: translateY(1px); }
  &:disabled { opacity: .4; }
  &.outline { background: transparent; }
}
.min { min-height: 25px; padding: 4px 10px; font-size: 11px; }
</style>
