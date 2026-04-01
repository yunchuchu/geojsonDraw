<script setup lang="ts">
import AMapLoader from '@amap/amap-jsapi-loader'
import buildingGeojsonUrl from './assets/sz84.geojson?url'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  MultiPolygon,
  Point,
  Polygon,
} from 'geojson'
import {
  bboxIntersects,
  closeRing,
  expandBounds,
  geometryToAmapPath,
  getMinimumAreaBoundingRectangle,
  geometryToSinglePolygonRings,
  getBoundsFromGeometry,
  translatePolygonRings,
  transformFeatureCoordinates,
  type BBox,
  type CoordinateSystem,
  type PolygonRing,
  type PolygonRings,
} from './utils/geometry'

type DrawMode = 'none' | 'polygon' | 'building-rectangle'
type ExportCoordinateSystem = CoordinateSystem
type SurfaceGeometry = Polygon | MultiPolygon
type ExportGeometry = Point | SurfaceGeometry
type ExportFeature = Feature<ExportGeometry, GeoJsonProperties>
type ExportFeatureCollection = FeatureCollection<ExportGeometry, GeoJsonProperties>
type SurfaceGeometryType = SurfaceGeometry['type']
type OverlayKind = 'export-point' | 'export-surface'
type OverlaySource = 'manual' | 'building-import'

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
  kind: OverlayKind
  source: OverlaySource
  geometryType: ExportGeometry['type']
  overlay: any
}

type CandidateBuilding = {
  id: string
  geometryType: SurfaceGeometryType
  geometry: SurfaceGeometry
  properties: GeoJsonProperties
  bbox: BBox
}

const EXPORT_SURFACE_STYLE = {
  strokeColor: '#2563eb',
  strokeWeight: 2,
  fillColor: '#3b82f6',
  fillOpacity: 0.24,
  zIndex: 130,
}

const SELECTED_SURFACE_STYLE = {
  strokeColor: '#ca8a04',
  strokeWeight: 3,
  fillColor: '#fde047',
  fillOpacity: 0.4,
  zIndex: 320,
}

const CANDIDATE_SURFACE_STYLE = {
  strokeColor: '#6b7280',
  strokeWeight: 1.5,
  fillColor: '#94a3b8',
  fillOpacity: 0.2,
  zIndex: 90,
}

const CANDIDATE_SELECTED_STYLE = {
  strokeColor: '#7c3aed',
  strokeWeight: 2,
  fillColor: '#a78bfa',
  fillOpacity: 0.28,
  zIndex: 100,
}

const BUILDING_LAYER_MIN_ZOOM = 15
const BUILDING_LAYER_RENDER_LIMIT = 1800
const BUILDING_LAYER_BOUNDS_PADDING = 0.01
const SURFACE_DRAG_HANDLE_OFFSET_PX = 44

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
const selectedBuildingCandidateIds = ref<string[]>([])
const exportCoordinateSystem = ref<ExportCoordinateSystem>('gcj02')
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
const isBuildingLayerVisible = ref(false)
const isBuildingDataLoading = ref(false)
const hasBuildingDataLoaded = ref(false)
const visibleBuildingCandidateCount = ref(0)
const currentMapZoom = ref(11)

let map: any | null = null
let mouseTool: any | null = null
let polygonEditor: any | null = null
let suggestionTimer: number | null = null
let suggestionRequestSeq = 0
let mapApi: any | null = null
let surfaceDragHandleMarker: any | null = null
let surfaceDragStartPosition: [number, number] | null = null
let surfaceDragStartRings: PolygonRings | null = null
let surfaceDragPointerCleanup: (() => void) | null = null

const overlays = new Map<string, StoredOverlay>()
const buildingCandidatesById = new Map<string, CandidateBuilding>()
const buildingCandidateOverlays = new Map<string, any>()

let features: ExportFeature[] = []
let buildingCandidates: CandidateBuilding[] = []
let exportedBuildingSourceIds = new Set<string>()

const parsedFeatureCollection = computed(() => {
  try {
    return JSON.parse(geojsonText.value) as ExportFeatureCollection
  } catch {
    return { type: 'FeatureCollection', features: [] } as ExportFeatureCollection
  }
})

const featureCount = computed(() => parsedFeatureCollection.value.features.length)
const polygonCount = computed(
  () =>
    parsedFeatureCollection.value.features.filter((feature) => {
      const geometryType = feature.geometry?.type
      return geometryType === 'Polygon' || geometryType === 'MultiPolygon'
    }).length,
)
const selectedBuildingCandidateCount = computed(() => selectedBuildingCandidateIds.value.length)
const selectedBuildingCandidateLookup = computed(
  () => new Set(selectedBuildingCandidateIds.value),
)
const isBuildingLayerReady = computed(
  () => isBuildingLayerVisible.value && hasBuildingDataLoaded.value && !isBuildingDataLoading.value,
)
const canUseBuildingLayerAtCurrentZoom = computed(
  () => currentMapZoom.value >= BUILDING_LAYER_MIN_ZOOM,
)
const buildingLayerStatus = computed(() => {
  if (isBuildingDataLoading.value) {
    return '建筑面加载中...'
  }
  if (!hasBuildingDataLoaded.value) {
    return '建筑面未加载'
  }
  if (!isBuildingLayerVisible.value) {
    return `建筑面已隐藏，共 ${buildingCandidates.length} 条`
  }
  if (!canUseBuildingLayerAtCurrentZoom.value) {
    return `请放大到 ${BUILDING_LAYER_MIN_ZOOM} 级后查看候选建筑`
  }
  return `当前显示 ${visibleBuildingCandidateCount.value} 条，已选 ${selectedBuildingCandidateCount.value} 条`
})

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

