import buffer from "@turf/buffer";
import { lineString } from "@turf/helpers";
import lineOffset from "@turf/line-offset";
import simplify from "@turf/simplify";
import type { Feature, LineString, MultiPolygon, Polygon, Position } from "geojson";
import playAreaData from "../../../../../packages/game-data/maps/koriyama/play-area.json";

const EARTH_RADIUS_METERS: number = 6_371_008.8;
const METERS_PER_LATITUDE_DEGREE: number = 111_320;
const COORDINATE_KEY_PRECISION: number = 7;
const MAXIMUM_TILE_COUNT: number = 256;
const FETCH_BATCH_SIZE: number = 8;
const POLYGON_SIMPLIFICATION_TOLERANCE_DEGREES: number = 0.00004;
const BUFFER_STEPS: number = 8;

export type GeographicCoordinate = readonly [longitude: number, latitude: number];

export type RiverPlayAreaConfig = {
  readonly riverName: string;
  readonly sourceUrl: string;
  readonly zoomLevel: number;
  readonly start: GeographicCoordinate;
  readonly end: GeographicCoordinate;
  readonly leftWidthMeters: number;
  readonly rightWidthMeters: number;
  readonly searchPaddingMeters: number;
  readonly maximumConnectionGapMeters: number;
};

export type RiverPlayArea = {
  readonly riverName: string;
  readonly centerLine: readonly GeographicCoordinate[];
  readonly polygons: readonly (readonly (readonly GeographicCoordinate[])[])[];
  readonly cameraTarget: GeographicCoordinate;
};

type GraphEdge = {
  readonly destinationKey: string;
  readonly distanceMeters: number;
};

type GraphNode = {
  readonly coordinate: GeographicCoordinate;
  readonly edges: GraphEdge[];
};

type GraphEndpoint = {
  readonly key: string;
  readonly lineIndex: number;
};

type QueueEntry = {
  readonly key: string;
  readonly distanceMeters: number;
};

type TileCoordinate = {
  readonly x: number;
  readonly y: number;
};

type RiverTileFetcher = (input: string, init?: RequestInit) => Promise<Response>;

const KORIYAMA_RIVER_PLAY_AREA_CONFIG: RiverPlayAreaConfig = {
  riverName: playAreaData.riverName,
  sourceUrl: playAreaData.sourceUrl,
  zoomLevel: playAreaData.zoomLevel,
  start: [playAreaData.start.longitude, playAreaData.start.latitude],
  end: [playAreaData.end.longitude, playAreaData.end.latitude],
  leftWidthMeters: playAreaData.leftWidthMeters,
  rightWidthMeters: playAreaData.rightWidthMeters,
  searchPaddingMeters: playAreaData.searchPaddingMeters,
  maximumConnectionGapMeters: playAreaData.maximumConnectionGapMeters,
};

export async function loadKoriyamaRiverPlayArea(
  signal?: AbortSignal,
  fetcher: RiverTileFetcher = fetch,
): Promise<RiverPlayArea> {
  const config: RiverPlayAreaConfig = KORIYAMA_RIVER_PLAY_AREA_CONFIG;
  validateConfig(config);

  const tiles: readonly TileCoordinate[] = getTilesForConfig(config);
  const riverLines: GeographicCoordinate[][] = await fetchRiverLines(
    config,
    tiles,
    signal,
    fetcher,
  );
  const centerLine: GeographicCoordinate[] = findRiverRoute(
    riverLines,
    config.start,
    config.end,
    config.maximumConnectionGapMeters,
  );

  return createRiverPlayArea(config, centerLine);
}

export function createRiverPlayArea(
  config: RiverPlayAreaConfig,
  centerLine: readonly GeographicCoordinate[],
): RiverPlayArea {
  if (centerLine.length < 2) {
    throw new Error("River center line must contain at least two coordinates");
  }

  const sourceLine: Feature<LineString> = lineString(
    centerLine.map((coordinate: GeographicCoordinate): Position => [...coordinate]),
  );
  const bufferRadiusMeters: number =
    (config.leftWidthMeters + config.rightWidthMeters) / 2;
  const centerOffsetMeters: number =
    (config.rightWidthMeters - config.leftWidthMeters) / 2;
  const offsetLine: Feature<LineString> =
    centerOffsetMeters === 0
      ? sourceLine
      : lineOffset(sourceLine, centerOffsetMeters, { units: "meters" });
  const buffered: Feature<Polygon | MultiPolygon> | undefined = buffer(
    offsetLine,
    bufferRadiusMeters,
    { units: "meters", steps: BUFFER_STEPS },
  );

  if (buffered === undefined) {
    throw new Error("Failed to create the river play area polygon");
  }

  const simplified: Feature<Polygon | MultiPolygon> = simplify(buffered, {
    tolerance: POLYGON_SIMPLIFICATION_TOLERANCE_DEGREES,
    highQuality: true,
    mutate: false,
  });
  const polygons = toPlayAreaPolygons(simplified.geometry);

  return {
    riverName: config.riverName,
    centerLine: [...centerLine],
    polygons,
    cameraTarget: centerLine[Math.floor(centerLine.length / 2)],
  };
}

