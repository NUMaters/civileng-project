import * as T from "three";
import { ConvexHull } from "three/addons/math/ConvexHull.js";
import { layoutFacilityLabel, type FacilityLabelBounds, type FacilityLabelLayout } from "./facilityLabelLayout";

export const FACILITY_BODY_GAP = 7;
export const MAX_FACILITY_POINTER_LENGTH = 32;
export type FacilityLabelEnvelope = {
  corners: readonly T.Vector3[];
  /** Exact static convex-hull boundary vertices, not a fixed directional sample. */
  supports: readonly T.Vector3[];
  sourcePointCount: number;
  uniquePointCount: number;
};
export type ProjectedFacilityBody = FacilityLabelBounds & {
  topX: number; topY: number; bottomX: number; bottomY: number;
};

/** Call once, before attaching operation effects. Cache 8 box corners and the
 * exact boundary vertices of the static geometry's convex hull. Never walk the
 * scene tree during label layout.
 */
export function cacheFacilityLabelEnvelope(model: T.Group): FacilityLabelEnvelope {
  model.updateWorldMatrix(true, true);
  const inverse = model.matrixWorld.clone().invert();
  const box = new T.Box3();
  let sourcePointCount = 0;
  const uniquePoints = new Map<string, T.Vector3>(), point = new T.Vector3(), matrix = new T.Matrix4();
  model.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    const positions = object.geometry.getAttribute("position");
      if (!positions) return;
      matrix.multiplyMatrices(inverse, object.matrixWorld);
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(matrix);
        box.expandByPoint(point);
        sourcePointCount++;
        const key = `${point.x},${point.y},${point.z}`;
        if (!uniquePoints.has(key)) uniquePoints.set(key, point.clone());
      }
  });
  if (box.isEmpty()) return { corners: [], supports: [], sourcePointCount, uniquePointCount: 0 };
  const corners: T.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) {
    for (const z of [box.min.z, box.max.z]) corners.push(new T.Vector3(x, y, z));
  }
  const points = [...uniquePoints.values()];
  const hull = new ConvexHull().setFromPoints(points);
  const boundary = new Set<T.Vector3>();
  for (const face of hull.faces) {
    if (face.mark !== 0) continue;
    let edge = face.edge;
    do {
      boundary.add(edge.head().point);
      edge = edge.next;
    } while (edge !== face.edge);
  }
  const supports = boundary.size > 0 ? [...boundary].map(p => p.clone()) : points;
  return { corners, supports, sourcePointCount, uniquePointCount: points.length };
}

/** Project only the bounded cache using the current model-view-projection matrix.
 * Caller owns the scratch vector/output. Reject near-plane crossings/behind-camera
 * geometry instead of manufacturing a clipped/offscreen anchor.
 */
export function projectFacilityBody(
  envelope: FacilityLabelEnvelope, clip: T.Matrix4, width: number, height: number,
  out: ProjectedFacilityBody, point: T.Vector3,
): boolean {
  if (!envelope.corners.length || !envelope.supports.length || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  out.left = out.top = out.topY = Infinity;
  out.right = out.bottom = out.bottomY = -Infinity;
  const e = clip.elements;
  // Keep the cached AABB corners as a cheap conservative clip/near-plane
  // check for the caller's existing fail-closed semantics. Bounds themselves
  // come only from the exact convex-hull boundary below.
  for (const corner of envelope.corners) {
    const w = e[3] * corner.x + e[7] * corner.y + e[11] * corner.z + e[15];
    if (!Number.isFinite(w) || w <= 0) return false;
    point.copy(corner).applyMatrix4(clip);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z) || point.z < -1 || point.z > 1) return false;
  }
  // With positive clip-space w, perspective projection is a linear-fractional
  // map, so each screen-axis extremum of the convex hull is attained at a
  // cached boundary vertex.
  // This loop is bounded by the creation-time hull, not by the current scene
  // geometry.
  for (const support of envelope.supports) {
    const projected = point.copy(support).applyMatrix4(clip);
    const x = (projected.x * 0.5 + 0.5) * width, y = (-projected.y * 0.5 + 0.5) * height;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    out.left = Math.min(out.left, x); out.right = Math.max(out.right, x);
    out.top = Math.min(out.top, y); out.bottom = Math.max(out.bottom, y);
    if (y < out.topY) { out.topY = y; out.topX = x; }
    if (y > out.bottomY) { out.bottomY = y; out.bottomX = x; }
  }
  return true;
}

/** Prefer above the whole body; otherwise below the whole body, never below its
 * roof anchor. Long leaders/offscreen attachment points fail closed. Generic
 * layoutFacilityLabel is unchanged (guidance still uses its original behavior).
 */
export function layoutFacilityLabelOutsideBody(
  body: ProjectedFacilityBody, width: number, height: number,
  viewportWidth: number, viewportHeight: number, bounds: FacilityLabelBounds,
  out: FacilityLabelLayout,
): boolean {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight) || viewportWidth <= 0 || viewportHeight <= 0) return false;
  if (!Number.isFinite(body.top) || !Number.isFinite(body.bottom) || body.top > body.bottom) return false;
  for (let side = 0; side < 2; side++) {
    const x = side === 0 ? body.topX : body.bottomX, y = side === 0 ? body.topY : body.bottomY;
    if (x < 0 || x > viewportWidth || y < 0 || y > viewportHeight) continue;
    // Reuse horizontal containment and pointer coordinates. Choose vertical placement
    // from the full envelope, not from a roof point that could flip into the body.
    if (!layoutFacilityLabel(x, y, width, height, bounds, out)) continue;
    out.y = side === 0 ? Math.min(bounds.bottom, body.top - FACILITY_BODY_GAP) - height
      : Math.max(bounds.top, body.bottom + FACILITY_BODY_GAP);
    if (out.y < bounds.top || out.y + height > bounds.bottom) continue;
    out.pointerSide = side === 0 ? "bottom" : "top";
    out.pointerHeight = side === 0 ? y - out.y - height : out.y - y;
    if (out.pointerHeight < FACILITY_BODY_GAP) continue;
    if (Math.hypot(out.pointerHeight, out.pointerTipX - out.pointerBaseX) > MAX_FACILITY_POINTER_LENGTH) continue;
    return true;
  }
  return false;
}
