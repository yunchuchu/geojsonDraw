<script setup lang="ts">
import AMapLoader from '@amap/amap-jsapi-loader'
import buildingGeojsonUrl from './assets/sz84.geojson?url'
import SurfaceWorkbench from './components/SurfaceWorkbench.vue'
import SurfacePropertyTable from './components/SurfacePropertyTable.vue'
import UserManualButton from './components/UserManualButton.vue'
import UserManualModal from './components/UserManualModal.vue'
import userManualMarkdown from './docs/user-manual.md?raw'
import { computed, createApp, onMounted, onUnmounted, ref, watch } from 'vue'
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
import { regularizePolygonRing } from './utils/regularize'

type DrawMode = 'none' | 'polygon' | 'building-rectangle' | 'export-rectangle'
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

type AmapPoiDetail = AmapPlacePoi & {
  id?: string
  type?: string
  typecode?: string
  tel?: string
}

type AmapWebPlaceDetailPoi = AmapPoiDetail & {
  pname?: string
  cityname?: string | string[]
  citycode?: string
  adname?: string
  adcode?: string
  pcode?: string
  postcode?: string
  website?: string
  email?: string
  entr_location?: string
  exit_location?: string
  navi_poiid?: string
  gridcode?: string
  alias?: string | string[]
  business_area?: string | string[]
  biz_type?: string
  parking_type?: string
}

type AmapWebPlaceDetailResponse = {
  status: string
  info?: string
  infocode?: string
  pois?: AmapWebPlaceDetailPoi[]
}

type AmapRegeoAddressComponent = {
  province?: string
  city?: string | string[]
  citycode?: string
  district?: string
  adcode?: string
  township?: string
  towncode?: string
  neighborhood?: {
    name?: string
    type?: string
  }
  building?: {
    name?: string
    type?: string
  }
  streetNumber?: {
    street?: string
    number?: string
    location?: string
    direction?: string
    distance?: string
  }
}

type AmapRegeoResult = {
  formatted_address?: string
  addressComponent?: AmapRegeoAddressComponent
}

type AmapRegeoResponse = {
  status: string
  info?: string
  infocode?: string
  regeocode?: AmapRegeoResult
}

type InfoCardItem = {
  label: string
  value: string
}

type MapInfoCard = {
  title: string
  source: string
  items: InfoCardItem[]
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

type SurfaceQuickPropertyKey =
  | 'height'
  | 'name'
  | 'adcode'
  | 'citycode'
  | 'fullAddress'
  | 'streetNumber'
  | 'communityName'

type SurfaceQuickPropertyValues = Record<SurfaceQuickPropertyKey, string>

type SurfaceCustomPropertyRow = {
  id: string
  key: string
  value: string
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

const BUILDING_LAYER_MIN_ZOOM = 12
const BUILDING_LAYER_RENDER_LIMIT = 1800
const BUILDING_LAYER_BOUNDS_PADDING = 0.01
const SURFACE_DRAG_HANDLE_OFFSET_PX = 44
const SURFACE_QUICK_PROPERTY_KEYS: SurfaceQuickPropertyKey[] = [
  'height',
  'name',
  'adcode',
  'citycode',
  'fullAddress',
  'streetNumber',
  'communityName',
]
const SURFACE_QUICK_PROPERTY_KEY_SET = new Set<string>(SURFACE_QUICK_PROPERTY_KEYS)
const SURFACE_INTERNAL_PROPERTY_KEYS = new Set(['sourceType', 'buildingSourceId'])
const SURFACE_REGULARIZE_OPTIONS = {
  angleSnapDeg: 10,
  lineSnapDistanceMeters: 0.8,
  maxMoveRatio: 0.3,
}

const amapKey = import.meta.env.VITE_AMAP_KEY as string | undefined
const amapSearchKey =
  (import.meta.env.VITE_AMAP_SEARCH_KEY as string | undefined) ?? amapKey
const amapMapStyle =
  (import.meta.env.VITE_AMAP_MAP_STYLE as string | undefined) ?? 'amap://styles/normal'
const amapSecurityJsCode = import.meta.env.VITE_AMAP_SECURITY_JS_CODE as string | undefined

const mapContainer = ref<HTMLElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)
const searchQuery = ref('')
const isSearching = ref(false)
const searchError = ref('')
const searchTips = ref<SearchTip[]>([])
const searchSuggestionsStyle = ref<Record<string, string>>({})
const drawMode = ref<DrawMode>('none')
const selectedFeatureId = ref<string | null>(null)
const selectedExportSurfaceIds = ref<string[]>([])
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
const feedback = ref('提示：双击地图空白处也可自动开始绘制。')

const isExportModalOpen = ref(false)
const isUserManualOpen = ref(false)
const showGeojsonText = ref(false)
const isEditingSelected = ref(false)
const isBuildingLayerVisible = ref(false)
const isBuildingDataLoading = ref(false)
const hasBuildingDataLoaded = ref(false)
const visibleBuildingCandidateCount = ref(0)
const currentMapZoom = ref(11)
const isBuildingActionsExpanded = ref(false)
const selectedMapInfo = ref<MapInfoCard | null>(null)
const isMapInfoLoading = ref(false)
const surfaceQuickPropertyValues = ref<SurfaceQuickPropertyValues>({
  height: '',
  name: '',
  adcode: '',
  citycode: '',
  fullAddress: '',
  streetNumber: '',
  communityName: '',
})
const surfaceCustomPropertyRows = ref<SurfaceCustomPropertyRow[]>([])
const surfaceEditableCustomKeys = ref<string[]>([])
const isSurfacePropertyPanelOpen = ref(false)

let map: any | null = null
let mouseTool: any | null = null
let polygonEditor: any | null = null
let suggestionTimer: number | null = null
let suggestionRequestSeq = 0
let mapInfoRequestSeq = 0
let mapApi: any | null = null
let placeSearchService: any | null = null
let surfaceDragHandleMarker: any | null = null
let surfaceDragStartPosition: [number, number] | null = null
let surfaceDragStartItems:
  | Array<{ id: string; geometryType: SurfaceGeometryType; rings: PolygonRings }>
  | null = null
let surfaceDragPointerCleanup: (() => void) | null = null
let surfaceWorkbenchUnmount: (() => void) | null = null
let surfaceWorkbenchMode: 'single' | 'batch' | null = null

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
const selectedExportSurfaceLookup = computed(() => new Set(selectedExportSurfaceIds.value))
const batchSurfaceCount = computed(() => selectedExportSurfaceIds.value.length)
const isBatchSurfaceSelection = computed(() => batchSurfaceCount.value > 1)
const hasExportSurfaceFeatures = computed(() =>
  parsedFeatureCollection.value.features.some(
    (feature) => feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon',
  ),
)
const isBuildingLayerReady = computed(
  () => isBuildingLayerVisible.value && hasBuildingDataLoaded.value && !isBuildingDataLoading.value,
)
const regularizeThreshold = ref(SURFACE_REGULARIZE_OPTIONS.maxMoveRatio)
const canUseBuildingLayerAtCurrentZoom = computed(
  () => currentMapZoom.value >= BUILDING_LAYER_MIN_ZOOM,
)
const surfacePropertyPanelMode = computed<'single' | 'batch'>(() =>
  isBatchSurfaceSelection.value ? 'batch' : 'single',
)
const surfacePropertyTargetCount = computed(() =>
  isBatchSurfaceSelection.value ? selectedExportSurfaceIds.value.length : 1,
)
const hasSurfacePropertyTarget = computed(() => {
  if (isBatchSurfaceSelection.value) {
    return selectedExportSurfaceIds.value.length > 1
  }
  if (!selectedFeatureId.value) {
    return false
  }
  return Boolean(getSurfaceFeatureById(selectedFeatureId.value))
})
const shouldShowSurfacePropertyPanel = computed(() => {
  if (!hasSurfacePropertyTarget.value) return false
  if (!isSurfacePropertyPanelOpen.value) return false
  if (isBatchSurfaceSelection.value) return true
  return isEditingSelected.value
})
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

const safeInfoValue = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    const text = value
      .map((item) => safeInfoValue(item))
      .filter((item): item is string => Boolean(item))
      .join(' / ')
    return text || null
  }
  return null
}

const createEmptySurfaceQuickPropertyValues = (): SurfaceQuickPropertyValues => ({
  height: '',
  name: '',
  adcode: '',
  citycode: '',
  fullAddress: '',
  streetNumber: '',
  communityName: '',
})

