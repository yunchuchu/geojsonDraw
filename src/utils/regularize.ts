import { closeRing, type PolygonRing } from './geometry'

type Point2D = [number, number]

export type RegularizeOptions = {
  angleSnapDeg?: number
  lineSnapDistanceMeters?: number
  maxMoveRatio?: number
}

type EdgeData = {
  index: number
  start: Point2D
  end: Point2D
  midpoint: Point2D
  length: number
  theta: number
}

type AngleCluster = {
  edgeIndexes: number[]
  weightSum: number
  cos2Sum: number
  sin2Sum: number
}

type LineCluster = {
  edgeIndexes: number[]
  weightedC: number
  weightSum: number
}

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI
const LNG_TO_METER = 111320
const LAT_TO_METER = 110540
const EPS = 1e-9

const normalizeAxisAngle = (theta: number): number => {
  let next = theta % Math.PI
  if (next < 0) next += Math.PI
  return next
}

const axisAngleDistance = (a: number, b: number): number => {
  const delta = Math.abs(a - b)
  return Math.min(delta, Math.PI - delta)
}

const getClusterMeanAngle = (cluster: AngleCluster): number =>
  normalizeAxisAngle(0.5 * Math.atan2(cluster.sin2Sum, cluster.cos2Sum))

const toLocalProjector = (ring: PolygonRing) => {
  const opened = ring.slice(0, -1)
  const lng0 = opened.reduce((sum, point) => sum + point[0], 0) / opened.length
  const lat0 = opened.reduce((sum, point) => sum + point[1], 0) / opened.length
  const cosLat = Math.cos((lat0 * Math.PI) / 180)
  const meterX = LNG_TO_METER * Math.max(0.000001, cosLat)

  const toLocal = ([lng, lat]: [number, number]): Point2D => [
    (lng - lng0) * meterX,
    (lat - lat0) * LAT_TO_METER,
  ]
  const toLngLat = ([x, y]: Point2D): [number, number] => [x / meterX + lng0, y / LAT_TO_METER + lat0]

  return {
    toLocal,
    toLngLat,
  }
}

const getRingArea = (vertices: Point2D[]): number => {
  let area = 0
  for (let i = 0; i < vertices.length; i += 1) {
    const [x1, y1] = vertices[i]
    const [x2, y2] = vertices[(i + 1) % vertices.length]
    area += x1 * y2 - x2 * y1
  }
  return area / 2
}

const getBoundingDiagonal = (vertices: Point2D[]): number => {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const [x, y] of vertices) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return Math.hypot(maxX - minX, maxY - minY)
}

const getEdges = (vertices: Point2D[]): EdgeData[] => {
  const edges: EdgeData[] = []
  for (let i = 0; i < vertices.length; i += 1) {
    const start = vertices[i]
    const end = vertices[(i + 1) % vertices.length]
    const dx = end[0] - start[0]
    const dy = end[1] - start[1]
    const length = Math.hypot(dx, dy)
    if (length < EPS) {
      continue
    }
    edges.push({
      index: i,
      start,
      end,
      midpoint: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
      length,
      theta: normalizeAxisAngle(Math.atan2(dy, dx)),
    })
  }
  return edges
}

const clusterEdgesByAngle = (edges: EdgeData[], angleThreshold: number): { clusterIdByEdge: Map<number, number>; clusters: AngleCluster[] } => {
  const sorted = [...edges].sort((a, b) => b.length - a.length)
  const clusters: AngleCluster[] = []
  const clusterIdByEdge = new Map<number, number>()

  for (const edge of sorted) {
    let bestClusterId = -1
    let bestDistance = Number.POSITIVE_INFINITY
    for (let i = 0; i < clusters.length; i += 1) {
      const mean = getClusterMeanAngle(clusters[i])
      const distance = axisAngleDistance(edge.theta, mean)
      if (distance <= angleThreshold && distance < bestDistance) {
        bestDistance = distance
        bestClusterId = i
      }
    }

    if (bestClusterId < 0) {
      const nextCluster: AngleCluster = {
        edgeIndexes: [],
        weightSum: 0,
        cos2Sum: 0,
        sin2Sum: 0,
      }
      clusters.push(nextCluster)
      bestClusterId = clusters.length - 1
    }

    const cluster = clusters[bestClusterId]
    const weight = edge.length
    cluster.edgeIndexes.push(edge.index)
    cluster.weightSum += weight
    cluster.cos2Sum += Math.cos(2 * edge.theta) * weight
    cluster.sin2Sum += Math.sin(2 * edge.theta) * weight
    clusterIdByEdge.set(edge.index, bestClusterId)
  }

  return { clusterIdByEdge, clusters }
}

const intersectLines = (n1: Point2D, c1: number, n2: Point2D, c2: number): Point2D | null => {
  const det = n1[0] * n2[1] - n1[1] * n2[0]
  if (Math.abs(det) < EPS) return null
  return [(c1 * n2[1] - n1[1] * c2) / det, (n1[0] * c2 - c1 * n2[0]) / det]
}