const getFeatureSource = (feature: ExportFeature): OverlaySource =>
  feature.properties?.sourceType === 'building-import' ? 'building-import' : 'manual'

const syncExportedBuildingSourceIds = (): void => {
  const nextIds = new Set<string>()
  for (const feature of features) {
    const buildingSourceId = feature.properties?.buildingSourceId
    if (
      feature.properties?.sourceType === 'building-import' &&
      typeof buildingSourceId === 'string' &&
      buildingSourceId
    ) {
      nextIds.add(buildingSourceId)
    }
  }
  exportedBuildingSourceIds = nextIds
}

const syncGeojson = (): void => {
  const nextFeatures = features.map((feature) =>
    transformFeatureCoordinates(feature, 'gcj02', exportCoordinateSystem.value),
  )

  geojsonText.value = JSON.stringify(
    {
      type: 'FeatureCollection',
      features: nextFeatures,
    },
    null,
    2,
  )
}

watch(exportCoordinateSystem, () => {
  syncGeojson()
})

const getSurfaceGeometryFromRings = (
  geometryType: SurfaceGeometryType,
  rings: PolygonRings,
): SurfaceGeometry =>
  geometryType === 'MultiPolygon'
    ? {
        type: 'MultiPolygon',
        coordinates: [rings],
      }
    : {
        type: 'Polygon',
        coordinates: rings,
      }

const getNormalizedSurfaceGeometry = (
  geometry: SurfaceGeometry,
): SurfaceGeometry | null => {
  const rings = geometryToSinglePolygonRings(geometry)
  if (!rings) return null
  return getSurfaceGeometryFromRings(geometry.type, rings)
}

const getSurfaceFeatureById = (id: string): Feature<SurfaceGeometry, GeoJsonProperties> | null => {
  const feature = features.find((item) => String(item.id) === id)
  if (!feature || feature.geometry.type === 'Point') {
    return null
  }
  return feature as Feature<SurfaceGeometry, GeoJsonProperties>
}

const getDragHandlePosition = (geometry: SurfaceGeometry): [number, number] | null => {
  const bounds = getBoundsFromGeometry(geometry)
  if (!bounds) return null

  const centerLng = (bounds[0] + bounds[2]) / 2
  const topLat = bounds[3]

  if (!map || !mapApi?.Pixel || !map.lngLatToContainer || !map.containerToLngLat) {
    return [centerLng, topLat]
  }

  const pixel = map.lngLatToContainer([centerLng, topLat])
  if (!pixel) {
    return [centerLng, topLat]
  }

  const x = typeof pixel.getX === 'function' ? pixel.getX() : pixel.x
  const y = (typeof pixel.getY === 'function' ? pixel.getY() : pixel.y) - SURFACE_DRAG_HANDLE_OFFSET_PX
  const lngLat = map.containerToLngLat(new mapApi.Pixel(x, y))

  return lngLat ? toLngLatPair(lngLat) : [centerLng, topLat]
}

const getLngLatFromClientPoint = (clientX: number, clientY: number): [number, number] | null => {
  if (!mapContainer.value || !mapApi?.Pixel || !map?.containerToLngLat) {
    return null
  }

  const rect = mapContainer.value.getBoundingClientRect()
  const pixel = new mapApi.Pixel(clientX - rect.left, clientY - rect.top)
  const lngLat = map.containerToLngLat(pixel)
  return lngLat ? toLngLatPair(lngLat) : null
}

const teardownSurfaceDragHandle = (): void => {
  surfaceDragPointerCleanup?.()
  surfaceDragPointerCleanup = null
  if (surfaceDragHandleMarker && map) {
    map.remove(surfaceDragHandleMarker)
  }
  surfaceDragHandleMarker = null
  surfaceDragStartPosition = null
  surfaceDragStartRings = null
}

const syncSurfaceDragHandlePosition = (): void => {
  if (!surfaceDragHandleMarker || !selectedFeatureId.value) return

  const selectedFeature = getSurfaceFeatureById(selectedFeatureId.value)
  if (!selectedFeature) return

  const position = getDragHandlePosition(selectedFeature.geometry)
  if (!position) return
  surfaceDragHandleMarker.setPosition(position)
}

