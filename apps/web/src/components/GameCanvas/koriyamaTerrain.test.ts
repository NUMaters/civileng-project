import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeKoriyamaTerrain, groundElevationToLocalY, sampleKoriyamaTerrain, type KoriyamaTerrain } from "./koriyamaTerrain";

const base = new URL("../../../public/geodata/koriyama/", import.meta.url);
const metadata = JSON.parse(readFileSync(new URL("terrain-metadata.json", base), "utf8"));
const bytes = readFileSync(new URL("terrain.bin", base));
const terrain = decodeKoriyamaTerrain(Uint8Array.from(bytes).buffer, metadata);
const lonLat = (x: number, y: number, t: KoriyamaTerrain = terrain) => {
  const w = 256 * 2 ** t.metadata.zoom;
  return [(x + t.metadata.pixelOrigin[0]! + .5) / w * 360 - 180,
    Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + t.metadata.pixelOrigin[1]! + .5) / w))) * 180 / Math.PI] as const;
};
// Deliberately artificial unit-test values, never shipped as terrain data.
const fixture = (): KoriyamaTerrain => ({ metadata: { ...metadata, width: 2, height: 2, pixelOrigin: [metadata.pixelOrigin[0]+100,metadata.pixelOrigin[1]+100] },
  elevationsCm: new Int32Array([23000, 23200, 23400, 23600]), quality: new Uint8Array([1,1,1,1]) });

describe("pure terrain interpolation", () => {
  it("bilinearly interpolates in Mercator with metre units and fixed datum", () => {
    const t = fixture(), p = lonLat(.25,.75,t), s = sampleKoriyamaTerrain(t,...p);
    expect(s.elevationM).toBeCloseTo(233.5, 6); expect(s.localY).toBeCloseTo(3.5, 6);
    expect(groundElevationToLocalY(225)).toBe(-5);
  });
  it("preserves corners, north/south order and valid zero or negative heights", () => {
    const t=fixture(); t.elevationsCm[0]=0; t.elevationsCm[3]=-100;
    expect(sampleKoriyamaTerrain(t,...lonLat(0,0,t)).elevationM).toBe(0);
    expect(sampleKoriyamaTerrain(t,...lonLat(1,1,t)).elevationM).toBe(-1);
  });
  it("reports noData without renormalizing; zero-weight missing neighbours are harmless", () => {
    const t=fixture(); t.quality[3]=0; t.elevationsCm[3]=metadata.noData;
    expect(sampleKoriyamaTerrain(t,...lonLat(.5,.5,t))).toEqual({elevationM:null,localY:null,quality:"noData"});
    expect(sampleKoriyamaTerrain(t,...lonLat(0,0,t)).elevationM).toBe(230);
  });
  it("propagates worst contributing source quality", () => {
    const t=fixture(); t.quality[3]=2;
    expect(sampleKoriyamaTerrain(t,...lonLat(.5,.5,t)).quality).toBe("fallback-dem5b");
    t.quality[3]=3;
    expect(sampleKoriyamaTerrain(t,...lonLat(.5,.5,t)).quality).toBe("fallback-dem10b");
    expect(sampleKoriyamaTerrain(t,...lonLat(0,0,t)).quality).toBe("dem5a");
  });
  it("does not clamp out-of-coverage or invalid coordinates", () => {
    expect(sampleKoriyamaTerrain(terrain,140.369,37.36).quality).toBe("outside-coverage");
    expect(sampleKoriyamaTerrain(terrain,NaN,37.36).quality).toBe("invalid-coordinate");
    expect(() => groundElevationToLocalY(Infinity)).toThrow();
  });
  it("rejects malformed buffers, dimensions, and source flags", () => {
    expect(() => decodeKoriyamaTerrain(new ArrayBuffer(0),metadata)).toThrow();
    expect(() => decodeKoriyamaTerrain(Uint8Array.from(bytes).buffer,{...metadata,width:1})).toThrow();
    const bad=Uint8Array.from(bytes); bad[4]=0;
    expect(() => decodeKoriyamaTerrain(bad.buffer,metadata)).toThrow();
  });
});

describe("bounded real GSI asset", () => {
  it("matches recorded asset and source hashes", () => {
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(metadata.asset.sha256);
    for(const source of metadata.sources) expect(createHash("sha256").update(readFileSync(new URL(source.file,base))).digest("hex")).toBe(source.sha256);
  });
  it("covers every requested edge/corner and the campus area", () => {
    for(const lon of [140.370,140.380,140.398]) for(const lat of [37.351,37.358,37.379]) {
      const s=sampleKoriyamaTerrain(terrain,lon,lat);
      expect(s.elevationM).not.toBeNull(); expect(s.elevationM!).toBeGreaterThan(150); expect(s.elevationM!).toBeLessThan(400);
    }
  });
  it("matches coverage counts/range and has actual relief", () => {
    const counts=[0,0,0,0]; let min=Infinity,max=-Infinity;
    terrain.quality.forEach((q,i)=>{ counts[q]++; if(q) { min=Math.min(min,terrain.elevationsCm[i]!/100);max=Math.max(max,terrain.elevationsCm[i]!/100); } });
    expect(counts).toEqual([metadata.counts.noData,metadata.counts.dem5a,metadata.counts.dem5b,metadata.counts.dem10b]);
    expect([min,max]).toEqual(metadata.elevationRangeM); expect(max-min).toBeGreaterThan(10);
    expect(metadata.bounds).toEqual([140.370,37.351,140.398,37.379]);
  });
  it("interpolates continuously across cached tile seams", () => {
    const seamX = 256 - metadata.pixelOrigin[0] % 256 - .5, y = 150.25;
    const left=sampleKoriyamaTerrain(terrain,...lonLat(seamX-1e-5,y));
    const right=sampleKoriyamaTerrain(terrain,...lonLat(seamX+1e-5,y));
    expect(left.elevationM).not.toBeNull(); expect(right.elevationM).not.toBeNull();
    expect(Math.abs(left.elevationM!-right.elevationM!)).toBeLessThan(.001);
  });
});
