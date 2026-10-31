<template>
  <div class="content" :class="[$style.select, show ? $style.active : '']">
    <div ref="dom_btn" class="label-content" :class="$style.label" role="combobox" aria-haspopup="listbox" tabindex="0" :aria-label="$attrs['aria-label']" :aria-expanded="show" :aria-controls="`${listId}-list`" :aria-activedescendant="show && highlightedIndex >= 0 ? `${listId}-${highlightedIndex}` : undefined" @click="handleShow" @keydown="handleKeydown" @blur="handleHide()">
      <span class="label">{{ label }}</span>
      <div class="icon" :class="$style.icon">
        <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 451.847 451.847" space="preserve">
          <use xlink:href="#icon-down" />
        </svg>
      </div>
    </div>
    <ul v-if="show" :id="`${listId}-list`" ref="dom_list" role="listbox" class="selection-list scroll" :class="$style.list" :style="listStyles">
      <li
        v-for="(item, index) in list" :id="`${listId}-${index}`" :key="index" role="option" :aria-selected="(itemKey ? item[itemKey] : item) == modelValue" :class="[$style.listItem, (itemKey ? item[itemKey] : item) == modelValue ? $style.active : null, index === highlightedIndex ? $style.highlighted : null]"
        :aria-label="itemName ? item[itemName] : item" @mousedown.prevent @mousemove="highlightedIndex = index" @click="handleClick(item)"
      >
        {{ itemName ? item[itemName] : item }}
      </li>
    </ul>
  </div>
</template>

<script>
let nextSelectionId = 0

export default {
  props: {
    list: {
      type: Array,
      default() {
        return []
      },
    },
    modelValue: {
      type: [String, Number],
      required: true,
    },
    itemName: {
      type: String,
      default: '',
    },
    itemKey: {
      type: String,
      default: '',
    },
  },
  emits: ['update:modelValue', 'change'],
  data() {
    return {
      show: false,
      highlightedIndex: -1,
      listId: `lx-selection-${++nextSelectionId}`,
      listStyles: {
        transform: 'scaleY(0) translateY(0)',
      },
    }
  },
  computed: {
    activeIndex() {
      if (this.modelValue == null) return -1
      if (!this.itemName) return this.list.indexOf(this.modelValue)
      return this.list.findIndex(l => l[this.itemKey] == this.modelValue)
    },
    label() {
      if (this.modelValue == null) return ''
      if (!this.itemName) return this.modelValue
      const item = this.list[this.activeIndex]
      if (!item) return ''
      return item[this.itemName]
    },
  },
  mounted() {
    document.addEventListener('click', this.handleHide, true)
  },
  beforeUnmount() {
    document.removeEventListener('click', this.handleHide, true)
  },
  methods: {
    handleHide(e) {
      if (!this.show) return
      if (e && (this.$refs.dom_btn.contains(e.target) || this.$refs.dom_list?.contains(e.target))) return
      this.show = false
      this.listStyles.transform = 'scaleY(0) translateY(0)'
    },
    handleClick(item) {
      const value = this.itemKey ? item[this.itemKey] : item
      this.handleHide()
      if (value === this.modelValue) return
      this.$emit('update:modelValue', value)
      this.$emit('change', item)
    },
    handleKeydown(event) {
      const { key } = event
      if (key === 'Tab') { this.handleHide(); return }
      if (key === 'Escape') { event.stopPropagation(); this.handleHide(); return }
      if (!['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) return
      event.preventDefault()
      if (key === 'Enter' || key === ' ') {
        if (this.show && this.highlightedIndex >= 0) this.handleClick(this.list[this.highlightedIndex])
        else this.handleShow()
        return
      }
      const wasOpen = this.show
      if (!wasOpen) this.handleShow()
      if (key === 'Home') this.highlightedIndex = 0
      else if (key === 'End') this.highlightedIndex = this.list.length - 1
      else if (wasOpen) this.highlightedIndex = Math.max(0, Math.min(this.list.length - 1, this.highlightedIndex + (key === 'ArrowDown' ? 1 : -1)))
      this.$nextTick(() => this.$refs.dom_list?.children[this.highlightedIndex]?.scrollIntoView({ block: 'nearest' }))
    },
    handleShow() {
      this.show = true
      this.highlightedIndex = this.activeIndex >= 0 ? this.activeIndex : this.list.length ? 0 : -1
      this.$nextTick(() => {
        if (!this.show || !this.$refs.dom_list) return
        this.listStyles.transform = `scaleY(1) translateY(${this.handleGetOffset()}px)`

        const activeItem = this.$refs.dom_list.children[this.activeIndex]
        if (activeItem) this.$refs.dom_list.scrollTop = activeItem.offsetTop - this.$refs.dom_list.clientHeight * 0.38
      })
    },
    handleGetOffset() {
      const listHeight = this.$refs.dom_list.clientHeight
      const dom_select = this.$refs.dom_list.offsetParent
      const dom_container = dom_select.offsetParent
      const containerHeight = dom_container.clientHeight
      if (containerHeight < listHeight) return 0
      const offsetHeight = (dom_container.scrollTop + containerHeight) - (dom_select.offsetTop + listHeight)
      if (offsetHeight > 0) return 0
      return offsetHeight - 5
    },
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

@selection-height: 32px;

.select {
  display: inline-block;
  font-size: 12px;
  position: relative;
  width: var(--selection-width, 300px);

  &.active {
    .label {
      background-color: var(--color-button-background);
    }
    .list {
      opacity: 1;
    }
    .icon {
      svg{
        transform: rotate(180deg);
      }
    }
  }
}

.label {
  border: 1px solid var(--ui-border);
  background-color: var(--ui-canvas);
  padding: 0 11px;
  transition: background-color @transition-normal;
  height: @selection-height;
  // line-height: 27px;
  line-height: 1.5;
  box-sizing: border-box;
  color: var(--color-button-font);
  border-radius: @form-radius;
  cursor: pointer;
  display: flex;
  align-items: center;

  span {
    flex: auto;
    .mixin-ellipsis-1();
  }
  .icon {
    flex: none;
    margin-left: 7px;
    line-height: 0;
    svg {
      width: 1em;
      transition: transform .2s ease;
      transform: rotate(0);
    }
  }

  &:hover {
    background-color: var(--color-button-background-hover);
  }
  &:active {
    background-color: var(--color-button-background-active);
  }
}

.list {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  background-color: var(--color-content-background);
  opacity: 0;
  transform: scaleY(0) translateY(0);
  transform-origin: 0 (@selection-height / 2) 0;
  transition: .25s ease;
  transition-property: transform, opacity;
  z-index: 10;
  border-radius: @form-radius;
  border: 1px solid var(--ui-border);
  padding: 4px;
  box-sizing: border-box;
  box-shadow: var(--ui-shadow);
  overflow: auto;
  max-height: 200px;
}
.listItem {
  cursor: pointer;
  padding: 0 10px;
  line-height: @selection-height;
  // color: var(--color-button-font);
  outline: none;
  transition: background-color @transition-normal;
  background-color: transparent;
  box-sizing: border-box;
  .mixin-ellipsis-1();

  &:hover, &.highlighted {
    background-color: var(--color-button-background-hover);
  }
  &:active {
    background-color: var(--color-button-background-active);
  }
  &.active {
    color: var(--color-button-font);
  }
}


</style>