const setupSurfaceDragHandle = (selected: StoredOverlay): void => {
  if (!map || !mapApi) return

  const currentFeature = getSurfaceFeatureById(selected.id)
  if (!currentFeature) return

  const position = getDragHandlePosition(currentFeature.geometry)
  if (!position) return

  teardownSurfaceDragHandle()

  const workbench = document.createElement('div')
  workbench.className = 'surface-workbench'

  const dragButton = document.createElement('button')
  dragButton.type = 'button'
  dragButton.className = 'surface-workbench__drag'
  dragButton.setAttribute('aria-label', '拖拽选中面')
  dragButton.title = '拖拽'
  dragButton.textContent = '拖拽'

  const flattenButton = document.createElement('button')
  flattenButton.type = 'button'
  flattenButton.className = 'surface-workbench__action'
  flattenButton.title = '规整'
  flattenButton.textContent = '规整'

  const deleteButton = document.createElement('button')
  deleteButton.type = 'button'
  deleteButton.className = 'surface-workbench__action surface-workbench__action--danger'
  deleteButton.title = '删除'
  deleteButton.textContent = '删除'

  const finishButton = document.createElement('button')
  finishButton.type = 'button'
  finishButton.className = 'surface-workbench__action'
  finishButton.title = '完成'
  finishButton.textContent = '完成'

  workbench.append(dragButton, flattenButton, deleteButton, finishButton)

  const handleMarker = new mapApi.Marker({
    position,
    draggable: false,
    bubble: false,
    zIndex: 430,
    offset: new mapApi.Pixel(-84, -18),
    content: workbench,
  })

  handleMarker.setMap(map)

  const startDrag = (event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()

    const feature = getSurfaceFeatureById(selected.id)
    const rings = feature ? geometryToSinglePolygonRings(feature.geometry) : null
    if (!rings) return

    surfaceDragStartPosition = toLngLatPair(handleMarker.getPosition())
    surfaceDragStartRings = rings.map((ring) => ring.map(([lng, lat]) => [lng, lat] as [number, number]))
    polygonEditor?.close()
    polygonEditor = null
    map?.setDefaultCursor('grabbing')

    const handleMove = (moveEvent: MouseEvent): void => {
      if (!surfaceDragStartPosition || !surfaceDragStartRings) return

      const nextPosition = getLngLatFromClientPoint(moveEvent.clientX, moveEvent.clientY)
      if (!nextPosition) return

      const deltaLng = nextPosition[0] - surfaceDragStartPosition[0]
      const deltaLat = nextPosition[1] - surfaceDragStartPosition[1]
      const nextRings = translatePolygonRings(surfaceDragStartRings, deltaLng, deltaLat)
      const nextGeometry = getSurfaceGeometryFromRings(
        selected.geometryType as SurfaceGeometryType,
        nextRings,
      )
      const nextPath = geometryToAmapPath(nextGeometry)
      if (!nextPath) return

      selected.overlay.setPath(nextPath)
      handleMarker.setPosition(nextPosition)
    }

    const handleUp = (upEvent: MouseEvent): void => {
      const currentFeature = getSurfaceFeatureById(selected.id)
      const nextPosition = getLngLatFromClientPoint(upEvent.clientX, upEvent.clientY)
      const safePosition = nextPosition ?? toLngLatPair(handleMarker.getPosition())

      if (!surfaceDragStartPosition || !surfaceDragStartRings) {
        surfaceDragPointerCleanup?.()
        surfaceDragPointerCleanup = null
        map?.setDefaultCursor('default')
        syncSurfaceDragHandlePosition()
        return
      }

      const deltaLng = safePosition[0] - surfaceDragStartPosition[0]
      const deltaLat = safePosition[1] - surfaceDragStartPosition[1]
      const nextRings = translatePolygonRings(surfaceDragStartRings, deltaLng, deltaLat)
      const nextGeometry = getSurfaceGeometryFromRings(
        selected.geometryType as SurfaceGeometryType,
        nextRings,
      )
      const nextPath = geometryToAmapPath(nextGeometry)

      surfaceDragStartPosition = null
      surfaceDragStartRings = null
      surfaceDragPointerCleanup?.()
      surfaceDragPointerCleanup = null
      map?.setDefaultCursor('default')

      if (!currentFeature || !nextPath) {
        syncSurfaceDragHandlePosition()
        return
      }

      selected.overlay.setPath(nextPath)
      updateFeature(selected.id, {
        ...currentFeature,
        geometry: nextGeometry,
      })

      if (isEditingSelected.value) {
        startEditSelected()
        feedback.value = '已通过上方工作区移动选中面。'
        return
      }

      syncSurfaceDragHandlePosition()
      feedback.value = '已通过上方工作区移动选中面。'
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp, { once: true })
    surfaceDragPointerCleanup = () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }

  dragButton.addEventListener('mousedown', startDrag)
  flattenButton.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    flattenSelectedSurface()
  })
  deleteButton.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    deleteSelected()
  })
  finishButton.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    stopPolygonEditing()
    feedback.value = '已结束当前面的编辑。'
  })

  surfaceDragHandleMarker = handleMarker
}

const setSelectedBuildingCandidateIds = (ids: string[]): void => {
  selectedBuildingCandidateIds.value = ids
  for (const candidateId of buildingCandidateOverlays.keys()) {
    applyBuildingCandidateStyle(candidateId)
  }
}

const clearBuildingCandidateSelection = (): void => {
  if (!selectedBuildingCandidateCount.value) return
  setSelectedBuildingCandidateIds([])
  feedback.value = '已清空候选建筑选择。'
}

const applySelectionStyle = (overlayItem: StoredOverlay, selected: boolean): void => {
  if (overlayItem.kind === 'export-point') {
    overlayItem.overlay.setzIndex(selected ? 320 : 150)
    return
  }

  overlayItem.overlay.setOptions(selected ? SELECTED_SURFACE_STYLE : EXPORT_SURFACE_STYLE)
}

const applyBuildingCandidateStyle = (candidateId: string): void => {
  const overlay = buildingCandidateOverlays.get(candidateId)
  if (!overlay) return

  const isSelected = selectedBuildingCandidateLookup.value.has(candidateId)
  overlay.setOptions(isSelected ? CANDIDATE_SELECTED_STYLE : CANDIDATE_SURFACE_STYLE)
}

