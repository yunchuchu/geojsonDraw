<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import L from 'leaflet'
import 'leaflet-draw'

const amapKey = import.meta.env.VITE_AMAP_KEY as string | undefined
const mapContainer = ref<HTMLElement | null>(null)
const searchQuery = ref('')
const isSearching = ref(false)
const searchError = ref('')
const geojsonText = ref(
  JSON.stringify(
    {
      type: 'FeatureCollection',
      features: [],
    },
    null,
    2,
  ),
)
const feedback = ref('请在地图中使用工具栏绘制点或面，右上角可导出 GeoJSON。')

const isExportModalOpen = ref(false)
const showGeojsonText = ref(false)

let map: L.Map | null = null
let featureGroup: L.FeatureGroup | null = null

const parsedFeatureCollection = computed(() => {
  try {
    return JSON.parse(geojsonText.value) as GeoJSON.FeatureCollection
  } catch {
    return { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection
  }
})

const featureCount = computed(() => parsedFeatureCollection.value.features.length)
const pointCount = computed(
  () =>
    parsedFeatureCollection.value.features.filter(
      (feature) => feature.geometry?.type === 'Point',
    ).length,
)
const polygonCount = computed(
  () =>
    parsedFeatureCollection.value.features.filter(
      (feature) => feature.geometry?.type === 'Polygon',
    ).length,
)

const syncGeojson = (): void => {
  if (!featureGroup) return
  geojsonText.value = JSON.stringify(
    featureGroup.toGeoJSON() as GeoJSON.FeatureCollection,
    null,
    2,
  )
}

const copyGeojson = async (): Promise<void> => {
  if (!featureCount.value) {
    feedback.value = '当前没有可复制的要素，请先绘制。'
    return
  }

  try {
    await navigator.clipboard.writeText(geojsonText.value)
    feedback.value = 'GeoJSON 已复制到剪贴板。'
  } catch {
    feedback.value = '复制失败，请手动复制右侧文本内容。'
  }
}

const downloadGeojson = (): void => {
  if (!featureCount.value) {
    feedback.value = '当前没有可下载的要素，请先绘制。'
    return
  }

  const blob = new Blob([geojsonText.value], { type: 'application/geo+json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `features-${Date.now()}.geojson`
  anchor.click()
  URL.revokeObjectURL(url)
  feedback.value = 'GeoJSON 文件已开始下载。'
}

const clearAll = (): void => {
  if (!featureGroup) return
  featureGroup.clearLayers()
  syncGeojson()
  feedback.value = '已清空全部要素。'
}

const closeExportModal = (): void => {
  isExportModalOpen.value = false
}

const toggleGeojsonText = (): void => {
  showGeojsonText.value = !showGeojsonText.value
}

const handleSearch = async (): Promise<void> => {
  const query = searchQuery.value.trim()
  searchError.value = ''

  if (!query) {
    searchError.value = '请输入要搜索的地名或地址。'
    return
  }

  if (!amapKey) {
    searchError.value = '未配置高德 Key，无法使用搜索功能。'
    return
  }

  if (!map) {
    searchError.value = '地图尚未初始化，请稍后重试。'
    return
  }

  isSearching.value = true

  try {
    const params = new URLSearchParams({
      key: amapKey,
      address: query,
    })

    const resp = await fetch(`https://restapi.amap.com/v3/geocode/geo?${params.toString()}`)
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`)
    }

    const data = (await resp.json()) as {
      status: string
      geocodes?: Array<{ location?: string }>
      info?: string
    }

    if (data.status !== '1' || !data.geocodes || data.geocodes.length === 0) {
      searchError.value = '未找到匹配结果，请尝试更精确的地址。'
      return
    }

    const loc = data.geocodes[0]?.location
    if (!loc || !loc.includes(',')) {
      searchError.value = '搜索结果坐标异常，请换个关键词再试。'
      return
    }

    const [lngStr, latStr] = loc.split(',')
    const lng = Number.parseFloat(lngStr)
    const lat = Number.parseFloat(latStr)
    if (Number.isNaN(lng) || Number.isNaN(lat)) {
      searchError.value = '解析坐标失败，请换个关键词再试。'
      return
    }

    map.setView([lat, lng], Math.max(map.getZoom(), 14))
    feedback.value = '已跳转到搜索位置，可继续在该区域绘制。'
  } catch (error) {
    console.error(error)
    searchError.value = '搜索失败，请检查网络或稍后重试。'
  } finally {
    isSearching.value = false
  }
}

onMounted(() => {
  if (!mapContainer.value) return

  map = L.map(mapContainer.value, {
    center: [31.2304, 121.4737],
    zoom: 11,
    zoomControl: true,
  })

  if (!amapKey) {
    feedback.value = '未检测到 VITE_AMAP_KEY，请在 .env 中配置高德 Key 后刷新页面。'
  } else {
    const baseLayer = L.tileLayer(
      `https://webst0{s}.is.autonavi.com/appmaptile?style=7&x={x}&y={y}&z={z}&key=${encodeURIComponent(amapKey)}`,
      {
        subdomains: ['1', '2', '3', '4'],
        maxZoom: 20,
        attribution: '&copy; AMap',
      },
    )

    baseLayer.on('tileerror', () => {
      feedback.value = '高德底图加载失败，请检查 Key、域名白名单或网络状态。'
    })
    baseLayer.addTo(map)
  }

  featureGroup = new L.FeatureGroup()
  featureGroup.addTo(map)

  const drawControl = new L.Control.Draw({
    position: 'topleft',
    draw: {
      polyline: false,
      rectangle: false,
      circle: false,
      circlemarker: false,
      marker: {},
      polygon: {
        allowIntersection: true,
        showArea: false,
      },
    },
    edit: {
      featureGroup,
      remove: true,
    },
  })
  map.addControl(drawControl)

  map.on(L.Draw.Event.CREATED, (event) => {
    const createdEvent = event as L.DrawEvents.Created
    if (!featureGroup) return

    featureGroup.addLayer(createdEvent.layer)
    syncGeojson()
    feedback.value = '绘制成功，可通过右上角导出按钮导出 GeoJSON。'
  })

  map.on(L.Draw.Event.EDITED, () => {
    syncGeojson()
    feedback.value = '编辑已同步到 GeoJSON。'
  })

  map.on(L.Draw.Event.DELETED, () => {
    syncGeojson()
    feedback.value = '删除已同步到 GeoJSON。'
  })
})

onUnmounted(() => {
  map?.remove()
  map = null
  featureGroup = null
})
</script>

<template>
  <main class="app-shell">
    <div ref="mapContainer" class="map-canvas" aria-label="地图绘制区域"></div>

    <header class="top-bar">
      <div class="brand">
        <h1>GeoJSON 手动绘制工具</h1>
        <p>底图：高德底图（Key 鉴权）</p>
      </div>

      <div class="search-bar">
        <input
          v-model="searchQuery"
          type="text"
          class="search-input"
          placeholder="输入地名或地址，按回车或点击搜索"
          @keyup.enter="handleSearch"
        />
        <button
          type="button"
          class="btn btn-primary search-button"
          :disabled="isSearching"
          @click="handleSearch"
        >
          {{ isSearching ? '搜索中…' : '搜索' }}
        </button>
      </div>

      <button type="button" class="btn btn-primary export-trigger" @click="isExportModalOpen = true">
        导出 GeoJSON
      </button>
    </header>

    <p class="feedback-toast">
      {{ feedback }}
    </p>

    <p v-if="searchError" class="search-error">
      {{ searchError }}
    </p>

    <div v-if="isExportModalOpen" class="modal-backdrop" @click.self="closeExportModal">
      <section class="modal">
        <header class="modal-header">
          <h2>导出 GeoJSON</h2>
          <button type="button" class="modal-close" aria-label="关闭" @click="closeExportModal">
            ×
          </button>
        </header>

        <div class="modal-body">
          <div class="stats">
            <span>总要素：{{ featureCount }}</span>
            <span>点：{{ pointCount }}</span>
            <span>面：{{ polygonCount }}</span>
          </div>

          <div class="actions">
            <button type="button" class="btn btn-primary" @click="copyGeojson">复制 GeoJSON</button>
            <button type="button" class="btn btn-primary" @click="downloadGeojson">下载 .geojson</button>
            <button type="button" class="btn btn-ghost" @click="clearAll">清空要素</button>
          </div>

          <button type="button" class="btn btn-ghost toggle-geojson" @click="toggleGeojsonText">
            {{ showGeojsonText ? '收起 GeoJSON 文本' : '展开 GeoJSON 文本' }}
          </button>

          <div v-if="showGeojsonText" class="geojson-wrapper">
            <label for="geojson-output" class="textarea-label">GeoJSON 输出</label>
            <textarea
              id="geojson-output"
              class="geojson-output"
              :value="geojsonText"
              readonly
              spellcheck="false"
            />
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
