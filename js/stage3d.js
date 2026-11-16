/* =========================================================
   NIGHT CITY : JACK IN — STAGE 3D (외부 라이브러리 없이 WebGL로 직접 렌더링)
   0과 1로 이루어진 사람(옆모습 흉상) + 목 뒤 소켓 + 정면 3D 칩

   - 사람: 머리·목·어깨를 SDF(부드럽게 합친 타원체·캡슐)로 정의하고,
           표면을 라이다처럼 가로줄로 샘플링한 점 2만여 개를 0/1 숫자로 그림
           (림 라이트 · 스캔 띠 · 아래에서 흩어져 떠오르는 입자 · 숫자 깜빡임)
   - 칩:   assets/chip.svg를 앞면 텍스처로 쓴 두께 있는 3D 칩. 떠 있을 땐 정면,
           꽂힐 때만 소켓 방향으로 살짝 돌아 들어감. 몸 안에 묻힌 부분은 가려지고
           피부 아래로 연두색 빛이 비침
   - 후처리: 블룸 · 색수차 · 비네팅 · 필름 그레인

   사용: Stage3D.supported()
         Stage3D.prepare()              (미리 점 계산, 선택)
         Stage3D.start(canvas, { onNear, onInsertStart, onLocked, onFrame })
         Stage3D.insert()               (키보드 등으로 자동 삽입)
         Stage3D.stop()
   ========================================================= */
