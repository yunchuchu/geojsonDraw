import type {
  Feature,
  GeoJsonProperties,
  MultiPolygon,
  Point,
  Polygon,
  Position,
} from 'geojson'

export type BBox = [minLng: number, minLat: number, maxLng: number, maxLat: number]
export type CoordinateSystem = 'gcj02' | 'wgs84'
export type PolygonRing = Array<[number, number]>
export type PolygonRings = PolygonRing[]

const EARTH_RADIUS = 6378245.0
const EE = 0.00669342162296594323

const isOutsideChina = (lng: number, lat: number): boolean =>
  lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271

const transformLat = (lng: number, lat: number): number => {
  let ret =
    -100.0 +
    2.0 * lng +
    3.0 * lat +
    0.2 * lat * lat +
    0.1 * lng * lat +
    0.2 * Math.sqrt(Math.abs(lng))
  ret +=
    ((20.0 * Math.sin(6.0 * lng * Math.PI) + 20.0 * Math.sin(2.0 * lng * Math.PI)) * 2.0) /
    3.0
  ret +=
    ((20.0 * Math.sin(lat * Math.PI) + 40.0 * Math.sin((lat / 3.0) * Math.PI)) * 2.0) / 3.0
  ret +=
    ((160.0 * Math.sin((lat / 12.0) * Math.PI) + 320 * Math.sin((lat * Math.PI) / 30.0)) * 2.0) /
    3.0
  return ret
}

const transformLng = (lng: number, lat: number): number => {
  let ret =
    300.0 +
    lng +
    2.0 * lat +
    0.1 * lng * lng +
    0.1 * lng * lat +
    0.1 * Math.sqrt(Math.abs(lng))
  ret +=
    ((20.0 * Math.sin(6.0 * lng * Math.PI) + 20.0 * Math.sin(2.0 * lng * Math.PI)) * 2.0) /
    3.0
  ret +=
    ((20.0 * Math.sin(lng * Math.PI) + 40.0 * Math.sin((lng / 3.0) * Math.PI)) * 2.0) / 3.0
  ret +=
    ((150.0 * Math.sin((lng / 12.0) * Math.PI) + 300.0 * Math.sin((lng / 30.0) * Math.PI)) * 2.0) /
    3.0
  return ret
}

export const wgs84ToGcj02 = (lng: number, lat: number): [number, number] => {
  if (isOutsideChina(lng, lat)) {
    return [lng, lat]
  }

  let dLat = transformLat(lng - 105.0, lat - 35.0)
  let dLng = transformLng(lng - 105.0, lat - 35.0)
  const radLat = (lat / 180.0) * Math.PI
  let magic = Math.sin(radLat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180.0) / (((EARTH_RADIUS * (1 - EE)) / (magic * sqrtMagic)) * Math.PI)
  dLng = (dLng * 180.0) / ((EARTH_RADIUS / sqrtMagic) * Math.cos(radLat) * Math.PI)
  return [lng + dLng, lat + dLat]
}

export const gcj02ToWgs84 = (lng: number, lat: number): [number, number] => {
  if (isOutsideChina(lng, lat)) {
    return [lng, lat]
  }
  const [offsetLng, offsetLat] = wgs84ToGcj02(lng, lat)
  return [lng * 2 - offsetLng, lat * 2 - offsetLat]
}

const transformPosition = (
  position: Position,
  source: CoordinateSystem,
  target: CoordinateSystem,
): Position => {
  if (position.length < 2 || source === target) {
    return [...position]
  }

  const [lng, lat, ...rest] = position
  const [nextLng, nextLat] =
    source === 'wgs84' ? wgs84ToGcj02(lng, lat) : gcj02ToWgs84(lng, lat)
  return [nextLng, nextLat, ...rest]
}

const transformPositions = (
  coordinates: Position[],
  source: CoordinateSystem,
  target: CoordinateSystem,
): Position[] => coordinates.map((position) => transformPosition(position, source, target))

