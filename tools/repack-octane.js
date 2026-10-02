// Repackages the user's Sketchfab Octane GLB into the game's flat-car rig:
// - nodes: octane-car-body + wheel-front-right/left + wheel-rear-right/left (top-level)
// - body = single mesh with 4 primitives (chassis/paint/body/window), wheel = rim+tread 2 primitives
// - materials remapped to flat-car names (body-shell/lower-detail/glass/wheel-metal/tire)
// - BIN chunk + accessors + bufferViews copied byte-identical (zero vertex reprocessing)
// - corrective per-node matrices: S(s) * T(-center) * W(worldFromSketchfab)
const fs = require("fs");

const SRC = "C:/Users/purpl/Downloads/octane_-_rocket_league_car.glb";
const OUT = "C:/Users/purpl/Downloads/car-soccer-assets/octane-car/model.glb";

const buf = fs.readFileSync(SRC);
const jsonLen = buf.readUInt32LE(12);
const j = JSON.parse(buf.slice(20, 20 + jsonLen).toString());
const binHdr = 20 + jsonLen;
const binLen = buf.readUInt32LE(binHdr);
const bin = buf.slice(binHdr + 8, binHdr + 8 + binLen);

// ---------- mat4 (column-major) ----------
const I = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
function T(x, y, z) { const m = I.slice(); m[12] = x; m[13] = y; m[14] = z; return m; }
function S(x, y, z) { const m = I.slice(); m[0] = x; m[5] = y; m[10] = z; return m; }
function nodeMat(n) {
  if (n.matrix) return n.matrix.slice();
  const t = n.translation || [0,0,0], q = n.rotation || [0,0,0,1], s = n.scale || [1,1,1];
  const [x,y,z,w] = q, x2=x+x, y2=y+y, z2=z+z;
  const xx=x*x2, xy=x*y2, xz=x*z2, yy=y*y2, yz=y*z2, zz=z*z2, wx=w*x2, wy=w*y2, wz=w*z2;
  return [
    (1-(yy+zz))*s[0], (xy+wz)*s[0], (xz-wy)*s[0], 0,
    (xy-wz)*s[1], (1-(xx+zz))*s[1], (yz+wx)*s[1], 0,
    (xz+wy)*s[2], (yz-wx)*s[2], (1-(xx+yy))*s[2], 0,
    t[0], t[1], t[2], 1
  ];
}
const parent = new Map();
j.nodes.forEach((n, i) => (n.children || []).forEach(c => parent.set(c, i)));
function worldMat(i) {
  const anc = [];
  let p = parent.get(i);
  while (p !== undefined) { anc.unshift(p); p = parent.get(p); }
  let m = I.slice();
  for (const a of anc) m = mul(m, nodeMat(j.nodes[a]));
  return mul(m, nodeMat(j.nodes[i]));
}
function xform(m, p) {
  return [
    m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],
    m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],
    m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]
  ];
}
function bbox(meshIdxs, wm) {
  const mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
  for (const mi of meshIdxs) for (const prim of j.meshes[mi].primitives) {
    const a = j.accessors[prim.attributes.POSITION];
    const lo = a.min, hi = a.max;
    for (const c of [[lo[0],lo[1],lo[2]],[hi[0],lo[1],lo[2]],[lo[0],hi[1],lo[2]],[lo[0],lo[1],hi[2]],[hi[0],hi[1],lo[2]],[hi[0],lo[1],hi[2]],[lo[0],hi[1],hi[2]],[hi[0],hi[1],hi[2]]]) {
      const w = xform(wm, c);
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], w[k]); mx[k] = Math.max(mx[k], w[k]); }
    }
  }
  return { mn, mx, dims: mx.map((v,k) => v - mn[k]), center: mx.map((v,k) => (v + mn[k]) / 2) };
}

// ---------- measure ----------
const bodyNodes = [4, 5, 6, 7];           // Chassis, Paint, Octane Body, Window
const wheelNodes = { fr: 8, fl: 11, rr: 14, rl: 17 }; // each has rim+tread children
const bodyMeshes = bodyNodes.map(i => j.nodes[i].mesh);
const W3 = worldMat(3);
const bb = bbox(bodyMeshes, W3);
console.log("body world bbox min", bb.mn.map(v=>+v.toFixed(2)), "max", bb.mx.map(v=>+v.toFixed(2)), "dims", bb.dims.map(v=>+v.toFixed(2)));

const CAR_LEN = 1.466;
const s = CAR_LEN / bb.dims[0];
console.log("scale s =", s.toFixed(6));

// ---------- materials (flat-car order) ----------
const materials = [
  { name: "body-shell", pbrMetallicRoughness: { baseColorFactor: [1,1,1,1], metallicFactor: 0.1, roughnessFactor: 0.45 } },
  { name: "lower-detail", pbrMetallicRoughness: { baseColorFactor: [0.05,0.05,0.06,1], metallicFactor: 0.2, roughnessFactor: 0.8 } },
  { name: "glass", pbrMetallicRoughness: { baseColorFactor: [0.05,0.06,0.08,1], metallicFactor: 0, roughnessFactor: 0.12 } },
  { name: "wheel-metal", pbrMetallicRoughness: { baseColorFactor: [0.03,0.03,0.03,1], metallicFactor: 0.8, roughnessFactor: 0.25 } },
  { name: "lamps", pbrMetallicRoughness: { baseColorFactor: [1,1,1,1], metallicFactor: 0, roughnessFactor: 0.3 } },
  { name: "tail-lamps", pbrMetallicRoughness: { baseColorFactor: [0.8,0.05,0.05,1], metallicFactor: 0, roughnessFactor: 0.3 } },
  { name: "tire", pbrMetallicRoughness: { baseColorFactor: [0.02,0.02,0.02,1], metallicFactor: 0, roughnessFactor: 0.9 } }
];
// user material -> new index: 0 Chassis->body-shell(0), 1 Paint->lower-detail(1), 2 Octane Body->body-shell(0),
// 3 Window->glass(2), 4 Rim->wheel-metal(3), 5 Tread->tire(6)
const matMap = [0, 1, 0, 2, 3, 6];

