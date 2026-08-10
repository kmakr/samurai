// A single dynamic geometry holding N textured quads, rebuilt each frame.
//
// Writing ~2k vertices per frame is far cheaper than either re-rasterising a
// canvas or issuing a draw call per decal, and it lets every mark share one
// atlas and one material.

import * as THREE from 'three';

const VERT = /* glsl */`
  attribute float aAlpha;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vUv = uv;
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */`
  uniform sampler2D tAtlas;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    float a = texture2D(tAtlas, vUv).a * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

export function quadMaterial(atlas, color = 0x000000, depthWrite = false) {
  return new THREE.ShaderMaterial({
    uniforms: {
      tAtlas: { value: atlas },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite,
    depthTest: true,
    // Floor stains wind clockwise seen from above, and billboarded droplets can
    // face either way, so neither can rely on front-face culling.
    side: THREE.DoubleSide,
  });
}

export class QuadBatch {
  constructor(max, material) {
    this.max = max;
    this.count = 0;

    this.pos = new Float32Array(max * 4 * 3);
    this.uv = new Float32Array(max * 4 * 2);
    this.alpha = new Float32Array(max * 4);

    const IndexArray = max * 4 > 65535 ? Uint32Array : Uint16Array;
    const idx = new IndexArray(max * 6);
    for (let i = 0; i < max; i++) {
      const o = i * 4, k = i * 6;
      idx[k] = o; idx[k + 1] = o + 1; idx[k + 2] = o + 2;
      idx[k + 3] = o; idx[k + 4] = o + 2; idx[k + 5] = o + 3;
    }

    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3);
    this.aUv = new THREE.BufferAttribute(this.uv, 2);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1);
    this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aUv.setUsage(THREE.DynamicDrawUsage);
    this.aAlpha.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('uv', this.aUv);
    g.setAttribute('aAlpha', this.aAlpha);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);

    this.geo = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }

  begin() { this.count = 0; }

  // Corners must be given in winding order; uvRect is [u0, v0, u1, v1].
  push(c0, c1, c2, c3, uvRect, alpha) {
    if (this.count >= this.max) return false;
    const i = this.count++;
    const p = i * 12, u = i * 8, a = i * 4;
    const P = this.pos;
    P[p] = c0.x; P[p + 1] = c0.y; P[p + 2] = c0.z;
    P[p + 3] = c1.x; P[p + 4] = c1.y; P[p + 5] = c1.z;
    P[p + 6] = c2.x; P[p + 7] = c2.y; P[p + 8] = c2.z;
    P[p + 9] = c3.x; P[p + 10] = c3.y; P[p + 11] = c3.z;

    const [u0, v0, u1, v1] = uvRect;
    const U = this.uv;
    U[u] = u0; U[u + 1] = v0;
    U[u + 2] = u1; U[u + 3] = v0;
    U[u + 4] = u1; U[u + 5] = v1;
    U[u + 6] = u0; U[u + 7] = v1;

    const A = this.alpha;
    A[a] = A[a + 1] = A[a + 2] = A[a + 3] = alpha;
    return true;
  }

  end() {
    // Full re-upload. At these vertex counts it is a few tens of KB and avoids
    // depending on the update-range API, which has moved between three versions.
    this.aPos.needsUpdate = true;
    this.aUv.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
    this.geo.setDrawRange(0, this.count * 6);
  }
}