const setSelectedFeature = (nextId: string | null): void => {
  if (selectedFeatureId.value !== nextId && isEditingSelected.value) {
    stopPolygonEditing()
  }
  if (selectedFeatureId.value && overlays.has(selectedFeatureId.value)) {
    applySelectionStyle(overlays.get(selectedFeatureId.value) as StoredOverlay, false)
  }
  selectedFeatureId.value = nextId
  if (nextId && overlays.has(nextId)) {
    applySelectionStyle(overlays.get(nextId) as StoredOverlay, true)
  }
}

const bindExportOverlayEvents = (overlayItem: StoredOverlay): void => {
  overlayItem.overlay.on('click', () => {
    setSelectedFeature(overlayItem.id)
    if (overlayItem.kind === 'export-surface') {
      if (selectedFeatureId.value !== overlayItem.id || !isEditingSelected.value) {
        startEditSelected()
      }
      feedback.value = '已选中面要素，已自动进入编辑模式。'
      return
    }

    feedback.value = '已选中导出要素，可继续删除。'
  })
}

const toggleBuildingCandidateSelection = (candidateId: string): void => {
  stopPolygonEditing()
  setSelectedFeature(null)

  const nextIds = new Set(selectedBuildingCandidateIds.value)
  if (nextIds.has(candidateId)) {
    nextIds.delete(candidateId)
  } else {
    nextIds.add(candidateId)
  }
  setSelectedBuildingCandidateIds([...nextIds])
  feedback.value = `候选建筑已选 ${nextIds.size} 条，可点击“添加选中建筑”。`
}

const createExportPointMarker = (feature: Feature<Point>): StoredOverlay => {
  const marker = new mapApi.Marker({
    position: [...feature.geometry.coordinates],
    draggable: true,
    bubble: false,
  })
  marker.setMap(map)
  marker.on('dragend', () => {
    const [nextLng, nextLat] = toLngLatPair(marker.getPosition())
    updateFeature(String(feature.id), {
      ...feature,
      geometry: {
        type: 'Point',
        coordinates: [nextLng, nextLat],
      },
    })
    feedback.value = '点位拖拽已同步到 GeoJSON。'
  })

  return {
    id: String(feature.id),
    kind: 'export-point',
    source: getFeatureSource(feature as ExportFeature),
    geometryType: 'Point',
    overlay: marker,
  }
}

const createExportSurfaceOverlay = (feature: Feature<SurfaceGeometry>): StoredOverlay | null => {
  const path = geometryToAmapPath(feature.geometry)
  if (!path) return null

  const polygon = new mapApi.Polygon({
    path,
    bubble: false,
    ...EXPORT_SURFACE_STYLE,
  })
  polygon.setMap(map)

  return {
    id: String(feature.id),
    kind: 'export-surface',
    source: getFeatureSource(feature as ExportFeature),
    geometryType: feature.geometry.type,
    overlay: polygon,
  }
}

const registerExportFeature = (feature: ExportFeature): void => {
  let overlayItem: StoredOverlay | null = null

  if (feature.geometry.type === 'Point') {
    overlayItem = createExportPointMarker(feature as Feature<Point, GeoJsonProperties>)
  } else if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
    overlayItem = createExportSurfaceOverlay(feature as Feature<SurfaceGeometry>)
  }

  if (!overlayItem) return
  overlays.set(String(feature.id), overlayItem)
  bindExportOverlayEvents(overlayItem)
}

const updateFeature = (id: string, nextFeature: ExportFeature): void => {
  features = features.map((feature) => (String(feature.id) === id ? nextFeature : feature))
  syncGeojson()
}

const normalizePolygonPathInput = (path: any): any[][] => {
  if (!Array.isArray(path) || path.length === 0) {
    return []
  }

  const first = path[0]
  if (Array.isArray(first)) {
    return path as any[][]
  }

  return [path as any[]]
}

const getPolygonRingsFromOverlay = (polygon: any): PolygonRings => {
  const paths = normalizePolygonPathInput(polygon.getPath())
  return paths
    .map((path) => closeRing(path.map((lngLat) => toLngLatPair(lngLat))))
    .filter((ring) => ring.length >= 4)
}

const addPolygonFeatureFromRing = (ring: PolygonRing): void => {
  const id = createFeatureId()
  const closedRing = closeRing(ring)
  if (closedRing.length < 4) {
    feedback.value = '当前面要素无有效坐标，未能写入导出集合。'
    return
  }

  const feature: Feature<Polygon> = {
    type: 'Feature',
    id,
    properties: {
      sourceType: 'manual',
    },
    geometry: {
      type: 'Polygon',
      coordinates: [closedRing],
    },
  }

  registerExportFeature(feature)
  features = [...features, feature]
  syncGeojson()
  setSelectedFeature(id)
}

const removeFeatureById = (id: string): void => {
  const target = overlays.get(id)
  if (!target || !map) return

  if (selectedFeatureId.value === id) {
    stopPolygonEditing()
  }

  map.remove(target.overlay)
  overlays.delete(id)
  features = features.filter((feature) => String(feature.id) !== id)

  if (selectedFeatureId.value === id) {
    setSelectedFeature(null)
  }

  syncExportedBuildingSourceIds()
  syncGeojson()
  refreshVisibleBuildingCandidates()
}

const stopDrawing = (): void => {
  mouseTool?.close()
  map?.setDefaultCursor('default')
  drawMode.value = 'none'
}

