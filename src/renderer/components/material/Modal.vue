<template>
  <teleport :to="teleport">
    <div v-if="showModal" ref="dom_container" :class="$style.container">
      <transition enter-active-class="animated fadeIn" leave-active-class="animated fadeOut">
        <div v-show="showContent" :class="[$style.modal, {[$style.filter]: filter}]" @click="bgClose && close()">
          <transition :enter-active-class="inClass" :leave-active-class="outClass" @after-enter="$emit('after-enter', $event)" @after-leave="handleAfterLeave">
            <div v-show="showContent" :class="$style.content" :style="contentStyle" @click.stop>
              <header v-if="!hideHeader" :class="$style.header">
                <button v-if="closeBtn" type="button" @click="close">
                  <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 212.982 212.982" space="preserve">
                    <use xlink:href="#icon-delete" />
                  </svg>
                </button>
              </header>
              <slot />
            </div>
          </transition>
        </div>
      </transition>
    </div>
  </teleport>
</template>

<script>
import { getRandom } from '@common/utils/common'
import { nextTick } from '@common/utils/vueTools'
import { appSetting } from '@renderer/store/setting'

let modalCount = 0
export default {
  props: {
    show: {
      type: Boolean,
      default: false,
    },
    closeBtn: {
      type: Boolean,
      default: true,
    },
    hideHeader: {
      type: Boolean,
      default: false,
    },
    bgClose: {
      type: Boolean,
      default: false,
    },
    teleport: {
      type: String,
      default: '#root',
    },
    maxWidth: {
      type: String,
      default: '76%',
    },
    minWidth: {
      type: String,
      default: '280px',
    },
    maxHeight: {
      type: String,
      default: '76%',
    },
    width: {
      type: String,
      default: 'auto',
    },
    height: {
      type: String,
      default: 'auto',
    },
  },
  emits: ['after-enter', 'after-leave', 'close'],
  data() {
    return {
      animates: [
        [['jackInTheBox', 'flipInX', 'flipInY', 'lightSpeedIn'], ['flipOutX', 'flipOutY', 'lightSpeedOut']],
        // [['jackInTheBox', 'lightSpeedIn'], ['lightSpeedOut']],
        [['rotateInDownLeft', 'rotateInDownRight', 'rotateInUpLeft', 'rotateInUpRight'], ['rotateOutDownLeft', 'rotateOutDownRight', 'rotateOutUpLeft', 'rotateOutUpRight']],
        [['jackInTheBox', 'zoomInDown', 'zoomInUp'], ['zoomOutDown', 'zoomOutUp']],
        [['slideInDown', 'slideInLeft', 'slideInRight', 'slideInUp'], ['slideOutDown', 'slideOutLeft', 'slideOutRight', 'slideOutUp']],

        // ['flipInX', 'flipOutX'],
        // ['flipInY', 'flipOutY'],
        // ['lightSpeedIn', 'lightSpeedOut'],
        // ['rotateInDownLeft', 'rotateOutDownLeft'],
        // ['rotateInDownRight', 'rotateOutDownRight'],
        // ['rotateInUpLeft', 'rotateOutUpLeft'],
        // ['rotateInUpRight', 'rotateOutUpRight'],
        // // ['rollIn', 'rollOut'],
        // // ['zoomIn', 'zoomOut'],
        // ['zoomInDown', 'zoomOutDown'],
        // // ['zoomInLeft', 'zoomOutLeft'],
        // // ['zoomInRight', 'zoomOutRight'],
        // ['zoomInUp', 'zoomOutUp'],
        // ['slideInDown', 'slideOutDown'],
        // ['slideInLeft', 'slideOutLeft'],
        // ['slideInRight', 'slideOutRight'],
        // ['slideInUp', 'slideOutUp'],
        // // ['jackInTheBox', 'hinge'],
      ],
      // animateIn: [
      //   'flipInX',
      //   'flipInY',
      //   // 'fadeIn',
      //   // 'bounceIn',
      //   'lightSpeedIn',
      //   'rotateInDownLeft',
      //   'rotateInDownRight',
      //   'rotateInUpLeft',
      //   'rotateInUpRight',
      //   'rollIn',
      //   'zoomIn',
      //   'zoomInDown',
      //   'zoomInLeft',
      //   'zoomInRight',
      //   'zoomInUp',
      //   'slideInDown',
      //   'slideInLeft',
      //   'slideInRight',
      //   'slideInUp',
      //   'jackInTheBox',
      // ],
      // animateOut: [
      //   'flipOutX',
      //   'flipOutY',
      //   // 'fadeOut',
      //   // 'bounceOut',
      //   'lightSpeedOut',
      //   'rotateOutDownLeft',
      //   'rotateOutDownRight',
      //   'rotateOutUpLeft',
      //   'rotateOutUpRight',
      //   'rollOut',
      //   'zoomOut',
      //   'zoomOutDown',
      //   'zoomOutLeft',
      //   'zoomOutRight',
      //   'zoomOutUp',
      //   'slideOutDown',
      //   'slideOutLeft',
      //   'slideOutRight',
      //   'slideOutUp',
      //   'hinge',
      // ],
      inClass: 'animated jackInTheBox',
      outClass: 'animated slideOutRight',
      showModal: false,
      showContent: false,
      modalCount: false,
      isAddedClass: false,
      // ai: 0,
    }
  },
  computed: {
    contentStyle() {
      return {
        maxWidth: this.maxWidth,
        minWidth: this.minWidth,
        width: this.width,
        height: this.height,
        maxHeight: this.maxHeight,
      }
    },
    filter() {
      return this.teleport == '#root' || this.modalCount > 1
    },
  },
  watch: {
    show(val) {
      this.handleShowChange(val)
    },
  },
  mounted() {
    if (this.show) this.handleShowChange(true)
    this.setRandomAnimation()
  },
  beforeUnmount() {
    this.removeClass()
  },
  methods: {
    handleShowChange(val) {
      if (val) {
        // const dom = document.getElementById(this.teleport)
        // if (dom) {
        //   // dom.t
        // }
        this.setRandomAnimation()
        this.modalCount = ++modalCount
        this.showModal = true
        void nextTick(() => {
          const node = this.$refs.dom_container.parentNode
          if (!node.classList.contains('show-modal')) {
            node.classList.add('show-modal')
            this.isAddedClass = true
          }
          this.showContent = true
        })
      } else {
        if (modalCount > 0) this.modalCount = --modalCount
        this.removeClass()
        this.showContent = false
      }
    },
    removeClass() {
      if (!this.isAddedClass) return
      this.$refs.dom_container?.parentNode.classList.remove('show-modal')
    },
    setRandomAnimation() {
      if (appSetting['common.randomAnimate']) {
        const [animIn, animOut] = this.animates[getRandom(0, this.animates.length)]
        // const [animIn, animOut] = this.animates[this.ai]
        // if (++this.ai >= this.animates.length) this.ai = 0
        // console.log(animIn, animOut)
        // this.inClass = 'animated ' + animIn
        // this.outClass = 'animated ' + animOut
        this.inClass = 'animated ' + animIn[getRandom(0, animIn.length)]
        this.outClass = 'animated ' + animOut[getRandom(0, animOut.length)]
      }
    },
    close() {
      this.$emit('close')
    },
    handleAfterLeave(event) {
      this.$emit('after-leave', event)
      this.showModal = false
    },
  },
}
</script>


<style lang="less" module>
.container { position: absolute; inset: 0; z-index: 1001; }
.modal { width: 100%; height: 100%; display: grid; align-items: center; justify-items: center; background: rgba(15, 25, 18, .2); &.filter { backdrop-filter: blur(4px); } }
.content { position: relative; display: flex; flex-direction: column; min-width: 220px; border: 1px solid var(--ui-border); border-radius: 18px; box-shadow: var(--ui-shadow); overflow: hidden; z-index: 100; background: var(--ui-surface); }
.header { flex: none; display: flex; align-items: center; justify-content: flex-end; height: 30px; padding: 4px 7px; box-sizing: border-box;
  button { display: flex; justify-content: center; align-items: center; width: 24px; height: 24px; border: 0; border-radius: 50%; padding: 7px; background: transparent; color: var(--ui-muted); cursor: pointer;
    svg { width: 100%; height: 100%; } &:hover { color: var(--ui-text); background: var(--ui-hover); }
  }
}
</style>
