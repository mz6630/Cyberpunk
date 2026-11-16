/* =========================================================
   NIGHT CITY : JACK IN — BINARY BODY (ASCII 렌더러)
   3D로 계산한 오리지널 사람 흉상(3/4 옆모습)을 ASCII 아트로 그린다.
   - 브라우저에서 SDF 레이마칭으로 형태를 한 번 계산 (머리·얼굴·목·어깨)
     → 셀마다 법선·오목함(AO) 저장
   - 매 프레임 조명을 계산해 밝기 → 글자 밀도( . : - = + 1 0 8 # @ )와 색으로 변환
   - 스캔 띠가 지나가면 그 줄은 0/1 데이터로 뒤바뀜, 가로 글리치, 배경 ASCII 비,
     아래쪽은 시안 입자로 부서짐
   - 목 오른쪽 뒤에 포트. 칩이 꽂히면 묻힌 부분이 연두색으로 비치고 파동이 퍼짐

   사용: BinaryBody.start(canvas, { left, top, size, slotH, depth }) → { portX, portY }
         BinaryBody.setNear(bool) / lock() / stop()
         BinaryBody.PORT (상자 0~1 기준 포트 위치), BinaryBody.NECK_W
   ========================================================= */
(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 3D 형태 (거리 함수) ---------- */
  const YAW = (-48 * Math.PI) / 180;            // 얼굴이 왼쪽 앞을 보게 (3/4)
  const CY = Math.cos(YAW), SY = Math.sin(YAW);
  const SPAN = 2.2;                              // 상자 한 변 = 월드 2.2
  const TOPY = 0.68;                             // 상자 위쪽 월드 y

  const sph = (x, y, z, r) => Math.hypot(x, y, z) - r;
  function ell(x, y, z, a, b, c) {
    const k0 = Math.hypot(x / a, y / b, z / c);
    const k1 = Math.hypot(x / (a * a), y / (b * b), z / (c * c));
    return (k0 * (k0 - 1)) / (k1 || 1e-6);
  }
  function cap(x, y, z, ax, ay, az, bx, by, bz, r) {
    const px = x - ax, py = y - ay, pz = z - az, dx = bx - ax, dy = by - ay, dz = bz - az;
    const h = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / (dx * dx + dy * dy + dz * dz)));
    return Math.hypot(px - dx * h, py - dy * h, pz - dz * h) - r;
  }
  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  const smax = (a, b, k) => -smin(-a, -b, k);

  // 머리 기준 좌표 (얼굴이 +z)
  function local(x, y, z) {
    const ax = Math.abs(x);
    let d = ell(x, y - 0.15, z + 0.05, 0.36, 0.42, 0.44);                     // 두개골
    d = smin(d, ell(x, y + 0.12, z - 0.08, 0.28, 0.33, 0.31), 0.12);          // 얼굴
    d = smin(d, sph(x, y + 0.385, z - 0.17, 0.105), 0.1);                    // 턱끝
    d = smin(d, sph(ax - 0.18, y + 0.25, z - 0.02, 0.1), 0.12);              // 턱선
    d = smin(d, sph(ax - 0.19, y + 0.04, z - 0.2, 0.1), 0.08);               // 광대
    d = smin(d, cap(x, y, z, -0.17, 0.08, 0.3, 0.17, 0.08, 0.3, 0.055), 0.06); // 눈썹뼈
    d = smax(d, -sph(ax - 0.125, y - 0.005, z - 0.36, 0.075), 0.04);         // 눈두덩
    d = Math.min(d, sph(ax - 0.125, y, z - 0.29, 0.06));                     // 눈
    d = smin(d, cap(x, y, z, 0, 0.04, 0.35, 0, -0.13, 0.43, 0.04), 0.05);    // 콧대
    d = smin(d, sph(x, y + 0.145, z - 0.425, 0.05), 0.03);                   // 코끝
    d = smin(d, sph(ax - 0.045, y + 0.16, z - 0.39, 0.035), 0.03);           // 콧방울
    d = smin(d, ell(x, y + 0.235, z - 0.355, 0.085, 0.028, 0.04), 0.03);     // 윗입술
    d = smin(d, ell(x, y + 0.285, z - 0.345, 0.075, 0.03, 0.04), 0.03);      // 아랫입술
    d = smax(d, -ell(x, y + 0.258, z - 0.4, 0.08, 0.006, 0.05), 0.01);       // 입술 사이
    d = smin(d, ell(ax - 0.36, y, z + 0.02, 0.045, 0.11, 0.075), 0.04);      // 귀
    d = smin(d, cap(x, y, z, 0, -0.3, -0.06, 0, -1.0, -0.04, 0.165), 0.12);  // 목
    d = smin(d, cap(x, y, z, -0.78, -1.12, -0.08, 0.78, -1.12, -0.08, 0.2), 0.3); // 어깨
    d = smin(d, ell(x, y + 1.45, z, 0.8, 0.45, 0.32), 0.2);                  // 가슴
    return d;
  }
  const map = (x, y, z) => local(x * CY - z * SY, y, x * SY + z * CY);
  const toWorld = (x, y, z) => [x * CY + z * SY, y, -x * SY + z * CY];

  // 포트: 목 오른쪽 뒤 표면
  const PORT_W = toWorld(0.132, -0.62, -0.149);
  const PORT = { x: 0.5 + PORT_W[0] / SPAN, y: (TOPY - PORT_W[1]) / SPAN };
  const NECK_W = 0.34 / SPAN;

  /* ---------- 글자·색 ---------- */
  const RAMP = ['.', '.', ',', ':', ';', '-', '=', '+', '1', '1', '0', '0', '8', '#', '@'];
  const SHADES = ['#5a0a1a', '#a3102e', '#e01a3f', '#ff4d6a', '#ffa3b5', '#ffe6ec', '#5ef6ff', '#12f870'];
  const CYAN = 6, GREEN = 7;

  let cv = null, ctx = null, dpr = 1, raf = 0, running = false;
  let box = null, cells = [], rain = [], parts = [], atlas = null;
  let cw = 5, ch = 8, cols = 0, rows = 0;
  let lockedAt = 0, near = false, t0 = 0, lastFrame = 0;

  function buildAtlas() {
    atlas = [];
    const font = `700 ${ch * 1.08}px Consolas, Menlo, "DejaVu Sans Mono", "Courier New", monospace`;
    for (let s = 0; s < SHADES.length; s++) {
      atlas[s] = {};
      for (const c of new Set([...RAMP, '0', '1'])) {
        const can = document.createElement('canvas');
        can.width = Math.ceil(cw * dpr * 1.3);
        can.height = Math.ceil(ch * dpr * 1.2);
        const g = can.getContext('2d');
        g.scale(dpr, dpr);
        g.font = font;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = SHADES[s];
        g.fillText(c, (cw * 1.3) / 2, (ch * 1.2) / 2);
        atlas[s][c] = can;
      }
    }
  }

  // 형태를 한 번 계산: 셀마다 레이마칭 → 법선 · AO
  function build() {
    const S = box.size;
    ch = Math.max(5, Math.min(10, S / 112));
    cw = ch * 0.6;
    cols = Math.ceil(S / cw);
    rows = Math.ceil(S / ch);
    cells = [];
    const e = 0.004;
    for (let r = 0; r < rows; r++) {
      const wy = TOPY - (((r + 0.5) * ch) / S) * SPAN;
      for (let c = 0; c < cols; c++) {
        const wx = (((c + 0.5) * cw) / S - 0.5) * SPAN;
        let z = 1.2, hit = false;
        for (let i = 0; i < 64; i++) {
          const d = map(wx, wy, z);
          if (d < 0.003) { hit = true; break; }
          z -= Math.max(d, 0.004);
          if (z < -1.2) break;
        }
        if (!hit) continue;
        let nx = map(wx + e, wy, z) - map(wx - e, wy, z);
        let ny = map(wx, wy + e, z) - map(wx, wy - e, z);
        let nz = map(wx, wy, z + e) - map(wx, wy, z - e);
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        let ao = 0;
        for (let k = 1; k <= 4; k++) {
          const h = 0.035 * k;
          ao += (h - map(wx + nx * h, wy + ny * h, z + nz * h)) / Math.pow(2, k);
        }
        ao = Math.max(0, Math.min(1, 1 - ao * 3.2));
        const fade = wy < -1.12 ? Math.max(0, 1 - (-1.12 - wy) / 0.42) : 1;
        if (Math.random() > Math.max(0.05, fade)) continue;
        cells.push({ c, r, wx, wy, nx, ny, nz, ao, fade, seed: Math.random() });
      }
    }
    rain = [];
    const vw = cv.width / dpr;
    const n = Math.floor(vw / (cw * 9));
    for (let i = 0; i < n; i++) rain.push({ x: Math.random() * vw, y: Math.random() * (cv.height / dpr), v: 30 + Math.random() * 90, len: 6 + Math.floor(Math.random() * 14) });
    buildAtlas();
  }

  function frame(ts) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (ts - lastFrame < 33) return;
    const dt = Math.min(0.1, (ts - lastFrame) / 1000 || 0.033);
    lastFrame = ts;
    const t = (ts - t0) / 1000;
    const W = cv.width / dpr, H = cv.height / dpr;
    const S = box.size, ox = box.left, oy = box.top;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = 'rgb(3, 2, 6)';
    ctx.fillRect(0, 0, W, H);

    // 배경 ASCII 비
    if (!reduceMotion) {
      for (const d of rain) {
        d.y += d.v * dt;
        if (d.y - d.len * ch > H) { d.y = -10; d.x = Math.random() * W; }
        for (let k = 0; k < d.len; k++) {
          const y = d.y - k * ch;
          if (y < -ch || y > H) continue;
          ctx.globalAlpha = (k === 0 ? 0.35 : 0.14) * (1 - k / d.len);
          ctx.drawImage(atlas[k === 0 ? 2 : 1][Math.random() < 0.5 ? '0' : '1'], d.x, y, cw * 1.3, ch * 1.2);
        }
      }
    }

    // 조명: 얼굴 쪽(왼쪽 위 앞) 키 라이트가 천천히 흔들림 + 오른쪽 뒤 테두리 빛
    const la = Math.sin(t * 0.35) * 0.25;
    let lx = -0.55 + la, ly = 0.5, lz = 0.67;
    const ll = Math.hypot(lx, ly, lz); lx /= ll; ly /= ll; lz /= ll;
    const rx = 0.88, ry = 0.25, rz = -0.4;
    const scanY = TOPY - ((t * 0.32) % 1.5) * (SPAN / 1.4);
    const lockT = lockedAt ? (performance.now() - lockedAt) / 1000 : -1;
    const gRow = !reduceMotion && Math.random() < 0.12 ? Math.floor(Math.random() * rows) : -99;
    const gShift = Math.round((Math.random() - 0.5) * 8);
    const sx0 = (box.depth / S) * SPAN, sh0 = (box.slotH / S) * SPAN;

    for (const p of cells) {
      const diff = Math.max(0, p.nx * lx + p.ny * ly + p.nz * lz);
      const back = Math.pow(Math.max(0, p.nx * rx + p.ny * ry + p.nz * rz), 1.4);
      const rim = Math.pow(1 - Math.max(0, p.nz), 3);
      const spec = Math.pow(Math.max(0, 2 * diff * p.nz - lz), 24);
      let v = p.ao * (0.06 + 0.72 * diff) + 0.5 * back + 0.22 * rim * p.ao + 0.4 * spec;
      v = Math.pow(Math.min(1, v), 1.15) * (0.93 + 0.07 * Math.sin(t * 7 + p.seed * 40)) * p.fade;

      let shade = v < 0.16 ? 0 : v < 0.32 ? 1 : v < 0.52 ? 2 : v < 0.72 ? 3 : v < 0.88 ? 4 : 5;
      let glyph = RAMP[Math.min(RAMP.length - 1, Math.floor(v * RAMP.length))];
      if ((glyph === '1' || glyph === '0') && Math.random() < 0.08) glyph = Math.random() < 0.5 ? '0' : '1';
      const sd = Math.abs(p.wy - scanY);
      if (sd < 0.03) { glyph = Math.random() < 0.5 ? '0' : '1'; shade = Math.min(5, shade + 2); v = 1; }
      else if (sd < 0.07) shade = Math.min(5, shade + 1);
      if (back > 0.75 && Math.random() < 0.06) shade = CYAN;

      if (lockT >= 0) {
        const dist = Math.hypot(p.wx - PORT_W[0], p.wy - PORT_W[1]);
        const wave = Math.max(0, 1 - Math.abs(dist - lockT * 1.6) / 0.12);
        if (wave > 0.3) { shade = wave > 0.75 ? 5 : 4; glyph = Math.random() < 0.5 ? '0' : '1'; }
        if (p.wx > PORT_W[0] - sx0 && p.wx < PORT_W[0] + 0.01 && Math.abs(p.wy - PORT_W[1]) < sh0 * 0.62) {
          shade = GREEN; glyph = Math.random() < 0.5 ? '0' : '1'; v = 1;
        }
      }

      let x = ox + p.c * cw;
      const y = oy + p.r * ch;
      if (Math.abs(p.r - gRow) < 2) x += gShift * cw;
      ctx.globalAlpha = Math.max(0.3, Math.min(1, 0.3 + v * 1.1));
      ctx.drawImage(atlas[shade][glyph], x - cw * 0.15, y - ch * 0.1, cw * 1.3, ch * 1.2);
    }
    ctx.globalAlpha = 1;

    if (!reduceMotion) {
      for (let i = 0; i < 4; i++) {
        parts.push({ x: ox + S * (0.25 + Math.random() * 0.55), y: oy + S * (0.92 + Math.random() * 0.08), vx: (Math.random() - 0.35) * 18, vy: -14 - Math.random() * 30, life: 1, s: 1.2 + Math.random() * 2.2 });
      }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i];
      q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt * 0.5;
      if (q.life <= 0) { parts.splice(i, 1); continue; }
      ctx.globalAlpha = q.life * 0.75;
      ctx.fillStyle = SHADES[CYAN];
      ctx.fillRect(q.x, q.y, q.s, q.s);
    }
    ctx.globalAlpha = 1;

    // 목 포트 소켓
    const sx = ox + PORT.x * S, sy = oy + PORT.y * S;
    const slotH = box.slotH;
    const pulse = 0.6 + 0.4 * Math.sin(t * 4);
    if (lockT >= 0) {
      ctx.strokeStyle = SHADES[GREEN];
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sx, sy - slotH / 2 - 3); ctx.lineTo(sx, sy + slotH / 2 + 3); ctx.stroke();
    } else {
      const lip = Math.max(6, slotH * 0.22);
      ctx.fillStyle = '#000';
      ctx.fillRect(sx - lip, sy - slotH / 2, lip, slotH);
      ctx.strokeStyle = near ? '#fcee0a' : `rgba(94, 246, 255, ${pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - lip, sy - slotH / 2); ctx.lineTo(sx, sy - slotH / 2); ctx.lineTo(sx, sy - slotH / 2 - 4);
      ctx.moveTo(sx - lip, sy + slotH / 2); ctx.lineTo(sx, sy + slotH / 2); ctx.lineTo(sx, sy + slotH / 2 + 4);
      ctx.stroke();
      ctx.fillStyle = near ? 'rgba(252, 238, 10, 0.2)' : `rgba(94, 246, 255, ${0.1 * pulse})`;
      ctx.beginPath(); ctx.arc(sx, sy, slotH * 1.3, 0, Math.PI * 2); ctx.fill();
    }
  }

  function start(canvas, opts) {
    stop();
    cv = canvas;
    ctx = cv.getContext('2d');
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.floor(window.innerWidth * dpr);
    cv.height = Math.floor(window.innerHeight * dpr);
    box = { left: opts.left, top: opts.top, size: opts.size, slotH: opts.slotH, depth: opts.depth };
    build();
    parts = [];
    lockedAt = 0;
    near = false;
    running = true;
    t0 = performance.now();
    lastFrame = 0;
    raf = requestAnimationFrame(frame);
    return { portX: box.left + PORT.x * box.size, portY: box.top + PORT.y * box.size };
  }

  function lock() { lockedAt = performance.now(); near = false; }
  function setNear(v) { near = !!v; }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    if (ctx && cv) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); }
  }

  window.BinaryBody = { start, lock, stop, setNear, PORT, NECK_W };
})();