// ---------- assemble meshes (reference original accessors verbatim) ----------
function mergePrims(meshIdxs, wm) {
  const prims = [];
  for (const mi of meshIdxs) for (const p of j.meshes[mi].primitives) {
    const attrs = { POSITION: p.attributes.POSITION };
    if (p.attributes.NORMAL !== undefined) attrs.NORMAL = p.attributes.NORMAL;
    else console.log("NOTE: mesh", mi, "primitive has no NORMAL");
    const np = { attributes: attrs, material: matMap[p.material] };
    if (p.indices !== undefined) np.indices = p.indices;
    if (p.mode !== undefined && p.mode !== 4) throw new Error("non-triangle primitive mode " + p.mode);
    prims.push(np);
  }
  return { primitives: prims };
}

const bodyMesh = mergePrims(bodyMeshes, W3);

function wheelMesh(groupIdx) {
  const g = j.nodes[groupIdx];
  const meshIdxs = g.children.map(ci => j.nodes[ci].mesh);
  const W = worldMat(groupIdx);
  const wb = bbox(meshIdxs, W);
  // M = S(s) * T(-center) * W  -> geometry centered at node origin, uniformly scaled
  const M = mul(S(s, s, s), mul(T(-wb.center[0], -wb.center[1], -wb.center[2]), W));
  const chk = bbox(meshIdxs, mul(S(s,s,s), mul(T(-wb.center[0], -wb.center[1], -wb.center[2]), W)));
  console.log(`wheel node ${groupIdx}: world center`, wb.center.map(v=>+v.toFixed(2)), "dims", wb.dims.map(v=>+v.toFixed(2)),
    "-> node-space dims", chk.dims.map(v=>+v.toFixed(4)), "center", chk.center.map(v=>+v.toFixed(5)));
  return { mesh: mergePrims(meshIdxs, W), matrix: M, diameter: (wb.dims[0] + wb.dims[1]) / 2 * s };
}

const fr = wheelMesh(wheelNodes.fr), fl = wheelMesh(wheelNodes.fl), rr = wheelMesh(wheelNodes.rr), rl = wheelMesh(wheelNodes.rl);
console.log("wheel diameters (scaled): FR", fr.diameter.toFixed(4), "RR", rr.diameter.toFixed(4), "(flat-car: 0.24 / 0.27)");

// body node matrix: map body bbox center x -> 0.118 (flat-car body center), z -> 0, minY -> -0.145
const cx = 0.118 - bb.center[0] * s;
const cz = 0 - bb.center[2] * s;
const cy = -0.145 - bb.mn[1] * s;
const Mbody = mul(T(cx, cy, cz), S(s, s, s));
// full: T * S * W3
const MbodyFull = mul(Mbody, W3);
const bchk = bbox(bodyMeshes, MbodyFull);
console.log("body node-space bbox min", bchk.mn.map(v=>+v.toFixed(4)), "max", bchk.mx.map(v=>+v.toFixed(4)));

const gltf = {
  asset: { version: "2.0", generator: "car-soccer-web octane repack (user GLB)" },
  scene: 0,
  scenes: [{ name: "Scene", nodes: [0, 1, 2, 3, 4] }],
  nodes: [
    { name: "octane-car-body", mesh: 0, matrix: MbodyFull.map(v => +v.toFixed(7)) },
    { name: "wheel-front-right", mesh: 1, matrix: fr.matrix.map(v => +v.toFixed(7)) },
    { name: "wheel-front-left", mesh: 2, matrix: fl.matrix.map(v => +v.toFixed(7)) },
    { name: "wheel-rear-right", mesh: 3, matrix: rr.matrix.map(v => +v.toFixed(7)) },
    { name: "wheel-rear-left", mesh: 4, matrix: rl.matrix.map(v => +v.toFixed(7)) }
  ],
  meshes: [bodyMesh, fr.mesh, fl.mesh, rr.mesh, rl.mesh],
  materials,
  accessors: j.accessors,
  bufferViews: j.bufferViews,
  buffers: [{ byteLength: binLen }]
};

const jsonBuf = Buffer.from(JSON.stringify(gltf), "utf8");
const jsonPad = Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20);
const binPad = Buffer.alloc((4 - (binLen % 4)) % 4, 0);
const binChunkLen = binLen + binPad.length;
const total = 12 + 8 + jsonBuf.length + jsonPad.length + 8 + binChunkLen;
const out = Buffer.alloc(total);
out.writeUInt32LE(0x46546C67, 0);
out.writeUInt32LE(2, 4);
out.writeUInt32LE(total, 8);
out.writeUInt32LE(jsonBuf.length + jsonPad.length, 12);
out.writeUInt32LE(0x4E4F534A, 16);
jsonBuf.copy(out, 20);
jsonPad.copy(out, 20 + jsonBuf.length);
const binStart = 20 + jsonBuf.length + jsonPad.length;
out.writeUInt32LE(binChunkLen, binStart);
out.writeUInt32LE(0x004E4942, binStart + 4);
bin.copy(out, binStart + 8);
binPad.copy(out, binStart + 8 + binLen);

fs.writeFileSync(OUT, out);
console.log("wrote", OUT, out.length, "bytes");