export function findRiverRoute(
  riverLines: readonly (readonly GeographicCoordinate[])[],
  start: GeographicCoordinate,
  end: GeographicCoordinate,
  maximumConnectionGapMeters: number,
): GeographicCoordinate[] {
  const graph: Map<string, GraphNode> = new Map<string, GraphNode>();
  const endpoints: GraphEndpoint[] = [];

  riverLines.forEach((line: readonly GeographicCoordinate[], lineIndex: number): void => {
    addLineToGraph(graph, endpoints, line, lineIndex);
  });

  if (graph.size === 0) {
    throw new Error("No river center line data was found near the configured points");
  }

  connectNearbyEndpoints(graph, endpoints, maximumConnectionGapMeters);
  const startKey: string = findNearestNodeKey(graph, start);
  const endKey: string = findNearestNodeKey(graph, end);
  return findShortestPath(graph, startKey, endKey);
}

export function isCoordinateInPlayArea(
  coordinate: GeographicCoordinate,
  playArea: RiverPlayArea,
): boolean {
  return playArea.polygons.some(
    (polygon: readonly (readonly GeographicCoordinate[])[]): boolean =>
      isCoordinateInPolygon(coordinate, polygon),
  );
}

function validateConfig(config: RiverPlayAreaConfig): void {
  if (config.leftWidthMeters <= 0 || config.rightWidthMeters <= 0) {
    throw new Error("River play area widths must be greater than zero");
  }
  if (config.zoomLevel < 0 || config.zoomLevel > 22) {
    throw new Error("River tile zoom level is outside the supported range");
  }
  if (config.searchPaddingMeters < 0 || config.maximumConnectionGapMeters < 0) {
    throw new Error("River search distances must not be negative");
  }
}

function getTilesForConfig(config: RiverPlayAreaConfig): TileCoordinate[] {
  const meanLatitude: number = (config.start[1] + config.end[1]) / 2;
  const latitudePadding: number = config.searchPaddingMeters / METERS_PER_LATITUDE_DEGREE;
  const longitudePadding: number =
    config.searchPaddingMeters /
    (METERS_PER_LATITUDE_DEGREE * Math.cos((meanLatitude * Math.PI) / 180));
  const west: number = Math.min(config.start[0], config.end[0]) - longitudePadding;
  const east: number = Math.max(config.start[0], config.end[0]) + longitudePadding;
  const south: number = Math.min(config.start[1], config.end[1]) - latitudePadding;
  const north: number = Math.max(config.start[1], config.end[1]) + latitudePadding;
  const northwest: TileCoordinate = coordinateToTile([west, north], config.zoomLevel);
  const southeast: TileCoordinate = coordinateToTile([east, south], config.zoomLevel);
  const tiles: TileCoordinate[] = [];

  for (let y: number = northwest.y; y <= southeast.y; y += 1) {
    for (let x: number = northwest.x; x <= southeast.x; x += 1) {
      tiles.push({ x, y });
    }
  }

  if (tiles.length > MAXIMUM_TILE_COUNT) {
    throw new Error(`River search area is too large: ${tiles.length} tiles`);
  }
  return tiles;
}

