/* =========================================================
   NIGHT CITY : JACK IN — Intro
   intro.mp4(19초)를 프레임 단위로 분석해 캔버스로 재현합니다.

   0.00 – 0.33  검은 화면 → 붉은 배경이 서서히 켜짐, 상단에 노란 섬광 라인
   0.33 – 0.40  가로로 길게 늘어난 노란 잔상
   0.40 – 0.47  흰색/시안 잔상 + 위쪽으로 튀는 조각
   0.47 – 0.77  로고가 시안/노랑 조각으로 찢어지며 형성
   0.77 – 1.50  노란 로고로 안정, 시안 글리치가 잦아듦
   1.20 – 9.95  로고가 아주 천천히 줌아웃 (약 17%)
   3.9 / 4.35 / 8.05  짧은 미세 글리치
   9.97 – 10.25 시안 플래시
  10.25 – 10.40 노란 로고로 잠깐 복귀
  10.40 – 10.77 조각나며 흩어짐
  10.77 – 10.93 배경이 꺼지고 노란 조각 몇 개만 남음
  10.93 – 11.00 완전한 암전
  11.00 – 11.50 붉은 배경 다시 켜짐
  11.50 – 19.00 붉은 노이즈 배경 유지 → 메인으로 전환

   효과음: js/sfx.js (Web Audio 합성, 자동 재생 시도 → 막히면 첫 클릭부터 이어서 재생)
   로고 이미지: assets/logo.png (영상에서 추출한 'Cyberpunk' 글자, 투명 배경)
   아래 줄 'WEBSITE'는 SUB 설정으로 캔버스에 직접 그립니다 (Barlow Condensed).
   ========================================================= */
