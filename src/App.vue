<script setup lang="ts">
import AMapLoader from '@amap/amap-jsapi-loader'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson'

type DrawMode = 'none' | 'point' | 'polygon'

type SearchTip = {
  name: string
  district?: string
  address?: string
  location?: string
}

type AmapPlacePoi = {
  name?: string
  pname?: string
  cityname?: string
  adname?: string
  address?: string
  location?: string
}

type StoredOverlay = {
  id: string
  type: 'Point' | 'Polygon'
  overlay: any
}

const POLYGON_DEFAULT_STYLE = {
  strokeColor: '#2563eb',
  strokeWeight: 2,
  fillColor: '#3b82f6',
  fillOpacity: 0.2,
}

const POLYGON_SELECTED_STYLE = {
  strokeColor: '#ef4444',
  strokeWeight: 3,
  fillColor: '#f97316',
  fillOpacity: 0.3,
}

const amapKey = import.meta.env.VITE_AMAP_KEY as string | undefined
const amapSearchKey =
  (import.meta.env.VITE_AMAP_SEARCH_KEY as string | undefined) ?? amapKey
const amapMapStyle =
  (import.meta.env.VITE_AMAP_MAP_STYLE as string | undefined) ?? 'amap://styles/normal'
const amapSecurityJsCode = import.meta.env.VITE_AMAP_SECURITY_JS_CODE as string | undefined

const mapContainer = ref<HTMLElement | null>(null)
const searchQuery = ref('')
const isSearching = ref(false)
const searchError = ref('')
const searchTips = ref<SearchTip[]>([])
const drawMode = ref<DrawMode>('none')
const selectedFeatureId = ref<string | null>(null)
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
const feedback = ref('请先选择绘制模式（点/面），然后在地图上操作。')

const isExportModalOpen = ref(false)
const showGeojsonText = ref(false)
const isEditingSelected = ref(false)

let map: any | null = null
let mouseTool: any | null = null
let polygonEditor: any | null = null
let suggestionTimer: number | null = null
let suggestionRequestSeq = 0
let mapApi: any | null = null

const overlays = new Map<string, StoredOverlay>()
let features: Feature[] = []