function coordinateToTile(coordinate: GeographicCoordinate, zoomLevel: number): TileCoordinate {
  const tileCount: number = 2 ** zoomLevel;
  const latitudeRadians: number = (coordinate[1] * Math.PI) / 180;
  const x: number = Math.floor(((coordinate[0] + 180) / 360) * tileCount);
  const y: number = Math.floor(
    ((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2) * tileCount,
  );
  return {
    x: Math.max(0, Math.min(tileCount - 1, x)),
    y: Math.max(0, Math.min(tileCount - 1, y)),
  };
}

async function fetchRiverLines(
  config: RiverPlayAreaConfig,
  tiles: readonly TileCoordinate[],
  signal: AbortSignal | undefined,
  fetcher: RiverTileFetcher,
): Promise<GeographicCoordinate[][]> {
  const lines: GeographicCoordinate[][] = [];

  for (let index: number = 0; index < tiles.length; index += FETCH_BATCH_SIZE) {
    const batch: readonly TileCoordinate[] = tiles.slice(index, index + FETCH_BATCH_SIZE);
    const results: GeographicCoordinate[][][] = await Promise.all(
      batch.map(
        async (tile: TileCoordinate): Promise<GeographicCoordinate[][]> =>
          fetchRiverTile(config, tile, signal, fetcher),
      ),
    );
    results.forEach((tileLines: GeographicCoordinate[][]): void => {
      lines.push(...tileLines);
    });
  }

  return lines;
}

async function fetchRiverTile(
  config: RiverPlayAreaConfig,
  tile: TileCoordinate,
  signal: AbortSignal | undefined,
  fetcher: RiverTileFetcher,
): Promise<GeographicCoordinate[][]> {
  const url: string = config.sourceUrl
    .replace("{z}", String(config.zoomLevel))
    .replace("{x}", String(tile.x))
    .replace("{y}", String(tile.y));
  const response: Response = await fetcher(url, { signal });

  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error(`Failed to load river tile: ${url} (${response.status})`);
  }

  const data: unknown = await response.json();
  return parseRiverLines(data);
}

function parseRiverLines(data: unknown): GeographicCoordinate[][] {
  if (!isRecord(data) || !Array.isArray(data.features)) {
    throw new Error("River tile response is not a GeoJSON FeatureCollection");
  }

  const lines: GeographicCoordinate[][] = [];
  data.features.forEach((feature: unknown): void => {
    if (!isRecord(feature) || !isRecord(feature.geometry)) {
      return;
    }
    const geometry = feature.geometry;
    if (geometry.type === "LineString") {
      const line: GeographicCoordinate[] | undefined = parseCoordinateLine(geometry.coordinates);
      if (line !== undefined) {
        lines.push(line);
      }
      return;
    }
    if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
      geometry.coordinates.forEach((coordinates: unknown): void => {
        const line: GeographicCoordinate[] | undefined = parseCoordinateLine(coordinates);
        if (line !== undefined) {
          lines.push(line);
        }
      });
    }
  });
  return lines;
}

function parseCoordinateLine(value: unknown): GeographicCoordinate[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const coordinates: GeographicCoordinate[] = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length < 2) {
      return undefined;
    }
    const longitude: unknown = item[0];
    const latitude: unknown = item[1];
    if (typeof longitude !== "number" || typeof latitude !== "number") {
      return undefined;
    }
    coordinates.push([longitude, latitude]);
  }
  return coordinates.length >= 2 ? coordinates : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function addLineToGraph(
  graph: Map<string, GraphNode>,
  endpoints: GraphEndpoint[],
  line: readonly GeographicCoordinate[],
  lineIndex: number,
): void {
  if (line.length < 2) {
    return;
  }

  line.forEach((coordinate: GeographicCoordinate): void => {
    const key: string = coordinateKey(coordinate);
    if (!graph.has(key)) {
      graph.set(key, { coordinate, edges: [] });
    }
  });

  for (let index: number = 1; index < line.length; index += 1) {
    addUndirectedEdge(graph, coordinateKey(line[index - 1]), coordinateKey(line[index]));
  }
  endpoints.push({ key: coordinateKey(line[0]), lineIndex });
  endpoints.push({ key: coordinateKey(line[line.length - 1]), lineIndex });
}

function connectNearbyEndpoints(
  graph: Map<string, GraphNode>,
  endpoints: readonly GraphEndpoint[],
  maximumGapMeters: number,
): void {
  for (let firstIndex: number = 0; firstIndex < endpoints.length; firstIndex += 1) {
    const first: GraphEndpoint = endpoints[firstIndex];
    for (let secondIndex: number = firstIndex + 1; secondIndex < endpoints.length; secondIndex += 1) {
      const second: GraphEndpoint = endpoints[secondIndex];
      if (first.key === second.key || first.lineIndex === second.lineIndex) {
        continue;
      }
      const firstNode: GraphNode | undefined = graph.get(first.key);
      const secondNode: GraphNode | undefined = graph.get(second.key);
      if (firstNode === undefined || secondNode === undefined) {
        continue;
      }
      if (distanceMeters(firstNode.coordinate, secondNode.coordinate) <= maximumGapMeters) {
        addUndirectedEdge(graph, first.key, second.key);
      }
    }
  }
}

