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
const EPSILON = 1e-9

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

const openRing = (ring: PolygonRing): PolygonRing => {
  if (ring.length < 2) return [...ring]
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) {
    return ring.slice(0, -1)
  }
  return [...ring]
}

const getSignedRingArea = (ring: PolygonRing): number => {
  const vertices = openRing(ring)
  if (vertices.length < 3) return 0

  let area = 0
  for (let index = 0; index < vertices.length; index += 1) {
    const [x1, y1] = vertices[index]
    const [x2, y2] = vertices[(index + 1) % vertices.length]
    area += x1 * y2 - x2 * y1
  }
  return area / 2
}

const rotatePoint = ([x, y]: [number, number], angle: number): [number, number] => {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [x * cos - y * sin, x * sin + y * cos]
}

const squaredDistance = ([x1, y1]: [number, number], [x2, y2]: [number, number]): number =>
  (x1 - x2) ** 2 + (y1 - y2) ** 2

const cross = (
  [ox, oy]: [number, number],
  [ax, ay]: [number, number],
  [bx, by]: [number, number],
): number => (ax - ox) * (by - oy) - (ay - oy) * (bx - ox)

const getConvexHull = (points: PolygonRing): PolygonRing => {
  const uniquePoints = [...new Map(points.map((point) => [`${point[0]},${point[1]}`, point])).values()]
    .sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]))

  if (uniquePoints.length <= 3) {
    return uniquePoints
  }

  const lower: PolygonRing = []
  for (const point of uniquePoints) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop()
    }
    lower.push(point)
  }

  const upper: PolygonRing = []
  for (let index = uniquePoints.length - 1; index >= 0; index -= 1) {
    const point = uniquePoints[index]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop()
    }
    upper.push(point)
  }

  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

const rotateRingStartToNearest = (
  ring: PolygonRing,
  targetPoint: [number, number],
): PolygonRing => {
  const vertices = openRing(ring)
  if (vertices.length < 2) return ring

  let startIndex = 0
  let minDistance = Number.POSITIVE_INFINITY
  vertices.forEach((point, index) => {
    const distance = squaredDistance(point, targetPoint)
    if (distance < minDistance) {
      minDistance = distance
      startIndex = index
    }
  })

  const rotated = [...vertices.slice(startIndex), ...vertices.slice(0, startIndex)]
  return closeRing(rotated)
}

const ensureRingOrientation = (ring: PolygonRing, shouldBeClockwise: boolean): PolygonRing => {
  const isClockwise = getSignedRingArea(ring) < 0
  if (isClockwise === shouldBeClockwise) {
    return ring
  }
  return closeRing(openRing(ring).reverse())
}

export const normalizePolygonRings = (coordinates: Position[][]): PolygonRings =>
  coordinates
    .map((ring) => closeRing(ring.map((position) => [position[0], position[1]] as [number, number])))
    .filter((ring) => ring.length >= 4)

export const getMinimumAreaBoundingRectangle = (ring: PolygonRing): PolygonRing | null => {
  const vertices = openRing(ring)
  if (vertices.length < 3) return null

  const hull = getConvexHull(vertices)
  if (hull.length < 3) return null

  let bestRect:
    | {
        area: number
        angle: number
        minX: number
        maxX: number
        minY: number
        maxY: number
      }
    | null = null

  for (let index = 0; index < hull.length; index += 1) {
    const current = hull[index]
    const next = hull[(index + 1) % hull.length]
    const edgeAngle = Math.atan2(next[1] - current[1], next[0] - current[0])

    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    for (const point of hull) {
      const [rotatedX, rotatedY] = rotatePoint(point, -edgeAngle)
      minX = Math.min(minX, rotatedX)
      maxX = Math.max(maxX, rotatedX)
      minY = Math.min(minY, rotatedY)
      maxY = Math.max(maxY, rotatedY)
    }

    const area = (maxX - minX) * (maxY - minY)
    if (!bestRect || area < bestRect.area - EPSILON) {
      bestRect = { area, angle: edgeAngle, minX, maxX, minY, maxY }
    }
  }

  if (!bestRect) return null

  const rectangle = closeRing(
    [
      [bestRect.minX, bestRect.minY],
      [bestRect.maxX, bestRect.minY],
      [bestRect.maxX, bestRect.maxY],
      [bestRect.minX, bestRect.maxY],
    ].map((point) => rotatePoint(point as [number, number], bestRect.angle)),
  )

  const orientedRectangle = ensureRingOrientation(rectangle, getSignedRingArea(ring) < 0)
  return rotateRingStartToNearest(orientedRectangle, vertices[0])
}

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

export const translatePolygonRings = (
  rings: PolygonRings,
  deltaLng: number,
  deltaLat: number,
): PolygonRings =>
  rings.map((ring) =>
    ring.map(([lng, lat]) => [lng + deltaLng, lat + deltaLat] as [number, number]),
  )

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
