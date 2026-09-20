/** Node 22+, no dependencies. Only terrain* outputs; cached PNGs are immutable inputs. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const out = new URL('../public/geodata/koriyama/', import.meta.url);
const bounds = [140.370, 37.351, 140.398, 37.379];
const zoom = 14, world = 256 * 2 ** zoom, noData = -2147483648;
const hash = b => createHash('sha256').update(b).digest('hex');
const px = lon => (lon + 180) / 360 * world;
const py = lat => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * world;

/** Strict subset used by GSI: 8-bit RGB/RGBA, non-interlaced, all five PNG filters. */
export function decodePng(png) {
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Error('Invalid PNG');
  let width, height, channels; const chunks = [];
  for (let p = 8; p < png.length;) {
    const len = png.readUInt32BE(p), type = png.toString('ascii', p + 4, p + 8);
    const d = png.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = d.readUInt32BE(0); height = d.readUInt32BE(4);
      channels = d[9] === 2 ? 3 : d[9] === 6 ? 4 : 0;
      if (width !== 256 || height !== 256 || d[8] !== 8 || !channels || d[10] || d[11] || d[12]) throw Error('Unsupported GSI PNG');
    }
    if (type === 'IDAT') chunks.push(d);
    p += len + 12;
    if (type === 'IEND') break;
  }
  const stride = width * channels, raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: 300000 });
  if (raw.length !== (stride + 1) * height) throw Error('Bad PNG size');
  const pixels = Buffer.alloc(stride * height);
  const paeth = (a,b,c) => { const p=a+b-c, pa=Math.abs(p-a), pb=Math.abs(p-b), pc=Math.abs(p-c); return pa<=pb && pa<=pc ? a : pb<=pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw Error('Bad PNG filter');
    for (let x = 0; x < stride; x++) {
      const i=y*stride+x, a=x>=channels ? pixels[i-channels] : 0, b=y ? pixels[i-stride] : 0, c=y && x>=channels ? pixels[i-stride-channels] : 0;
      pixels[i] = raw[y*(stride+1)+1+x] + [0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];
    }
  }
  const values = new Int32Array(width * height);
  for (let i=0; i<values.length; i++) {
    const p=i*channels, n=pixels[p]*65536+pixels[p+1]*256+pixels[p+2];
    values[i] = n === 8388608 || (channels === 4 && pixels[p+3] !== 255) ? noData : n < 8388608 ? n : n-16777216;
  }
  return values;
}

