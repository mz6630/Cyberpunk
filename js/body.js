/* =========================================================
   NIGHT CITY : JACK IN — BINARY BODY (정면 ASCII 렌더러)
   실제 사람 비율의 정면 흉상을 ASCII 아트로 그린다.
   - 형태: MakeHuman 기본 메시(CC0)를 정면에서 렌더링해 만든 assets/body-map.png
       R,G = 법선 x,y · B = 오목한 그늘(AO) · A = 재질(40 피부, 120 금속, 160 케이블, 200 눈)
   - 매 프레임 조명을 계산해 밝기 → 글자 밀도( . : - = + 1 0 8 # @ )와 색
   - 사이버펑크: 관자놀이 금속 임플란트 · 뺨 회로선 · 목 옆 포트와 케이블
   - 지지직: 가로 찢김 + 색 분리, 블록 깨짐, 신호 끊김, 스캔라인, 0/1 데이터 스캔, 잡음 줄
   - 칩이 꽂히면 목 안에 묻힌 부분이 연두색으로 비치고 파동이 퍼짐

   사용: BinaryBody.start(canvas, { left, top, size, slotH, depth })
         BinaryBody.setNear(bool) / lock() / stop()
         BinaryBody.PORT (상자 0~1 기준 포트 위치), BinaryBody.NECK_W
   ========================================================= */