function addUndirectedEdge(graph: Map<string, GraphNode>, firstKey: string, secondKey: string): void {
  const first: GraphNode | undefined = graph.get(firstKey);
  const second: GraphNode | undefined = graph.get(secondKey);
  if (first === undefined || second === undefined || firstKey === secondKey) {
    return;
  }
  const distance: number = distanceMeters(first.coordinate, second.coordinate);
  addEdge(first, secondKey, distance);
  addEdge(second, firstKey, distance);
}

function addEdge(node: GraphNode, destinationKey: string, distance: number): void {
  if (!node.edges.some((edge: GraphEdge): boolean => edge.destinationKey === destinationKey)) {
    node.edges.push({ destinationKey, distanceMeters: distance });
  }
}

function findNearestNodeKey(graph: Map<string, GraphNode>, target: GeographicCoordinate): string {
  let nearestKey: string | undefined;
  let nearestDistance: number = Number.POSITIVE_INFINITY;
  graph.forEach((node: GraphNode, key: string): void => {
    const distance: number = distanceMeters(node.coordinate, target);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestKey = key;
    }
  });
  if (nearestKey === undefined) {
    throw new Error("Could not snap the configured point to a river center line");
  }
  return nearestKey;
}

function findShortestPath(
  graph: ReadonlyMap<string, GraphNode>,
  startKey: string,
  endKey: string,
): GeographicCoordinate[] {
  const distances: Map<string, number> = new Map<string, number>([[startKey, 0]]);
  const previous: Map<string, string> = new Map<string, string>();
  const queue: MinimumQueue = new MinimumQueue();
  queue.push({ key: startKey, distanceMeters: 0 });

  while (queue.length > 0) {
    const current: QueueEntry | undefined = queue.pop();
    if (current === undefined || current.distanceMeters !== distances.get(current.key)) {
      continue;
    }
    if (current.key === endKey) {
      return reconstructPath(graph, previous, startKey, endKey);
    }
    const node: GraphNode | undefined = graph.get(current.key);
    node?.edges.forEach((edge: GraphEdge): void => {
      const candidateDistance: number = current.distanceMeters + edge.distanceMeters;
      if (candidateDistance < (distances.get(edge.destinationKey) ?? Number.POSITIVE_INFINITY)) {
        distances.set(edge.destinationKey, candidateDistance);
        previous.set(edge.destinationKey, current.key);
        queue.push({ key: edge.destinationKey, distanceMeters: candidateDistance });
      }
    });
  }

  throw new Error("No connected river route was found between the configured points");
}

function reconstructPath(
  graph: ReadonlyMap<string, GraphNode>,
  previous: ReadonlyMap<string, string>,
  startKey: string,
  endKey: string,
): GeographicCoordinate[] {
  const path: GeographicCoordinate[] = [];
  let currentKey: string | undefined = endKey;

  while (currentKey !== undefined) {
    const node: GraphNode | undefined = graph.get(currentKey);
    if (node === undefined) {
      throw new Error("River route graph is inconsistent");
    }
    path.push(node.coordinate);
    if (currentKey === startKey) {
      return path.reverse();
    }
    currentKey = previous.get(currentKey);
  }
  throw new Error("River route could not be reconstructed");
}

function coordinateKey(coordinate: GeographicCoordinate): string {
  return `${coordinate[0].toFixed(COORDINATE_KEY_PRECISION)},${coordinate[1].toFixed(
    COORDINATE_KEY_PRECISION,
  )}`;
}

function distanceMeters(first: GeographicCoordinate, second: GeographicCoordinate): number {
  const firstLatitude: number = (first[1] * Math.PI) / 180;
  const secondLatitude: number = (second[1] * Math.PI) / 180;
  const latitudeDelta: number = secondLatitude - firstLatitude;
  const longitudeDelta: number = ((second[0] - first[0]) * Math.PI) / 180;
  const haversine: number =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
}

function toPlayAreaPolygons(
  geometry: Polygon | MultiPolygon,
): (readonly (readonly GeographicCoordinate[])[])[] {
  const sourcePolygons: Position[][][] =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return sourcePolygons.map(
    (polygon: Position[][]): readonly (readonly GeographicCoordinate[])[] =>
      polygon.map(
        (ring: Position[]): readonly GeographicCoordinate[] =>
          ring.map(
            (position: Position): GeographicCoordinate => [position[0], position[1]],
          ),
      ),
  );
}