const stopPolygonEditing = (): void => {
  polygonEditor?.close()
  polygonEditor = null
  teardownSurfaceDragHandle()
  isEditingSelected.value = false
}

const startEditSelected = (): void => {
  if (!map || !mapApi) return
  if (!selectedFeatureId.value) {
    feedback.value = '请先选中一个面要素。'
    return
  }

  const selected = overlays.get(selectedFeatureId.value)
  if (!selected || selected.kind !== 'export-surface') {
    feedback.value = '当前选中要素不是面，无法编辑。'
    return
  }

  stopDrawing()
  stopPolygonEditing()

  polygonEditor = new mapApi.PolygonEditor(map, selected.overlay)
  const syncPolygon = () => {
    const currentFeature = features.find((feature) => String(feature.id) === selected.id)
    if (!currentFeature || currentFeature.geometry.type === 'Point') {
      return
    }

    const rings = getPolygonRingsFromOverlay(selected.overlay)
    if (!rings.length) {
      return
    }

    updateFeature(selected.id, {
      ...currentFeature,
      geometry: getSurfaceGeometryFromRings(selected.geometryType as SurfaceGeometryType, rings),
    })
  }

  polygonEditor.on('adjust', syncPolygon)
  polygonEditor.on('addnode', syncPolygon)
  polygonEditor.on('removenode', syncPolygon)
  polygonEditor.on('end', syncPolygon)
  polygonEditor.open()
  setupSurfaceDragHandle(selected)
  isEditingSelected.value = true
  feedback.value = '面编辑模式已开启：可在上方工作区拖拽、规整、删除或完成。'
}

const flattenSelectedSurface = (): void => {
  if (!selectedFeatureId.value) {
    feedback.value = '请先选中一个面要素。'
    return
  }

  const selected = overlays.get(selectedFeatureId.value)
  if (!selected || selected.kind !== 'export-surface') {
    feedback.value = '当前选中要素不是面，无法平整。'
    return
  }

  const currentFeature = features.find((feature) => String(feature.id) === selected.id)
  if (!currentFeature || currentFeature.geometry.type === 'Point') {
    feedback.value = '当前选中要素不是面，无法平整。'
    return
  }

  const rings = geometryToSinglePolygonRings(currentFeature.geometry)
  if (!rings || rings.length !== 1) {
    feedback.value = '平整当前仅支持单环面要素。'
    return
  }

  const flattenedOuterRing = getMinimumAreaBoundingRectangle(rings[0])
  if (!flattenedOuterRing) {
    feedback.value = '当前面形状不足以进行平整。'
    return
  }

  const nextGeometry = getSurfaceGeometryFromRings(
    selected.geometryType as SurfaceGeometryType,
    [flattenedOuterRing],
  )
  const nextPath = geometryToAmapPath(nextGeometry)
  if (!nextPath) {
    feedback.value = '平整失败，请重试。'
    return
  }

  const shouldResumeEditing = isEditingSelected.value
  if (shouldResumeEditing) {
    stopPolygonEditing()
  }

  selected.overlay.setPath(nextPath)
  updateFeature(selected.id, {
    ...currentFeature,
    geometry: nextGeometry,
  })

  if (shouldResumeEditing) {
    startEditSelected()
  }

  feedback.value = '已将选中面平整为最小外接矩形。'
}

const addPolygonFeature = (polygon: any): void => {
  const rings = getPolygonRingsFromOverlay(polygon)
  if (!rings.length) {
    feedback.value = '当前面要素无有效坐标，未能写入导出集合。'
    return
  }

  const [outerRing] = rings
  if (!outerRing) {
    feedback.value = '当前面要素无有效坐标，未能写入导出集合。'
    return
  }

  if (map) {
    map.remove(polygon)
  }

  addPolygonFeatureFromRing(outerRing)
}

const startDrawPolygon = (): void => {
  if (!mouseTool) return
  stopPolygonEditing()
  setSelectedFeature(null)
  drawMode.value = 'polygon'
  mouseTool.close()
  map?.setDefaultCursor('crosshair')
  mouseTool.polygon({
    ...EXPORT_SURFACE_STYLE,
  })
  feedback.value = '面绘制模式已开启：点击地图开始绘制，双击结束。'
}

const toggleDrawPolygon = (): void => {
  if (drawMode.value === 'polygon') {
    stopDrawing()
    feedback.value = '已退出面绘制模式。'
    return
  }

  startDrawPolygon()
}

const handleMapBlankDoubleClick = (): void => {
  if (drawMode.value !== 'none') return
  if (isEditingSelected.value) return
  startDrawPolygon()
}

const handleWindowKeydown = (event: KeyboardEvent): void => {
  const target = event.target as HTMLElement | null
  const tagName = target?.tagName
  if (tagName === 'INPUT' || tagName === 'TEXTAREA') return

  if (drawMode.value === 'polygon' && event.key === 'Escape') {
    event.preventDefault()
    stopDrawing()
    feedback.value = '已取消当前面的绘制。'
  }
}

const getMapBoundsBBox = (): BBox | null => {
  if (!map) return null
  const bounds = map.getBounds?.()
  if (!bounds) return null
  const [minLng, minLat] = toLngLatPair(bounds.getSouthWest())
  const [maxLng, maxLat] = toLngLatPair(bounds.getNorthEast())
  return [minLng, minLat, maxLng, maxLat]
}

