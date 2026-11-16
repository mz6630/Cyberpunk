/* =========================================================
   NIGHT CITY : JACK IN — BINARY BODY
   0과 1로만 이루어진 사람 흉상(옆모습, 왼쪽을 봄). 목 뒤에 칩 포트가 있다.
   - 윤곽 안을 격자로 채운 숫자(0/1)가 계속 바뀌고, 가장자리가 밝게 빛남(림 라이트)
   - 아래로 갈수록 흩어지며 시안 입자로 부서짐, 세로 빛줄기·가로 글리치
   - 칩이 꽂히면 포트에서 밝아지는 파동이 몸 전체로 퍼짐

   사용: BinaryBody.start(canvas, { left, top, size }) → { portX, portY, neckW }
         BinaryBody.lock()  칩 고정 (파동 시작)
         BinaryBody.stop()
   ========================================================= */
(() => {
  // 옆모습 윤곽 (정사각형 상자 0~1 기준, 왼쪽이 얼굴)
  const OUTLINE = [
    [0.52, 0.03], [0.42, 0.045], [0.345, 0.09], [0.305, 0.15], [0.292, 0.205], [0.296, 0.235],
    [0.282, 0.262], [0.262, 0.305], [0.243, 0.338], [0.262, 0.352], [0.27, 0.364],
    [0.262, 0.378], [0.27, 0.392], [0.264, 0.408], [0.276, 0.425], [0.272, 0.448],
    [0.296, 0.478], [0.35, 0.49], [0.39, 0.5], [0.395, 0.56], [0.388, 0.625],
    [0.33, 0.68], [0.2, 0.735], [0.11, 0.8], [0.07, 0.9], [0.06, 1.0],
    [0.94, 1.0], [0.93, 0.9], [0.88, 0.8], [0.8, 0.73], [0.69, 0.68],
    [0.615, 0.62], [0.6, 0.55], [0.615, 0.47], [0.665, 0.415], [0.7, 0.33],
    [0.705, 0.235], [0.675, 0.14], [0.615, 0.07],
  ];
  const PORT = { x: 0.603, y: 0.545 };     // 목 뒤 포트 (상자 기준)
  const NECK_W = 0.2;

  const COL = { red: '#ff2b4d', hot: '#ffc2cd', deep: '#c8183a', cyan: '#5ef6ff', green: '#12f870' };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let cv = null, ctx = null, dpr = 1, raf = 0, running = false;
  let box = null, pts = [], parts = [], sprites = null, step = 8;
  let lockedAt = 0, lastFrame = 0, t0 = 0, near = false;

  function catmull(points, seg = 6) {
    const out = [];
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
      for (let k = 0; k < seg; k++) {
        const t = k / seg, t2 = t * t, t3 = t2 * t;
        out.push([
          0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
        ]);
      }
    }
    return out;
  }

  // 숫자 스프라이트 (색 4단계 × 0/1)
  function makeSprites(size) {
    const shades = [COL.deep, COL.red, COL.hot, COL.cyan, COL.green];
    const s = {};
    shades.forEach((c, i) => {
      ['0', '1'].forEach((d) => {
        const can = document.createElement('canvas');
        can.width = can.height = Math.ceil(size * dpr);
        const g = can.getContext('2d');
        g.scale(dpr, dpr);
        g.font = `700 ${size * 0.95}px "JetBrains Mono", Consolas, "Courier New", monospace`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = c;
        g.fillText(d, size / 2, size / 2 + size * 0.04);
        s[`${i}${d}`] = can;
      });
    });
    return s;
  }

  function build() {
    const S = box.size;
    step = Math.max(6, Math.round(S / 78));
    // 윤곽 마스크
    const m = document.createElement('canvas');
    m.width = m.height = Math.ceil(S);
    const g = m.getContext('2d');
    const curve = catmull(OUTLINE);
    g.beginPath();
    curve.forEach(([x, y], i) => (i ? g.lineTo(x * S, y * S) : g.moveTo(x * S, y * S)));
    g.closePath();
    g.fill();
    const data = g.getImageData(0, 0, m.width, m.height).data;
    const inside = (x, y) => x >= 0 && y >= 0 && x < m.width && y < m.height && data[(Math.floor(y) * m.width + Math.floor(x)) * 4 + 3] > 128;

    pts = [];
    for (let y = step / 2; y < S; y += step) {
      for (let x = step / 2; x < S; x += step) {
        if (!inside(x, y)) continue;
        // 가장자리까지 거리 (8방향, 칸 단위)
        let d = 8;
        for (let r = 1; r <= 7 && d === 8; r++) {
          for (let a = 0; a < 8; a++) {
            const ang = (a / 8) * Math.PI * 2;
            if (!inside(x + Math.cos(ang) * r * step, y + Math.sin(ang) * r * step)) { d = r; break; }
          }
        }
        const ny = y / S;
        // 아래쪽은 점점 흩어짐
        const fade = ny > 0.78 ? 1 - (ny - 0.78) / 0.24 : 1;
        if (Math.random() > Math.max(0.12, fade)) continue;
        // 밝기: 가장자리 림 라이트 + 위·뒤쪽에서 오는 빛 + 흔들림
        const rim = d <= 1 ? 1 : d === 2 ? 0.8 : d === 3 ? 0.6 : 0.4;
        const light = 0.3 * (1 - ny) + 0.2 * (x / S);
        const b = Math.min(1, rim + light + Math.random() * 0.18) * fade;
        pts.push({ x, y, b, d: Math.random() < 0.5 ? '0' : '1', fade });
      }
    }
    sprites = makeSprites(step * 1.15);
  }

  function shadeOf(b) { return b > 0.9 ? 2 : b > 0.5 ? 1 : 0; }

  function frame(ts) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (ts - lastFrame < 33) return;          // 30fps
    lastFrame = ts;
    const t = (ts - t0) / 1000;
    const W = cv.width / dpr, H = cv.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // 붉은 배경을 눌러 인물이 떠 보이게
    ctx.fillStyle = 'rgba(3, 2, 6, 0.78)';
    ctx.fillRect(0, 0, W, H);

    const S = box.size, ox = box.left, oy = box.top;
    const scanY = ((t * 0.22) % 1.3) - 0.15;          // 위에서 아래로 지나가는 스캔 띠
    const glitchRow = !reduceMotion && Math.random() < 0.08 ? Math.random() : -1;
    const lockT = lockedAt ? (performance.now() - lockedAt) / 1000 : -1;
    const px = PORT.x * S, py = PORT.y * S;
    const sz = step * 1.15;

    for (const p of pts) {
      if (Math.random() < (reduceMotion ? 0.004 : 0.02)) p.d = p.d === '0' ? '1' : '0';
      let b = p.b * (0.85 + Math.random() * 0.15);
      const ny = p.y / S;
      if (Math.abs(ny - scanY) < 0.035) b = Math.min(1, b + 0.45);
      // 칩이 꽂히면 포트에서 퍼지는 파동
      let wave = 0;
      if (lockT >= 0) {
        const r = lockT * S * 0.9;
        const dist = Math.hypot(p.x - px, p.y - py);
        wave = Math.max(0, 1 - Math.abs(dist - r) / (S * 0.06));
        b = Math.min(1, b + wave * 0.9);
      }
      // 꽂힌 칩이 목 안에서 비쳐 보이는 부분
      const buried = lockT >= 0 && p.x > px - box.depth && p.x < px && Math.abs(p.y - py) < box.slotH * 0.7;
      let x = ox + p.x, y = oy + p.y;
      if (glitchRow >= 0 && Math.abs(ny - glitchRow) < 0.02) x += (Math.random() - 0.5) * step * 4;
      let shade = wave > 0.5 && lockT >= 0 ? (Math.random() < 0.3 ? 3 : 2) : (Math.random() < 0.004 ? 3 : shadeOf(b));
      if (buried) { shade = 4; b = 0.75 + Math.random() * 0.25; }
      ctx.globalAlpha = Math.max(0.32, b);
      ctx.drawImage(sprites[`${shade}${p.d}`], x - sz / 2, y - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;

    // 세로 빛줄기
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      if (Math.random() < 0.5) continue;
      const x = ox + S * (0.25 + Math.random() * 0.5);
      const gr = ctx.createLinearGradient(0, oy, 0, oy + S);
      gr.addColorStop(0, 'rgba(94, 246, 255, 0)');
      gr.addColorStop(0.3, 'rgba(94, 246, 255, 0.10)');
      gr.addColorStop(1, 'rgba(94, 246, 255, 0)');
      ctx.fillStyle = gr;
      ctx.fillRect(x, oy, 1 + Math.random() * 2, S);
    }
    ctx.globalCompositeOperation = 'source-over';

    // 아래쪽에서 부서져 떠오르는 시안 입자
    if (!reduceMotion) {
      for (let i = 0; i < 3; i++) {
        parts.push({ x: ox + S * (0.3 + Math.random() * 0.6), y: oy + S * (0.9 + Math.random() * 0.1), vx: (Math.random() - 0.3) * 0.6, vy: -0.3 - Math.random() * 0.6, life: 1, s: 1.5 + Math.random() * 2.5 });
      }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i];
      q.x += q.vx; q.y += q.vy; q.life -= 0.015;
      if (q.life <= 0) { parts.splice(i, 1); continue; }
      ctx.globalAlpha = q.life * 0.7;
      ctx.fillStyle = COL.cyan;
      ctx.fillRect(q.x, q.y, q.s, q.s);
    }
    ctx.globalAlpha = 1;

    // 목 포트: 목 표면에 파인 짧은 구멍. 꽂힌 뒤에는 안쪽에 묻힌 칩이 연두색으로 비침
    const sx = ox + px, sy = oy + py;
    const slotH = box.slotH;
    const pulse = 0.6 + 0.4 * Math.sin(t * 4);
    if (lockT >= 0) {
      const g = ctx.createLinearGradient(sx - box.depth, 0, sx, 0);
      g.addColorStop(0, 'rgba(18, 248, 112, 0)');
      g.addColorStop(1, 'rgba(18, 248, 112, 0.28)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - box.depth, sy - slotH / 2, box.depth, slotH);
      ctx.strokeStyle = '#12f870';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sx, sy - slotH / 2 - 3); ctx.lineTo(sx, sy + slotH / 2 + 3); ctx.stroke();
    } else {
      const lip = Math.max(6, slotH * 0.22);
      const g = ctx.createLinearGradient(sx - lip, 0, sx, 0);
      g.addColorStop(0, '#000');
      g.addColorStop(1, '#0a0d12');
      ctx.fillStyle = g;
      ctx.fillRect(sx - lip, sy - slotH / 2, lip, slotH);
      ctx.strokeStyle = near ? '#fcee0a' : `rgba(94, 246, 255, ${pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - lip, sy - slotH / 2); ctx.lineTo(sx, sy - slotH / 2); ctx.lineTo(sx, sy - slotH / 2 - 4);
      ctx.moveTo(sx - lip, sy + slotH / 2); ctx.lineTo(sx, sy + slotH / 2); ctx.lineTo(sx, sy + slotH / 2 + 4);
      ctx.stroke();
      ctx.fillStyle = near ? 'rgba(252, 238, 10, 0.22)' : `rgba(94, 246, 255, ${0.12 * pulse})`;
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
    return geometry();
  }

  function geometry() {
    return { portX: box.left + PORT.x * box.size, portY: box.top + PORT.y * box.size, neckW: NECK_W * box.size };
  }

  function lock() { lockedAt = performance.now(); near = false; }
  function setNear(v) { near = !!v; }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    if (ctx && cv) ctx.clearRect(0, 0, cv.width, cv.height);
  }

  window.BinaryBody = { start, lock, stop, setNear, PORT, NECK_W };
})();
