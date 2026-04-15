<script setup lang="ts">
defineProps<{
  label?: string
}>()

const emit = defineEmits<{
  click: []
}>()
</script>

<template>
  <button type="button" class="manual-button" @click="emit('click')">
    <span class="manual-button__dot" aria-hidden="true"></span>
    {{ label ?? '使用说明' }}
  </button>
</template>

<style scoped>
.manual-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 999px;
  padding: 0 10px 0 8px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.76), rgba(248, 250, 252, 0.82));
  color: rgba(15, 23, 42, 0.78);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.01em;
  box-shadow:
    0 8px 20px rgba(15, 23, 42, 0.08),
    0 0 0 1px rgba(255, 255, 255, 0.22) inset;
  backdrop-filter: blur(18px) saturate(150%);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
  cursor: pointer;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    background 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease;
}

.manual-button__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.72);
  box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.08);
}

.manual-button:hover {
  transform: translateY(-1px);
  border-color: rgba(59, 130, 246, 0.22);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.88), rgba(248, 250, 252, 0.9));
  color: rgba(15, 23, 42, 0.92);
  box-shadow:
    0 10px 22px rgba(15, 23, 42, 0.1),
    0 0 0 1px rgba(255, 255, 255, 0.26) inset;
}

.manual-button:focus-visible {
  outline: 3px solid rgba(147, 197, 253, 0.6);
  outline-offset: 2px;
}
</style>
