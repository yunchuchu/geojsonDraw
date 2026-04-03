<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

const props = defineProps<{
  initialRegularizeThreshold?: number
  mode?: 'single' | 'batch'
  selectionCount?: number
}>()

const emit = defineEmits<{
  dragStart: [event: MouseEvent]
  togglePropertyPanel: []
  copy: []
  flatten: [threshold: number]
  remove: []
  finish: []
}>()

const isFlattenHovering = ref(false)
const regularizeThreshold = ref(props.initialRegularizeThreshold ?? 1)
const isPropertyPanelVisible = ref(false)
let flattenHoverCloseTimer: number | null = null

const FLATTEN_HOVER_CLOSE_DELAY_MS = 220
const workbenchMode = computed(() => props.mode ?? 'single')
const copyLabel = computed(() => (workbenchMode.value === 'batch' ? '批量复制' : '复制'))
const flattenLabel = computed(() => (workbenchMode.value === 'batch' ? '批量规整' : '规整'))
const dragLabel = computed(() => (workbenchMode.value === 'batch' ? '整体拖拽' : '拖拽'))
const removeLabel = computed(() => (workbenchMode.value === 'batch' ? '批量删除' : '删除'))
const finishLabel = computed(() => (workbenchMode.value === 'batch' ? '结束批量' : '完成'))
const propertyLabel = computed(() => (isPropertyPanelVisible.value ? '隐藏属性' : '属性'))

const clampThreshold = (value: number): number => Math.min(2, Math.max(0.05, value))

const clearFlattenHoverCloseTimer = (): void => {
  if (flattenHoverCloseTimer !== null) {
    window.clearTimeout(flattenHoverCloseTimer)
    flattenHoverCloseTimer = null
  }
}

const openFlattenPopover = (): void => {
  clearFlattenHoverCloseTimer()
  isFlattenHovering.value = true
}

const scheduleCloseFlattenPopover = (): void => {
  clearFlattenHoverCloseTimer()
  flattenHoverCloseTimer = window.setTimeout(() => {
    isFlattenHovering.value = false
    flattenHoverCloseTimer = null
  }, FLATTEN_HOVER_CLOSE_DELAY_MS)
}

const handleDragStart = (event: MouseEvent): void => {
  event.preventDefault()
  event.stopPropagation()
  emit('dragStart', event)
}

const handleCopy = (event: MouseEvent): void => {
  event.preventDefault()
  event.stopPropagation()
  emit('copy')
}

const handleTogglePropertyPanel = (event: MouseEvent): void => {
  event.preventDefault()
  event.stopPropagation()
  isPropertyPanelVisible.value = !isPropertyPanelVisible.value
  emit('togglePropertyPanel')
}

const handleFlatten = (event: MouseEvent): void => {
  event.preventDefault()
  event.stopPropagation()
  emit('flatten', regularizeThreshold.value)
}

const handleRemove = (event: MouseEvent): void => {
  event.preventDefault()
  event.stopPropagation()
  emit('remove')
}

const handleFinish = (event: MouseEvent): void => {
  event.preventDefault()
  event.stopPropagation()
  emit('finish')
}

const handleThresholdInput = (event: Event): void => {
  const target = event.target as HTMLInputElement | null
  const nextValue = Number(target?.value ?? regularizeThreshold.value)
  regularizeThreshold.value = clampThreshold(nextValue)
}

const stopPointerPropagation = (event: Event): void => {
  event.stopPropagation()
}

onBeforeUnmount(() => {
  clearFlattenHoverCloseTimer()
})
</script>

<template>
  <div class="surface-workbench">
    <button type="button" class="surface-workbench__action" :title="finishLabel" @click="handleFinish">
      {{ finishLabel }}
    </button>
    <div
      class="surface-workbench__flatten-wrap"
      @mouseenter="openFlattenPopover"
      @mouseleave="scheduleCloseFlattenPopover"
    >
      <div
        v-if="isFlattenHovering"
        class="surface-workbench__threshold-popover"
        @mousedown="stopPointerPropagation"
        @pointerdown="stopPointerPropagation"
        @touchstart="stopPointerPropagation"
      >
        <label class="surface-workbench__threshold-label">规整阈值：{{ regularizeThreshold.toFixed(2) }}</label>
        <input
          class="surface-workbench__threshold-slider"
          type="range"
          min="0.05"
          max="2"
          step="0.01"
          :value="regularizeThreshold"
          @input="handleThresholdInput"
          @click="stopPointerPropagation"
          @mousedown="stopPointerPropagation"
          @pointerdown="stopPointerPropagation"
          @touchstart="stopPointerPropagation"
        />
        <p class="surface-workbench__threshold-tip">提示：可多次点击“规整”逐步优化形状。</p>
      </div>
      <button type="button" class="surface-workbench__action" :title="flattenLabel" @click="handleFlatten">
        {{ flattenLabel }}
      </button>
    </div>
    <button
      type="button"
      class="surface-workbench__drag"
      aria-label="拖拽选中面"
      :title="dragLabel"
      @mousedown="handleDragStart"
    >
      {{ dragLabel }}
    </button>
    <button
      type="button"
      class="surface-workbench__action"
      :class="{ 'surface-workbench__action--active': isPropertyPanelVisible }"
      :title="propertyLabel"
      @click="handleTogglePropertyPanel"
    >
      {{ propertyLabel }}
    </button>
    <button type="button" class="surface-workbench__action" :title="copyLabel" @click="handleCopy">
      {{ copyLabel }}
    </button>
    <button
      type="button"
      class="surface-workbench__action surface-workbench__action--danger"
      :title="removeLabel"
      @click="handleRemove"
    >
      {{ removeLabel }}
    </button>
  </div>
</template>

<style scoped>
.surface-workbench {
  display: flex;
  align-items: center;
  gap: 8px;
}

.surface-workbench__action--active {
  border-color: rgba(59, 130, 246, 0.9);
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.2);
  color: #1d4ed8;
}

.surface-workbench__flatten-wrap {
  position: relative;
}

.surface-workbench__threshold-popover {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 12px);
  transform: translateX(-50%);
  width: 260px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.18);
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 20;
}

.surface-workbench__threshold-popover::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: -12px;
  width: 100%;
  height: 12px;
}

.surface-workbench__threshold-label {
  font-size: 12px;
  color: #334155;
}

.surface-workbench__threshold-slider {
  width: 100%;
}

.surface-workbench__threshold-tip {
  margin: 0;
  font-size: 11px;
  line-height: 1.3;
  color: #64748b;
  white-space: nowrap;
}
</style>