async function main() {
  await mkdir(out, { recursive: true });
  // Pixel-centre convention; a one-sample halo supports bilinear sampling at bounds.
  const x0=Math.floor(px(bounds[0])-.5), y0=Math.floor(py(bounds[3])-.5);
  const width=Math.ceil(px(bounds[2])-.5)-x0+1, height=Math.ceil(py(bounds[1])-.5)-y0+1;
  const bytes=Buffer.alloc(width*height*5);
  for (let i=0;i<width*height;i++) bytes.writeInt32LE(noData,i*5);
  const sources=[], attempts=[]; let downloadedBytes=0;
  for (let ty=Math.floor(y0/256);ty<=Math.floor((y0+height-1)/256);ty++) {
    for (let tx=Math.floor(x0/256);tx<=Math.floor((x0+width-1)/256);tx++) {
      for (const [layer,quality] of [['dem5a_png',1],['dem5b_png',2],['dem_png',3]]) {
        const name=`terrain-source-${layer}-${zoom}-${tx}-${ty}.png`;
        const url=`https://cyberjapandata.gsi.go.jp/xyz/${layer}/${zoom}/${tx}/${ty}.png`;
        const file=new URL(name,out), infoFile=new URL(name+'.json',out);
        let png, info;
        try {
          info=JSON.parse(await readFile(infoFile,'utf8'));
          if (info.status === 404) { attempts.push({url,status:404}); continue; }
          png=await readFile(file); if (hash(png)!==info.sha256) throw Error('Cache hash mismatch');
        }
        catch (e) {
          if (e.code !== 'ENOENT') throw e;
          if (process.argv.includes('--offline')) throw Error(`Offline cache miss: ${name}`);
          const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
          if (response.status===404) {
            attempts.push({url,status:404});
            await writeFile(infoFile,JSON.stringify({url,status:404,retrievedAt:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
            continue;
          }
          if (!response.ok) throw Error(`${response.status}: ${url}`);
          const parts=[]; let size=0;
          for await (const part of response.body) {
            size+=part.length; downloadedBytes+=part.length;
            if (size>500000 || downloadedBytes>4*1024*1024) throw Error('Download budget exceeded');
            parts.push(part);
          }
          png=Buffer.concat(parts); decodePng(png);
          info={url,file:name,bytes:png.length,sha256:hash(png),retrievedAt:new Date().toISOString(),lastModified:response.headers.get('last-modified')};
          await writeFile(file,png,{flag:'wx'}); await writeFile(infoFile,JSON.stringify(info,null,2)+'\n',{flag:'wx'});
        }
        const tile=decodePng(png); sources.push({...info,layer,quality,x:tx,y:ty,z:zoom});
        let missing=0;
        for (let y=Math.max(y0,ty*256);y<=Math.min(y0+height-1,ty*256+255);y++) {
          for (let x=Math.max(x0,tx*256);x<=Math.min(x0+width-1,tx*256+255);x++) {
            const i=((y-y0)*width+x-x0)*5, v=tile[(y-ty*256)*256+x-tx*256];
            if (!bytes[i+4] && v!==noData) { bytes.writeInt32LE(v,i); bytes[i+4]=quality; }
            if (!bytes[i+4]) missing++;
          }
        }
        if (!missing) break;
      }
    }
  }
  const counts={noData:0,dem5a:0,dem5b:0,dem10b:0}; const keys=Object.keys(counts); let min=Infinity,max=-Infinity;
  for(let i=0;i<width*height;i++) { const q=bytes[i*5+4]; counts[keys[q]]++; if(q) { const v=bytes.readInt32LE(i*5)/100; min=Math.min(min,v); max=Math.max(max,v); } }
  if (!Number.isFinite(min)) throw Error('No measured terrain available');
  const metadata={schemaVersion:1,bounds,zoom,width,height,pixelOrigin:[x0,y0],pixelAnchor:'centre (+0.5)',rowOrder:'north-to-south',horizontalCrs:'EPSG:3857 raster; longitude/latitude input',
    encoding:'row-major interleaved int32 little-endian centimetres + uint8 quality (5 bytes/sample)',noData,
    qualityCodes:{0:'noData',1:'DEM5A',2:'DEM5B fallback',3:'DEM10B fallback'},localDatumM:230,
    verticalDatum:'GSI orthometric elevation H, Japan national mean-sea-level height system (Tokyo Peil mainland reference); NOT ellipsoid height',
    verticalDatumEpoch:'Tile payload has no epoch identifier. 2011/2024 realization not independently verified; do not assume compatibility with PLATEAU 2020 absolute heights.',
    sourceNominalResolutionM:{DEM5A:5,DEM5B:5,DEM10B:10},gridSpacingAtCentreM:40075016.68557849/world*Math.cos((bounds[1]+bounds[3])/2*Math.PI/180),
    acquisitionDate:'Unknown; retrieval dates and HTTP Last-Modified are not survey dates',sources,attempts,counts,elevationRangeM:[min,max],
    asset:{file:'terrain.bin',bytes:bytes.length,sha256:hash(bytes)},
    sourceUrl:'https://maps.gsi.go.jp/development/ichiran.html',encodingUrl:'https://maps.gsi.go.jp/development/demtile.html',
    license:'GSI content terms / PDL1.0; attribution and processing statement required',licenseUrl:'https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html',
    attribution:'地理院タイル（国土地理院）標高タイルを加工して作成',
    limitations:['Source DEM is interpolated terrain, not a direct survey of each output point','No bridge decks, building roofs or reliable river bathymetry','No geoid offset or vertical exaggeration applied','Strict noData; no synthetic filling']};
  await writeFile(new URL('terrain.bin',out),bytes);
  await writeFile(new URL('terrain-metadata.json',out),JSON.stringify(metadata,null,2)+'\n');
  console.log(JSON.stringify({width,height,counts,elevationRangeM:[min,max],assetBytes:bytes.length,sourceBytes:sources.reduce((n,s)=>n+s.bytes,0),downloadedBytes},null,2));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
