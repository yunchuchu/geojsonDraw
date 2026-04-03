<script setup lang="ts">
import { computed, ref } from 'vue'

type QuickPropertyKey =
  | 'height'
  | 'name'
  | 'adcode'
  | 'citycode'
  | 'fullAddress'
  | 'streetNumber'
  | 'communityName'

type QuickPropertyValues = Record<QuickPropertyKey, string>

type CustomPropertyRow = {
  id: string
  key: string
  value: string
}

const props = defineProps<{
  mode: 'single' | 'batch'
  targetCount: number
  quickValues: QuickPropertyValues
  customRows: CustomPropertyRow[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  updateQuickValue: [key: QuickPropertyKey, value: string]
  updateCustomRows: [rows: CustomPropertyRow[]]
  apply: []
  reset: []
}>()

const pendingCustomKey = ref('')
const pendingCustomValue = ref('')

const quickFields: Array<{ key: QuickPropertyKey; label: string; placeholder: string }> = [
  { key: 'height', label: 'height', placeholder: '例如 12.5' },
  { key: 'name', label: 'name', placeholder: '建筑名称' },
  { key: 'adcode', label: 'adcode', placeholder: '行政区编码' },
  { key: 'citycode', label: 'citycode', placeholder: '城市编码' },
  { key: 'fullAddress', label: 'fullAddress', placeholder: '完整地址' },
  { key: 'streetNumber', label: 'streetNumber', placeholder: '街道门牌' },
  { key: 'communityName', label: 'communityName', placeholder: '小区名称' },
]

const applyLabel = computed(() => (props.mode === 'batch' ? `批量应用到 ${props.targetCount} 个建筑面` : '保存到当前建筑面'))

const panelTitle = computed(() => (props.mode === 'batch' ? '建筑面属性批量设置' : '建筑面属性设置'))

const handleQuickInput = (key: QuickPropertyKey, event: Event): void => {
  const target = event.target as HTMLInputElement | null
  emit('updateQuickValue', key, target?.value ?? '')
}

const updateCustomRow = (rowId: string, patch: Partial<Pick<CustomPropertyRow, 'key' | 'value'>>): void => {
  const nextRows = props.customRows.map((row) =>
    row.id === rowId
      ? {
          ...row,
          ...patch,
        }
      : row,
  )
  emit('updateCustomRows', nextRows)
}

const removeCustomRow = (rowId: string): void => {
  emit(
    'updateCustomRows',
    props.customRows.filter((row) => row.id !== rowId),
  )
}

const appendCustomRow = (): void => {
  const key = pendingCustomKey.value.trim()
  const value = pendingCustomValue.value.trim()
  if (!key || !value) return

  emit('updateCustomRows', [
    ...props.customRows,
    {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      key,
      value,
    },
  ])
  pendingCustomKey.value = ''
  pendingCustomValue.value = ''
}

const handlePendingCustomKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Enter') {
    event.preventDefault()
    appendCustomRow()
  }
}

const isAddCustomDisabled = computed(
  () =>
    props.disabled ||
    !pendingCustomKey.value.trim() ||
    !pendingCustomValue.value.trim(),
)
</script>

<template>
  <aside class="surface-property-panel" aria-label="建筑面属性设置">
    <header class="surface-property-panel__header">
      <h3>{{ panelTitle }}</h3>
      <button type="button" class="panel-action-link" :disabled="disabled" @click="emit('reset')">重置</button>
    </header>

    <table class="surface-property-table">
      <tbody>
        <tr v-for="field in quickFields" :key="field.key">
          <th>{{ field.label }}</th>
          <td>
            <input
              :value="quickValues[field.key]"
              :placeholder="field.placeholder"
              :disabled="disabled"
              type="text"
              @input="handleQuickInput(field.key, $event)"
            />
          </td>
        </tr>

        <tr v-for="row in customRows" :key="row.id">
          <th>
            <input
              :value="row.key"
              placeholder="自定义属性名"
              :disabled="disabled"
              type="text"
              @input="
                updateCustomRow(row.id, {
                  key: ($event.target as HTMLInputElement).value,
                })
              "
            />
          </th>
          <td class="custom-row-value">
            <input
              :value="row.value"
              placeholder="属性值"
              :disabled="disabled"
              type="text"
              @input="
                updateCustomRow(row.id, {
                  value: ($event.target as HTMLInputElement).value,
                })
              "
            />
            <button
              type="button"
              class="table-icon-btn table-icon-btn--danger"
              :disabled="disabled"
              @click="removeCustomRow(row.id)"
            >
              删
            </button>
          </td>
        </tr>

        <tr class="add-custom-row">
          <th>
            <input
              v-model="pendingCustomKey"
              placeholder="新增属性名"
              :disabled="disabled"
              type="text"
              @keydown="handlePendingCustomKeydown"
            />
          </th>
          <td class="custom-row-value">
            <input
              v-model="pendingCustomValue"
              placeholder="新增属性值"
              :disabled="disabled"
              type="text"
              @keydown="handlePendingCustomKeydown"
            />
            <button
              type="button"
              class="table-icon-btn"
              :disabled="isAddCustomDisabled"
              @click="appendCustomRow"
            >
              新增
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <button type="button" class="btn btn-primary property-apply-btn" :disabled="disabled" @click="emit('apply')">
      {{ applyLabel }}
    </button>
  </aside>
</template>

<style scoped>
.surface-property-panel {
  width: min(380px, calc(100vw - 32px));
  padding: 10px;
  border-radius: 14px;
  border: 1px solid rgba(191, 219, 254, 0.92);
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.95), rgba(248, 250, 252, 0.96));
  box-shadow:
    0 18px 38px rgba(15, 23, 42, 0.16),
    0 0 0 1px rgba(148, 163, 184, 0.16);
  pointer-events: auto;
}

.surface-property-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.surface-property-panel__header h3 {
  margin: 0;
  font-size: 14px;
  color: #0f172a;
}

.panel-action-link {
  border: none;
  padding: 0;
  background: transparent;
  font-size: 12px;
  color: #2563eb;
  cursor: pointer;
}

.panel-action-link:disabled {
  color: #94a3b8;
  cursor: default;
}

.surface-property-table {
  margin-top: 8px;
  width: 100%;
  border-collapse: collapse;
}

.surface-property-table th,
.surface-property-table td {
  border-bottom: 1px solid rgba(226, 232, 240, 0.9);
  padding: 6px 0;
  vertical-align: middle;
}

.surface-property-table th {
  width: 130px;
  padding-right: 8px;
  font-size: 12px;
  font-weight: 500;
  color: #475569;
  text-align: left;
}

.surface-property-table td {
  font-size: 12px;
}

.surface-property-table input {
  width: 100%;
  box-sizing: border-box;
  height: 28px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.5);
  padding: 0 8px;
  font-size: 12px;
  color: #0f172a;
  background: rgba(255, 255, 255, 0.9);
}

.surface-property-table input:focus {
  outline: none;
  border-color: rgba(59, 130, 246, 0.9);
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.2);
}

.custom-row-value {
  display: flex;
  align-items: center;
  gap: 6px;
}

.table-icon-btn {
  flex: 0 0 auto;
  border: 1px solid rgba(148, 163, 184, 0.45);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.9);
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  color: #334155;
  cursor: pointer;
}

.table-icon-btn--danger {
  color: #b91c1c;
  border-color: rgba(248, 113, 113, 0.55);
}

.table-icon-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.add-custom-row th,
.add-custom-row td {
  border-bottom: none;
}

.property-apply-btn {
  margin-top: 10px;
  width: 100%;
  border-radius: 10px;
  height: 34px;
}
</style>