export const closeRing = (ring: PolygonRing): PolygonRing => {
  if (ring.length < 3) return ring
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) {
    return ring
  }
  return [...ring, [...first] as [number, number]]
}

export const normalizePolygonRings = (coordinates: Position[][]): PolygonRings =>
  coordinates
    .map((ring) => closeRing(ring.map((position) => [position[0], position[1]] as [number, number])))
    .filter((ring) => ring.length >= 4)

export const geometryToSinglePolygonRings = (
  geometry: Polygon | MultiPolygon,
): PolygonRings | null => {
  if (geometry.type === 'Polygon') {
    const rings = normalizePolygonRings(geometry.coordinates)
    return rings.length ? rings : null
  }

  if (geometry.coordinates.length !== 1) {
    return null
  }

  const rings = normalizePolygonRings(geometry.coordinates[0])
  return rings.length ? rings : null
}

export const geometryToAmapPath = (
  geometry: Polygon | MultiPolygon,
): PolygonRing | PolygonRings | null => {
  const rings = geometryToSinglePolygonRings(geometry)
  if (!rings) return null
  return rings.length === 1 ? rings[0] : rings
}

export const getBoundsFromRings = (rings: PolygonRings): BBox | null => {
  let minLng = Number.POSITIVE_INFINITY
  let minLat = Number.POSITIVE_INFINITY
  let maxLng = Number.NEGATIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY

  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      minLng = Math.min(minLng, lng)
      minLat = Math.min(minLat, lat)
      maxLng = Math.max(maxLng, lng)
      maxLat = Math.max(maxLat, lat)
    }
  }

  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) {
    return null
  }

  return [minLng, minLat, maxLng, maxLat]
}

export const getBoundsFromGeometry = (geometry: Polygon | MultiPolygon): BBox | null => {
  const rings = geometryToSinglePolygonRings(geometry)
  if (!rings) return null
  return getBoundsFromRings(rings)
}

export const expandBounds = (bbox: BBox, padding: number): BBox => [
  bbox[0] - padding,
  bbox[1] - padding,
  bbox[2] + padding,
  bbox[3] + padding,
]

export const bboxIntersects = (a: BBox, b: BBox): boolean =>
  !(a[0] > b[2] || a[2] < b[0] || a[1] > b[3] || a[3] < b[1])

export const transformPolygonGeometry = (
  geometry: Polygon,
  source: CoordinateSystem,
  target: CoordinateSystem,
): Polygon => ({
  type: 'Polygon',
  coordinates: geometry.coordinates.map((ring) => transformPositions(ring, source, target)),
})

export const transformMultiPolygonGeometry = (
  geometry: MultiPolygon,
  source: CoordinateSystem,
  target: CoordinateSystem,
): MultiPolygon => ({
  type: 'MultiPolygon',
  coordinates: geometry.coordinates.map((polygon) =>
    polygon.map((ring) => transformPositions(ring, source, target)),
  ),
})

export const transformFeatureCoordinates = <
  T extends Point | Polygon | MultiPolygon,
  P extends GeoJsonProperties = GeoJsonProperties,
>(
  feature: Feature<T, P>,
  source: CoordinateSystem,
  target: CoordinateSystem,
): Feature<T, P> => {
  if (source === target) {
    return JSON.parse(JSON.stringify(feature)) as Feature<T, P>
  }

  if (feature.geometry.type === 'Point') {
    return {
      ...feature,
      geometry: {
        type: 'Point',
        coordinates: transformPosition(feature.geometry.coordinates, source, target),
      },
    } as Feature<T, P>
  }

  if (feature.geometry.type === 'Polygon') {
    return {
      ...feature,
      geometry: transformPolygonGeometry(feature.geometry, source, target),
    } as Feature<T, P>
  }

  return {
    ...feature,
    geometry: transformMultiPolygonGeometry(feature.geometry, source, target),
  } as Feature<T, P>
}