function isCoordinateInPolygon(
  coordinate: GeographicCoordinate,
  polygon: readonly (readonly GeographicCoordinate[])[],
): boolean {
  const exterior: readonly GeographicCoordinate[] | undefined = polygon[0];
  if (exterior === undefined || !isCoordinateInRing(coordinate, exterior)) {
    return false;
  }
  return !polygon
    .slice(1)
    .some((hole: readonly GeographicCoordinate[]): boolean => isCoordinateInRing(coordinate, hole));
}

function isCoordinateInRing(
  coordinate: GeographicCoordinate,
  ring: readonly GeographicCoordinate[],
): boolean {
  let inside: boolean = false;
  for (let currentIndex: number = 0, previousIndex: number = ring.length - 1;
    currentIndex < ring.length;
    previousIndex = currentIndex, currentIndex += 1) {
    const current: GeographicCoordinate = ring[currentIndex];
    const previous: GeographicCoordinate = ring[previousIndex];
    if (isCoordinateOnSegment(coordinate, previous, current)) {
      return true;
    }
    const crossesLatitude: boolean = current[1] > coordinate[1] !== previous[1] > coordinate[1];
    const intersectionLongitude: number =
      ((previous[0] - current[0]) * (coordinate[1] - current[1])) /
        (previous[1] - current[1]) +
      current[0];
    if (crossesLatitude && coordinate[0] < intersectionLongitude) {
      inside = !inside;
    }
  }
  return inside;
}

function isCoordinateOnSegment(
  coordinate: GeographicCoordinate,
  start: GeographicCoordinate,
  end: GeographicCoordinate,
): boolean {
  const squaredLength: number =
    (end[0] - start[0]) ** 2 + (end[1] - start[1]) ** 2;
  if (squaredLength === 0) {
    return coordinate[0] === start[0] && coordinate[1] === start[1];
  }
  const crossProduct: number =
    (coordinate[1] - start[1]) * (end[0] - start[0]) -
    (coordinate[0] - start[0]) * (end[1] - start[1]);
  if (Math.abs(crossProduct) > Number.EPSILON * 100) {
    return false;
  }
  const dotProduct: number =
    (coordinate[0] - start[0]) * (end[0] - start[0]) +
    (coordinate[1] - start[1]) * (end[1] - start[1]);
  return dotProduct >= 0 && dotProduct <= squaredLength;
}

class MinimumQueue {
  private readonly entries: QueueEntry[] = [];

  public get length(): number {
    return this.entries.length;
  }

  public push(entry: QueueEntry): void {
    this.entries.push(entry);
    this.bubbleUp(this.entries.length - 1);
  }

  public pop(): QueueEntry | undefined {
    const first: QueueEntry | undefined = this.entries[0];
    const last: QueueEntry | undefined = this.entries.pop();
    if (first === undefined || last === undefined) {
      return first;
    }
    if (this.entries.length > 0) {
      this.entries[0] = last;
      this.bubbleDown(0);
    }
    return first;
  }

  private bubbleUp(startIndex: number): void {
    let index: number = startIndex;
    while (index > 0) {
      const parentIndex: number = Math.floor((index - 1) / 2);
      if (this.entries[parentIndex].distanceMeters <= this.entries[index].distanceMeters) {
        return;
      }
      [this.entries[parentIndex], this.entries[index]] = [
        this.entries[index],
        this.entries[parentIndex],
      ];
      index = parentIndex;
    }
  }

  private bubbleDown(startIndex: number): void {
    let index: number = startIndex;
    while (true) {
      const leftIndex: number = index * 2 + 1;
      const rightIndex: number = leftIndex + 1;
      let smallestIndex: number = index;
      if (
        leftIndex < this.entries.length &&
        this.entries[leftIndex].distanceMeters < this.entries[smallestIndex].distanceMeters
      ) {
        smallestIndex = leftIndex;
      }
      if (
        rightIndex < this.entries.length &&
        this.entries[rightIndex].distanceMeters < this.entries[smallestIndex].distanceMeters
      ) {
        smallestIndex = rightIndex;
      }
      if (smallestIndex === index) {
        return;
      }
      [this.entries[index], this.entries[smallestIndex]] = [
        this.entries[smallestIndex],
        this.entries[index],
      ];
      index = smallestIndex;
    }
  }
}