const clearBuildingCandidateOverlays = (): void => {
  if (map && buildingCandidateOverlays.size) {
    map.remove([...buildingCandidateOverlays.values()])
  }
  buildingCandidateOverlays.clear()
  visibleBuildingCandidateCount.value = 0
}

const refreshVisibleBuildingCandidates = (): void => {
  if (!map || !mapApi) return

  if (
    !isBuildingLayerVisible.value ||
    !hasBuildingDataLoaded.value ||
    !canUseBuildingLayerAtCurrentZoom.value
  ) {
    clearBuildingCandidateOverlays()
    return
  }

  const bounds = getMapBoundsBBox()
  if (!bounds) {
    clearBuildingCandidateOverlays()
    return
  }

  const expandedBounds = expandBounds(bounds, BUILDING_LAYER_BOUNDS_PADDING)
  const nextVisibleIds: string[] = []

  for (const candidate of buildingCandidates) {
    if (exportedBuildingSourceIds.has(candidate.id)) continue
    if (!bboxIntersects(candidate.bbox, expandedBounds)) continue
    nextVisibleIds.push(candidate.id)
    if (nextVisibleIds.length >= BUILDING_LAYER_RENDER_LIMIT) {
      break
    }
  }

  const nextVisibleSet = new Set(nextVisibleIds)

  for (const [candidateId, overlay] of buildingCandidateOverlays.entries()) {
    if (nextVisibleSet.has(candidateId)) continue
    map.remove(overlay)
    buildingCandidateOverlays.delete(candidateId)
  }

  for (const candidateId of nextVisibleIds) {
    if (buildingCandidateOverlays.has(candidateId)) {
      applyBuildingCandidateStyle(candidateId)
      continue
    }

    const candidate = buildingCandidatesById.get(candidateId)
    if (!candidate) continue
    const path = geometryToAmapPath(candidate.geometry)
    if (!path) continue

    const polygon = new mapApi.Polygon({
      path,
      bubble: false,
      ...CANDIDATE_SURFACE_STYLE,
    })
    polygon.setMap(map)
    polygon.on('click', () => {
      toggleBuildingCandidateSelection(candidateId)
    })
    buildingCandidateOverlays.set(candidateId, polygon)
    applyBuildingCandidateStyle(candidateId)
  }

  visibleBuildingCandidateCount.value = nextVisibleIds.length
}

