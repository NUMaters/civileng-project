import {
  Cartesian2,
  Color,
  ColorMaterialProperty,
  ImageMaterialProperty,
  type MaterialProperty,
} from "cesium";

export type StructureMaterialKind =
  | "earth"
  | "grass"
  | "concrete"
  | "asphalt"
  | "riprap"
  | "water"
  | "metal"
  | "accent";

const textureCache = new Map<string, HTMLCanvasElement>();

const SOLID_COLOR_BY_KIND: Record<Exclude<StructureMaterialKind, "accent">, string> = {
  earth: "#a07440",
  grass: "#5a8a3e",
  concrete: "#c8ced1",
  asphalt: "#3a3f44",
  riprap: "#6b7074",
  water: "#1f86bd",
  metal: "#7a848a",
};

/**
 * 施設パーツ用のマテリアル（手続きテクスチャ）。
 * glTF 無しでもコンクリート・土・護岸などらしさを出す。
 *
 * @param options.solidOnly 円柱など ImageMaterial が不安定な形状向けに単色へ落とす。
 */
export function createStructureMaterial(
  kind: StructureMaterialKind,
  options: {
    preview?: boolean;
    accentHex?: string;
    repeatX?: number;
    repeatY?: number;
    /** true ならテクスチャを使わず ColorMaterial のみ（Cylinder 向け）。 */
    solidOnly?: boolean;
  } = {},
): MaterialProperty {
  const preview = options.preview === true;
  if (kind === "accent") {
    const color = Color.fromCssColorString(options.accentHex ?? "#e8a72d").withAlpha(
      preview ? 0.55 : 0.95,
    );
    return new ColorMaterialProperty(color);
  }

  if (options.solidOnly === true) {
    return new ColorMaterialProperty(
      Color.fromCssColorString(SOLID_COLOR_BY_KIND[kind]).withAlpha(preview ? 0.55 : 0.92),
    );
  }

  try {
    if (kind === "water") {
      const image = getOrCreateTexture("water", paintWaterTexture);
      return new ImageMaterialProperty({
        image,
        repeat: new Cartesian2(options.repeatX ?? 3, options.repeatY ?? 2),
        color: Color.WHITE.withAlpha(preview ? 0.45 : 0.88),
        transparent: true,
      });
    }

    const painters: Record<
      Exclude<StructureMaterialKind, "accent" | "water">,
      () => HTMLCanvasElement
    > = {
      earth: () => getOrCreateTexture("earth", paintEarthTexture),
      grass: () => getOrCreateTexture("grass", paintGrassTexture),
      concrete: () => getOrCreateTexture("concrete", paintConcreteTexture),
      asphalt: () => getOrCreateTexture("asphalt", paintAsphaltTexture),
      riprap: () => getOrCreateTexture("riprap", paintRiprapTexture),
      metal: () => getOrCreateTexture("metal", paintMetalTexture),
    };

    const painter = painters[kind];
    if (painter === undefined) {
      return new ColorMaterialProperty(
        Color.fromCssColorString("#9aa3a8").withAlpha(preview ? 0.5 : 0.9),
      );
    }

    const image = painter();
    return new ImageMaterialProperty({
      image,
      repeat: new Cartesian2(options.repeatX ?? 2.5, options.repeatY ?? 1.5),
      color: Color.WHITE.withAlpha(preview ? 0.5 : 1),
      transparent: preview,
    });
  } catch (error) {
    console.warn("Structure texture unavailable, falling back to solid color", kind, error);
    return new ColorMaterialProperty(
      Color.fromCssColorString(SOLID_COLOR_BY_KIND[kind]).withAlpha(preview ? 0.55 : 0.92),
    );
  }
}

function getOrCreateTexture(key: string, paint: (ctx: CanvasRenderingContext2D, size: number) => void): HTMLCanvasElement {
  const cached = textureCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    paint(ctx, size);
  }
  textureCache.set(key, canvas);
  return canvas;
}