(() => {
  const LOGO_SRC = 'assets/logo.png';
  const LOGO_WIDTH = 0.616;      // 줌아웃이 끝났을 때 화면 너비 대비 로고 너비 (영상 실측)
  const LOGO_ZOOM = 0.172;       // 시작 시 추가 확대 비율 (영상 실측 449px → 383px)
  const LOGO_MAX_HEIGHT = 0.36;  // 세로 화면 대비 최대 높이
  const DURATION = 19.0;

  const T = {
    bgIn: 0.33,
    smearEnd: 0.40,
    whiteEnd: 0.47,
    chaosEnd: 0.77,
    settleEnd: 1.50,
    zoomStart: 1.20,
    outStart: 9.97,
    flashEnd: 10.25,
    holdEnd: 10.40,
    breakEnd: 10.77,
    blackStart: 10.93,
    bgBack: 11.00,
    bgBackEnd: 11.50,
  };
  // 로고 유지 구간의 미세 글리치 (영상과 같은 시점)
  const MICRO = [
    { at: 3.88, dur: 0.20, amt: 0.14 },
    { at: 4.32, dur: 0.30, amt: 0.26 },
    { at: 8.00, dur: 0.30, amt: 0.20 },
  ];

  const C = {
    cyan: '#5ef6ff',
    yellow: '#fcee0a',
    white: '#f4ffff',
  };

  const intro = document.getElementById('intro');
  const canvas = document.getElementById('intro-canvas');
  const ctx = canvas.getContext('2d');
  const site = document.getElementById('site');
  const replayBtn = document.getElementById('replay');
  const soundBtn = document.getElementById('sound');
  const SFX = window.IntroSFX || { supported: false, running: false, unlock: () => Promise.resolve(false), onReady() {}, play() {}, stop() {}, setMuted() {}, muted: true };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, dpr = 1, u = 1;          // u = 1080p 기준 단위
  let logo = null;                           // { base, cyan, yellow, white, glow, w, h }
  let bgLayer = null;                        // 정적인 배경(그라디언트·도트·UI 텍스트)
  let startTime = 0;
  let timeOffset = 0;
  let skipped = false;
  let finished = false;
  let running = false;     // 인트로 재생 중
  let audioOn = false;     // 이번 재생에 소리가 붙었는지
  let rafId = 0;

  /* ---------- 유틸 ---------- */
  const rand = (a, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
  const chance = (p) => Math.random() < p;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const easeOut = (k) => 1 - Math.pow(1 - k, 3);
  const lerp = (a, b, k) => a + (b - a) * k;

  // 같은 '틱' 안에서는 같은 글리치 모양을 유지(영상처럼 프레임 단위로 끊기는 느낌)
  function seeded(seed) {
    let s = seed >>> 0;
    return () => {
      s += 0x6d2b79f5;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- 캔버스 크기 ---------- */
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.floor(window.innerWidth * dpr);
    H = Math.floor(window.innerHeight * dpr);
    canvas.width = W;
    canvas.height = H;
    u = Math.min(H / 1080, W / 1920 * 1.4);
    bgLayer = buildBackground();
  }

  /* ---------- 배경 (한 번만 그려 두는 정적 레이어) ---------- */
  function buildBackground() {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const rng = seeded(2077);

    // 위는 붉고 아래로 갈수록 검게
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0.00, '#2f0605');
    grad.addColorStop(0.12, '#260303');
    grad.addColorStop(0.35, '#1d0202');
    grad.addColorStop(0.55, '#130101');
    grad.addColorStop(0.75, '#060000');
    grad.addColorStop(1.00, '#020000');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    // 밝기가 조금씩 다른 가로 띠
    let y = 0;
    while (y < H * 0.78) {
      const h = (20 + rng() * 110) * u;
      g.fillStyle = rng() < 0.5 ? `rgba(90, 10, 14, ${0.05 + rng() * 0.09})` : `rgba(0, 0, 0, ${0.06 + rng() * 0.12})`;
      g.fillRect(0, y, W, h);
      y += h;
    }
    // 화면 3/4 지점의 어두운 경계
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, H * 0.755, W, H * 0.245);

    // 좌우 가장자리의 도트 매트릭스
    const step = Math.max(4, Math.round(5 * u));
    const edge = W * 0.14;
    for (let yy = 0; yy < H * 0.92; yy += step) {
      if (rng() < 0.08) continue;                  // 가끔 줄이 끊김
      for (let xx = 0; xx < W; xx += step) {
        const d = Math.min(xx, W - xx);
        let p = d < edge ? 1 - d / edge : 0;
        p = p * p * 0.9 + (rng() < 0.012 ? 0.6 : 0);
        if (rng() > p) continue;
        const a = (0.18 + rng() * 0.45) * (1 - yy / H * 0.7);
        g.fillStyle = `rgba(255, 70, 70, ${a.toFixed(3)})`;
        g.fillRect(xx, yy, Math.max(1, 1.6 * u), Math.max(1, 1.6 * u));
      }
    }

    // 희미한 UI 텍스트 블록 (작은 막대 묶음)
    for (let i = 0; i < 26; i++) {
      const bx = rng() * W, by = rng() * H * 0.9;
      const bw = (40 + rng() * 120) * u, rows = 3 + Math.floor(rng() * 8);
      const a = (0.06 + rng() * 0.1) * (1 - by / H * 0.5);
      g.fillStyle = `rgba(210, 90, 90, ${a})`;
      for (let r = 0; r < rows; r++) {
        let x = bx;
        while (x < bx + bw) {
          const w = (3 + rng() * 14) * u;
          if (rng() < 0.8) g.fillRect(x, by + r * 5 * u, w, 2 * u);
          x += w + 2 * u;
        }
      }
      if (rng() < 0.4) {                             // 세로 가는 선
        g.fillRect(bx - 4 * u, by - 10 * u, Math.max(1, u), rows * 5 * u + 30 * u);
      }
    }

    // 흩어진 작은 붉은 대시
    for (let i = 0; i < 260; i++) {
      const a = 0.15 + rng() * 0.5;
      const yy = rng() * H * 0.95;
      g.fillStyle = `rgba(255, 60, 60, ${a * (1 - yy / H * 0.6)})`;
      g.fillRect(rng() * W, yy, (2 + rng() * 12) * u, Math.max(1, 1.6 * u));
    }
    return c;
  }

  /* ---------- 배경: 깜빡이는 UI 조각 ---------- */
  const blocks = [];

  function spawnBlock() {
    const b = {
      x: rand(W),
      y: rand(H * 0.9),
      born: performance.now(),
      life: rand(200, 1600),
      alpha: rand(0.25, 0.75),
      kind: Math.random(),
    };
    if (b.kind < 0.6) { b.w = rand(4, 22) * u; b.h = 2.2 * u; }        // 짧은 대시
    else if (b.kind < 0.85) { b.w = rand(30, 140) * u; b.h = 2.2 * u; } // 긴 막대
    else { b.w = rand(5, 9) * u; b.h = b.w; }                          // 사각 픽셀
    b.color = chance(0.06) ? '160,255,255' : chance(0.05) ? '255,240,120' : '255,70,80';
    blocks.push(b);
  }

  function drawBackground(level) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (level <= 0) return;

    ctx.globalAlpha = level;
    ctx.drawImage(bgLayer, 0, 0);

    const now = performance.now();
    if (blocks.length < 45 && chance(0.6)) spawnBlock();
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      const age = (now - b.born) / b.life;
      if (age >= 1) { blocks.splice(i, 1); continue; }
      const flicker = chance(0.1) ? 0.2 : 1;
      ctx.globalAlpha = level * b.alpha * flicker * (1 - b.y / H * 0.6);
      ctx.fillStyle = `rgb(${b.color})`;
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- 글리치 라인 (화면을 가로지르는 시안/노랑 줄) ---------- */
  function drawGlitchLines(amount, rng = Math.random, colors) {
    const n = Math.floor(amount * 6 + (rng() < amount ? 1 : 0));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const r = rng();
      const color = colors ? colors[Math.floor(r * colors.length)]
        : r < 0.45 ? C.cyan : r < 0.8 ? C.yellow : '#ff3344';
      const w = (0.03 + rng() * 0.22) * W;
      const x = rng() * (W - w * 0.5);
      const y = rng() * H;
      const h = (1.5 + rng() * 3) * u;
      ctx.globalAlpha = 0.35 + rng() * 0.5;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
  }

  /* ---------- 로고 ---------- */
  function tint(src, color) {
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const t = c.getContext('2d');
    t.drawImage(src, 0, 0);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = color;
    t.fillRect(0, 0, c.width, c.height);
    return c;
  }

  // 미리 흐리게 만들어 둔 빛번짐 레이어 (매 프레임 shadowBlur를 쓰지 않도록)
  function blurred(src, px) {
    const pad = px * 3;
    const c = document.createElement('canvas');
    c.width = src.width + pad * 2; c.height = src.height + pad * 2;
    const t = c.getContext('2d');
    if ('filter' in t) {
      t.filter = `blur(${px}px)`;
      t.drawImage(src, pad, pad);
    } else {
      t.shadowColor = '#fff'; t.shadowBlur = px * 2;
      t.drawImage(src, pad, pad);
    }
    c.pad = pad;
    return c;
  }

  /* ---------- 서브 텍스트 (원본의 '2077' 자리) ----------
     logo.png에는 'Cyberpunk' 글자만 남겨 두고, 아래 줄은 여기서 직접 그립니다.
     좌표는 logo.png(1577×407) 기준이며 원본 2077의 크기·색·회로선을 실측한 값입니다. */
  const SUB = {
    text: 'WEBSITE',
    font: '600 67px "Barlow Condensed", "Arial Narrow", sans-serif',
    color: '#5fbdc9',
    firstX: 965,      // 첫 글자 중심
    step: 72,         // 글자 간격
    baseline: 345,    // 글자 아래선
    lineY: 321.5,     // 회로선 높이
    lineLowY: 339,    // 왼쪽 아래로 꺾인 구간 높이
    lineStart: 935,
    lineEnd: 1432,
    rings: [2.5, 4.5], // 글자 사이 작은 원 (몇 번째 글자 뒤인지: 2.5 = 3번째와 4번째 사이)
  };

  function drawSubline(g) {
    const s = SUB;
    const rng = seeded(77);
    const kinkX = s.firstX + s.step * 0.5;
    g.save();
    g.strokeStyle = s.color;
    g.fillStyle = s.color;
    g.lineWidth = 2.6;
    g.globalAlpha = 0.9;
    // 회로선: 왼쪽은 낮게, 첫 글자 뒤에서 비스듬히 올라가 오른쪽으로 이어짐
    g.beginPath();
    g.moveTo(s.lineStart, s.lineLowY);
    g.lineTo(kinkX - 6, s.lineLowY);
    g.lineTo(kinkX + 8, s.lineY);
    g.lineTo(s.lineEnd, s.lineY);
    g.stroke();
    // 선 주변의 잔 노이즈 (원본의 거친 질감)
    for (let i = 0; i < 46; i++) {
      const x = s.lineStart + rng() * (s.lineEnd + 60 - s.lineStart);
      const y = (x < kinkX ? s.lineLowY : s.lineY) + (rng() - 0.5) * 9;
      g.globalAlpha = 0.25 + rng() * 0.5;
      g.fillRect(x, y, 3 + rng() * 16, 1.6 + rng() * 1.4);
    }
    // 작은 원
    g.globalAlpha = 0.95;
    g.lineWidth = 2.2;
    for (const k of s.rings) {
      const x = s.firstX + s.step * k;
      g.fillStyle = '#000';
      g.globalCompositeOperation = 'destination-out';
      g.beginPath(); g.arc(x, s.lineY, 6, 0, Math.PI * 2); g.fill();
      g.globalCompositeOperation = 'source-over';
      g.beginPath(); g.arc(x, s.lineY, 5.4, 0, Math.PI * 2); g.stroke();
    }
    // 글자: 선을 살짝 지우고 그 위에 그림
    g.font = s.font;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    [...s.text].forEach((ch, i) => {
      const x = s.firstX + s.step * i;
      const w = g.measureText(ch).width;
      g.globalCompositeOperation = 'destination-out';
      g.globalAlpha = 1;
      g.fillRect(x - w / 2 - 5, s.lineY - 4, w + 10, 8);
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = s.color;
      g.fillText(ch, x, s.baseline);
    });
    g.restore();
  }

  function buildLogo(src, withSub = true) {
    const base = document.createElement('canvas');
    base.width = src.naturalWidth || src.width;
    base.height = src.naturalHeight || src.height;
    const bctx = base.getContext('2d');
    bctx.drawImage(src, 0, 0);
    if (withSub) drawSubline(bctx);
    const cyan = tint(base, C.cyan);
    logo = {
      base,
      cyan,
      yellow: tint(base, C.yellow),
      white: tint(base, C.white),
      glow: blurred(tint(base, '#ffd200'), 18),
      cyanGlow: blurred(cyan, 22),
      w: base.width,
      h: base.height,
    };
  }

  // logo.png를 불러오지 못했을 때 쓰는 임시 워드마크
  function buildPlaceholderLogo() {
    const c = document.createElement('canvas');
    const font = 'italic 700 250px Rajdhani, Arial, sans-serif';
    const probe = c.getContext('2d');
    probe.font = font;
    const textW = Math.ceil(probe.measureText('NIGHT CITY').width);
    c.width = textW + 60; c.height = 330;
    const t = c.getContext('2d');
    t.textAlign = 'center';
    t.textBaseline = 'middle';
    t.font = font;
    t.fillStyle = C.cyan;
    t.fillText('NIGHT CITY', c.width / 2 + 10, 125 + 8);
    t.fillStyle = C.yellow;
    t.fillText('NIGHT CITY', c.width / 2, 125);
    t.font = '700 60px Rajdhani, Arial, sans-serif';
    t.fillStyle = C.cyan;
    t.fillText('J  A  C  K    I  N', c.width * 0.66, 285);
    buildLogo(c, false);
  }

  // 시간에 따른 로고 크기 (영상: 1.2초부터 천천히 줌아웃, 끝으로 갈수록 느려짐)
  function zoomAt(t) {
    const p = clamp01((t - T.zoomStart) / (T.outStart - T.zoomStart));
    return 1 + LOGO_ZOOM * Math.pow(1 - p, 1.7);
  }

  let currentZoom = 1 + LOGO_ZOOM;
  function logoRect() {
    let w = W * LOGO_WIDTH;
    if (w * (logo.h / logo.w) > H * LOGO_MAX_HEIGHT) w = H * LOGO_MAX_HEIGHT * (logo.w / logo.h);
    w *= currentZoom;
    const h = w * (logo.h / logo.w);
    return { x: (W - w) / 2, y: H * 0.505 - h / 2, w, h };
  }

  function drawGlow(layer, r, alpha) {
    const s = r.w / logo.w;
    const p = layer.pad * s;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.drawImage(layer, r.x - p, r.y - p, r.w + p * 2, r.h + p * 2);
    ctx.restore();
  }

  function drawLogoStable(alpha = 1, glow = 0.22) {
    const r = logoRect();
    if (glow > 0) drawGlow(logo.glow, r, glow * alpha);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(logo.base, r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  /**
   * 로고를 가로 띠로 잘라 어긋나게 그린다.
   * @param {number} intensity 0–1 어긋남 강도
   * @param {object} o dropout(조각 누락 확률), tintBias(시안/흰색 쪽 비중), split(시안 잔상), squash, seed
   */
  function drawLogoGlitch(intensity, o = {}) {
    const rng = seeded(o.seed || 1);
    const r = logoRect();
    const dropout = o.dropout || 0;
    const tintBias = o.tintBias ?? 0.5;
    const squash = o.squash || 0;
    const maxShift = r.w * 0.22 * intensity;

    ctx.save();

    // RGB 분리: 시안 잔상 + 빛번짐
    const split = o.split ?? 1;
    if (intensity > 0.05 && split > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5 * intensity * split;
      ctx.drawImage(logo.cyan, r.x - 14 * u * intensity, r.y + 4 * u * intensity, r.w, r.h);
      drawGlow(logo.cyanGlow, r, 0.6 * intensity * split * tintBias);
    }

    // 가로 띠 조각
    let sy = 0;
    while (sy < 1) {
      const bh = Math.min(1 - sy, 0.03 + rng() * 0.16);
      const skip = rng() < dropout;
      const shift = Math.pow(rng() * 2 - 1, 3) * maxShift;
      const stretch = rng() < 0.3 * intensity ? 1 + rng() * 1.6 * intensity : 1;
      const pick = rng();
      const offR = rng();
      if (!skip) {
        const src = pick < tintBias * 0.6 ? logo.cyan
          : pick < tintBias ? logo.white
          : pick < tintBias + 0.2 ? logo.yellow
          : logo.base;
        const dy = r.y + r.h * (0.5 + (sy - 0.5) * (1 - squash));
        const dh = r.h * bh * (1 - squash);
        ctx.globalAlpha = src === logo.base ? 1 : 0.92;
        ctx.globalCompositeOperation = src === logo.base ? 'source-over' : 'lighter';
        const dw = r.w * stretch;
        ctx.drawImage(
          src,
          0, sy * logo.h, logo.w, bh * logo.h,
          r.x + shift - (dw - r.w) * offR, dy, dw, dh
        );
      }
      sy += bh;
    }
    ctx.restore();
  }

  // 등장 직전: 가로로 늘어난 잔상 (노랑 → 흰색/시안)
  function drawSmear(k, seed, white) {
    const rng = seeded(seed);
    const r = logoRect();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bands = white ? 4 : 3;
    for (let i = 0; i < bands; i++) {
      const sy = 0.2 + rng() * 0.55;
      const sh = 0.06 + rng() * 0.14;
      const src = white ? (i % 2 ? logo.cyan : logo.white) : logo.yellow;
      ctx.globalAlpha = 0.75 + rng() * 0.25;
      ctx.drawImage(
        src,
        0, sy * logo.h, logo.w, sh * logo.h,
        r.x - r.w * (0.32 - k * 0.12) + (rng() - 0.5) * 50 * u,
        r.y + r.h * (0.40 + i * 0.045),
        r.w * (1.55 - k * 0.2),
        r.h * (0.05 + rng() * 0.06)
      );
    }
    if (white) {
      // 위쪽으로 튀는 흰 조각
      for (let i = 0; i < 5; i++) {
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = C.white;
        ctx.fillRect(r.x + r.w * (0.25 + rng() * 0.4), r.y + r.h * (0.15 + rng() * 0.15), (20 + rng() * 60) * u, (6 + rng() * 10) * u);
      }
    }
    ctx.restore();
  }

  // 사라지기 직전: 로고 전체가 시안/흰색으로 빛남
  function drawFlash(k) {
    const r = logoRect();
    const a = Math.sin(clamp01(k) * Math.PI);
    drawLogoStable(1, 0.22 * (1 - a));
    ctx.save();
    ctx.globalAlpha = 0.9 * a;                       // 로고를 시안으로 덮고
    ctx.drawImage(logo.cyan, r.x, r.y, r.w, r.h);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.18 * a;                      // 가운데만 살짝 하얗게
    ctx.drawImage(logo.white, r.x, r.y, r.w, r.h);
    ctx.restore();
    drawGlow(logo.cyanGlow, r, 0.8 * a);
  }

  /* ---------- 메인 렌더 ---------- */
  function render(t) {
    const tick = Math.floor(t * 30); // 30fps 단위로 글리치 모양 갱신 (원본 영상과 같은 프레임레이트)
    currentZoom = zoomAt(t);

    // 배경 밝기
    let bg;
    if (t < T.bgIn) bg = 0.35 + 0.65 * (t / T.bgIn) * (t / T.bgIn);
    else if (t < T.breakEnd) bg = 1;
    else if (t < T.blackStart) bg = 0.25 * (1 - (t - T.breakEnd) / (T.blackStart - T.breakEnd));
    else if (t < T.bgBack) bg = 0;
    else if (t < T.bgBackEnd) bg = (t - T.bgBack) / (T.bgBackEnd - T.bgBack);
    else bg = 1;
    if (t < T.bgIn) bg *= 0.55;
    drawBackground(bg);

    if (reduceMotion) {
      // 동작 줄이기: 글리치 없이 페이드만
      const a = t < 0.3 ? 0 : t < 1.2 ? (t - 0.3) / 0.9 : t < T.outStart ? 1 : t < T.breakEnd ? 1 - (t - T.outStart) / (T.breakEnd - T.outStart) : 0;
      if (a > 0) drawLogoStable(clamp01(a));
      return;
    }

    if (t < T.bgIn) {
      // 상단을 스치는 노란 섬광 라인 + 드문 글리치 줄
      if (t > 0.1 && t < 0.25) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = C.yellow;
        ctx.globalAlpha = 0.8;
        ctx.fillRect(W * (0.45 + t * 0.5), H * 0.07, W * 0.065, 2.5 * u);
        ctx.restore();
      }
      drawGlitchLines(t > 0.25 ? 0.6 : 0.15, seeded(tick + 1));
    } else if (t < T.smearEnd) {
      const k = (t - T.bgIn) / (T.smearEnd - T.bgIn);
      drawSmear(k, tick, false);
      drawGlitchLines(0.5, seeded(tick + 7));
    } else if (t < T.whiteEnd) {
      const k = (t - T.smearEnd) / (T.whiteEnd - T.smearEnd);
      drawSmear(k, tick, true);
      drawGlitchLines(0.9, seeded(tick + 7), [C.cyan, C.cyan, C.white]);
    } else if (t < T.chaosEnd) {
      const k = (t - T.whiteEnd) / (T.chaosEnd - T.whiteEnd);
      drawLogoGlitch(1 - k * 0.35, { dropout: 0.4 - k * 0.25, tintBias: 0.8 - k * 0.2, seed: tick });
      drawGlitchLines(1, seeded(tick + 3));
    } else if (t < T.settleEnd) {
      const k = (t - T.chaosEnd) / (T.settleEnd - T.chaosEnd);
      const intensity = Math.pow(1 - k, 2.2) * 0.5;
      if (intensity > 0.03 && (tick % 2 === 0 || k < 0.4)) {
        drawLogoStable(1, 0.3);
        drawLogoGlitch(intensity, { dropout: 0.55, tintBias: 0.35 * (1 - k), split: 1 - k, seed: tick });
      } else {
        drawLogoStable(1, 0.22 + 0.25 * (1 - k));
      }
      drawGlitchLines(0.45 * (1 - k), seeded(tick + 5));
    } else if (t < T.outStart) {
      const m = MICRO.find((g) => t >= g.at && t < g.at + g.dur);
      if (m) {
        const k = (t - m.at) / m.dur;
        const amt = m.amt * Math.sin(k * Math.PI);
        drawLogoStable(1, 0.22 + amt);
        if (tick % 3 !== 2) drawLogoGlitch(amt, { dropout: 0.6, tintBias: 0.6, seed: tick });
        drawGlitchLines(amt * 1.5, seeded(tick + 11));
      } else {
        drawLogoStable();
      }
    } else if (t < T.flashEnd) {
      const k = (t - T.outStart) / (T.flashEnd - T.outStart);
      drawFlash(k);
      if (k > 0.3) drawLogoGlitch(0.12, { dropout: 0.7, tintBias: 0.9, split: 0, seed: tick });
      drawGlitchLines(0.3, seeded(tick + 9), [C.cyan]);
    } else if (t < T.holdEnd) {
      drawLogoStable(1, 0.35);
      drawLogoGlitch(0.15, { dropout: 0.6, tintBias: 0.3, split: 0.5, seed: tick });
      drawGlitchLines(0.4, seeded(tick + 9));
    } else if (t < T.breakEnd) {
      const k = (t - T.holdEnd) / (T.breakEnd - T.holdEnd);
      drawLogoGlitch(0.45 + k * 0.45, {
        dropout: 0.15 + easeOut(k) * 0.45,
        tintBias: k < 0.6 ? 0.4 : 0.15,
        split: k < 0.5 ? 1 : 0.3,
        seed: tick,
      });
      drawGlitchLines(0.6 + k * 0.4, seeded(tick + 9));
    } else if (t < T.blackStart) {
      // 배경이 꺼지는 동안 노란 조각 몇 개만 남음
      const k = (t - T.breakEnd) / (T.blackStart - T.breakEnd);
      drawLogoGlitch(0.6, {
        dropout: lerp(0.82, 0.95, k),
        tintBias: 0,
        split: 0,
        squash: k * 0.15,
        seed: Math.floor(t * 15),
      });
    }
  }

  function frame(now) {
    const t = (now - startTime) / 1000 + timeOffset;
    render(t);
    const end = skipped ? T.bgBackEnd + 0.3 : DURATION;
    if (t >= end) { finish(); return; }
    rafId = requestAnimationFrame(frame);
  }

  /* ---------- 시작 / 건너뛰기 / 종료 ---------- */
  const nowT = () => (performance.now() - startTime) / 1000 + timeOffset;
  const endT = () => (skipped ? T.bgBackEnd + 0.3 : DURATION);

  // 오디오가 켜져 있으면 지금 인트로 시점부터 소리를 맞춰 재생
  function syncAudio() {
    if (!running || finished) return;
    if (SFX.running && !audioOn) {
      audioOn = true;
      SFX.play(skipped ? Math.max(nowT(), T.outStart) : nowT(), endT());
      syncSound();
    }
  }

  function start() {
    running = true;
    finished = false;
    skipped = false;
    audioOn = false;
    timeOffset = 0;
    blocks.length = 0;
    intro.classList.remove('is-done');
    intro.hidden = false;
    site.classList.remove('is-visible');
    site.hidden = true;
    startTime = performance.now();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
    // 클릭 없이도 소리를 켜 본다. 브라우저가 막으면 첫 클릭 때 이어서 재생
    SFX.unlock().then(syncAudio);
    syncSound();
  }

  // 클릭/키 입력 시 바로 퇴장 연출로 넘어감
  function skip() {
    if (!running || finished || skipped) return;
    const t = nowT();
    skipped = true;
    if (t < T.outStart) timeOffset += T.outStart - t;
    if (audioOn) SFX.play(Math.max(t, T.outStart), endT());
  }

  // 소리가 막혀 있을 때의 첫 클릭/키는 '소리 켜기'로만 쓰고 건너뛰지 않음
  function interact() {
    if (audioOn || !SFX.supported || SFX.muted) { skip(); return; }
    SFX.unlock().then((ok) => { if (ok) syncAudio(); else skip(); });
  }

  function finish() {
    if (finished) return;
    finished = true;
    running = false;
    cancelAnimationFrame(rafId);
    SFX.stop();
    audioOn = false;
    site.hidden = false;
    requestAnimationFrame(() => site.classList.add('is-visible'));
    intro.classList.add('is-done');
    setTimeout(() => { if (finished) intro.hidden = true; }, 850);
    syncSound();
    document.dispatchEvent(new CustomEvent('intro:done'));
  }

  intro.addEventListener('pointerdown', interact);
  window.addEventListener('keydown', (e) => {
    if (e.target === soundBtn || e.target === replayBtn) return;
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); interact(); }
  });
  window.addEventListener('resize', resize);
  replayBtn.addEventListener('click', () => { SFX.unlock(); start(); });
  SFX.onReady(syncAudio);   // 어떤 경로로든 오디오가 켜지면 바로 맞춰 재생

  // 사운드 켜기/끄기 (자동 재생이 막혀도 따로 표시하지 않고, 첫 클릭부터 소리가 남)
  function syncSound() {
    soundBtn.textContent = SFX.muted ? 'SOUND OFF' : 'SOUND ON';
    soundBtn.setAttribute('aria-pressed', String(!SFX.muted));
  }
  if (SFX.supported) {
    soundBtn.hidden = false;
    soundBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    soundBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (running && !audioOn && !SFX.muted) {      // 막혀 있던 소리 켜기
        SFX.unlock().then(syncAudio);
        return;
      }
      SFX.setMuted(!SFX.muted);
      if (!SFX.muted) SFX.unlock().then(syncAudio);
      syncSound();
    });
    syncSound();
  }

  /* ---------- 초기화 ---------- */
  resize();
  drawBackground(0);

  // 서브 텍스트 폰트가 준비된 뒤에 로고를 합성 (최대 2.5초 대기)
  const fontReady = document.fonts
    ? Promise.race([
        document.fonts.load(SUB.font, SUB.text),
        new Promise((r) => setTimeout(r, 2500)),
      ]).catch(() => {})
    : Promise.resolve();

  const img = new Image();
  img.onload = () => { fontReady.then(() => { buildLogo(img); start(); }); };
  img.onerror = () => {
    console.info('[intro] assets/logo.png 를 불러오지 못해 임시 워드마크로 재생합니다.');
    const ready = document.fonts ? document.fonts.load('italic 700 250px Rajdhani') : Promise.resolve();
    ready.catch(() => {}).finally(() => { buildPlaceholderLogo(); start(); });
  };
  img.src = LOGO_SRC;
})();
