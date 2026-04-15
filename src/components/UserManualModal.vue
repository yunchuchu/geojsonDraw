<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '../utils/markdown'

const props = defineProps<{
  open: boolean
  title?: string
  markdown: string
}>()

const emit = defineEmits<{
  close: []
}>()

const manualHtml = computed(() => renderMarkdown(props.markdown))
</script>

<template>
  <div v-if="open" class="manual-backdrop" @click.self="emit('close')">
    <section class="manual-modal" aria-label="用户操作手册">
      <header class="manual-modal__header">
        <div>
          <p class="manual-modal__eyebrow">帮助文档</p>
          <h2>{{ title ?? '用户操作手册' }}</h2>
        </div>
        <button type="button" class="manual-modal__close" aria-label="关闭操作手册" @click="emit('close')">
          ×
        </button>
      </header>

      <div class="manual-modal__body">
        <article class="manual-content" v-html="manualHtml"></article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.manual-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1800;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.36);
  backdrop-filter: blur(6px);
}

.manual-modal {
  width: min(960px, calc(100vw - 32px));
  max-height: min(88vh, 920px);
  overflow: hidden;
  border-radius: 24px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.96)),
    #fff;
  box-shadow:
    0 28px 80px rgba(15, 23, 42, 0.24),
    0 0 0 1px rgba(255, 255, 255, 0.5) inset;
}

.manual-modal__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 24px 24px 18px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.9);
}

.manual-modal__header h2 {
  margin: 4px 0 0;
  font-size: 24px;
  line-height: 1.2;
  color: #0f172a;
}

.manual-modal__eyebrow {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #2563eb;
}

.manual-modal__close {
  border: none;
  background: rgba(241, 245, 249, 0.9);
  color: #0f172a;
  width: 40px;
  height: 40px;
  border-radius: 999px;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}

.manual-modal__body {
  overflow: auto;
  max-height: calc(88vh - 92px);
  padding: 24px;
}

.manual-content :deep(h1),
.manual-content :deep(h2),
.manual-content :deep(h3) {
  color: #0f172a;
  line-height: 1.25;
}

.manual-content :deep(h1) {
  margin: 0 0 18px;
  font-size: 28px;
}

.manual-content :deep(h2) {
  margin: 28px 0 12px;
  padding-top: 8px;
  font-size: 20px;
  border-top: 1px solid rgba(226, 232, 240, 0.9);
}

.manual-content :deep(h3) {
  margin: 18px 0 10px;
  font-size: 16px;
}

.manual-content :deep(p) {
  margin: 0 0 12px;
  color: #334155;
  line-height: 1.75;
}

.manual-content :deep(ul),
.manual-content :deep(ol) {
  margin: 0 0 14px;
  padding-left: 22px;
  color: #334155;
}

.manual-content :deep(li) {
  margin: 6px 0;
  line-height: 1.7;
}

.manual-content :deep(code) {
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(226, 232, 240, 0.7);
  color: #0f172a;
  font-size: 0.92em;
}

.manual-content :deep(a) {
  color: #1d4ed8;
}

@media (max-width: 720px) {
  .manual-backdrop {
    padding: 12px;
  }

  .manual-modal {
    width: 100%;
    max-height: 92vh;
    border-radius: 18px;
  }

  .manual-modal__header,
  .manual-modal__body {
    padding: 18px;
  }

  .manual-modal__header h2 {
    font-size: 20px;
  }

  .manual-content :deep(h1) {
    font-size: 24px;
  }

  .manual-content :deep(h2) {
    font-size: 18px;
  }
}
</style>
