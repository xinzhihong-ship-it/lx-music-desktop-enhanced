<template>
  <!-- 传了 ariaLabel 时把它同时挂到根元素：悬停提示（Tips 插件读 aria-label）是从被悬停
       的元素向上找的，只挂在勾选框那层的话，鼠标停在文字上时提示不会出现。 -->
  <div :class="[$style.checkbox, { [$style.toggle]: !need && typeof modelValue === 'boolean' && label != null }]" :aria-label="ariaLabel || null">
    <input
      :id="id" ref="dom_input" :type="need ? 'radio' : 'checkbox'" :aria-hidden="true" :checked="checked"
      :class="$style.input" :disabled="disabled" :value="value" :name="name" @input="handleInput($event.target.checked)"
    >
    <label :for="id" :class="$style.content">
      <div :class="$style.container" :role="need ? 'radio' : typeof modelValue === 'boolean' && label != null ? 'switch' : 'checkbox'" :tabindex="disabled ? -1 : 0" :aria-label="ariaLabel || label" :aria-checked="checked" :aria-disabled="disabled" @keydown.enter.space.stop.prevent="handleToggle">
        <svg version="1.1" :class="$style.icon" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" width="100%" viewBox="0 32 448 448" space="preserve">
          <use xlink:href="#icon-check-true" />
        </svg>
      </div>
      <slot v-if="label == null" />
      <span v-else :class="$style.label">
        {{ label }}
      </span>
    </label>
  </div>
</template>

<script>
export default {
  props: {
    modelValue: {
      type: [String, Boolean, Number, Array],
      required: true,
    },
    value: {
      type: [String, Boolean, Number, Array],
      default: undefined,
    },
    id: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      default: undefined,
    },
    need: {
      type: Boolean,
      default: false,
    },
    ariaLabel: {
      type: String,
      default: undefined,
    },
    label: {
      type: String,
      default: undefined,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['update:modelValue', 'change'],
  data() {
    return {
      checked: false,
    }
  },
  watch: {
    modelValue(n) {
      this.setValue(n)
    },
  },
  mounted() {
    this.setValue(this.modelValue)
  },
  methods: {
    handleInput(checked) {
      let modelValue
      if (Array.isArray(this.modelValue)) {
        modelValue = [...this.modelValue]
        if (checked) modelValue.push(this.value)
        else {
          const index = modelValue.indexOf(this.value)
          if (index > -1) modelValue.splice(index, 1)
        }
      } else {
        if (typeof this.modelValue == 'boolean') {
          modelValue = checked
        } else modelValue = checked ? this.value : ''
      }
      this.$emit('update:modelValue', modelValue)
      this.$emit('change', modelValue)
    },
    setValue(value) {
      let checked
      if (Array.isArray(value)) {
        checked = value.includes(this.value)
      } else {
        if (typeof this.modelValue == 'boolean') {
          checked = this.modelValue
        } else if (value == null) checked = this.modelValue != ''
        else checked = this.modelValue == this.value
      }
      // console.log(this.need, this.value, checked)
      // this.checked = this.need ? checked && this.value : checked
      if (this.checked == checked) return
      this.checked = checked
    },
    handleToggle(event) {
      if (this.disabled) return
      event.lx_handled = true
      if (this.need) {
        if (this.$refs.dom_input.checked) return
        this.$refs.dom_input.checked = true
        this.handleInput(true)
      } else {
        this.$refs.dom_input.checked = !this.$refs.dom_input.checked
        this.handleInput(this.$refs.dom_input.checked)
      }
    },
  },
}
</script>


<style lang="less" module>
.checkbox { display: inline-block; }
.input { display: none;
  &:disabled + .content { opacity: .45; .container, .label { cursor: not-allowed; } }
  &:checked + .content { .container { border-color: var(--color-primary); background: var(--ui-selected); } .icon { transform: scale(1); } }
}
.content { display: flex; align-items: center; gap: 8px; }
.container { position: relative; flex: none; width: 14px; height: 14px; border: 1px solid var(--color-font-label); border-radius: 4px; color: var(--color-primary-font); cursor: pointer; display: flex; transition: background .2s, border-color .2s; }
.icon { width: 100%; height: 100%; fill: currentColor; transform: scale(0); transition: transform .2s var(--ui-ease); }
.label { flex: auto; line-height: 1.6; cursor: pointer; }
.toggle {
  .container { width: 30px; height: 18px; border: 0; border-radius: 12px; background: var(--color-200);
    &:after { content: ''; width: 12px; height: 12px; border-radius: 50%; background: var(--ui-surface); position: absolute; left: 3px; top: 3px; box-shadow: 0 1px 3px rgba(0, 0, 0, .1); transition: transform .3s var(--ui-ease); }
  }
  .icon { display: none; }
  .input:checked + .content .container { background: var(--color-primary); &:after { transform: translateX(12px); } }
}
</style>