(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MAP_SRC = 'assets/body-map.png';
  const PORT = { x: 0.634, y: 0.7266 };       // 목 오른쪽 옆 (맵에서 계산한 값)
  const NECK_W = 0.2766;

  const RAMP = ['.', '.', ',', ':', ';', '-', '=', '+', '1', '1', '0', '0', '8', '#', '@'];
  const METAL = ['=', '#', '=', '[', ']', '#', '%'];
  const NOISE = ['0', '1', '#', '%', '&', '$', '@', '/', '\\', '<', '>', '*', '?'];
  const SHADES = ['#4a0816', '#93102b', '#d8193d', '#ff4a66', '#ffa0b2', '#ffe8ee', '#5ef6ff', '#12f870', '#bfe9ee'];
  const CYAN = 6, GREEN = 7, STEEL = 8;
  const GLYPHS = [...new Set([...RAMP, ...METAL, ...NOISE, 'o', '@', '0', '1', '|'])];

  let mapData = null, mapW = 0, mapH = 0;
  const mapReady = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = mapW = img.naturalWidth; c.height = mapH = img.naturalHeight;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      mapData = g.getImageData(0, 0, mapW, mapH).data;
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = MAP_SRC;
  });

  let cv = null, ctx = null, dpr = 1, raf = 0, running = false;
  let box = null, cells = [], rain = [], parts = [], atlas = null;
  let cw = 5, ch = 8, cols = 0, rows = 0;
  let lockedAt = 0, near = false, t0 = 0, lastFrame = 0;
  let blocks = [], dropUntil = 0, dropShift = 0, tearUntil = 0, tear = null;

  function buildAtlas() {
    atlas = [];
    const font = `700 ${ch * 1.08}px Consolas, Menlo, "DejaVu Sans Mono", "Courier New", monospace`;
    for (let s = 0; s < SHADES.length; s++) {
      atlas[s] = {};
      for (const c of GLYPHS) {
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

  // 맵의 한 칸을 평균해 셀 정보로 (작은 칸 여러 개를 모아 부드럽게)
  function sample(u, v, du, dv) {
    let nx = 0, ny = 0, ao = 0, n = 0;
    const mats = {};
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        const x = Math.min(mapW - 1, Math.max(0, Math.floor((u + (i - 1) * du / 3) * mapW)));
        const y = Math.min(mapH - 1, Math.max(0, Math.floor((v + (j - 1) * dv / 3) * mapH)));
        const k = (y * mapW + x) * 4;
        const a = mapData[k + 3];
        if (a < 20) continue;
        nx += mapData[k] / 127.5 - 1;
        ny += mapData[k + 1] / 127.5 - 1;
        ao += mapData[k + 2] / 255;
        const m = Math.round(a / 40);
        mats[m] = (mats[m] || 0) + 1;
        n++;
      }
    }
    if (n < 4) return null;
    nx /= n; ny /= n; ao /= n;
    let mat = 1, best = 0;
    for (const m in mats) if (mats[m] > best || (m >= 3 && mats[m] >= 2)) { best = mats[m]; mat = +m; }
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    return { nx, ny, nz, ao, mat };
  }

  function build() {
    const S = box.size;
    ch = Math.max(5, Math.min(10, S / 120));
    cw = ch * 0.6;
    cols = Math.ceil(S / cw);
    rows = Math.ceil(S / ch);
    cells = [];
    const grid = new Array(cols * rows).fill(null);
    for (let r = 0; r < rows; r++) {
      const v = ((r + 0.5) * ch) / S;
      for (let c = 0; c < cols; c++) {
        const u = ((c + 0.5) * cw) / S;
        const s = sample(u, v, cw / S, ch / S);
        if (!s) continue;
        const fade = v > 0.86 ? Math.max(0, 1 - (v - 0.86) / 0.14) : 1;     // 아래쪽은 흩어짐
        if (Math.random() > Math.max(0.04, fade)) continue;
        const cell = { c, r, u, v, ...s, fade, seed: Math.random(), metalCh: METAL[Math.floor(Math.random() * METAL.length)] };
        cells.push(cell);
        grid[r * cols + c] = cell;
      }
    }
    for (const p of cells) {
      const n = (dc, dr) => grid[(p.r + dr) * cols + (p.c + dc)];
      p.edge = !(n(1, 0) && n(-1, 0) && n(0, 1) && n(0, -1));
    }
    rain = [];
    const vw = cv.width / dpr;
    const n = Math.floor(vw / (cw * 10));
    for (let i = 0; i < n; i++) rain.push({ x: Math.random() * vw, y: Math.random() * (cv.height / dpr), v: 30 + Math.random() * 90, len: 6 + Math.floor(Math.random() * 14) });
    buildAtlas();
  }

  const pickNoise = () => NOISE[Math.floor(Math.random() * NOISE.length)];

  function frame(ts) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (ts - lastFrame < 33) return;
    const dt = Math.min(0.1, (ts - lastFrame) / 1000 || 0.033);
    lastFrame = ts;
    const t = (ts - t0) / 1000;
    const now = performance.now();
    const W = cv.width / dpr, H = cv.height / dpr;
    const S = box.size;
    let ox = box.left;
    const oy = box.top;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = 'rgb(3, 2, 6)';
    ctx.fillRect(0, 0, W, H);

    /* --- 지지직 --- */
    if (!reduceMotion) {
      if (now > dropUntil && Math.random() < 0.025) { dropUntil = now + 60 + Math.random() * 120; dropShift = (Math.random() - 0.5) * 30; }
      if (now > tearUntil && Math.random() < 0.09) {
        const r0 = Math.floor(Math.random() * rows);
        tear = { r0, r1: r0 + 1 + Math.floor(Math.random() * 6), shift: Math.round((Math.random() - 0.5) * 14) };
        tearUntil = now + 50 + Math.random() * 140;
      }
      if (now > tearUntil) tear = null;
      if (Math.random() < 0.12) blocks.push({ c: Math.floor(Math.random() * cols), r: Math.floor(Math.random() * rows), w: 3 + Math.floor(Math.random() * 14), h: 1 + Math.floor(Math.random() * 4), until: now + 80 + Math.random() * 220 });
      blocks = blocks.filter((b) => b.until > now);
    }
    const dropping = now < dropUntil;
    if (dropping) ox += dropShift;

    if (!reduceMotion) {
      for (const d of rain) {
        d.y += d.v * dt;
        if (d.y - d.len * ch > H) { d.y = -10; d.x = Math.random() * W; }
        for (let k = 0; k < d.len; k++) {
          const y = d.y - k * ch;
          if (y < -ch || y > H) continue;
          ctx.globalAlpha = (k === 0 ? 0.3 : 0.11) * (1 - k / d.len);
          ctx.drawImage(atlas[k === 0 ? 2 : 1][Math.random() < 0.5 ? '0' : '1'], d.x, y, cw * 1.3, ch * 1.2);
        }
      }
    }

    // 조명: 정면 위쪽 키 라이트(좌우로 천천히) + 오른쪽 뒤 테두리 빛
    const la = Math.sin(t * 0.3) * 0.35;
    let lx = -0.3 + la, ly = 0.45, lz = 0.84;
    const ll = Math.hypot(lx, ly, lz); lx /= ll; ly /= ll; lz /= ll;
    const rx = 0.9, ry = 0.2, rz = -0.3;
    const scanV = ((t * 0.22) % 1.3) - 0.15;
    const lockT = lockedAt ? (now - lockedAt) / 1000 : -1;
    const su = box.depth / S, sv = box.slotH / S;
    const inBlock = (p) => blocks.some((b) => p.c >= b.c && p.c < b.c + b.w && p.r >= b.r && p.r < b.r + b.h);

    for (const p of cells) {
      const diff = Math.max(0, p.nx * lx + p.ny * ly + p.nz * lz);
      const back = Math.pow(Math.max(0, p.nx * rx + p.ny * ry + p.nz * rz), 1.6);
      const rim = Math.pow(1 - p.nz, 3);
      const spec = Math.pow(Math.max(0, 2 * diff * p.nz - lz), p.mat === 3 ? 8 : 30);
      let v = p.ao * (0.1 + 0.85 * diff) + 0.3 * back + 0.15 * rim * p.ao + (p.mat === 3 ? 0.6 : 0.3) * spec;
      v = Math.pow(Math.min(1, v * 1.08), 1.05) * (0.94 + 0.06 * Math.sin(t * 7 + p.seed * 40)) * p.fade;
      if (p.edge) v = Math.max(v, 0.45);

      let shade = v < 0.15 ? 0 : v < 0.3 ? 1 : v < 0.5 ? 2 : v < 0.7 ? 3 : v < 0.87 ? 4 : 5;
      let glyph;
      if (p.mat === 3) {
        glyph = p.metalCh;
        shade = v > 0.55 ? 5 : STEEL;
        if (Math.random() < 0.05) shade = CYAN;
      } else if (p.mat === 4) {
        glyph = Math.random() < 0.85 ? '=' : '|';
        shade = v > 0.45 ? STEEL : 1;
      } else if (p.mat === 5) {
        glyph = v > 0.45 ? '@' : 'o';
        shade = Math.random() < 0.2 ? CYAN : 5;
      } else {
        glyph = RAMP[Math.min(RAMP.length - 1, Math.floor(v * RAMP.length))];
        if ((glyph === '1' || glyph === '0') && Math.random() < 0.08) glyph = Math.random() < 0.5 ? '0' : '1';
      }

      const sd = Math.abs(p.v - scanV);
      if (sd < 0.012) { glyph = Math.random() < 0.5 ? '0' : '1'; shade = Math.min(5, shade + 2); v = 1; }
      else if (sd < 0.03) shade = Math.min(5, shade + 1);
      if (p.mat === 1 && back > 0.7 && Math.random() < 0.05) shade = CYAN;
      if (inBlock(p)) { glyph = pickNoise(); shade = Math.random() < 0.3 ? CYAN : Math.random() < 0.5 ? 5 : 3; v = 1; }

      if (lockT >= 0) {
        const dist = Math.hypot(p.u - PORT.x, p.v - PORT.y);
        const wave = Math.max(0, 1 - Math.abs(dist - lockT * 0.75) / 0.05);
        if (wave > 0.3) { shade = wave > 0.75 ? 5 : 4; glyph = Math.random() < 0.5 ? '0' : '1'; }
        if (p.u > PORT.x - su && p.u < PORT.x + 0.004 && Math.abs(p.v - PORT.y) < sv * 0.62) {
          shade = GREEN; glyph = Math.random() < 0.5 ? '0' : '1'; v = 1;
        }
      }

      let x = ox + p.c * cw;
      const y = oy + p.r * ch;
      let a = Math.max(0.28, Math.min(1, 0.28 + v * 1.1));
      if (p.r % 2 === 1) a *= 0.86;
      if (dropping) a *= 0.55;
      if (tear && p.r >= tear.r0 && p.r < tear.r1) {
        ctx.globalAlpha = a * 0.6;
        ctx.drawImage(atlas[CYAN][glyph], x + (tear.shift - 2) * cw - cw * 0.15, y - ch * 0.1, cw * 1.3, ch * 1.2);
        x += tear.shift * cw;
      }
      ctx.globalAlpha = a;
      ctx.drawImage(atlas[shade][glyph], x - cw * 0.15, y - ch * 0.1, cw * 1.3, ch * 1.2);
    }
    ctx.globalAlpha = 1;

    if (!reduceMotion && Math.random() < 0.18) {
      const y = Math.random() * H;
      ctx.globalAlpha = 0.25;
      for (let x = 0; x < W; x += cw * (1 + Math.floor(Math.random() * 3))) {
        ctx.drawImage(atlas[Math.random() < 0.3 ? CYAN : 2][pickNoise()], x, y, cw * 1.3, ch * 1.2);
      }
      ctx.globalAlpha = 1;
    }

    if (!reduceMotion) {
      for (let i = 0; i < 4; i++) {
        parts.push({ x: ox + S * (0.1 + Math.random() * 0.8), y: oy + S * (0.92 + Math.random() * 0.08), vx: (Math.random() - 0.5) * 18, vy: -14 - Math.random() * 30, life: 1, s: 1.2 + Math.random() * 2.2 });
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
    running = true;
    const token = (start.token = (start.token || 0) + 1);
    mapReady.then((ok) => {
      if (!ok || !running || token !== start.token) return;
      build();
      parts = []; blocks = []; tear = null;
      lockedAt = 0; near = false;
      t0 = performance.now(); lastFrame = 0;
      raf = requestAnimationFrame(frame);
    });
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