const normalizeHeightPropertyValue = (rawValue: string): string | number => {
  const trimmed = rawValue.trim()
  if (!trimmed) return ''
  const parsed = Number(trimmed)
  if (Number.isFinite(parsed)) return parsed
  return trimmed
}

const extractEditableCustomProperties = (
  properties: GeoJsonProperties | null | undefined,
): { rows: SurfaceCustomPropertyRow[]; keys: string[] } => {
  if (!properties) {
    return { rows: [], keys: [] }
  }

  const rows: SurfaceCustomPropertyRow[] = []
  const keys: string[] = []
  for (const [key, value] of Object.entries(properties)) {
    if (SURFACE_QUICK_PROPERTY_KEY_SET.has(key) || SURFACE_INTERNAL_PROPERTY_KEYS.has(key)) {
      continue
    }
    const text = safeInfoValue(value)
    if (!text) continue
    rows.push({
      id: createFeatureId(),
      key,
      value: text,
    })
    keys.push(key)
  }
  return { rows, keys }
}

const resetSurfacePropertyEditor = (): void => {
  surfaceQuickPropertyValues.value = createEmptySurfaceQuickPropertyValues()
  surfaceCustomPropertyRows.value = []
  surfaceEditableCustomKeys.value = []
}

const syncSurfacePropertyEditorFromSelection = (): void => {
  if (isBatchSurfaceSelection.value) {
    resetSurfacePropertyEditor()
    return
  }
  if (!selectedFeatureId.value) {
    resetSurfacePropertyEditor()
    return
  }
  const selectedFeature = getSurfaceFeatureById(selectedFeatureId.value)
  if (!selectedFeature) {
    resetSurfacePropertyEditor()
    return
  }

  const properties = selectedFeature.properties ?? {}
  const nextQuickValues = createEmptySurfaceQuickPropertyValues()
  for (const key of SURFACE_QUICK_PROPERTY_KEYS) {
    nextQuickValues[key] = safeInfoValue(properties[key]) ?? ''
  }
  const { rows, keys } = extractEditableCustomProperties(properties)
  surfaceQuickPropertyValues.value = nextQuickValues
  surfaceCustomPropertyRows.value = rows
  surfaceEditableCustomKeys.value = keys
}

const handleSurfaceQuickPropertyChange = (key: SurfaceQuickPropertyKey, value: string): void => {
  surfaceQuickPropertyValues.value = {
    ...surfaceQuickPropertyValues.value,
    [key]: value,
  }
}

const handleSurfaceCustomRowsChange = (rows: SurfaceCustomPropertyRow[]): void => {
  surfaceCustomPropertyRows.value = rows
}

const toggleSurfacePropertyPanel = (): void => {
  if (!hasSurfacePropertyTarget.value) return
  isSurfacePropertyPanelOpen.value = !isSurfacePropertyPanelOpen.value
}

const applySurfacePropertiesToSingleFeature = (): void => {
  if (!selectedFeatureId.value) {
    feedback.value = '请先选中一个建筑面。'
    return
  }
  const selectedFeature = getSurfaceFeatureById(selectedFeatureId.value)
  if (!selectedFeature) {
    feedback.value = '当前选中要素不是建筑面，无法设置属性。'
    return
  }

  const nextProperties: GeoJsonProperties = {
    ...(selectedFeature.properties ?? {}),
  }

  for (const key of surfaceEditableCustomKeys.value) {
    delete nextProperties[key]
  }

  for (const key of SURFACE_QUICK_PROPERTY_KEYS) {
    const rawValue = surfaceQuickPropertyValues.value[key]?.trim() ?? ''
    if (!rawValue) {
      delete nextProperties[key]
      continue
    }
    nextProperties[key] = key === 'height' ? normalizeHeightPropertyValue(rawValue) : rawValue
  }

  for (const row of surfaceCustomPropertyRows.value) {
    const customKey = row.key.trim()
    const customValue = row.value.trim()
    if (!customKey || !customValue) continue
    if (SURFACE_INTERNAL_PROPERTY_KEYS.has(customKey)) continue
    nextProperties[customKey] = customValue
  }

  updateFeature(String(selectedFeature.id), {
    ...selectedFeature,
    properties: nextProperties,
  })
  syncSurfacePropertyEditorFromSelection()
  feedback.value = '建筑面属性已保存。'
}

const applySurfacePropertiesToBatchFeatures = (): void => {
  const targetIds = new Set(selectedExportSurfaceIds.value)
  if (!targetIds.size) {
    feedback.value = '请先框选需要批量设置属性的建筑面。'
    return
  }

  const patch: GeoJsonProperties = {}
  for (const key of SURFACE_QUICK_PROPERTY_KEYS) {
    const rawValue = surfaceQuickPropertyValues.value[key]?.trim() ?? ''
    if (!rawValue) continue
    patch[key] = key === 'height' ? normalizeHeightPropertyValue(rawValue) : rawValue
  }

  for (const row of surfaceCustomPropertyRows.value) {
    const customKey = row.key.trim()
    const customValue = row.value.trim()
    if (!customKey || !customValue) continue
    if (SURFACE_INTERNAL_PROPERTY_KEYS.has(customKey)) continue
    patch[customKey] = customValue
  }

  if (!Object.keys(patch).length) {
    feedback.value = '请至少填写一个属性后再批量应用。'
    return
  }

  let updatedCount = 0
  features = features.map((feature) => {
    const id = String(feature.id)
    if (!targetIds.has(id)) return feature
    if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') {
      return feature
    }
    updatedCount += 1
    return {
      ...feature,
      properties: {
        ...(feature.properties ?? {}),
        ...patch,
      },
    }
  })

  if (!updatedCount) {
    feedback.value = '批量应用失败：未找到可更新的建筑面。'
    return
  }

  syncExportedBuildingSourceIds()
  syncGeojson()
  refreshVisibleBuildingCandidates()
  feedback.value = `已批量更新 ${updatedCount} 个建筑面的属性。`
}

const applySurfaceProperties = (): void => {
  if (isBatchSurfaceSelection.value) {
    applySurfacePropertiesToBatchFeatures()
    return
  }
  applySurfacePropertiesToSingleFeature()
}

const showMapInfoCard = (title: string, source: string, items: InfoCardItem[]): void => {
  selectedMapInfo.value = {
    title,
    source,
    items: items.filter((item) => item.value),
  }
}

const clearMapInfoCard = (): void => {
  selectedMapInfo.value = null
  isMapInfoLoading.value = false
}

const setMapInfoFromBuildingCandidate = (candidate: CandidateBuilding): void => {
  const properties = candidate.properties ?? {}
  const title =
    safeInfoValue(
      properties.name ??
        properties.building_name ??
        properties.buildingName ??
        properties.label ??
        properties.title,
    ) ?? `候选建筑 ${candidate.id}`

  const preferredItems: InfoCardItem[] = [
    {
      label: '小区/区域',
      value:
        safeInfoValue(
          properties.community ??
            properties.community_name ??
            properties.estate ??
            properties.neighborhood ??
            properties.address,
        ) ?? '',
    },
    {
      label: '楼层高度',
      value: safeInfoValue(properties.height) ?? '',
    },
    {
      label: '数据来源',
      value: safeInfoValue(properties._source) ?? '建筑候选图层',
    },
  ]

  const extraItems = Object.entries(properties)
    .filter(([key]) => !['name', 'building_name', 'buildingName', 'label', 'title'].includes(key))
    .map(([key, value]) => ({
      label: key,
      value: safeInfoValue(value) ?? '',
    }))
    .filter((item) => item.value)
    .slice(0, 6)

  const preferredLabels = new Set(preferredItems.filter((item) => item.value).map((item) => item.label))
  const mergedItems = [
    ...preferredItems.filter((item) => item.value),
    ...extraItems.filter((item) => !preferredLabels.has(item.label)),
  ]

  showMapInfoCard(title, '候选建筑', mergedItems)
}