function paintEarthTexture(ctx: CanvasRenderingContext2D, size: number): void {
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, "#9a6b3a");
  gradient.addColorStop(0.45, "#b8844a");
  gradient.addColorStop(1, "#7d552c");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 220; i += 1) {
    const x = pseudo(i * 3.1) * size;
    const y = pseudo(i * 7.7) * size;
    ctx.fillStyle = `rgba(${90 + pseudo(i) * 60},${55 + pseudo(i + 2) * 40},${25 + pseudo(i + 4) * 20},${0.12 + pseudo(i + 1) * 0.2})`;
    ctx.fillRect(x, y, 2 + pseudo(i + 5) * 4, 1 + pseudo(i + 6) * 3);
  }
}

function paintGrassTexture(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = "#4f7a3a";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 300; i += 1) {
    const x = pseudo(i * 2.2) * size;
    const y = pseudo(i * 5.4) * size;
    ctx.strokeStyle = `rgba(${40 + pseudo(i) * 50},${90 + pseudo(i + 1) * 80},${30 + pseudo(i + 2) * 30},${0.35})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (pseudo(i + 3) - 0.5) * 4, y - 3 - pseudo(i + 4) * 5);
    ctx.stroke();
  }
  // 土の露出
  for (let i = 0; i < 40; i += 1) {
    ctx.fillStyle = `rgba(140,100,55,${0.15 + pseudo(i) * 0.2})`;
    ctx.fillRect(pseudo(i * 9) * size, pseudo(i * 11) * size, 6, 4);
  }
}

function paintConcreteTexture(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = "#c8ced1";
  ctx.fillRect(0, 0, size, size);
  // 型目
  ctx.strokeStyle = "rgba(90,95,100,0.35)";
  ctx.lineWidth = 1;
  for (let x = 0; x < size; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  for (let y = 0; y < size; y += 24) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  for (let i = 0; i < 180; i += 1) {
    ctx.fillStyle = `rgba(${160 + pseudo(i) * 50},${165 + pseudo(i + 1) * 45},${170 + pseudo(i + 2) * 40},${0.08})`;
    ctx.fillRect(pseudo(i * 4) * size, pseudo(i * 6) * size, 3, 2);
  }
}

function paintAsphaltTexture(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = "#3a3f44";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 250; i += 1) {
    ctx.fillStyle = `rgba(${40 + pseudo(i) * 40},${42 + pseudo(i + 1) * 40},${48 + pseudo(i + 2) * 40},${0.35})`;
    ctx.fillRect(pseudo(i * 3) * size, pseudo(i * 5) * size, 2, 2);
  }
  // 中央線
  ctx.strokeStyle = "rgba(220,190,70,0.45)";
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, size * 0.5);
  ctx.lineTo(size, size * 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
}

function paintRiprapTexture(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = "#6b7074";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 55; i += 1) {
    const x = pseudo(i * 1.7) * size;
    const y = pseudo(i * 2.9) * size;
    const r = 4 + pseudo(i + 3) * 10;
    const shade = 90 + pseudo(i + 4) * 70;
    ctx.fillStyle = `rgb(${shade},${shade + 4},${shade + 8})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + r, y + r * 0.3);
    ctx.lineTo(x + r * 0.7, y + r);
    ctx.lineTo(x - r * 0.2, y + r * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(40,40,45,0.35)";
    ctx.stroke();
  }
}

function paintMetalTexture(ctx: CanvasRenderingContext2D, size: number): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0, "#9aa3a8");
  gradient.addColorStop(0.5, "#6f777c");
  gradient.addColorStop(1, "#555c61");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(30,30,30,0.25)";
  for (let y = 4; y < size; y += 8) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
}

function paintWaterTexture(ctx: CanvasRenderingContext2D, size: number): void {
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, "#1a7eb8");
  gradient.addColorStop(0.5, "#2596cf");
  gradient.addColorStop(1, "#0f5f8a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(210,240,255,0.28)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i += 1) {
    const y = (i / 8) * size + pseudo(i) * 6;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= size; x += 8) {
      ctx.lineTo(x, y + Math.sin(x * 0.12 + i) * 3);
    }
    ctx.stroke();
  }
}

function pseudo(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}