const parsedFeatureCollection = computed(() => {
  try {
    return JSON.parse(geojsonText.value) as FeatureCollection
  } catch {
    return { type: 'FeatureCollection', features: [] } as FeatureCollection
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

const createFeatureId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `feature-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const toLngLatPair = (lngLat: any): [number, number] => {
  if (typeof lngLat?.getLng === 'function' && typeof lngLat?.getLat === 'function') {
    return [lngLat.getLng(), lngLat.getLat()]
  }
  return [lngLat?.lng ?? 0, lngLat?.lat ?? 0]
}

const syncGeojson = (): void => {
  geojsonText.value = JSON.stringify(
    {
      type: 'FeatureCollection',
      features,
    },
    null,
    2,
  )
}

const updateFeature = (id: string, nextFeature: Feature): void => {
  features = features.map((feature) => (feature.id === id ? nextFeature : feature))
  syncGeojson()
}

const applySelectionStyle = (overlayItem: StoredOverlay, selected: boolean): void => {
  if (overlayItem.type === 'Point') {
    overlayItem.overlay.setzIndex(selected ? 300 : 120)
    return
  }
  overlayItem.overlay.setOptions(selected ? POLYGON_SELECTED_STYLE : POLYGON_DEFAULT_STYLE)
}

const setSelectedFeature = (nextId: string | null): void => {
  if (selectedFeatureId.value && overlays.has(selectedFeatureId.value)) {
    applySelectionStyle(overlays.get(selectedFeatureId.value) as StoredOverlay, false)
  }
  selectedFeatureId.value = nextId
  if (nextId && overlays.has(nextId)) {
    applySelectionStyle(overlays.get(nextId) as StoredOverlay, true)
  }
}

const bindOverlayCommonEvents = (overlayItem: StoredOverlay): void => {
  overlayItem.overlay.on('click', () => {
    setSelectedFeature(overlayItem.id)
    feedback.value = '已选中要素，可点击“删除选中”。'
  })
}

const addPointFeature = (marker: any): void => {
  const id = createFeatureId()
  const [lng, lat] = toLngLatPair(marker.getPosition())
  const feature: Feature<Point> = {
    type: 'Feature',
    id,
    properties: {},
    geometry: {
      type: 'Point',
      coordinates: [lng, lat],
    },
  }

  marker.setMap(map)
  marker.setDraggable(true)
  marker.on('dragend', () => {
    const [nextLng, nextLat] = toLngLatPair(marker.getPosition())
    updateFeature(id, {
      ...feature,
      geometry: {
        type: 'Point',
        coordinates: [nextLng, nextLat],
      },
    })
    feedback.value = '点位拖拽已同步到 GeoJSON。'
  })

  const overlayItem: StoredOverlay = { id, type: 'Point', overlay: marker }
  overlays.set(id, overlayItem)
  bindOverlayCommonEvents(overlayItem)
  features = [...features, feature]
  syncGeojson()
  setSelectedFeature(id)
}

const closeRing = (coords: Array<[number, number]>): Array<[number, number]> => {
  if (coords.length < 3) return coords
  const first = coords[0]
  const last = coords[coords.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) {
    return coords
  }
  return [...coords, first]
}

const addPolygonFeature = (polygon: any): void => {
  const id = createFeatureId()
  const path = (polygon.getPath() as any[]).map((lngLat) => toLngLatPair(lngLat))
  const ring = closeRing(path)
  const feature: Feature<Polygon> = {
    type: 'Feature',
    id,
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [ring],
    },
  }

  polygon.setMap(map)
  const overlayItem: StoredOverlay = { id, type: 'Polygon', overlay: polygon }
  overlays.set(id, overlayItem)
  bindOverlayCommonEvents(overlayItem)
  features = [...features, feature]
  syncGeojson()
  setSelectedFeature(id)
}

const removeFeatureById = (id: string): void => {
  const target = overlays.get(id)
  if (!target || !map) return
  if (selectedFeatureId.value === id) {
    polygonEditor?.close()
    polygonEditor = null
    isEditingSelected.value = false
  }
  map.remove(target.overlay)
  overlays.delete(id)
  features = features.filter((feature) => feature.id !== id)
  if (selectedFeatureId.value === id) {
    setSelectedFeature(null)
  }
  syncGeojson()
}

const stopDrawing = (): void => {
  mouseTool?.close()
  map?.setDefaultCursor('default')
  drawMode.value = 'none'
}

const getPolygonRingFromOverlay = (polygon: any): Array<[number, number]> => {
  const path = (polygon.getPath() as any[]).map((lngLat) => toLngLatPair(lngLat))
  return closeRing(path)
}

const stopPolygonEditing = (): void => {
  polygonEditor?.close()
  polygonEditor = null
  isEditingSelected.value = false
}

const startEditSelected = (): void => {
  if (!map || !mapApi) return
  if (!selectedFeatureId.value) {
    feedback.value = '请先选中一个面要素。'
    return
  }
  const selected = overlays.get(selectedFeatureId.value)
  if (!selected || selected.type !== 'Polygon') {
    feedback.value = '当前选中要素不是面，无法编辑。'
    return
  }

  stopDrawing()
  stopPolygonEditing()

  polygonEditor = new mapApi.PolygonEditor(map, selected.overlay)
  const syncPolygon = () => {
    const ring = getPolygonRingFromOverlay(selected.overlay)
    updateFeature(selected.id, {
      type: 'Feature',
      id: selected.id,
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [ring],
      },
    })
  }
  polygonEditor.on('adjust', syncPolygon)
  polygonEditor.on('addnode', syncPolygon)
  polygonEditor.on('removenode', syncPolygon)
  polygonEditor.on('end', syncPolygon)
  polygonEditor.open()
  isEditingSelected.value = true
  feedback.value = '面编辑模式已开启：拖拽顶点修改形状。'
}

const startDrawPoint = (): void => {
  if (!mouseTool) return
  setSelectedFeature(null)
  drawMode.value = 'point'
  mouseTool.close()
  map?.setDefaultCursor('crosshair')
  mouseTool.marker({
    draggable: true,
  })
  feedback.value = '点绘制模式已开启：点击地图添加点。'
}

const startDrawPolygon = (): void => {
  if (!mouseTool) return
  setSelectedFeature(null)
  drawMode.value = 'polygon'
  mouseTool.close()
  map?.setDefaultCursor('crosshair')
  mouseTool.polygon({
    ...POLYGON_DEFAULT_STYLE,
  })
  feedback.value = '面绘制模式已开启：点击地图依次落点，双击结束。'
}

const deleteSelected = (): void => {
  if (!selectedFeatureId.value) {
    feedback.value = '请先在地图上点选一个要素。'
    return
  }
  removeFeatureById(selectedFeatureId.value)
  feedback.value = '选中要素已删除。'
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
  if (!map) return
  stopDrawing()
  stopPolygonEditing()
  const all = [...overlays.values()].map((item) => item.overlay)
  if (all.length) {
    map.remove(all)
  }
  overlays.clear()
  features = []
  setSelectedFeature(null)
  syncGeojson()
  feedback.value = '已清空全部要素。'
}

const closeExportModal = (): void => {
  isExportModalOpen.value = false
}

const toggleGeojsonText = (): void => {
  showGeojsonText.value = !showGeojsonText.value
}

const loadFeaturesToMap = (nextFeatures: Feature[]): void => {
  if (!map || !mapApi) return
  stopDrawing()
  stopPolygonEditing()

  const all = [...overlays.values()].map((item) => item.overlay)
  if (all.length) {
    map.remove(all)
  }
  overlays.clear()

  const accepted: Feature[] = []

  for (const rawFeature of nextFeatures) {
    const id = String(rawFeature.id ?? createFeatureId())
    const geometryType = rawFeature.geometry?.type

    if (geometryType === 'Point') {
      const coords = (rawFeature.geometry as Point).coordinates
      if (!coords || coords.length < 2) continue
      const marker = new mapApi.Marker({
        position: [coords[0], coords[1]],
        draggable: true,
      })
      marker.setMap(map)
      const fixedFeature: Feature<Point> = {
        type: 'Feature',
        id,
        properties: rawFeature.properties ?? {},
        geometry: {
          type: 'Point',
          coordinates: [coords[0], coords[1]],
        },
      }
      marker.on('dragend', () => {
        const [nextLng, nextLat] = toLngLatPair(marker.getPosition())
        updateFeature(id, {
          ...fixedFeature,
          geometry: {
            type: 'Point',
            coordinates: [nextLng, nextLat],
          },
        })
      })
      const overlayItem: StoredOverlay = { id, type: 'Point', overlay: marker }
      overlays.set(id, overlayItem)
      bindOverlayCommonEvents(overlayItem)
      accepted.push(fixedFeature)
      continue
    }

    if (geometryType === 'Polygon') {
      const polygonCoords = (rawFeature.geometry as Polygon).coordinates
      const firstRing = polygonCoords?.[0]
      if (!firstRing || firstRing.length < 3) continue
      const ring = closeRing(firstRing.map((pair) => [pair[0], pair[1]] as [number, number]))
      const polygon = new mapApi.Polygon({
        path: ring,
        ...POLYGON_DEFAULT_STYLE,
      })
      polygon.setMap(map)
      const fixedFeature: Feature<Polygon> = {
        type: 'Feature',
        id,
        properties: rawFeature.properties ?? {},
        geometry: {
          type: 'Polygon',
          coordinates: [ring],
        },
      }
      const overlayItem: StoredOverlay = { id, type: 'Polygon', overlay: polygon }
      overlays.set(id, overlayItem)
      bindOverlayCommonEvents(overlayItem)
      accepted.push(fixedFeature)
    }
  }

  features = accepted
  setSelectedFeature(accepted[0]?.id ? String(accepted[0].id) : null)
  syncGeojson()
}

const applyGeojsonText = (): void => {
  try {
    const parsed = JSON.parse(geojsonText.value) as FeatureCollection
    if (parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
      feedback.value = 'GeoJSON 格式错误：必须是 FeatureCollection。'
      return
    }
    loadFeaturesToMap(parsed.features as Feature[])
    feedback.value = 'GeoJSON 已应用到地图。'
  } catch {
    feedback.value = 'GeoJSON 文本解析失败，请检查 JSON 格式。'
  }
}

const parseLocation = (location?: string): [number, number] | null => {
  if (!location || !location.includes(',')) {
    return null
  }

  const [lngStr, latStr] = location.split(',')
  const lng = Number.parseFloat(lngStr)
  const lat = Number.parseFloat(latStr)
  if (Number.isNaN(lng) || Number.isNaN(lat)) {
    return null
  }

  return [lng, lat]
}

const focusSearchLocation = (lng: number, lat: number): void => {
  if (!map) return
  const zoom = Math.max(15, Math.min(17, map.getZoom()))
  map.setZoomAndCenter(zoom, [lng, lat])
}

const getAmapSearchError = (info?: string, infocode?: string): string => {
  if (infocode === '10009') {
    return '搜索 Key 平台类型不匹配，请在 .env 配置 VITE_AMAP_SEARCH_KEY（高德 Web 服务 Key）。'
  }
  if (info) {
    return `搜索失败：${info}`
  }
  return '搜索失败，请检查网络或稍后重试。'
}

const composeDistrict = (poi: AmapPlacePoi): string => {
  return [poi.pname, poi.cityname, poi.adname].filter(Boolean).join(' ')
}

const fetchPlaceText = async (
  keywords: string,
  pageSize: number,
): Promise<{
  status: string
  info?: string
  infocode?: string
  pois?: Array<AmapPlacePoi>
}> => {
  const params = new URLSearchParams({
    key: amapSearchKey ?? '',
    keywords,
    page_size: String(pageSize),
    page_num: '1',
  })

  const resp = await fetch(`https://restapi.amap.com/v5/place/text?${params.toString()}`)
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`)
  }

  return (await resp.json()) as {
    status: string
    info?: string
    infocode?: string
    pois?: Array<AmapPlacePoi>
  }
}

const clearSearchTips = (): void => {
  searchTips.value = []
}

const handleSearchInput = (): void => {
  const query = searchQuery.value.trim()
  searchError.value = ''

  if (suggestionTimer) {
    window.clearTimeout(suggestionTimer)
    suggestionTimer = null
  }

  if (!query || !amapSearchKey) {
    clearSearchTips()
    return
  }

  suggestionTimer = window.setTimeout(async () => {
    const requestSeq = ++suggestionRequestSeq
    try {
      const data = await fetchPlaceText(query, 5)
      if (requestSeq !== suggestionRequestSeq) {
        return
      }

      if (data.status !== '1') {
        clearSearchTips()
        if (data.infocode === '10009') {
          searchError.value = getAmapSearchError(data.info, data.infocode)
        }
        return
      }

      searchTips.value =
        data.pois?.length
          ? data.pois
              .filter((poi) => !!poi.name)
              .map((poi) => ({
                name: poi.name ?? '',
                district: composeDistrict(poi),
                address: poi.address,
                location: poi.location,
              }))
              .slice(0, 5)
          : []
    } catch {
      if (requestSeq === suggestionRequestSeq) {
        clearSearchTips()
      }
    }
  }, 250)
}

const selectSearchTip = (tip: SearchTip): void => {
  searchQuery.value = tip.name
  clearSearchTips()

  const parsed = parseLocation(tip.location)
  if (parsed) {
    const [lng, lat] = parsed
    focusSearchLocation(lng, lat)
    feedback.value = '已定位到候选地点，可继续在该区域绘制。'
    searchError.value = ''
  }
}

const handleSearch = async (): Promise<void> => {
  const query = searchQuery.value.trim()
  searchError.value = ''
  clearSearchTips()

  if (!query) {
    searchError.value = '请输入要搜索的地名或地址。'
    return
  }

  if (!amapSearchKey) {
    searchError.value = '未配置搜索 Key，无法使用搜索功能。'
    return
  }

  if (!map) {
    searchError.value = '地图尚未初始化，请稍后重试。'
    return
  }

  isSearching.value = true

  try {
    const data = await fetchPlaceText(query, 1)
    if (data.status !== '1') {
      searchError.value = getAmapSearchError(data.info, data.infocode)
      return
    }

    if (!data.pois || data.pois.length === 0) {
      searchError.value = '未找到匹配结果，请尝试更精确的地址。'
      return
    }

    const parsed = parseLocation(data.pois[0]?.location)
    if (!parsed) {
      searchError.value = '搜索结果坐标异常，请换个关键词再试。'
      return
    }

    const [lng, lat] = parsed
    focusSearchLocation(lng, lat)
    feedback.value = '已跳转到搜索位置，可继续在该区域绘制。'
  } catch (error) {
    console.error(error)
    searchError.value = '搜索失败，请检查网络或稍后重试。'
  } finally {
    isSearching.value = false
  }
}

onMounted(async () => {
  if (!mapContainer.value) return

  if (!amapKey) {
    feedback.value = '未检测到 VITE_AMAP_KEY，请在 .env 中配置高德 Key 后刷新页面。'
    return
  }

  try {
    if (amapSecurityJsCode) {
      ;(window as Window & { _AMapSecurityConfig?: { securityJsCode: string } })._AMapSecurityConfig =
        {
          securityJsCode: amapSecurityJsCode,
        }
    }

    mapApi = await AMapLoader.load({
      key: amapKey,
      version: '2.0',
      plugins: ['AMap.Scale', 'AMap.ToolBar', 'AMap.MouseTool', 'AMap.PolygonEditor'],
    })

    map = new mapApi.Map(mapContainer.value, {
      viewMode: '3D',
      zoom: 11,
      center: [121.4737, 31.2304],
      mapStyle: amapMapStyle,
    })

    map.addControl(new mapApi.Scale())
    map.addControl(new mapApi.ToolBar())

    mouseTool = new mapApi.MouseTool(map)
    mouseTool.on('draw', (event: { obj?: any }) => {
      if (!event.obj) return
      if (drawMode.value === 'point') {
        addPointFeature(event.obj)
      } else if (drawMode.value === 'polygon') {
        addPolygonFeature(event.obj)
      }
      stopDrawing()
      feedback.value = '绘制成功，可通过右上角导出按钮导出 GeoJSON。'
    })
  } catch (error) {
    console.error(error)
    feedback.value = '高德底图初始化失败，请检查 Key、安全密钥和域名白名单。'
  }
})

onUnmounted(() => {
  if (suggestionTimer) {
    window.clearTimeout(suggestionTimer)
    suggestionTimer = null
  }

  stopDrawing()
  stopPolygonEditing()
  overlays.clear()
  features = []
  setSelectedFeature(null)

  map?.destroy()
  map = null
  mouseTool = null
  mapApi = null
})
</script>

<template>
  <main class="app-shell">
    <div ref="mapContainer" class="map-canvas" aria-label="地图绘制区域"></div>

    <header class="top-bar">
      <div class="brand">
        <h1>GeoJSON 手动绘制工具</h1>
        <p>底图：高德 JSAPI 2.0（Loader 初始化）</p>
      </div>

      <div class="search-bar">
        <div class="search-input-wrap">
          <input
            v-model="searchQuery"
            type="text"
            class="search-input"
            placeholder="输入地名、地址或关键词，按回车或点击搜索"
            @input="handleSearchInput"
            @keyup.enter="handleSearch"
          />
          <ul v-if="searchTips.length" class="search-suggestions">
            <li v-for="(tip, idx) in searchTips" :key="`${tip.name}-${idx}`">
              <button type="button" class="search-suggestion-item" @click="selectSearchTip(tip)">
                <span class="tip-name">{{ tip.name }}</span>
                <span class="tip-meta">{{ [tip.district, tip.address].filter(Boolean).join(' ') }}</span>
              </button>
            </li>
          </ul>
        </div>
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

    <div class="draw-actions-panel">
      <button
        type="button"
        class="btn"
        :class="drawMode === 'point' ? 'btn-primary' : 'btn-ghost'"
        @click="startDrawPoint"
      >
        绘制点
      </button>
      <button
        type="button"
        class="btn"
        :class="drawMode === 'polygon' ? 'btn-primary' : 'btn-ghost'"
        @click="startDrawPolygon"
      >
        绘制面
      </button>
      <button type="button" class="btn btn-ghost" @click="stopDrawing">停止绘制</button>
      <button type="button" class="btn btn-ghost" @click="startEditSelected">编辑选中面</button>
      <button
        type="button"
        class="btn btn-ghost"
        :disabled="!isEditingSelected"
        @click="stopPolygonEditing"
      >
        结束编辑
      </button>
      <button type="button" class="btn btn-ghost" @click="deleteSelected">删除选中</button>
    </div>

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
              v-model="geojsonText"
              spellcheck="false"
            />
            <button type="button" class="btn btn-ghost" @click="applyGeojsonText">
              将文本应用到地图
            </button>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