export const regularizePolygonRing = (
  ring: PolygonRing,
  options: RegularizeOptions = {},
): PolygonRing | null => {
  const closed = closeRing(ring)
  if (closed.length < 4) return null

  const opened = closed.slice(0, -1)
  if (opened.length < 3) return null

  const projector = toLocalProjector(closed)
  const localVertices = opened.map((point) => projector.toLocal(point as [number, number]))
  const edges = getEdges(localVertices)
  if (edges.length < 3) return null

  const angleSnapDeg = options.angleSnapDeg ?? 10
  const lineSnapDistanceMeters = options.lineSnapDistanceMeters ?? 0.8
  const maxMoveRatio = options.maxMoveRatio ?? 0.22
  const angleThreshold = Math.max(1, angleSnapDeg) * DEG_TO_RAD

  const { clusterIdByEdge, clusters } = clusterEdgesByAngle(edges, angleThreshold)
  const meanByCluster = clusters.map((cluster) => getClusterMeanAngle(cluster))

  const thetaByEdge = new Map<number, number>()
  const cByEdge = new Map<number, number>()
  const nByEdge = new Map<number, Point2D>()

  for (const edge of edges) {
    const clusterId = clusterIdByEdge.get(edge.index)
    if (clusterId === undefined) continue
    const theta = meanByCluster[clusterId]
    const normal: Point2D = [-Math.sin(theta), Math.cos(theta)]
    const c = normal[0] * edge.midpoint[0] + normal[1] * edge.midpoint[1]
    thetaByEdge.set(edge.index, theta)
    nByEdge.set(edge.index, normal)
    cByEdge.set(edge.index, c)
  }

  for (let clusterId = 0; clusterId < clusters.length; clusterId += 1) {
    const clusterEdgeIndexes = clusters[clusterId].edgeIndexes
    const lineSeeds = clusterEdgeIndexes
      .map((edgeIndex) => {
        const edge = edges.find((item) => item.index === edgeIndex)
        const c = cByEdge.get(edgeIndex)
        return edge && c !== undefined ? { edgeIndex, c, weight: edge.length } : null
      })
      .filter((item): item is { edgeIndex: number; c: number; weight: number } => Boolean(item))
      .sort((a, b) => a.c - b.c)

    const lineClusters: LineCluster[] = []
    for (const seed of lineSeeds) {
      const prev = lineClusters[lineClusters.length - 1]
      const prevC = prev ? prev.weightedC / prev.weightSum : Number.NaN
      if (!prev || Math.abs(seed.c - prevC) > lineSnapDistanceMeters) {
        lineClusters.push({
          edgeIndexes: [seed.edgeIndex],
          weightedC: seed.c * seed.weight,
          weightSum: seed.weight,
        })
      } else {
        prev.edgeIndexes.push(seed.edgeIndex)
        prev.weightedC += seed.c * seed.weight
        prev.weightSum += seed.weight
      }
    }

    for (const group of lineClusters) {
      const mergedC = group.weightedC / group.weightSum
      for (const edgeIndex of group.edgeIndexes) {
        cByEdge.set(edgeIndex, mergedC)
      }
    }
  }

  const regularizedVertices: Point2D[] = []
  for (let i = 0; i < localVertices.length; i += 1) {
    const prevEdgeIndex = (i - 1 + localVertices.length) % localVertices.length
    const currEdgeIndex = i

    const prevNormal = nByEdge.get(prevEdgeIndex)
    const currNormal = nByEdge.get(currEdgeIndex)
    const prevC = cByEdge.get(prevEdgeIndex)
    const currC = cByEdge.get(currEdgeIndex)

    if (!prevNormal || !currNormal || prevC === undefined || currC === undefined) {
      regularizedVertices.push(localVertices[i])
      continue
    }

    const crossPoint = intersectLines(prevNormal, prevC, currNormal, currC)
    regularizedVertices.push(crossPoint ?? localVertices[i])
  }

  const diagonal = getBoundingDiagonal(localVertices)
  const maxMoveMeters = Math.max(1.5, diagonal * maxMoveRatio)
  const constrainedVertices: Point2D[] = regularizedVertices.map((nextPoint, i) => {
    const base = localVertices[i]
    const dx = nextPoint[0] - base[0]
    const dy = nextPoint[1] - base[1]
    const distance = Math.hypot(dx, dy)
    if (distance <= maxMoveMeters || distance < EPS) {
      return nextPoint
    }
    const scale = maxMoveMeters / distance
    return [base[0] + dx * scale, base[1] + dy * scale]
  })

  const areaBefore = Math.abs(getRingArea(localVertices))
  const areaAfter = Math.abs(getRingArea(constrainedVertices))
  if (areaBefore < EPS || areaAfter < EPS) return null

  const areaRatio = areaAfter / areaBefore
  if (areaRatio < 0.6 || areaRatio > 1.6) {
    return null
  }

  const output = constrainedVertices.map((point) => projector.toLngLat(point))
  return closeRing(output.map(([lng, lat]) => [lng, lat] as [number, number]))
}

export const describeRegularizeOptions = (options: RegularizeOptions = {}): string => {
  const angle = options.angleSnapDeg ?? 10
  const distance = options.lineSnapDistanceMeters ?? 0.8
  return `角度吸附≈${angle.toFixed(0)}°，线距吸附≈${distance.toFixed(1)}m`
}

export const getEdgeAxisAnglesDeg = (ring: PolygonRing): number[] => {
  const closed = closeRing(ring)
  if (closed.length < 4) return []
  const opened = closed.slice(0, -1)
  const edges = getEdges(opened)
  return edges.map((edge) => normalizeAxisAngle(edge.theta) * RAD_TO_DEG)
}