const ensureBuildingCandidatesLoaded = async (): Promise<void> => {
  if (hasBuildingDataLoaded.value || isBuildingDataLoading.value) return

  isBuildingDataLoading.value = true
  feedback.value = '正在载入建筑面底图，请稍候...'

  try {
    const resp = await fetch(buildingGeojsonUrl)
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`)
    }

    const data = (await resp.json()) as FeatureCollection<SurfaceGeometry, GeoJsonProperties>
    const nextCandidates: CandidateBuilding[] = []

    buildingCandidatesById.clear()

    data.features.forEach((feature, index) => {
      const rawGeometry = feature.geometry
      if (!rawGeometry || (rawGeometry.type !== 'Polygon' && rawGeometry.type !== 'MultiPolygon')) {
        return
      }

      const convertedFeature = transformFeatureCoordinates(
        {
          type: 'Feature',
          id: String(feature.id ?? `building-${index}`),
          properties: feature.properties ?? {},
          geometry: rawGeometry,
        } as Feature<SurfaceGeometry, GeoJsonProperties>,
        'wgs84',
        'gcj02',
      )

      const normalizedGeometry = getNormalizedSurfaceGeometry(convertedFeature.geometry)
      if (!normalizedGeometry) {
        return
      }

      const bbox = getBoundsFromGeometry(normalizedGeometry)
      if (!bbox) {
        return
      }

      const candidate: CandidateBuilding = {
        id: String(feature.id ?? `building-${index}`),
        geometryType: normalizedGeometry.type,
        geometry: normalizedGeometry,
        properties: feature.properties ?? {},
        bbox,
      }

      nextCandidates.push(candidate)
      buildingCandidatesById.set(candidate.id, candidate)
    })

    buildingCandidates = nextCandidates
    hasBuildingDataLoaded.value = true
    feedback.value = `建筑面已加载，共 ${buildingCandidates.length} 条。`
  } catch (error) {
    console.error(error)
    feedback.value = '建筑面数据加载失败，请检查 GeoJSON 文件。'
  } finally {
    isBuildingDataLoading.value = false
  }
}

const toggleBuildingLayer = async (): Promise<void> => {
  if (isBuildingLayerVisible.value) {
    isBuildingLayerVisible.value = false
    if (drawMode.value === 'building-rectangle') {
      stopDrawing()
    }
    clearBuildingCandidateOverlays()
    feedback.value = '建筑面候选层已隐藏。'
    return
  }

  await ensureBuildingCandidatesLoaded()
  if (!hasBuildingDataLoaded.value) return

  isBuildingLayerVisible.value = true
  refreshVisibleBuildingCandidates()

  if (!canUseBuildingLayerAtCurrentZoom.value) {
    feedback.value = `建筑面已加载，请放大到 ${BUILDING_LAYER_MIN_ZOOM} 级后查看。`
    return
  }

  feedback.value = '建筑面候选层已显示，可点击或框选建筑后加入导出集合。'
}

const startRectangleSelectBuildings = (): void => {
  if (!mouseTool) return
  if (!isBuildingLayerReady.value) {
    feedback.value = '请先显示建筑面候选层。'
    return
  }
  if (!canUseBuildingLayerAtCurrentZoom.value) {
    feedback.value = `请放大到 ${BUILDING_LAYER_MIN_ZOOM} 级后再进行框选。`
    return
  }

  stopPolygonEditing()
  setSelectedFeature(null)
  drawMode.value = 'building-rectangle'
  mouseTool.close()
  map?.setDefaultCursor('crosshair')
  mouseTool.rectangle({
    strokeColor: '#7c3aed',
    strokeWeight: 2,
    strokeOpacity: 0.9,
    fillColor: '#a78bfa',
    fillOpacity: 0.12,
  })
  feedback.value = '框选模式已开启：按住鼠标拖拽选中范围内建筑。'
}

const addSelectedBuildingCandidates = (): void => {
  if (!selectedBuildingCandidateCount.value) {
    feedback.value = '请先点击或框选候选建筑。'
    return
  }

  const nextFeatures = [...features]
  let addedCount = 0
  let lastAddedId: string | null = null

  for (const candidateId of selectedBuildingCandidateIds.value) {
    if (exportedBuildingSourceIds.has(candidateId)) continue
    const candidate = buildingCandidatesById.get(candidateId)
    if (!candidate) continue

    const featureId = createFeatureId()
    const nextFeature: Feature<SurfaceGeometry> = {
      type: 'Feature',
      id: featureId,
      properties: {
        ...(candidate.properties ?? {}),
        sourceType: 'building-import',
        buildingSourceId: candidate.id,
      },
      geometry: candidate.geometry,
    }

    registerExportFeature(nextFeature)
    nextFeatures.push(nextFeature)
    addedCount += 1
    lastAddedId = featureId
  }

  if (!addedCount) {
    feedback.value = '选中的建筑都已经在导出集合中了。'
    return
  }

  features = nextFeatures
  syncExportedBuildingSourceIds()
  setSelectedBuildingCandidateIds([])
  syncGeojson()
  refreshVisibleBuildingCandidates()
  if (lastAddedId) {
    setSelectedFeature(lastAddedId)
  }
  feedback.value = `已添加 ${addedCount} 条建筑到导出集合。`
}

const handleRectangleSelection = (rectangle: any): void => {
  if (!map) return

  const bounds = rectangle?.getBounds?.()
  map.remove(rectangle)

  if (!bounds) {
    feedback.value = '框选失败，请重试。'
    return
  }

  const [minLng, minLat] = toLngLatPair(bounds.getSouthWest())
  const [maxLng, maxLat] = toLngLatPair(bounds.getNorthEast())
  const rectangleBounds: BBox = [minLng, minLat, maxLng, maxLat]
  const nextIds = new Set(selectedBuildingCandidateIds.value)

  for (const candidate of buildingCandidates) {
    if (exportedBuildingSourceIds.has(candidate.id)) continue
    if (!bboxIntersects(candidate.bbox, rectangleBounds)) continue
    nextIds.add(candidate.id)
  }

  setSelectedBuildingCandidateIds([...nextIds])
  feedback.value = `框选完成，候选建筑已选 ${nextIds.size} 条。`
}

const deleteSelected = (): void => {
  if (!selectedFeatureId.value) {
    feedback.value = '请先在地图上点选一个导出要素。'
    return
  }
  removeFeatureById(selectedFeatureId.value)
  feedback.value = '选中要素已删除。'
}

const copyGeojson = async (): Promise<void> => {
  if (!featureCount.value) {
    feedback.value = '当前没有可复制的要素，请先绘制或添加建筑。'
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
    feedback.value = '当前没有可下载的要素，请先绘制或添加建筑。'
    return
  }

  const blob = new Blob([geojsonText.value], { type: 'application/geo+json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `features-${exportCoordinateSystem.value}-${Date.now()}.geojson`
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
  syncExportedBuildingSourceIds()
  setSelectedFeature(null)
  syncGeojson()
  refreshVisibleBuildingCandidates()
  feedback.value = '已清空全部导出要素。'
}

const closeExportModal = (): void => {
  isExportModalOpen.value = false
}

const toggleGeojsonText = (): void => {
  showGeojsonText.value = !showGeojsonText.value
}

const normalizeIncomingFeature = (
  rawFeature: Feature,
  inputCoordinateSystem: ExportCoordinateSystem,
): ExportFeature | null => {
  const id = String(rawFeature.id ?? createFeatureId())
  const properties = rawFeature.properties ?? {}
  const geometry = rawFeature.geometry

  if (!geometry) return null

  if (geometry.type === 'Point') {
    const converted = transformFeatureCoordinates(
      {
        type: 'Feature',
        id,
        properties,
        geometry,
      } as Feature<Point, GeoJsonProperties>,
      inputCoordinateSystem,
      'gcj02',
    )

    return converted
  }

  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') {
    return null
  }

  const converted = transformFeatureCoordinates(
    {
      type: 'Feature',
      id,
      properties,
      geometry,
    } as Feature<SurfaceGeometry, GeoJsonProperties>,
    inputCoordinateSystem,
    'gcj02',
  )

  const normalizedGeometry = getNormalizedSurfaceGeometry(converted.geometry)
  if (!normalizedGeometry) {
    return null
  }

  return {
    ...converted,
    geometry: normalizedGeometry,
  }
}

const clearExportOverlays = (): void => {
  if (map && overlays.size) {
    map.remove([...overlays.values()].map((item) => item.overlay))
  }
  overlays.clear()
}

const loadFeaturesToMap = (
  nextFeatures: Feature[],
  inputCoordinateSystem: ExportCoordinateSystem = exportCoordinateSystem.value,
): void => {
  if (!map || !mapApi) return

  stopDrawing()
  stopPolygonEditing()
  clearExportOverlays()

  const accepted: ExportFeature[] = []

  for (const rawFeature of nextFeatures) {
    const normalized = normalizeIncomingFeature(rawFeature, inputCoordinateSystem)
    if (!normalized) continue
    registerExportFeature(normalized)
    accepted.push(normalized)
  }

  features = accepted
  syncExportedBuildingSourceIds()
  syncGeojson()
  refreshVisibleBuildingCandidates()
  setSelectedFeature(accepted[0]?.id ? String(accepted[0].id) : null)
}

const applyGeojsonText = (): void => {
  try {
    const parsed = JSON.parse(geojsonText.value) as ExportFeatureCollection
    if (parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
      feedback.value = 'GeoJSON 格式错误：必须是 FeatureCollection。'
      return
    }
    loadFeaturesToMap(parsed.features as Feature[], exportCoordinateSystem.value)
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

    currentMapZoom.value = map.getZoom()
    map.addControl(new mapApi.Scale())
    map.addControl(new mapApi.ToolBar())

    mouseTool = new mapApi.MouseTool(map)
    mouseTool.on('draw', (event: { obj?: any }) => {
      if (!event.obj) return

      if (drawMode.value === 'polygon') {
        addPolygonFeature(event.obj)
        stopDrawing()
        startEditSelected()
        feedback.value = '面要素已加入导出集合，并已进入编辑模式。'
      } else if (drawMode.value === 'building-rectangle') {
        handleRectangleSelection(event.obj)
        stopDrawing()
      }
    })

    map.on('dblclick', handleMapBlankDoubleClick)
    map.on('moveend', () => {
      refreshVisibleBuildingCandidates()
      syncSurfaceDragHandlePosition()
    })
    map.on('zoomend', () => {
      currentMapZoom.value = map?.getZoom?.() ?? currentMapZoom.value
      refreshVisibleBuildingCandidates()
      syncSurfaceDragHandlePosition()
    })
    window.addEventListener('keydown', handleWindowKeydown)
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
  window.removeEventListener('keydown', handleWindowKeydown)

  stopDrawing()
  stopPolygonEditing()
  clearExportOverlays()
  clearBuildingCandidateOverlays()
  features = []
  buildingCandidates = []
  buildingCandidatesById.clear()
  selectedBuildingCandidateIds.value = []
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
        <h1>GeoJSON 建筑面提取工具</h1>
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
        :class="drawMode === 'polygon' ? 'btn-primary' : 'btn-ghost'"
        @click="toggleDrawPolygon"
      >
        {{ drawMode === 'polygon' ? '完成绘制' : '绘制面' }}
      </button>

      <button
        type="button"
        class="btn"
        :class="isBuildingLayerVisible ? 'btn-primary' : 'btn-ghost'"
        :disabled="isBuildingDataLoading"
        @click="toggleBuildingLayer"
      >
        {{ isBuildingDataLoading ? '加载建筑面…' : isBuildingLayerVisible ? '隐藏建筑面' : '显示建筑面' }}
      </button>
      <button
        type="button"
        class="btn btn-ghost"
        :disabled="!isBuildingLayerReady || !canUseBuildingLayerAtCurrentZoom"
        @click="startRectangleSelectBuildings"
      >
        框选建筑
      </button>
      <button
        type="button"
        class="btn btn-ghost"
        :disabled="!selectedBuildingCandidateCount"
        @click="addSelectedBuildingCandidates"
      >
        添加选中建筑
      </button>
      <button
        type="button"
        class="btn btn-ghost"
        :disabled="!selectedBuildingCandidateCount"
        @click="clearBuildingCandidateSelection"
      >
        清空候选选择
      </button>

      <p class="candidate-status">
        {{ buildingLayerStatus }}
      </p>
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
            <span>面：{{ polygonCount }}</span>
          </div>

          <section class="coord-switch">
            <span class="section-label">导出坐标系</span>
            <label class="coord-option">
              <input v-model="exportCoordinateSystem" type="radio" value="gcj02" />
              <span>GCJ-02（高德）</span>
            </label>
            <label class="coord-option">
              <input v-model="exportCoordinateSystem" type="radio" value="wgs84" />
              <span>WGS84（84 坐标）</span>
            </label>
          </section>

          <div class="actions">
            <button type="button" class="btn btn-primary" @click="copyGeojson">复制 GeoJSON</button>
            <button type="button" class="btn btn-primary" @click="downloadGeojson">下载 .geojson</button>
            <button type="button" class="btn btn-ghost" @click="clearAll">清空要素</button>
          </div>

          <button type="button" class="btn btn-ghost toggle-geojson" @click="toggleGeojsonText">
            {{ showGeojsonText ? '收起 GeoJSON 文本' : '展开 GeoJSON 文本' }}
          </button>

          <div v-if="showGeojsonText" class="geojson-wrapper">
            <label for="geojson-output" class="textarea-label">
              GeoJSON 输出（{{ exportCoordinateSystem === 'gcj02' ? 'GCJ-02' : 'WGS84' }}）
            </label>
            <textarea
              id="geojson-output"
              v-model="geojsonText"
              class="geojson-output"
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