const fetchPlaceDetailById = async (poiId: string): Promise<AmapWebPlaceDetailResponse> => {
  const params = new URLSearchParams({
    key: amapSearchKey ?? '',
    id: poiId,
    extensions: 'all',
  })
  const resp = await fetch(`https://restapi.amap.com/v3/place/detail?${params.toString()}`)
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`)
  }
  return (await resp.json()) as AmapWebPlaceDetailResponse
}

const fetchRegeoByLocation = async (lng: number, lat: number): Promise<AmapRegeoResponse> => {
  const params = new URLSearchParams({
    key: amapSearchKey ?? '',
    location: `${lng},${lat}`,
    extensions: 'all',
    radius: '100',
  })
  const resp = await fetch(`https://restapi.amap.com/v3/geocode/regeo?${params.toString()}`)
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`)
  }
  return (await resp.json()) as AmapRegeoResponse
}

const fetchPlaceDetailFromSdk = (poiId: string): Promise<AmapPoiDetail | null> =>
  new Promise((resolve) => {
    if (!placeSearchService) {
      resolve(null)
      return
    }
    placeSearchService.getDetails(poiId, (status: string, result: any) => {
      if (status !== 'complete' || result?.info !== 'OK') {
        resolve(null)
        return
      }
      resolve((result?.poiList?.pois?.[0] as AmapPoiDetail | undefined) ?? null)
    })
  })

const buildHotspotInfoItems = (
  poiId: string | null,
  poiName: string,
  hotspotLocation: [number, number] | null,
  webPoi: AmapWebPlaceDetailPoi | null,
  sdkPoi: AmapPoiDetail | null,
  regeo: AmapRegeoResult | null,
): InfoCardItem[] => {
  const resolvedPoi = webPoi ?? sdkPoi
  const component = regeo?.addressComponent
  const cityValue = safeInfoValue(component?.city)
  const districtText = [component?.province, cityValue, component?.district].filter(Boolean).join(' ')
  const poiDistrict = [resolvedPoi?.pname, resolvedPoi?.cityname, resolvedPoi?.adname]
    .map((value) => safeInfoValue(value))
    .filter(Boolean)
    .join(' ')
  const streetNumberText = [component?.streetNumber?.street, component?.streetNumber?.number]
    .filter(Boolean)
    .join('')

  const values: InfoCardItem[] = [
    { label: 'POI ID', value: poiId ?? '' },
    { label: '名称', value: safeInfoValue(resolvedPoi?.name) ?? poiName },
    {
      label: '行政区编码(adcode)',
      value: safeInfoValue(webPoi?.adcode) ?? safeInfoValue(component?.adcode) ?? '',
    },
    {
      label: '城市编码(citycode)',
      value: safeInfoValue(webPoi?.citycode) ?? safeInfoValue(component?.citycode) ?? '',
    },
    { label: '完整地址', value: safeInfoValue(regeo?.formatted_address) ?? '' },
    { label: '地址(POI)', value: safeInfoValue(resolvedPoi?.address) ?? '' },
    { label: '省市区', value: districtText || poiDistrict },
    {
      label: '街道门牌',
      value: streetNumberText,
    },
    {
      label: '乡镇街道编码',
      value: safeInfoValue(component?.towncode) ?? '',
    },
    { label: '小区/社区', value: safeInfoValue(component?.neighborhood?.name) ?? '' },
    { label: '建筑', value: safeInfoValue(component?.building?.name) ?? '' },
    { label: '类型', value: safeInfoValue(resolvedPoi?.type) ?? '' },
    { label: '类型编码', value: safeInfoValue(resolvedPoi?.typecode) ?? '' },
    { label: '行业类型', value: safeInfoValue(webPoi?.biz_type) ?? '' },
    { label: '商圈', value: safeInfoValue(webPoi?.business_area) ?? '' },
    { label: '电话', value: safeInfoValue(resolvedPoi?.tel) ?? '' },
    { label: '邮编', value: safeInfoValue(webPoi?.postcode) ?? '' },
    { label: '官网', value: safeInfoValue(webPoi?.website) ?? '' },
    { label: '邮箱', value: safeInfoValue(webPoi?.email) ?? '' },
    { label: '停车场类型', value: safeInfoValue(webPoi?.parking_type) ?? '' },
    { label: '入口坐标', value: safeInfoValue(webPoi?.entr_location) ?? '' },
    { label: '出口坐标', value: safeInfoValue(webPoi?.exit_location) ?? '' },
    { label: '导航POI ID', value: safeInfoValue(webPoi?.navi_poiid) ?? '' },
    { label: '网格编码', value: safeInfoValue(webPoi?.gridcode) ?? '' },
    { label: '别名', value: safeInfoValue(webPoi?.alias) ?? '' },
    {
      label: '坐标',
      value:
        safeInfoValue(resolvedPoi?.location) ??
        (hotspotLocation ? `${hotspotLocation[0].toFixed(6)}, ${hotspotLocation[1].toFixed(6)}` : ''),
    },
  ]
  return values.filter((item) => item.value)
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

watch(isBuildingLayerVisible, (visible) => {
  if (!visible) {
    isBuildingActionsExpanded.value = false
  }
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

watch(
  [selectedFeatureId, selectedExportSurfaceIds, isBatchSurfaceSelection],
  () => {
    syncSurfacePropertyEditorFromSelection()
  },
  { immediate: true },
)

const getDragHandlePositionFromBounds = (bounds: BBox): [number, number] | null => {
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

const getDragHandlePosition = (geometry: SurfaceGeometry): [number, number] | null => {
  const bounds = getBoundsFromGeometry(geometry)
  if (!bounds) return null
  return getDragHandlePositionFromBounds(bounds)
}

const getBatchSurfaceBounds = (ids: string[]): BBox | null => {
  let minLng = Number.POSITIVE_INFINITY
  let minLat = Number.POSITIVE_INFINITY
  let maxLng = Number.NEGATIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY

  for (const id of ids) {
    const feature = getSurfaceFeatureById(id)
    if (!feature) continue
    const bounds = getBoundsFromGeometry(feature.geometry)
    if (!bounds) continue
    minLng = Math.min(minLng, bounds[0])
    minLat = Math.min(minLat, bounds[1])
    maxLng = Math.max(maxLng, bounds[2])
    maxLat = Math.max(maxLat, bounds[3])
  }

  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) {
    return null
  }
  return [minLng, minLat, maxLng, maxLat]
}

const getSurfaceWorkbenchSelectionIds = (): string[] => {
  if (surfaceWorkbenchMode === 'batch' || isBatchSurfaceSelection.value) {
    return selectedExportSurfaceIds.value.filter((id) => {
      const overlayItem = overlays.get(id)
      return overlayItem?.kind === 'export-surface' && Boolean(getSurfaceFeatureById(id))
    })
  }
  if (!selectedFeatureId.value) return []
  const overlayItem = overlays.get(selectedFeatureId.value)
  if (overlayItem?.kind !== 'export-surface') return []
  if (!getSurfaceFeatureById(selectedFeatureId.value)) return []
  return [selectedFeatureId.value]
}

const getSurfaceDragSelectionItems = (ids: string[]) => {
  const items: Array<{ id: string; geometryType: SurfaceGeometryType; rings: PolygonRings }> = []
  for (const id of ids) {
    const feature = getSurfaceFeatureById(id)
    if (!feature) continue
    const rings = geometryToSinglePolygonRings(feature.geometry)
    if (!rings) continue
    items.push({
      id,
      geometryType: feature.geometry.type,
      rings: rings.map((ring) => ring.map(([lng, lat]) => [lng, lat] as [number, number])),
    })
  }
  return items
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
  surfaceWorkbenchUnmount?.()
  surfaceWorkbenchUnmount = null
  if (surfaceDragHandleMarker && map) {
    map.remove(surfaceDragHandleMarker)
  }
  surfaceDragHandleMarker = null
  surfaceDragStartPosition = null
  surfaceDragStartItems = null
  surfaceWorkbenchMode = null
}

const syncSurfaceDragHandlePosition = (): void => {
  if (!surfaceDragHandleMarker) return
  const selectionIds = getSurfaceWorkbenchSelectionIds()
  if (!selectionIds.length) return
  let position: [number, number] | null = null
  if (selectionIds.length > 1) {
    const batchBounds = getBatchSurfaceBounds(selectionIds)
    position = batchBounds ? getDragHandlePositionFromBounds(batchBounds) : null
  } else {
    const selectedFeature = getSurfaceFeatureById(selectionIds[0])
    position = selectedFeature ? getDragHandlePosition(selectedFeature.geometry) : null
  }
  if (!position) return
  surfaceDragHandleMarker.setPosition(position)
}

const syncSurfaceWorkbenchForSelection = (): void => {
  if (isEditingSelected.value) return
  if (isBatchSurfaceSelection.value) {
    setupSurfaceDragHandle('batch')
    return
  }
  teardownSurfaceDragHandle()
}

const setupSurfaceDragHandle = (mode: 'single' | 'batch' = 'single'): void => {
  if (!map || !mapApi) return

  const selectionIds =
    mode === 'batch' ? selectedExportSurfaceIds.value : selectedFeatureId.value ? [selectedFeatureId.value] : []
  const validSelectionIds = selectionIds.filter((id) => {
    const overlayItem = overlays.get(id)
    return overlayItem?.kind === 'export-surface' && Boolean(getSurfaceFeatureById(id))
  })
  if (!validSelectionIds.length) return
  if (mode === 'batch' && validSelectionIds.length < 2) return

  const position =
    mode === 'batch'
      ? (() => {
          const batchBounds = getBatchSurfaceBounds(validSelectionIds)
          return batchBounds ? getDragHandlePositionFromBounds(batchBounds) : null
        })()
      : (() => {
          const selectedFeature = getSurfaceFeatureById(validSelectionIds[0])
          return selectedFeature ? getDragHandlePosition(selectedFeature.geometry) : null
        })()
  if (!position) return

  teardownSurfaceDragHandle()

  const workbench = document.createElement('div')

  const handleMarker = new mapApi.Marker({
    position,
    draggable: false,
    bubble: false,
    zIndex: 430,
    offset: new mapApi.Pixel(-84, -18),
    content: workbench,
  })

  handleMarker.setMap(map)

  const startDrag = (downEvent: MouseEvent): void => {
    const dragItems = getSurfaceDragSelectionItems(validSelectionIds)
    if (!dragItems.length) return

    surfaceDragStartPosition = toLngLatPair(handleMarker.getPosition())
    const dragStartMousePosition =
      getLngLatFromClientPoint(downEvent.clientX, downEvent.clientY) ?? surfaceDragStartPosition
    surfaceDragStartItems = dragItems
    polygonEditor?.close()
    polygonEditor = null
    isEditingSelected.value = false
    map?.setDefaultCursor('grabbing')
    let latestDeltaLng = 0
    let latestDeltaLat = 0

    const handleMove = (moveEvent: MouseEvent): void => {
      if (!surfaceDragStartPosition || !surfaceDragStartItems) return

      const nextMousePosition = getLngLatFromClientPoint(moveEvent.clientX, moveEvent.clientY)
      if (!nextMousePosition) return

      const deltaLng = nextMousePosition[0] - dragStartMousePosition[0]
      const deltaLat = nextMousePosition[1] - dragStartMousePosition[1]
      latestDeltaLng = deltaLng
      latestDeltaLat = deltaLat
      for (const item of surfaceDragStartItems) {
        const nextRings = translatePolygonRings(item.rings, deltaLng, deltaLat)
        const nextGeometry = getSurfaceGeometryFromRings(item.geometryType, nextRings)
        const nextPath = geometryToAmapPath(nextGeometry)
        const overlayItem = overlays.get(item.id)
        if (!nextPath || overlayItem?.kind !== 'export-surface') continue
        overlayItem.overlay.setPath(nextPath)
      }
      handleMarker.setPosition([
        surfaceDragStartPosition[0] + deltaLng,
        surfaceDragStartPosition[1] + deltaLat,
      ])
    }

    const handleUp = (upEvent: MouseEvent): void => {
      const nextMousePosition = getLngLatFromClientPoint(upEvent.clientX, upEvent.clientY)

      if (!surfaceDragStartPosition || !surfaceDragStartItems) {
        surfaceDragPointerCleanup?.()
        surfaceDragPointerCleanup = null
        map?.setDefaultCursor('default')
        syncSurfaceDragHandlePosition()
        return
      }

      const deltaLng =
        nextMousePosition?.[0] !== undefined
          ? nextMousePosition[0] - dragStartMousePosition[0]
          : latestDeltaLng
      const deltaLat =
        nextMousePosition?.[1] !== undefined
          ? nextMousePosition[1] - dragStartMousePosition[1]
          : latestDeltaLat
      const nextGeometryById = new Map<string, SurfaceGeometry>()
      for (const item of surfaceDragStartItems) {
        const nextRings = translatePolygonRings(item.rings, deltaLng, deltaLat)
        const nextGeometry = getSurfaceGeometryFromRings(item.geometryType, nextRings)
        const nextPath = geometryToAmapPath(nextGeometry)
        const overlayItem = overlays.get(item.id)
        if (!nextPath || overlayItem?.kind !== 'export-surface') continue
        overlayItem.overlay.setPath(nextPath)
        nextGeometryById.set(item.id, nextGeometry)
      }

      surfaceDragStartPosition = null
      surfaceDragStartItems = null
      surfaceDragPointerCleanup?.()
      surfaceDragPointerCleanup = null
      map?.setDefaultCursor('default')

      if (!nextGeometryById.size) {
        syncSurfaceDragHandlePosition()
        return
      }

      features = features.map((feature) => {
        if (feature.geometry.type === 'Point') return feature
        const nextGeometry = nextGeometryById.get(String(feature.id))
        if (!nextGeometry) return feature
        return {
          ...feature,
          geometry: nextGeometry,
        }
      })
      syncGeojson()
      refreshVisibleBuildingCandidates()

      if (mode === 'single') {
        if (selectedFeatureId.value) {
          startEditSelected()
        }
        feedback.value = '已通过上方工作区移动选中面。'
        return
      }

      syncSurfaceDragHandlePosition()
      feedback.value = `已整体移动 ${nextGeometryById.size} 个选中建筑面。`
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp, { once: true })
    surfaceDragPointerCleanup = () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }

  const workbenchApp = createApp(SurfaceWorkbench, {
    initialRegularizeThreshold: regularizeThreshold.value,
    mode,
    selectionCount: validSelectionIds.length,
    propertyPanelVisible: isSurfacePropertyPanelOpen.value,
    onDragStart: startDrag,
    onTogglePropertyPanel: () => {
      toggleSurfacePropertyPanel()
    },
    onCopy: () => {
      copySelected()
    },
    onFlatten: (threshold: number) => {
      regularizeThreshold.value = threshold
      flattenSelectedSurfaces(threshold)
    },
    onRemove: () => {
      deleteSelected()
    },
    onFinish: () => {
      if (mode === 'batch') {
        isSurfacePropertyPanelOpen.value = false
        setSelectedExportSurfaceIds([])
        setSelectedFeature(null)
        teardownSurfaceDragHandle()
        feedback.value = '已结束当前批量选择。'
        return
      }
      isSurfacePropertyPanelOpen.value = false
      stopPolygonEditing()
      feedback.value = '已结束当前面的编辑。'
    },
  })
  workbenchApp.mount(workbench)
  surfaceWorkbenchUnmount = () => {
    workbenchApp.unmount()
  }

  surfaceDragHandleMarker = handleMarker
  surfaceWorkbenchMode = mode
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

const refreshExportOverlaySelectionStyles = (): void => {
  for (const overlayItem of overlays.values()) {
    if (overlayItem.kind === 'export-point') {
      applySelectionStyle(overlayItem, overlayItem.id === selectedFeatureId.value)
      continue
    }
    const isSelected =
      overlayItem.id === selectedFeatureId.value || selectedExportSurfaceLookup.value.has(overlayItem.id)
    applySelectionStyle(overlayItem, isSelected)
  }
}

const setSelectedExportSurfaceIds = (ids: string[]): void => {
  const uniqIds = Array.from(new Set(ids))
  selectedExportSurfaceIds.value = uniqIds
  refreshExportOverlaySelectionStyles()
  syncSurfaceWorkbenchForSelection()
}

const setSelectedFeature = (nextId: string | null, options?: { preserveMulti?: boolean }): void => {
  if (selectedFeatureId.value !== nextId && isEditingSelected.value) {
    stopPolygonEditing()
  }
  if (!options?.preserveMulti && selectedExportSurfaceIds.value.length) {
    selectedExportSurfaceIds.value = []
  }
  selectedFeatureId.value = nextId
  refreshExportOverlaySelectionStyles()
  syncSurfaceWorkbenchForSelection()
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

const handleMapHotspotClick = async (event: any): Promise<void> => {
  const requestSeq = ++mapInfoRequestSeq
  const hotspotName = safeInfoValue(event?.name) ?? '地图兴趣点'
  const hotspotLocation = event?.lnglat ? toLngLatPair(event.lnglat) : null
  const fallbackItems: InfoCardItem[] = hotspotLocation
    ? [{ label: '坐标', value: `${hotspotLocation[0].toFixed(6)}, ${hotspotLocation[1].toFixed(6)}` }]
    : []

  showMapInfoCard(hotspotName, '地图点位', fallbackItems)

  const poiId = safeInfoValue(event?.id)
  if (!poiId) {
    return
  }

  isMapInfoLoading.value = true
  try {
    const tasks: Array<Promise<any>> = []
    tasks.push(fetchPlaceDetailById(poiId))
    tasks.push(fetchPlaceDetailFromSdk(poiId))
    if (hotspotLocation) {
      tasks.push(fetchRegeoByLocation(hotspotLocation[0], hotspotLocation[1]))
    }

    const [webDetailResult, sdkDetailResult, regeoResult] = await Promise.allSettled(tasks)
    if (requestSeq !== mapInfoRequestSeq) return

    const webDetail =
      webDetailResult?.status === 'fulfilled' &&
      webDetailResult.value?.status === '1' &&
      Array.isArray(webDetailResult.value?.pois) &&
      webDetailResult.value.pois.length
        ? (webDetailResult.value.pois[0] as AmapWebPlaceDetailPoi)
        : null

    const sdkDetail =
      sdkDetailResult?.status === 'fulfilled' ? (sdkDetailResult.value as AmapPoiDetail | null) : null

    const regeoData =
      regeoResult?.status === 'fulfilled' && regeoResult.value?.status === '1'
        ? ((regeoResult.value as AmapRegeoResponse).regeocode ?? null)
        : null

    const mergedItems = buildHotspotInfoItems(
      poiId,
      hotspotName,
      hotspotLocation,
      webDetail,
      sdkDetail,
      regeoData,
    )
    showMapInfoCard(
      safeInfoValue(webDetail?.name) ?? safeInfoValue(sdkDetail?.name) ?? hotspotName,
      '地图点位',
      mergedItems.length ? mergedItems : fallbackItems,
    )
  } catch {
    if (requestSeq !== mapInfoRequestSeq) return
  } finally {
    if (requestSeq === mapInfoRequestSeq) {
      isMapInfoLoading.value = false
    }
  }
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
  if (selectedExportSurfaceLookup.value.has(id)) {
    setSelectedExportSurfaceIds(selectedExportSurfaceIds.value.filter((featureId) => featureId !== id))
  }

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
  if (isBatchSurfaceSelection.value) {
    feedback.value = '当前为批量选择，请先结束批量状态后再编辑单个面。'
    return
  }
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

  polygonEditor = new mapApi.PolygonEditor(map, selected.overlay, {
    editOptions: {
      strokeColor: SELECTED_SURFACE_STYLE.strokeColor,
      strokeWeight: 2,
      fillColor: SELECTED_SURFACE_STYLE.fillColor,
      fillOpacity: 0.18,
    },
    controlPoint: {
      // 非常浅的蓝色实心点，看起来不抢眼
      fillColor: '#dbeafe',
      strokeColor: '#60a5fa',
      strokeWeight: 1,
    },
    midControlPoint: {
      // 中点弱化：接近背景的填充 + 很浅的蓝色边框
      fillColor: '#f8fafc',
      strokeColor: '#93c5fd',
      strokeWeight: 1,
    },
  })
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
  setupSurfaceDragHandle('single')
  isEditingSelected.value = true
  feedback.value = '面编辑模式已开启：可在上方工作区复制、规整、拖拽、删除或完成。'
}

const flattenSelectedSurface = (threshold: number = regularizeThreshold.value): void => {
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

  const regularizedOuterRing = regularizePolygonRing(rings[0], {
    ...SURFACE_REGULARIZE_OPTIONS,
    maxMoveRatio: threshold,
    lineSnapDistanceMeters: SURFACE_REGULARIZE_OPTIONS.lineSnapDistanceMeters * (1 + threshold * 2),
  })
  const flattenedOuterRing = regularizedOuterRing ?? getMinimumAreaBoundingRectangle(rings[0])
  if (!flattenedOuterRing) {
    feedback.value = '当前面形状不足以进行智能规整。'
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

  feedback.value = regularizedOuterRing
    ? '已智能规整选中面（共线/平行约束）。'
    : '已退回最小外接矩形规整（智能规整未收敛）。'
}

const flattenBatchSelectedSurfaces = (threshold: number = regularizeThreshold.value): void => {
  if (!isBatchSurfaceSelection.value) {
    flattenSelectedSurface(threshold)
    return
  }

  let successCount = 0
  let skippedCount = 0
  const nextGeometries = new Map<string, SurfaceGeometry>()

  for (const id of selectedExportSurfaceIds.value) {
    const feature = getSurfaceFeatureById(id)
    const overlayItem = overlays.get(id)
    if (!feature || overlayItem?.kind !== 'export-surface') {
      skippedCount += 1
      continue
    }
    const rings = geometryToSinglePolygonRings(feature.geometry)
    if (!rings || rings.length !== 1) {
      skippedCount += 1
      continue
    }
    const regularizedOuterRing = regularizePolygonRing(rings[0], {
      ...SURFACE_REGULARIZE_OPTIONS,
      maxMoveRatio: threshold,
      lineSnapDistanceMeters: SURFACE_REGULARIZE_OPTIONS.lineSnapDistanceMeters * (1 + threshold * 2),
    })
    const flattenedOuterRing = regularizedOuterRing ?? getMinimumAreaBoundingRectangle(rings[0])
    if (!flattenedOuterRing) {
      skippedCount += 1
      continue
    }
    const nextGeometry = getSurfaceGeometryFromRings(feature.geometry.type, [flattenedOuterRing])
    const nextPath = geometryToAmapPath(nextGeometry)
    if (!nextPath) {
      skippedCount += 1
      continue
    }
    overlayItem.overlay.setPath(nextPath)
    nextGeometries.set(id, nextGeometry)
    successCount += 1
  }

  if (!successCount) {
    feedback.value = '批量规整未生效：仅支持有效单环建筑面。'
    return
  }

  features = features.map((feature) => {
    if (feature.geometry.type === 'Point') return feature
    const nextGeometry = nextGeometries.get(String(feature.id))
    if (!nextGeometry) return feature
    return {
      ...feature,
      geometry: nextGeometry,
    }
  })
  syncGeojson()
  refreshVisibleBuildingCandidates()
  syncSurfaceDragHandlePosition()
  feedback.value =
    skippedCount > 0
      ? `批量规整完成：成功 ${successCount} 个，跳过 ${skippedCount} 个。`
      : `批量规整完成：成功 ${successCount} 个。`
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

const startRectangleSelectExportSurfaces = (): void => {
  if (!mouseTool) return
  if (!hasExportSurfaceFeatures.value) {
    feedback.value = '当前没有可框选的已有建筑面。'
    return
  }

  stopPolygonEditing()
  setSelectedFeature(null)
  drawMode.value = 'export-rectangle'
  mouseTool.close()
  map?.setDefaultCursor('crosshair')
  mouseTool.rectangle({
    strokeColor: '#f59e0b',
    strokeWeight: 2,
    strokeOpacity: 0.9,
    fillColor: '#fbbf24',
    fillOpacity: 0.1,
  })
  feedback.value = '已有建筑面框选已开启：按住鼠标拖拽选择范围。'
}

const toggleRectangleSelectExportSurfaces = (): void => {
  if (drawMode.value === 'export-rectangle') {
    stopDrawing()
    feedback.value = '已退出已有建筑面框选模式。'
    return
  }

  startRectangleSelectExportSurfaces()
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

  if (
    (drawMode.value === 'polygon' ||
      drawMode.value === 'building-rectangle' ||
      drawMode.value === 'export-rectangle') &&
    event.key === 'Escape'
  ) {
    event.preventDefault()
    stopDrawing()
    feedback.value = '已取消当前框选/绘制操作。'
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
      setMapInfoFromBuildingCandidate(candidate)
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

const handleToggleBuildingActions = async (): Promise<void> => {
  if (isBuildingLayerVisible.value) {
    await toggleBuildingLayer()
    return
  }

  await toggleBuildingLayer()
  if (isBuildingLayerVisible.value) {
    isBuildingActionsExpanded.value = true
  }
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

const handleExportSurfaceRectangleSelection = (rectangle: any): void => {
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
  const matchedSurfaceIds: string[] = []

  for (const feature of features) {
    if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') continue
    const featureBounds = getBoundsFromGeometry(feature.geometry)
    if (!featureBounds) continue
    if (!bboxIntersects(featureBounds, rectangleBounds)) continue
    matchedSurfaceIds.push(String(feature.id))
  }

  if (!matchedSurfaceIds.length) {
    setSelectedExportSurfaceIds([])
    setSelectedFeature(null)
    feedback.value = '框选范围内未命中已有建筑面。'
    return
  }

  setSelectedExportSurfaceIds(matchedSurfaceIds)
  const targetFeatureId = matchedSurfaceIds[matchedSurfaceIds.length - 1]
  setSelectedFeature(targetFeatureId, { preserveMulti: true })
  if (matchedSurfaceIds.length === 1) {
    startEditSelected()
    feedback.value = '框选完成，已选中 1 个已有建筑面并进入编辑。'
    return
  }
  feedback.value = `框选完成，已选中 ${matchedSurfaceIds.length} 个已有建筑面。`
}

const deleteBatchSelected = (): void => {
  const ids = [...selectedExportSurfaceIds.value]
  if (!ids.length) {
    feedback.value = '请先框选需要删除的建筑面。'
    return
  }
  stopPolygonEditing()
  const prevCount = overlays.size
  for (const id of ids) {
    removeFeatureById(id)
  }
  const deletedCount = Math.max(prevCount - overlays.size, 0)
  setSelectedExportSurfaceIds([])
  setSelectedFeature(null)
  teardownSurfaceDragHandle()
  feedback.value = `已批量删除 ${deletedCount} 个建筑面。`
}

const deleteSelected = (): void => {
  if (isBatchSurfaceSelection.value) {
    deleteBatchSelected()
    return
  }
  if (!selectedFeatureId.value) {
    feedback.value = '请先在地图上点选一个导出要素。'
    return
  }
  removeFeatureById(selectedFeatureId.value)
  feedback.value = '选中要素已删除。'
}

const copySelectedFeature = (): void => {
  if (!selectedFeatureId.value) {
    feedback.value = '请先选中一个面要素。'
    return
  }

  const selected = overlays.get(selectedFeatureId.value)
  if (!selected || selected.kind !== 'export-surface') {
    feedback.value = '当前选中要素不是面，无法复制。'
    return
  }

  const currentFeature = features.find((feature) => String(feature.id) === selected.id)
  if (!currentFeature || currentFeature.geometry.type === 'Point') {
    feedback.value = '当前选中要素不是面，无法复制。'
    return
  }

  const bounds = getBoundsFromGeometry(currentFeature.geometry)
  if (!bounds) {
    feedback.value = '复制失败：当前面边界无效。'
    return
  }
  const [minLng, minLat, maxLng, maxLat] = bounds
  const lngSpan = Math.abs(maxLng - minLng)
  const latSpan = Math.abs(maxLat - minLat)
  const offsetLng = Math.max(lngSpan * 0.12, 0.00003)
  const offsetLat = Math.max(latSpan * 0.12, 0.00003)

  const nextGeometry: SurfaceGeometry =
    currentFeature.geometry.type === 'Polygon'
      ? {
          type: 'Polygon',
          coordinates: currentFeature.geometry.coordinates.map((ring) =>
            ring.map((position) => [position[0] + offsetLng, position[1] + offsetLat] as [number, number]),
          ),
        }
      : {
          type: 'MultiPolygon',
          coordinates: currentFeature.geometry.coordinates.map((polygon) =>
            polygon.map((ring) =>
              ring.map((position) => [position[0] + offsetLng, position[1] + offsetLat] as [number, number]),
            ),
          ),
        }

  const copiedFeature: ExportFeature = {
    ...currentFeature,
    id: createFeatureId(),
    properties: {
      ...(currentFeature.properties ?? {}),
    },
    geometry: nextGeometry,
  }

  registerExportFeature(copiedFeature)
  features = [...features, copiedFeature]
  syncExportedBuildingSourceIds()
  syncGeojson()
  refreshVisibleBuildingCandidates()
  setSelectedFeature(String(copiedFeature.id))
  startEditSelected()
  feedback.value = '已复制选中面要素（已偏移），并进入复制体编辑。'
}

const copyBatchSelectedFeatures = (): void => {
  const ids = [...selectedExportSurfaceIds.value]
  if (!ids.length) {
    feedback.value = '请先框选需要复制的建筑面。'
    return
  }

  const nextFeatures = [...features]
  const copiedIds: string[] = []

  for (const id of ids) {
    const feature = getSurfaceFeatureById(id)
    if (!feature) continue
    const bounds = getBoundsFromGeometry(feature.geometry)
    if (!bounds) continue
    const [minLng, minLat, maxLng, maxLat] = bounds
    const lngSpan = Math.abs(maxLng - minLng)
    const latSpan = Math.abs(maxLat - minLat)
    const offsetLng = Math.max(lngSpan * 0.12, 0.00003)
    const offsetLat = Math.max(latSpan * 0.12, 0.00003)
    const copiedFeature: ExportFeature = {
      ...feature,
      id: createFeatureId(),
      properties: {
        ...(feature.properties ?? {}),
      },
      geometry:
        feature.geometry.type === 'Polygon'
          ? {
              type: 'Polygon',
              coordinates: feature.geometry.coordinates.map((ring) =>
                ring.map((position) => [position[0] + offsetLng, position[1] + offsetLat] as [number, number]),
              ),
            }
          : {
              type: 'MultiPolygon',
              coordinates: feature.geometry.coordinates.map((polygon) =>
                polygon.map((ring) =>
                  ring.map(
                    (position) => [position[0] + offsetLng, position[1] + offsetLat] as [number, number],
                  ),
                ),
              ),
            },
    }
    registerExportFeature(copiedFeature)
    nextFeatures.push(copiedFeature)
    copiedIds.push(String(copiedFeature.id))
  }

  if (!copiedIds.length) {
    feedback.value = '批量复制失败：未找到可复制的有效建筑面。'
    return
  }

  features = nextFeatures
  syncExportedBuildingSourceIds()
  syncGeojson()
  refreshVisibleBuildingCandidates()
  setSelectedExportSurfaceIds(copiedIds)
  setSelectedFeature(copiedIds[copiedIds.length - 1], { preserveMulti: true })
  setupSurfaceDragHandle('batch')
  feedback.value = `已批量复制 ${copiedIds.length} 个建筑面。`
}

const copySelected = (): void => {
  if (isBatchSurfaceSelection.value) {
    copyBatchSelectedFeatures()
    return
  }
  copySelectedFeature()
}

const flattenSelectedSurfaces = (threshold: number = regularizeThreshold.value): void => {
  if (isBatchSurfaceSelection.value) {
    flattenBatchSelectedSurfaces(threshold)
    return
  }
  flattenSelectedSurface(threshold)
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
  const zoom = 17
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

const updateSearchSuggestionsPosition = (): void => {
  if (!searchInputRef.value) return
  const rect = searchInputRef.value.getBoundingClientRect()
  searchSuggestionsStyle.value = {
    left: `${rect.left}px`,
    top: `${rect.bottom + 6}px`,
    width: `${rect.width}px`,
  }
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

  requestAnimationFrame(updateSearchSuggestionsPosition)

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

watch(
  searchTips,
  () => {
    if (!searchTips.value.length) return
    requestAnimationFrame(updateSearchSuggestionsPosition)
  },
  { deep: true },
)

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
    window.addEventListener('resize', updateSearchSuggestionsPosition)
    window.addEventListener('scroll', updateSearchSuggestionsPosition, true)

    if (amapSecurityJsCode) {
      ;(window as Window & { _AMapSecurityConfig?: { securityJsCode: string } })._AMapSecurityConfig =
        {
          securityJsCode: amapSecurityJsCode,
        }
    }

    mapApi = await AMapLoader.load({
      key: amapKey,
      version: '2.0',
      plugins: [
        'AMap.Scale',
        'AMap.ToolBar',
        'AMap.MouseTool',
        'AMap.PolygonEditor',
        'AMap.PlaceSearch',
      ],
    })

    map = new mapApi.Map(mapContainer.value, {
      // 使用俯视平面视图，避免 3D 楼块屋顶带来的面积放大与偏移
      viewMode: '2D',
      zoom: 12,
      center: [120.66748, 31.292582],
      mapStyle: amapMapStyle,
      doubleClickZoom: false,
      showBuildingBlock: true,
      features: ['bg', 'road', 'point', 'building'],
      pitch: 0,
      rotation: 0,
      pitchEnable: false,
      rotateEnable: false,
      isHotspot: true,
    })

    currentMapZoom.value = map.getZoom()
    map.addControl(new mapApi.Scale())
    map.addControl(new mapApi.ToolBar())
    placeSearchService = new mapApi.PlaceSearch()

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
      } else if (drawMode.value === 'export-rectangle') {
        handleExportSurfaceRectangleSelection(event.obj)
        stopDrawing()
      }
    })

    map.on('dblclick', handleMapBlankDoubleClick)
    map.on('hotspotclick', handleMapHotspotClick)
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
  window.removeEventListener('resize', updateSearchSuggestionsPosition)
  window.removeEventListener('scroll', updateSearchSuggestionsPosition, true)

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
  placeSearchService = null
})
</script>

<template>
  <main class="app-shell">
    <div ref="mapContainer" class="map-canvas" aria-label="地图绘制区域"></div>

    <div class="chrome-layer">
      <header class="top-strip">
        <div class="top-strip-left">
          <h1 class="app-title">GeoJson 建筑面工具</h1>
        </div>

        <div class="search-input-wrap header-search-wrap">
          <svg
            class="search-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            type="text"
            class="search-input"
            placeholder="输入地名、地址或关键词"
            @input="handleSearchInput"
            @keyup.enter="handleSearch"
          />
        </div>

        <div class="top-strip-right">
          <button
            type="button"
            class="btn btn-secondary export-trigger"
            @click="isExportModalOpen = true"
          >
            导出
          </button>
        </div>
      </header>

      <div class="manual-entry">
        <UserManualButton @click="isUserManualOpen = true" />
      </div>

      <Teleport to="body">
        <ul
          v-if="searchTips.length"
          class="search-suggestions search-suggestions-portal"
          :style="searchSuggestionsStyle"
        >
          <li v-for="(tip, idx) in searchTips" :key="`${tip.name}-${idx}`">
            <button type="button" class="search-suggestion-item" @click="selectSearchTip(tip)">
              <span class="tip-name">{{ tip.name }}</span>
              <span class="tip-meta">
                {{ [tip.district, tip.address].filter(Boolean).join(' ') }}
              </span>
            </button>
          </li>
        </ul>
      </Teleport>

      <aside class="tool-panel" aria-label="建筑面绘制与候选控制区">
        <button
          type="button"
          class="btn block-btn"
          :class="drawMode === 'polygon' ? 'btn-primary' : 'btn-ghost'"
          @click="toggleDrawPolygon"
        >
          {{ drawMode === 'polygon' ? '完成绘制' : '绘制建筑面' }}
        </button>
        <button
          type="button"
          class="btn block-btn"
          :class="drawMode === 'export-rectangle' ? 'btn-primary' : 'btn-ghost'"
          :disabled="!hasExportSurfaceFeatures"
          @click="toggleRectangleSelectExportSurfaces"
        >
          {{ drawMode === 'export-rectangle' ? '取消框选' : '开启框选' }}
        </button>

        <button
          type="button"
          class="btn block-btn"
          :class="isBuildingLayerVisible ? 'btn-primary' : 'btn-ghost'"
          :disabled="isBuildingDataLoading"
          @click="handleToggleBuildingActions"
        >
          {{
            isBuildingDataLoading
              ? '加载建筑面…'
              : isBuildingLayerVisible
                ? '关闭建筑候选'
                : '候选建筑'
          }}
        </button>

        <div class="building-action-cluster" :class="{ expanded: isBuildingActionsExpanded }">
          <button
            type="button"
            class="btn btn-ghost block-btn building-action-sub"
            :disabled="!isBuildingLayerReady || !canUseBuildingLayerAtCurrentZoom"
            @click="startRectangleSelectBuildings"
          >
            框选建筑
          </button>
          <button
            type="button"
            class="btn btn-ghost block-btn building-action-sub"
            :disabled="!selectedBuildingCandidateCount"
            @click="addSelectedBuildingCandidates"
          >
            加入选中建筑
          </button>
          <button
            type="button"
            class="btn btn-ghost block-btn building-action-sub"
            :disabled="!selectedBuildingCandidateCount"
            @click="clearBuildingCandidateSelection"
          >
            清空候选选择
          </button>
        </div>
        <p class="candidate-status">
          {{ buildingLayerStatus }}
        </p>
      </aside>

      <SurfacePropertyTable
        v-if="shouldShowSurfacePropertyPanel"
        class="surface-property-panel-anchor"
        :mode="surfacePropertyPanelMode"
        :target-count="surfacePropertyTargetCount"
        :quick-values="surfaceQuickPropertyValues"
        :custom-rows="surfaceCustomPropertyRows"
        :disabled="!hasSurfacePropertyTarget"
        @update-quick-value="handleSurfaceQuickPropertyChange"
        @update-custom-rows="handleSurfaceCustomRowsChange"
        @apply="applySurfaceProperties"
        @reset="syncSurfacePropertyEditorFromSelection"
      />

      <aside v-if="selectedMapInfo" class="poi-info-card" aria-label="地图点位信息">
        <header class="poi-info-header">
          <div>
            <p class="poi-info-source">{{ selectedMapInfo.source }}</p>
            <h3 class="poi-info-title">{{ selectedMapInfo.title }}</h3>
          </div>
          <button type="button" class="poi-info-close" aria-label="关闭信息" @click="clearMapInfoCard">
            ×
          </button>
        </header>
        <p v-if="isMapInfoLoading" class="poi-info-loading">正在获取更多详情...</p>
        <ul v-if="selectedMapInfo.items.length" class="poi-info-list">
          <li v-for="item in selectedMapInfo.items" :key="`${item.label}-${item.value}`">
            <span class="poi-info-label">{{ item.label }}</span>
            <span class="poi-info-value">{{ item.value }}</span>
          </li>
        </ul>
      </aside>
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

    <UserManualModal
      :open="isUserManualOpen"
      title="GeoJson 建筑面工具操作手册"
      :markdown="userManualMarkdown"
      @close="isUserManualOpen = false"
    />
  </main>
</template>

<style scoped>
.app-shell {
  position: relative;
  inset: 0;
  width: 100vw;
  height: 100vh;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
  color: #0f172a;
  background:
    radial-gradient(circle at 20% 20%, rgba(148, 163, 184, 0.2), transparent 55%),
    radial-gradient(circle at 80% 80%, rgba(191, 219, 254, 0.3), transparent 55%),
    #f9fafb;
  overflow: visible;
}

.map-canvas {
  position: absolute;
  inset: 0;
}

.chrome-layer {
  position: relative;
  z-index: 1000;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.manual-entry {
  position: absolute;
  top: 12px;
  right: 16px;
  z-index: 1200;
  pointer-events: auto;
}

.top-strip {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: space-between;
  column-gap: 16px;
  overflow: hidden;
  width: min(720px, 100% - 32px);
  padding: 4px 12px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.82), rgba(248, 250, 252, 0.9));
  border: 1px solid rgba(226, 232, 240, 0.9);
  box-shadow:
    0 18px 45px rgba(15, 23, 42, 0.08),
    0 0 0 1px rgba(148, 163, 184, 0.2);
  backdrop-filter: blur(26px) saturate(170%);
  -webkit-backdrop-filter: blur(26px) saturate(170%);
  pointer-events: auto;
}

.top-strip-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 0 0 auto;
}

.app-title {
  margin: 0;
  font-size: 13px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 600;
  color: #0f172a;
  white-space: nowrap;
}

.top-strip-right {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
  flex: 0 0 auto;
  justify-content: flex-end;
}

.search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 0 0 auto;
}

.header-search-wrap {
  position: relative;
  flex: 1 1 auto;
  min-width: 260px;
  max-width: 440px;
  overflow: visible;
  z-index: 80;
}

.search-input-wrap {
  position: relative;
  width: 100%;
  flex: 1;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  color: #94a3b8;
  pointer-events: none;
}

.search-input {
  box-sizing: border-box;
  width: 100%;
  height: 32px;
  padding: 0 12px 0 32px;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.55);
  background: radial-gradient(circle at 10% 0%, rgba(255, 255, 255, 0.95), rgba(248, 250, 252, 0.96));
  color: #0f172a;
  font-size: 13px;
  outline: none;
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease,
    background-color 150ms ease;
}

.search-input::placeholder {
  color: rgba(148, 163, 184, 0.9);
}

.search-input:focus {
  border-color: rgba(59, 130, 246, 0.9);
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.25);
}

.search-suggestions {
  margin: 0;
  padding: 4px;
  list-style: none;
  background: rgba(255, 255, 255, 0.98);
  border-radius: 14px;
  border: 1px solid rgba(191, 219, 254, 0.9);
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.09);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  z-index: 1300;
  pointer-events: auto;
}

.search-suggestions-portal {
  position: fixed;
  z-index: 1400;
}

.search-suggestion-item {
  width: 100%;
  padding: 6px 8px;
  border-radius: 10px;
  border: none;
  background: transparent;
  color: #0f172a;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  cursor: pointer;
  transition:
    background-color 150ms ease,
    transform 150ms ease;
}

.search-suggestion-item:hover {
  background: radial-gradient(circle at 0 0, rgba(59, 130, 246, 0.08), rgba(248, 250, 252, 1));
  transform: translateY(-1px);
}

.tip-name {
  font-size: 13px;
  font-weight: 500;
}

.tip-meta {
  margin-top: 1px;
  font-size: 11px;
  color: #6b7280;
}

.btn {
  box-sizing: border-box;
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 12px;
  height: 32px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: none;
  cursor: pointer;
  white-space: nowrap;
  background: transparent;
  color: #0f172a;
  transition:
    background-color 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 120ms ease;
}

.btn-primary {
  background: radial-gradient(circle at 0 0, rgba(59, 130, 246, 0.92), rgba(37, 99, 235, 1));
  border-color: rgba(59, 130, 246, 1);
  box-shadow:
    0 10px 26px rgba(37, 99, 235, 0.35),
    0 0 0 1px rgba(15, 23, 42, 0.02);
  color: #f9fafb;
}

.btn-secondary {
  background: radial-gradient(circle at 0 0, rgba(59, 130, 246, 0.92), rgba(37, 99, 235, 1));
  border-color: rgba(59, 130, 246, 1);
  box-shadow:
    0 10px 26px rgba(37, 99, 235, 0.35),
    0 0 0 1px rgba(15, 23, 42, 0.02);
  color: #f9fafb;
}

.btn-secondary:hover:not(:disabled) {
  background: radial-gradient(circle at 0 0, rgba(59, 130, 246, 0.98), rgba(37, 99, 235, 1));
}

.btn-ghost {
  background: rgba(255, 255, 255, 0.9);
  border-color: rgba(209, 213, 219, 0.9);
}

.btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow:
    0 14px 34px rgba(15, 23, 42, 0.08),
    0 0 0 1px rgba(148, 163, 184, 0.35);
}

button.btn.export-trigger {
  width: 73px;
}

.btn-primary:hover:not(:disabled) {
  background: radial-gradient(circle at 0 0, rgba(59, 130, 246, 0.98), rgba(37, 99, 235, 1));
}

.btn:disabled {
  cursor: default;
  opacity: 0.55;
  box-shadow: none;
}


.tool-panel {
  position: absolute;
  top: 78px;
  left: 16px;
  width: 220px;
  padding: 2px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  pointer-events: auto;
}

.surface-property-panel-anchor {
  position: absolute;
  top: 78px;
  left: 248px;
}

.tool-panel .btn {
  border-radius: 8px;
}

.block-btn {
  width: 100%;
  justify-content: space-between;
}

.block-btn + .block-btn {
  margin-top: 2px;
}

.building-action-cluster {
  position: relative;
  --cluster-gap: 6px;
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: var(--cluster-gap);
  padding: 0 8px 0 14px;
  margin-top: -2px;
  transform: translateY(-10px) scaleY(0.95);
  transform-origin: top left;
  pointer-events: none;
  transition:
    max-height 220ms ease,
    opacity 180ms ease,
    transform 220ms ease,
    margin-top 220ms ease,
    padding-top 220ms ease;
}

.building-action-cluster::before {
  content: '';
  position: absolute;
  left: 11px;
  top: 8px;
  bottom: 8px;
  width: 1px;
  background: linear-gradient(
    180deg,
    rgba(59, 130, 246, 0.45),
    rgba(99, 102, 241, 0.18) 40%,
    rgba(99, 102, 241, 0)
  );
}

.building-action-cluster.expanded {
  max-height: 180px;
  opacity: 1;
  margin-top: 4px;
  padding-top: 4px;
  transform: translateY(0) scaleY(1);
  pointer-events: auto;
}

.building-action-sub {
  position: relative;
}

.building-action-sub::before {
  content: '';
  position: absolute;
  left: -10px;
  top: 50%;
  width: 8px;
  height: 1px;
  background: rgba(59, 130, 246, 0.35);
  transform: translateY(-50%);
}

.candidate-status {
  margin: 4px 2px 0;
  padding: 1px 6px;
  display: inline-block;
  font-size: 10px;
  line-height: 1.4;
  color: rgba(133, 77, 14, 0.82);
  max-width: 100%;
  background: rgba(249, 250, 251, 0.9);
  border-radius: 2px;
  border: none;
}

.poi-info-card {
  position: absolute;
  top: 78px;
  right: 16px;
  width: min(340px, calc(100vw - 32px));
  padding: 12px 12px 10px;
  border-radius: 14px;
  border: 1px solid rgba(191, 219, 254, 0.92);
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.94), rgba(248, 250, 252, 0.96));
  box-shadow:
    0 18px 38px rgba(15, 23, 42, 0.16),
    0 0 0 1px rgba(148, 163, 184, 0.16);
  pointer-events: auto;
}

.poi-info-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.poi-info-source {
  margin: 0;
  font-size: 11px;
  color: #2563eb;
  letter-spacing: 0.02em;
}

.poi-info-title {
  margin: 2px 0 0;
  font-size: 15px;
  line-height: 1.4;
  color: #0f172a;
}

.poi-info-close {
  border: none;
  background: transparent;
  color: #64748b;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.poi-info-loading {
  margin: 8px 0 0;
  font-size: 12px;
  color: #6b7280;
}

.poi-info-list {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.poi-info-list li {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  line-height: 1.5;
}

.poi-info-label {
  color: #64748b;
  flex: 0 0 auto;
}

.poi-info-value {
  color: #0f172a;
  text-align: right;
  word-break: break-all;
}

.feedback-toast {
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  max-width: min(520px, 100% - 32px);
  padding: 8px 14px;
  border-radius: 999px;
  background: radial-gradient(circle at 0 0, rgba(234, 179, 8, 0.12), rgba(248, 250, 252, 0.98));
  border: 1px solid rgba(234, 179, 8, 0.7);
  color: #854d0e;
  font-size: 12px;
  text-align: center;
  box-shadow:
    0 10px 26px rgba(15, 23, 42, 0.12),
    0 0 0 1px rgba(148, 163, 184, 0.3);
  z-index: 15;
}

.search-error {
  position: absolute;
  top: 60px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(254, 242, 242, 0.96);
  border: 1px solid rgba(248, 113, 113, 0.9);
  color: #991b1b;
  font-size: 12px;
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.9);
  z-index: 20;
}

.modal-backdrop {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at 10% 0, rgba(15, 23, 42, 0.1), rgba(15, 23, 42, 0.18));
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  z-index: 40;
}

.modal {
  width: min(720px, 100% - 40px);
  max-height: min(640px, 100% - 80px);
  border-radius: 20px;
  background:
    radial-gradient(circle at 0 0, rgba(56, 189, 248, 0.18), transparent 65%),
    #ffffff;
  border: 1px solid rgba(191, 219, 254, 0.9);
  box-shadow:
    0 26px 60px rgba(15, 23, 42, 0.95),
    0 0 0 1px rgba(15, 23, 42, 0.9);
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 10px;
  border-bottom: 1px solid rgba(30, 64, 175, 0.7);
}

.modal-header h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.modal-close {
  border: none;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}

.modal-body {
  padding: 14px 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
}

.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: #4b5563;
}

.coord-switch {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
  color: #111827;
}

.section-label {
  font-size: 12px;
  color: #6b7280;
}

.coord-option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.toggle-geojson {
  align-self: flex-start;
}

.geojson-wrapper {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.textarea-label {
  font-size: 12px;
  color: #6b7280;
}

.geojson-output {
  width: 100%;
  min-height: 220px;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid rgba(191, 219, 254, 0.9);
  background: radial-gradient(circle at 0 0, rgba(248, 250, 252, 0.98), rgba(255, 255, 255, 0.98));
  color: #0f172a;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
  font-size: 12px;
  resize: vertical;
}

@media (max-width: 900px) {
  .top-strip {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .top-strip-right {
    width: 100%;
    justify-content: space-between;
  }

  .tool-panel {
    top: auto;
    bottom: 18px;
    left: 16px;
    right: auto;
    width: 220px;
  }

  .surface-property-panel-anchor {
    top: auto;
    bottom: 18px;
    left: 248px;
  }
}
</style>