(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- 수학 ---------------- */
  const V = {
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  };
  const M = {
    ident: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    persp(fovy, asp, n, f) {
      const t = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
      m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = (2 * f * n) / (n - f);
      return m;
    },
    lookAt(e, c, up) {
      const z = V.norm(V.sub(e, c)), x = V.norm(V.cross(up, z)), y = V.cross(z, x);
      return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -V.dot(x, e), -V.dot(y, e), -V.dot(z, e), 1]);
    },
    mul(a, b) {
      const o = new Float32Array(16);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
        o[i * 4 + j] = s;
      }
      return o;
    },
    rotY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
    trs(t, ry, s = 1) { const m = M.rotY(ry); for (let i = 0; i < 12; i++) if (i % 4 !== 3) m[i] *= s; m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; return m; },
    apply(m, p) {
      const x = p[0], y = p[1], z = p[2], w = m[3] * x + m[7] * y + m[11] * z + m[15];
      return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
    },
    invert(m) {
      const a = m, o = new Float32Array(16);
      const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4];
      const b03 = a[1] * a[6] - a[2] * a[5], b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
      const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12], b08 = a[8] * a[15] - a[11] * a[12];
      const b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
      const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
      o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
      o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
      o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
      o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
      o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
      o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
      o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
      o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
      return o;
    },
  };

  /* ---------------- 사람 형태 (SDF) ----------------
     y 위쪽, 얼굴은 -x 방향. 단위: 머리 높이 ≈ 0.75 */
  function sdE(p, c, r) {
    const x = (p[0] - c[0]) / r[0], y = (p[1] - c[1]) / r[1], z = (p[2] - c[2]) / r[2];
    const k0 = Math.sqrt(x * x + y * y + z * z);
    const k1 = Math.sqrt((x / r[0]) ** 2 + (y / r[1]) ** 2 + (z / r[2]) ** 2);
    return (k0 * (k0 - 1)) / (k1 || 1e-6);
  }
  function sdCap(p, a, b, r) {
    const pa = V.sub(p, a), ba = V.sub(b, a);
    const h = Math.max(0, Math.min(1, V.dot(pa, ba) / V.dot(ba, ba)));
    return V.len(V.sub(pa, V.mul(ba, h))) - r;
  }
  const sdS = (p, c, r) => V.len(V.sub(p, c)) - r;
  function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
  const smax = (a, b, k) => -smin(-a, -b, k);

  function sdf(p) {
    const q = [p[0], p[1], Math.abs(p[2])];          // 좌우 대칭
    // 머리
    let d = sdE(p, [0.06, 0.62, 0], [0.34, 0.37, 0.29]);
    d = smin(d, sdE(p, [-0.13, 0.5, 0], [0.24, 0.3, 0.22]), 0.08);
    d = smin(d, sdE(p, [-0.13, 0.31, 0], [0.21, 0.15, 0.19]), 0.08);
    d = smin(d, sdE(p, [-0.27, 0.25, 0], [0.07, 0.07, 0.085]), 0.05);
    d = smin(d, sdE(q, [-0.2, 0.44, 0.12], [0.12, 0.1, 0.09]), 0.05);
    d = smin(d, sdE(p, [-0.31, 0.585, 0], [0.05, 0.035, 0.16]), 0.04);
    d = smin(d, sdCap(p, [-0.32, 0.555, 0], [-0.405, 0.455, 0], 0.03), 0.03);
    d = smin(d, sdE(p, [-0.4, 0.447, 0], [0.04, 0.03, 0.048]), 0.02);
    d = smin(d, sdE(p, [-0.338, 0.357, 0], [0.034, 0.024, 0.085]), 0.02);
    d = smin(d, sdE(p, [-0.327, 0.317, 0], [0.032, 0.024, 0.075]), 0.02);
    d = smax(d, -sdS(q, [-0.335, 0.51, 0.1], 0.055), 0.04);      // 눈두덩
    d = smin(d, sdS(q, [-0.312, 0.508, 0.1], 0.042), 0.015);      // 눈
    d = smin(d, sdE(q, [0.06, 0.47, 0.29], [0.07, 0.11, 0.03]), 0.03);   // 귀
    // 목
    d = smin(d, sdCap(p, [0.0, 0.3, 0], [0.03, -0.12, 0], 0.15), 0.1);
    d = smin(d, sdE(p, [-0.13, 0.12, 0], [0.03, 0.04, 0.04]), 0.04);
    // 어깨 · 가슴 · 등
    d = smin(d, sdE(p, [0.06, -0.2, 0], [0.24, 0.16, 0.48]), 0.15);
    d = smin(d, sdS(q, [0.02, -0.28, 0.55], 0.17), 0.15);
    d = smin(d, sdE(p, [-0.04, -0.52, 0], [0.27, 0.38, 0.52]), 0.15);
    d = smin(d, sdE(p, [0.12, -0.48, 0], [0.22, 0.36, 0.5]), 0.15);
    return Math.max(d, -(p[1] + 0.78));
  }
  function grad(p) {
    const e = 0.0015;
    return V.norm([
      sdf([p[0] + e, p[1], p[2]]) - sdf([p[0] - e, p[1], p[2]]),
      sdf([p[0], p[1] + e, p[2]]) - sdf([p[0], p[1] - e, p[2]]),
      sdf([p[0], p[1], p[2] + e]) - sdf([p[0], p[1], p[2] - e]),
    ]);
  }

  // 표면을 라이다처럼 가로줄로 샘플링
  let cloud = null;
  function buildCloud() {
    if (cloud) return cloud;
    const target = 24000, ROW = 0.0105;
    const pos = [], nor = [], seed = [];
    let tries = 0;
    while (pos.length / 3 < target && tries < 400000) {
      tries++;
      const head = Math.random() < 0.55;
      let p = head
        ? [-0.5 + Math.random() * 0.95, 0.15 + Math.random() * 0.9, -0.36 + Math.random() * 0.72]
        : [-0.45 + Math.random() * 0.9, -0.8 + Math.random() * 0.98, -0.78 + Math.random() * 1.56];
      let d = sdf(p), ok = false;
      for (let i = 0; i < 6; i++) {
        if (Math.abs(d) > 0.3) break;
        const n = grad(p);
        p = V.sub(p, V.mul(n, d));
        d = sdf(p);
        if (Math.abs(d) < 0.002) { ok = true; break; }
      }
      if (!ok) continue;
      // 가로줄로 정렬
      p[1] = Math.round(p[1] / ROW) * ROW;
      for (let i = 0; i < 3; i++) {
        const n = grad(p), dd = sdf(p), h = n[0] * n[0] + n[2] * n[2];
        if (h < 0.05) break;
        p[0] -= (n[0] * dd) / h; p[2] -= (n[2] * dd) / h;
      }
      if (Math.abs(sdf(p)) > 0.004 || p[1] < -0.78) continue;
      const n = grad(p);
      pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); seed.push(Math.random(), Math.random());
    }
    // 목 뒤 포트 위치: +x에서 목 높이로 광선을 쏴서 표면을 찾음
    let port = [1, 0.08, 0];
    for (let i = 0; i < 200; i++) { const d = sdf(port); if (d < 0.0005) break; port = [port[0] - Math.max(d, 0.001), port[1], port[2]]; }
    cloud = { pos: new Float32Array(pos), nor: new Float32Array(nor), seed: new Float32Array(seed), count: pos.length / 3, port, portN: grad(port) };
    return cloud;
  }

  /* ---------------- WebGL ---------------- */
  let gl = null, canvas = null, raf = 0, running = false, opts = {};
  let progPts, progMesh, progBright, progBlur, progComp;
  let bufPts = {}, chipMesh = null, socketMesh = null, quad = null, atlas = null, chipTex = null;
  let rtScene = null, rtA = null, rtB = null;
  let W = 0, H = 0, dpr = 1;

  function compile(vs, fs) {
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    p.u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); p.u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name); }
    p.a = {};
    const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < na; i++) { const info = gl.getActiveAttrib(p, i); p.a[info.name] = gl.getAttribLocation(p, info.name); }
    return p;
  }

  function buffer(data) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  }
  function attr(prog, name, buf, size) {
    const loc = prog.a[name];
    if (loc === undefined || loc < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }
  function disableAttrs(prog) { Object.values(prog.a).forEach((l) => l >= 0 && gl.disableVertexAttribArray(l)); }

  function target(w, h, depth) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    let rb = null;
    if (depth) {
      rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { t, fb, rb, w, h };
  }
  function freeTarget(r) { if (!r) return; gl.deleteTexture(r.t); gl.deleteFramebuffer(r.fb); if (r.rb) gl.deleteRenderbuffer(r.rb); }

  function texFromCanvas(c) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /* ---------------- 셰이더 ---------------- */
  const VS_PTS = `
    attribute vec3 aPos; attribute vec3 aNor; attribute vec2 aSeed;
    uniform mat4 uProj, uView, uModel;
    uniform float uTime, uSize, uScan, uLock, uMotion;
    uniform vec3 uPort;
    varying float vB; varying float vDigit; varying float vWave; varying float vCyan;
    void main() {
      vec3 p = aPos;
      float bottom = smoothstep(-0.42, -0.74, p.y);
      float drift = fract(uTime * 0.06 * (0.4 + aSeed.x) + aSeed.y) * uMotion;
      p += bottom * vec3((aSeed.x - 0.5) * 0.5, 0.55, (aSeed.y - 0.5) * 0.5) * drift;
      float fade = 1.0 - bottom * (0.35 + drift * 0.65);
      vec4 world = uModel * vec4(p, 1.0);
      vec4 view = uView * world;
      gl_Position = uProj * view;
      vec3 nV = normalize(mat3(uView) * mat3(uModel) * aNor);
      vec3 vd = normalize(-view.xyz);
      float facing = dot(nV, vd);
      float rim = pow(1.0 - abs(facing), 2.2);
      float key = max(0.0, dot(nV, normalize(vec3(0.5, 0.7, 0.4)))) * 0.45;
      float b = 0.16 + rim * 1.05 + key + aSeed.y * 0.12;
      b += exp(-pow((aPos.y - uScan) * 16.0, 2.0)) * 0.9;
      vWave = 0.0;
      if (uLock >= 0.0) {
        float d = distance(aPos, uPort);
        vWave = exp(-pow((d - uLock * 1.15) * 8.0, 2.0));
        b += vWave * 1.4;
      }
      if (facing < 0.0) b *= 0.45;                    // 뒤쪽 면은 어둡게
      vB = b * fade;
      vCyan = step(0.985, aSeed.x) + bottom * step(0.6, aSeed.y);
      float flick = floor(uTime * (1.0 + aSeed.y * 7.0) * uMotion + aSeed.x * 50.0);
      vDigit = step(0.5, fract(sin(flick * 12.9898 + aSeed.x * 78.233) * 43758.5453));
      gl_PointSize = uSize * (0.85 + aSeed.y * 0.35) / max(0.2, -view.z);
    }`;
  const FS_PTS = `
    precision mediump float;
    uniform sampler2D uAtlas;
    varying float vB; varying float vDigit; varying float vWave; varying float vCyan;
    void main() {
      vec2 uv = gl_PointCoord; uv.x = (uv.x + vDigit) * 0.5;
      float a = texture2D(uAtlas, uv).a;
      if (a < 0.08) discard;
      vec3 red = vec3(1.0, 0.13, 0.27), hot = vec3(1.0, 0.78, 0.84), cyan = vec3(0.37, 0.96, 1.0), green = vec3(0.07, 0.97, 0.44);
      float b = clamp(vB, 0.0, 2.2);
      vec3 col = mix(red * 0.5, red, clamp(b, 0.0, 1.0));
      col = mix(col, hot, clamp(b - 1.0, 0.0, 1.0));
      col = mix(col, cyan, clamp(vCyan, 0.0, 1.0) * 0.85);
      col = mix(col, green, clamp(vWave, 0.0, 1.0) * 0.6);
      gl_FragColor = vec4(col * a * min(b, 1.5), 0.0);
    }`;

  const VS_MESH = `
    attribute vec3 aPos; attribute vec3 aNor; attribute vec2 aUV;
    uniform mat4 uProj, uView, uModel;
    varying vec3 vW; varying vec3 vN; varying vec2 vUV;
    void main() {
      vec4 w = uModel * vec4(aPos, 1.0);
      vW = w.xyz; vN = normalize(mat3(uModel) * aNor); vUV = aUV;
      gl_Position = uProj * uView * w;
    }`;
  const FS_MESH = `
    precision mediump float;
    uniform sampler2D uTex;
    uniform int uMode;            // 0 칩(텍스처), 1 단색(소켓), 2 칩의 몸속 부분 빛
    uniform vec3 uColor, uEmit, uCam, uLight, uClipP, uClipN;
    uniform float uClip, uTime;
    varying vec3 vW; varying vec3 vN; varying vec2 vUV;
    void main() {
      float inside = dot(vW - uClipP, uClipN);
      vec3 N = normalize(vN), Vd = normalize(uCam - vW), L = normalize(uLight);
      if (uMode == 2) {
        if (uClip < 0.5 || inside >= 0.0) discard;
        vec4 t = texture2D(uTex, vUV);
        if (t.a < 0.5) discard;
        float glow = 0.35 + 0.25 * sin(uTime * 6.0 + vW.y * 40.0);
        gl_FragColor = vec4(vec3(0.07, 0.97, 0.44) * glow, 0.0);
        return;
      }
      if (uClip > 0.5 && inside < 0.0) discard;
      vec3 base = uColor; float alpha = 1.0;
      if (uMode == 0) {
        vec4 t = texture2D(uTex, vUV);
        if (t.a < 0.5) discard;
        base = t.rgb;
        if (abs(N.z) < 0.5) base *= 0.42;           // 옆면은 어둡게
      }
      float diff = 0.5 + 0.5 * max(dot(N, L), 0.0);
      vec3 H = normalize(L + Vd);
      float spec = pow(max(dot(N, H), 0.0), 48.0) * 0.55;
      float fres = pow(1.0 - max(dot(N, Vd), 0.0), 3.0) * 0.25;
      vec3 col = base * diff + spec + fres * vec3(1.0, 0.4, 0.5) + uEmit;
      gl_FragColor = vec4(col, alpha);
    }`;

  const VS_QUAD = `attribute vec2 aPos; varying vec2 vUV; void main(){ vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
  const FS_BRIGHT = `
    precision mediump float; uniform sampler2D uTex; varying vec2 vUV;
    void main(){ vec3 c = texture2D(uTex, vUV).rgb; float l = max(c.r, max(c.g, c.b));
      float k = smoothstep(0.35, 0.9, l); gl_FragColor = vec4(c * k, 1.0); }`;
  const FS_BLUR = `
    precision mediump float; uniform sampler2D uTex; uniform vec2 uDir; varying vec2 vUV;
    void main(){
      vec3 c = texture2D(uTex, vUV).rgb * 0.227;
      c += texture2D(uTex, vUV + uDir * 1.385).rgb * 0.316; c += texture2D(uTex, vUV - uDir * 1.385).rgb * 0.316;
      c += texture2D(uTex, vUV + uDir * 3.231).rgb * 0.070; c += texture2D(uTex, vUV - uDir * 3.231).rgb * 0.070;
      gl_FragColor = vec4(c, 1.0); }`;
  const FS_COMP = `
    precision mediump float;
    uniform sampler2D uScene, uBloom; uniform float uTime; uniform vec2 uRes; uniform float uStrength;
    varying vec2 vUV;
    float hash(float n){ return fract(sin(n) * 43758.5453); }
    void main(){
      vec2 d = (vUV - 0.5);
      float r2 = dot(d, d);
      vec2 off = d * 0.004;
      vec4 s = texture2D(uScene, vUV);
      vec3 scene = vec3(texture2D(uScene, vUV + off).r, s.g, texture2D(uScene, vUV - off).b);
      // 배경: 거의 검정 + 아래쪽 붉은 기운 + 가는 세로 빛줄기
      vec3 bg = mix(vec3(0.012, 0.008, 0.016), vec3(0.09, 0.012, 0.03), smoothstep(0.2, 1.0, 1.0 - vUV.y) * 0.6);
      float col = floor(vUV.x * uRes.x / 3.0);
      float streak = step(0.992, hash(col)) * (0.5 + 0.5 * sin(uTime * 3.0 + col));
      bg += vec3(0.25, 0.85, 1.0) * streak * 0.05 * smoothstep(0.0, 0.6, vUV.y);
      vec3 c = bg * (1.0 - clamp(s.a, 0.0, 1.0)) + scene;
      c += texture2D(uBloom, vUV).rgb * uStrength;
      c *= 1.0 - r2 * 1.1;                                       // 비네팅
      c += (hash(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + uTime) - 0.5) * 0.035;   // 그레인
      gl_FragColor = vec4(c, 1.0);
    }`;

  /* ---------------- 메쉬 ---------------- */
  function boxGeo(sx, sy, sz, uv = true) {
    const x = sx / 2, y = sy / 2, z = sz / 2;
    const P = [], N = [], T = [];
    const face = (n, corners, uvs) => {
      [0, 1, 2, 0, 2, 3].forEach((i) => { P.push(...corners[i]); N.push(...n); T.push(...uvs[i]); });
    };
    const u = (px) => (px + x) / sx, v = (py) => 1 - (py + y) / sy;
    face([0, 0, 1], [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]], [[u(-x), v(-y)], [u(x), v(-y)], [u(x), v(y)], [u(-x), v(y)]]);
    face([0, 0, -1], [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]], [[u(x), v(-y)], [u(-x), v(-y)], [u(-x), v(y)], [u(x), v(y)]]);
    const mid = 0.5;
    face([0, 1, 0], [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]], [[u(-x), mid], [u(x), mid], [u(x), mid], [u(-x), mid]]);
    face([0, -1, 0], [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]], [[u(-x), mid], [u(x), mid], [u(x), mid], [u(-x), mid]]);
    face([1, 0, 0], [[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]], [[0.99, mid], [0.99, mid], [0.99, mid], [0.99, mid]]);
    face([-1, 0, 0], [[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]], [[0.5, mid], [0.5, mid], [0.5, mid], [0.5, mid]]);
    return { P, N, T };
  }
  function meshFrom(parts) {
    const P = [], N = [], T = [];
    parts.forEach(({ geo, at = [0, 0, 0] }) => {
      for (let i = 0; i < geo.P.length; i += 3) P.push(geo.P[i] + at[0], geo.P[i + 1] + at[1], geo.P[i + 2] + at[2]);
      N.push(...geo.N); T.push(...geo.T);
    });
    return { pos: buffer(new Float32Array(P)), nor: buffer(new Float32Array(N)), uv: buffer(new Float32Array(T)), count: P.length / 3 };
  }

  /* ---------------- 장면 상태 ---------------- */
  const CHIP = { L: 0.62, H: 0.62 * 0.24, T: 0.03 };
  let chip = { p: [1.3, 0.08, 0.15], ry: 0 };
  let state = 'idle';           // idle → drag → insert → locked
  let drag = null, near = false, lockAt = -1, t0 = 0, mouse = { x: 0, y: 0 };
  let cam = { eye: [0, 0, 4], target: [0, 0, 0] }, proj, view, vp, ivp;
  const BODY_YAW = -0.3;
  let portW = null, portNW = null;

  function layoutCamera() {
    const asp = W / H;
    const dist = Math.max(4.1, 2.25 / (2 * Math.tan(0.26) * asp));
    const tx = asp >= 1 ? 0.48 : 0.42;
    cam.base = { eye: [tx + 0.05, 0.16, dist], target: [tx, 0.1, 0] };
  }

  function updateCamera(t) {
    const m = reduceMotion ? 0 : 1;
    const sway = Math.sin(t * 0.25) * 0.08 * m;
    cam.eye = [cam.base.eye[0] + (mouse.x * 0.35 + sway) * m, cam.base.eye[1] - mouse.y * 0.18 * m, cam.base.eye[2]];
    cam.target = cam.base.target;
    proj = M.persp(0.52, W / H, 0.1, 50);
    view = M.lookAt(cam.eye, cam.target, [0, 1, 0]);
    vp = M.mul(proj, view);
    ivp = M.invert(vp);
  }

  function toScreen(p) {
    const c = M.apply(vp, p);
    return { x: (c[0] * 0.5 + 0.5) * (W / dpr), y: (1 - (c[1] * 0.5 + 0.5)) * (H / dpr), z: c[2] };
  }
  // 화면 좌표 → z=planeZ 평면 위의 월드 좌표
  function toWorldOnPlane(sx, sy, planeZ) {
    const nx = (sx / (W / dpr)) * 2 - 1, ny = 1 - (sy / (H / dpr)) * 2;
    const a = M.apply(ivp, [nx, ny, -1]), b = M.apply(ivp, [nx, ny, 1]);
    const dir = V.sub(b, a);
    const k = (planeZ - a[2]) / (dir[2] || 1e-6);
    return V.add(a, V.mul(dir, k));
  }

  function chipModel() { return M.trs(chip.p, chip.ry); }
  function chipTip() { return M.apply(chipModel(), [-CHIP.L / 2, 0, 0]); }
  function chipScreenRect() {
    const m = chipModel();
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => toScreen(M.apply(m, [sx * CHIP.L / 2, sy * CHIP.H / 2, CHIP.T / 2])));
    return { x0: Math.min(...pts.map((p) => p.x)) - 10, x1: Math.max(...pts.map((p) => p.x)) + 10, y0: Math.min(...pts.map((p) => p.y)) - 14, y1: Math.max(...pts.map((p) => p.y)) + 14 };
  }

  /* ---------------- 입력 ---------------- */
  function onDown(e) {
    if (!running) return;
    if (state !== 'idle') return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const b = chipScreenRect();
    if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const w = toWorldOnPlane(x, y, chip.p[2]);
    drag = { id: e.pointerId, off: V.sub(chip.p, w) };
    state = 'drag';
    canvas.style.cursor = 'grabbing';
    if (opts.onGrab) opts.onGrab();
  }
  function onMove(e) {
    if (!running) return;
    const r = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouse.y = ((e.clientY - r.top) / r.height) * 2 - 1;
    if (state === 'drag' && drag && e.pointerId === drag.id) {
      const w = toWorldOnPlane(e.clientX - r.left, e.clientY - r.top, chip.p[2]);
      chip.p = V.add(w, drag.off);
      const n = tipNear();
      if (n !== near) { near = n; if (opts.onNear) opts.onNear(near); }
    } else if (state === 'idle') {
      const b = chipScreenRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      canvas.style.cursor = x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 ? 'grab' : 'default';
    }
  }
  function onUp(e) {
    if (state !== 'drag' || !drag || e.pointerId !== drag.id) return;
    drag = null;
    canvas.style.cursor = 'default';
    if (near) insert();
    else state = 'idle';
    near = false;
    if (opts.onNear) opts.onNear(false);
  }
  function tipNear() {
    const a = toScreen(chipTip()), b = toScreen(portW);
    return Math.hypot(a.x - b.x, a.y - b.y) < Math.max(70, (W / dpr) * 0.07);
  }

  /* ---------------- 삽입 ---------------- */
  let anim = null;
  function insert() {
    if (state === 'insert' || state === 'locked') return;
    state = 'insert';
    if (opts.onInsertStart) opts.onInsertStart();
    const ry = -BODY_YAW;                         // 칩 축을 소켓 방향(+x에서 yaw만큼)에 맞춤
    const axis = [Math.cos(ry), 0, -Math.sin(ry)];
    const aligned = V.add(portW, V.mul(axis, CHIP.L / 2 + 0.012));
    const inside = V.add(portW, V.mul(axis, CHIP.L / 2 - CHIP.L * 0.17));
    const from = { p: chip.p.slice(), ry: chip.ry };
    const tl = [
      { to: { p: aligned, ry }, ms: 380, ease: (k) => 1 - Math.pow(1 - k, 3) },
      { to: { p: inside, ry }, ms: 300, ease: (k) => k * k, sfx: true },
    ];
    let i = 0, start = performance.now(), cur = from;
    anim = (now) => {
      const seg = tl[i];
      if (seg.sfx && !seg.played) { seg.played = true; if (opts.onSlide) opts.onSlide(); }
      const k = Math.min(1, (now - start) / seg.ms), e = seg.ease(k);
      chip.p = V.add(cur.p, V.mul(V.sub(seg.to.p, cur.p), e));
      chip.ry = cur.ry + (seg.to.ry - cur.ry) * e;
      if (k >= 1) {
        cur = { p: seg.to.p.slice(), ry: seg.to.ry };
        i++; start = now;
        if (i >= tl.length) {
          anim = null; state = 'locked'; lockAt = now;
          if (opts.onLocked) opts.onLocked(toScreen(portW));
        }
      }
    };
  }

  /* ---------------- 그리기 ---------------- */
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.floor(canvas.clientWidth * dpr) || Math.floor(window.innerWidth * dpr);
    H = Math.floor(canvas.clientHeight * dpr) || Math.floor(window.innerHeight * dpr);
    canvas.width = W; canvas.height = H;
    [rtScene, rtA, rtB].forEach(freeTarget);
    rtScene = target(W, H, true);
    rtA = target(Math.max(1, W >> 2), Math.max(1, H >> 2), false);
    rtB = target(Math.max(1, W >> 2), Math.max(1, H >> 2), false);
    layoutCamera();
  }

  function drawQuad(prog) {
    attr(prog, 'aPos', quad, 2);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    disableAttrs(prog);
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const t = (now - t0) / 1000;
    if (anim) anim(now);
    // 대기 중 칩은 위아래로 아주 살짝 떠 있음 (정면 유지)
    const bob = state === 'idle' && !reduceMotion ? Math.sin(t * 2.2) * 0.012 : 0;
    updateCamera(t);

    const body = M.rotY(BODY_YAW);
    const scan = 1.05 - ((t * 0.32) % 2.2);
    const lockT = lockAt >= 0 ? (now - lockAt) / 1000 : -1;

    // ---- 장면 → rtScene
    gl.bindFramebuffer(gl.FRAMEBUFFER, rtScene.fb);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    gl.useProgram(progMesh);
    gl.uniformMatrix4fv(progMesh.u.uProj, false, proj);
    gl.uniformMatrix4fv(progMesh.u.uView, false, view);
    gl.uniform3fv(progMesh.u.uCam, cam.eye);
    gl.uniform3fv(progMesh.u.uLight, [0.4 + mouse.x * 0.6, 0.8, 0.9]);
    gl.uniform3fv(progMesh.u.uClipP, portW);
    gl.uniform3fv(progMesh.u.uClipN, portNW);
    gl.uniform1f(progMesh.u.uTime, t);

    // 소켓
    const socketEmit = state === 'locked' ? [0.05, 0.9, 0.4] : near ? [0.95, 0.85, 0.05] : V.mul([0.3, 0.9, 1.0], 0.55 + 0.35 * Math.sin(t * 4));
    gl.uniformMatrix4fv(progMesh.u.uModel, false, body);
    gl.uniform1i(progMesh.u.uMode, 1);
    gl.uniform1f(progMesh.u.uClip, 0);
    gl.uniform3fv(progMesh.u.uColor, [0.12, 0.13, 0.16]);
    gl.uniform3fv(progMesh.u.uEmit, socketEmit);
    drawMesh(progMesh, socketMesh.frame);
    gl.uniform3fv(progMesh.u.uColor, [0.0, 0.0, 0.0]);
    gl.uniform3fv(progMesh.u.uEmit, [0, 0, 0]);
    drawMesh(progMesh, socketMesh.hole);

    // 칩 (몸 안으로 들어간 부분은 잘라냄)
    const cm = M.trs([chip.p[0], chip.p[1] + bob, chip.p[2]], chip.ry);
    gl.uniformMatrix4fv(progMesh.u.uModel, false, cm);
    gl.uniform1i(progMesh.u.uMode, 0);
    gl.uniform1f(progMesh.u.uClip, state === 'insert' || state === 'locked' ? 1 : 0);
    gl.uniform3fv(progMesh.u.uEmit, [0, 0, 0]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, chipTex);
    gl.uniform1i(progMesh.u.uTex, 0);
    drawMesh(progMesh, chipMesh);

    // 숫자 사람 (가산 혼합, 깊이 테스트만)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    gl.useProgram(progPts);
    gl.uniformMatrix4fv(progPts.u.uProj, false, proj);
    gl.uniformMatrix4fv(progPts.u.uView, false, view);
    gl.uniformMatrix4fv(progPts.u.uModel, false, body);
    gl.uniform1f(progPts.u.uTime, t);
    gl.uniform1f(progPts.u.uSize, 0.024 * H);
    gl.uniform1f(progPts.u.uScan, scan);
    gl.uniform1f(progPts.u.uLock, lockT);
    gl.uniform1f(progPts.u.uMotion, reduceMotion ? 0.2 : 1);
    gl.uniform3fv(progPts.u.uPort, cloud.port);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.uniform1i(progPts.u.uAtlas, 0);
    attr(progPts, 'aPos', bufPts.pos, 3);
    attr(progPts, 'aNor', bufPts.nor, 3);
    attr(progPts, 'aSeed', bufPts.seed, 2);
    gl.drawArrays(gl.POINTS, 0, cloud.count);
    disableAttrs(progPts);

    // 몸 안에 묻힌 칩이 피부 아래로 비침
    if (state === 'insert' || state === 'locked') {
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(progMesh);
      gl.uniformMatrix4fv(progMesh.u.uModel, false, cm);
      gl.uniform1i(progMesh.u.uMode, 2);
      gl.uniform1f(progMesh.u.uClip, 1);
      gl.bindTexture(gl.TEXTURE_2D, chipTex);
      drawMesh(progMesh, chipMesh);
      gl.enable(gl.DEPTH_TEST);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    // ---- 블룸
    gl.useProgram(progBright);
    gl.bindFramebuffer(gl.FRAMEBUFFER, rtA.fb);
    gl.viewport(0, 0, rtA.w, rtA.h);
    gl.bindTexture(gl.TEXTURE_2D, rtScene.t);
    gl.uniform1i(progBright.u.uTex, 0);
    drawQuad(progBright);
    gl.useProgram(progBlur);
    gl.uniform1i(progBlur.u.uTex, 0);
    for (let i = 0; i < 2; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, rtB.fb);
      gl.bindTexture(gl.TEXTURE_2D, rtA.t);
      gl.uniform2fv(progBlur.u.uDir, [(1.5 + i) / rtA.w, 0]);
      drawQuad(progBlur);
      gl.bindFramebuffer(gl.FRAMEBUFFER, rtA.fb);
      gl.bindTexture(gl.TEXTURE_2D, rtB.t);
      gl.uniform2fv(progBlur.u.uDir, [0, (1.5 + i) / rtA.h]);
      drawQuad(progBlur);
    }

    // ---- 합성 → 화면
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(progComp);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, rtScene.t); gl.uniform1i(progComp.u.uScene, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, rtA.t); gl.uniform1i(progComp.u.uBloom, 1);
    gl.uniform1f(progComp.u.uTime, t);
    gl.uniform2fv(progComp.u.uRes, [W, H]);
    gl.uniform1f(progComp.u.uStrength, 1.35 + (lockT >= 0 ? Math.max(0, 1 - lockT) * 1.2 : 0));
    drawQuad(progComp);
    gl.activeTexture(gl.TEXTURE0);

    if (opts.onFrame) opts.onFrame({ port: toScreen(portW), chip: chipScreenRect(), state });
  }

  function drawMesh(prog, m) {
    attr(prog, 'aPos', m.pos, 3);
    attr(prog, 'aNor', m.nor, 3);
    attr(prog, 'aUV', m.uv, 2);
    gl.drawArrays(gl.TRIANGLES, 0, m.count);
    disableAttrs(prog);
  }

  /* ---------------- 준비 ---------------- */
  function makeAtlas() {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.font = '700 54px "JetBrains Mono", Consolas, "Courier New", monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('0', 32, 34); g.fillText('1', 96, 34);
    return texFromCanvas(c);
  }

  function loadChipTexture() {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = 2048; c.height = Math.round(2048 * 0.24);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c);
      };
      img.onerror = () => {
        const c = document.createElement('canvas');
        c.width = 512; c.height = 123;
        const g = c.getContext('2d');
        g.fillStyle = '#d4122c'; g.fillRect(40, 10, 472, 103);
        g.fillStyle = '#e2b84a'; for (let i = 0; i < 5; i++) g.fillRect(0, 22 + i * 17, 60, 9);
        resolve(c);
      };
      img.src = 'assets/chip.svg';
    });
  }

  function buildSocket() {
    const P = V.sub(cloud.port, [0.0, 0, 0]);
    const sH = CHIP.H * 0.48, sZ = CHIP.T * 2.2, th = 0.014, out = 0.016;
    const at = (dx, dy, dz) => [P[0] + dx, P[1] + dy, P[2] + dz];
    const frame = meshFrom([
      { geo: boxGeo(out, th, sZ + th * 2, false), at: at(out / 2 - 0.004, sH / 2 + th / 2, 0) },
      { geo: boxGeo(out, th, sZ + th * 2, false), at: at(out / 2 - 0.004, -sH / 2 - th / 2, 0) },
      { geo: boxGeo(out, sH, th, false), at: at(out / 2 - 0.004, 0, sZ / 2 + th / 2) },
      { geo: boxGeo(out, sH, th, false), at: at(out / 2 - 0.004, 0, -sZ / 2 - th / 2) },
    ]);
    const hole = meshFrom([{ geo: boxGeo(0.05, sH, sZ, false), at: at(-0.022, 0, 0) }]);
    return { frame, hole };
  }

  function supported() {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
    } catch (e) { return false; }
  }

  function prepare() { buildCloud(); }

  let ready = null;
  async function start(cv, o = {}) {
    stop();
    canvas = cv;
    opts = o;
    gl = canvas.getContext('webgl', { antialias: true, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) return false;
    buildCloud();
    progPts = compile(VS_PTS, FS_PTS);
    progMesh = compile(VS_MESH, FS_MESH);
    progBright = compile(VS_QUAD, FS_BRIGHT);
    progBlur = compile(VS_QUAD, FS_BLUR);
    progComp = compile(VS_QUAD, FS_COMP);
    bufPts = { pos: buffer(cloud.pos), nor: buffer(cloud.nor), seed: buffer(cloud.seed) };
    quad = buffer(new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]));
    atlas = makeAtlas();
    chipMesh = meshFrom([{ geo: boxGeo(CHIP.L, CHIP.H, CHIP.T) }]);
    socketMesh = buildSocket();
    chipTex = texFromCanvas(await loadChipTexture());
    const body = M.rotY(BODY_YAW);
    portW = M.apply(body, cloud.port);
    portNW = V.norm(M.apply(body, cloud.portN).map((v, i) => v - [body[12], body[13], body[14]][i]));
    resize();
    updateCamera(0);
    // 칩 시작 위치: 포트와 같은 높이, 화면 오른쪽
    const portS = toScreen(portW);
    const startS = { x: Math.min(portS.x + Math.max(150, (W / dpr) * 0.2), (W / dpr) * 0.78), y: portS.y };
    const z = 0.18;
    chip = { p: toWorldOnPlane(startS.x, startS.y, z), ry: 0 };
    chip.p[0] += CHIP.L * 0.45;
    state = 'idle'; lockAt = -1; near = false; anim = null;
    running = true;
    t0 = performance.now();
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('resize', resize);
    raf = requestAnimationFrame(frame);
    return true;
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    if (canvas) {
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', resize);
    }
    if (gl) {
      [rtScene, rtA, rtB].forEach(freeTarget);
      rtScene = rtA = rtB = null;
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
      gl = null;
    }
  }

  function portScreen() { return portW ? toScreen(portW) : null; }

  window.Stage3D = { supported, prepare, start, stop, insert, portScreen };
})();
