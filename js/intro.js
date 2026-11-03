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
   칩 스테이지: 11.65초부터 붉은 화면에서 칩을 포트에 꽂으면 → 카프리 스파크 → 정전 → 메인
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
    const fx = document.getElementById('fx-canvas');
    if (fx) { fx.width = W; fx.height = H; }
    if (typeof glitterReset === 'function') glitterReset();
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

  /* =========================================================
     칩 스테이지
     인트로가 붉은 화면(11.5초)에 도달하면 포트와 칩이 나타난다.
     칩을 포트에 꽂으면
       ① 카프리 색(마젠타·형광 연두·보라)의 전기 스파크가 화면을 뒤덮고
       ② 정전된 것처럼 화면이 검게 꺼진 뒤 메인이 나타난다.
     ========================================================= */
  const stage = document.getElementById('stage');
  const port = document.getElementById('port');
  const portStatus = port.querySelector('.port-label span');
  const chip = document.getElementById('chip');
  const guide = document.getElementById('guide');
  const hint = document.getElementById('stage-hint');
  const fxCanvas = document.getElementById('fx-canvas');
  const fxCtx = fxCanvas.getContext('2d');

  // 레퍼런스 이미지 9장에서 추출한 카프리 색
  const CAPRI = { pink: '#ef0751', green: '#17ee7f', violet: '#8732c4', light: '#fb8295', black: '#07060d' };
  const CHIP_RATIO = 235 / 1100;        // assets/chip.png 세로/가로
  const PIN_CY = 0.522;                 // 칩 높이 대비 핀 중심
  const PIN_SPAN = 0.84 - 0.205;        // 칩 높이 대비 핀 높이
  const STAGE_AT = T.bgBackEnd + 0.15;  // 붉은 화면이 다 켜진 직후
  const STORM_DUR = reduceMotion ? 1.6 : 2.3;
  const BLACK_HOLD = 1.5;

  let mode = 'intro';                   // intro → stage → insert → storm → black
  let L = null;                         // 레이아웃 (CSS px)
  let chipPos = { x: 0, y: 0, rot: -6 };
  let drag = null;
  let stormStart = 0;
  let blackStart = 0;
  let dyingDone = false;

  function layoutStage() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const CW = Math.min(vw * (vw < vh ? 0.52 : 0.42), 620, vh * 1.5);
    const CH = CW * CHIP_RATIO;
    const cy = vh * 0.47;
    const portW = Math.max(90, CW * 0.34);
    const portH = Math.max(70, CH * 1.75);
    const portRight = Math.max(portW + 16, vw * 0.5 - CW * 0.3);
    const slotH = CH * PIN_SPAN * 1.12;
    const startX = Math.min(portRight + Math.max(70, vw * 0.1), vw - CW - 12);
    L = { vw, vh, CW, CH, cy, portW, portH, portRight, slotH, startX, startY: cy - CH * PIN_CY, depth: CW * 0.13 };

    Object.assign(port.style, { left: `${portRight - portW}px`, top: `${cy - portH / 2}px`, width: `${portW}px`, height: `${portH}px` });
    port.style.setProperty('--slot-top', `${portH / 2 - slotH / 2}px`);
    port.style.setProperty('--slot-h', `${slotH}px`);
    Object.assign(chip.style, { width: `${CW}px`, height: `${CH}px` });
    const gx0 = portRight + 14, gx1 = startX - 14;
    Object.assign(guide.style, { left: `${gx0}px`, top: `${cy}px`, width: `${Math.max(0, gx1 - gx0)}px`, display: gx1 - gx0 > 30 ? '' : 'none' });
    hint.style.top = `${cy + portH / 2 + 64}px`;
  }

  function placeChip() {
    chip.style.transform = `translate(${chipPos.x}px, ${chipPos.y}px) rotate(${chipPos.rot}deg)`;
    const inside = L.portRight - chipPos.x;      // 포트 안으로 들어간 부분은 가림
    chip.style.clipPath = mode === 'insert' && inside > 0 ? `inset(-40px -40px -40px ${inside}px)` : '';
  }

  function resetStage() {
    mode = 'intro';
    stage.hidden = true;
    stage.className = '';
    port.className = '';
    portStatus.textContent = 'SLOT 01 // AWAITING SHARD';
    intro.style.transform = '';
    fxShapes = [];
    dyingDone = false;
    fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
  }

  function enterStage() {
    mode = 'stage';
    layoutStage();
    chipPos = { x: L.startX, y: L.startY, rot: -6 };
    placeChip();
    stage.hidden = false;
    requestAnimationFrame(() => stage.classList.add('is-on'));
  }

  // 핀 끝 ↔ 포트 입구 거리
  function tipDistance() {
    const tx = chipPos.x, ty = chipPos.y + L.CH * PIN_CY;
    return Math.hypot(tx - L.portRight, ty - L.cy);
  }
  const snapRadius = () => Math.max(70, L.CW * 0.2);

  chip.addEventListener('pointerdown', (e) => {
    if (mode !== 'stage') return;
    e.stopPropagation();
    e.preventDefault();
    SFX.unlock().then(syncAudio);
    chip.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, dx: e.clientX - chipPos.x, dy: e.clientY - chipPos.y };
    stage.classList.add('is-dragging');
  });
  chip.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    chipPos.x = e.clientX - drag.dx;
    chipPos.y = e.clientY - drag.dy;
    chipPos.rot += (0 - chipPos.rot) * 0.3;
    placeChip();
    port.classList.toggle('is-near', tipDistance() < snapRadius() * 2);
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    stage.classList.remove('is-dragging');
    port.classList.remove('is-near');
    if (tipDistance() < snapRadius()) insertChip();
    else { chipPos.rot = -3; placeChip(); }
  };
  chip.addEventListener('pointerup', endDrag);
  chip.addEventListener('pointercancel', endDrag);
  chip.addEventListener('click', (e) => { e.stopPropagation(); if (e.detail === 0) insertChip(); }); // 키보드(Enter/Space)

  function tween(from, to, ms, ease, onDone) {
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = ease(k);
      chipPos.x = from.x + (to.x - from.x) * e;
      chipPos.y = from.y + (to.y - from.y) * e;
      chipPos.rot = from.rot + (to.rot - from.rot) * e;
      placeChip();
      if (k < 1) requestAnimationFrame(step); else if (onDone) onDone();
    };
    requestAnimationFrame(step);
  }

  function insertChip() {
    if (mode !== 'stage') return;
    SFX.unlock().then(syncAudio);
    mode = 'insert';
    stage.classList.add('is-inserting');
    const aligned = { x: L.portRight + 4, y: L.cy - L.CH * PIN_CY, rot: 0 };
    tween({ ...chipPos }, aligned, 260, (k) => 1 - Math.pow(1 - k, 3), () => {
      SFX.insert();
      tween({ ...aligned }, { ...aligned, x: aligned.x - L.depth }, 300, (k) => k * k, () => {
        port.classList.add('is-locked');
        portStatus.textContent = 'SHARD LINKED // CAPRI.EXE';
        // 핸드셰이크 후 폭풍
        setTimeout(startStorm, 420);
      });
    });
  }

  /* ---------- 카프리 스파크 ----------
     레퍼런스 분석으로 정한 규칙
     1. 빛번짐 없는 평면 색면 (셀 애니메이션 느낌)
     2. 큰 마젠타 덩어리에는 촘촘한 흰 글리터, 가는 가지에는 드문 글리터
     3. 테두리 대신 한쪽(오른쪽 아래)으로만 밀린 보라색 그림자
     4. 뾰족한 머리카락 덩어리 · 날카롭게 꺾이는 가지 · Z자 번개
        · 2~3개씩 묶인 형광 연두 칼날 · 검은 가시 · 둥근 점 · 연분홍 지그재그 선
     5. 12fps로 끊어 움직이고(스텝), 생길 때 2~3단계로 '팍' 커지며, 가장자리가 미세하게 떨림
     ---------------------------------- */
  const STEP_MS = 1000 / 12;
  let fxShapes = [];
  let lastStep = -1;
  let glitterDense = null;
  let glitterSparse = null;
  let whiteUntil = -1;

  function makeGlitter(density) {
    const s = Math.round(240 * Math.max(1, dpr * 0.75));
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    g.fillStyle = CAPRI.pink;
    g.fillRect(0, 0, s, s);
    const k = s / 240;
    if (density === 'dense') {
      // 촘촘하게 엉긴 반짝이 (머리카락 덩어리)
      for (let i = 0; i < 1500; i++) {
        g.fillStyle = Math.random() < 0.2 ? CAPRI.light : `rgba(255, 238, 245, ${0.35 + Math.random() * 0.6})`;
        const r = (0.6 + Math.random() * 1.6) * k;
        g.beginPath(); g.arc(Math.random() * s, Math.random() * s, r, 0, Math.PI * 2); g.fill();
      }
    } else {
      // 드문드문 흰 점 (가는 가지)
      for (let i = 0; i < 140; i++) {
        g.fillStyle = `rgba(255, 245, 250, ${0.5 + Math.random() * 0.5})`;
        const r = (0.5 + Math.random() * 1.3) * k;
        g.beginPath(); g.arc(Math.random() * s, Math.random() * s, r, 0, Math.PI * 2); g.fill();
      }
    }
    return fxCtx.createPattern(c, 'repeat');
  }

  function glitterReset() { glitterDense = null; glitterSparse = null; }
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // A→B를 n번 꺾는 Z자 경로
  function zig(x0, y0, x1, y1, n, amp) {
    const pts = [[x0, y0]];
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
    let sign = Math.random() < 0.5 ? 1 : -1;
    for (let j = 1; j < n; j++) {
      const t = j / n + rnd(-0.08, 0.08) / n;
      const off = sign * amp * rnd(0.4, 1);
      pts.push([x0 + (x1 - x0) * t + nx * off, y0 + (y1 - y0) * t + ny * off]);
      sign = -sign;
    }
    pts.push([x1, y1]);
    return pts;
  }

  // 경로를 두께가 줄어드는 면으로
  function ribbon(pts, w0, w1) {
    const left = [], right = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
      const w = (w0 + (w1 - w0) * (i / (pts.length - 1))) / 2;
      left.push([pts[i][0] + nx * w, pts[i][1] + ny * w]);
      right.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
    }
    return left.concat(right.reverse());
  }

  // 머리카락 덩어리: 밑동이 넓은 커다란 삼각 칼날 여러 장이 한 방향(dir)으로 부채꼴로 솟음
  //  (각 칼날 한쪽 변에 톱니). 여러 장이 겹치면서 사이사이 보라 그림자 줄이 생김
  function spikyMass(cx, cy, R, dir) {
    const polys = [];
    const at = (x, y, a, r) => [x + Math.cos(a) * r, y + Math.sin(a) * r];
    // 밑동 (찢긴 사각형)
    const body = [];
    for (let i = 0; i < 6; i++) body.push(at(cx, cy, dir + Math.PI / 4 + (i / 6) * Math.PI * 2 + rnd(-0.25, 0.25), R * rnd(0.3, 0.5)));
    polys.push(body);
    const fan = rnd(0.7, 1.2);
    const n = Math.floor(rnd(5, 9));
    for (let j = 0; j < n; j++) {
      const a = dir + rnd(-fan, fan);
      const len = R * rnd(1.1, 2.7) * (1 - Math.abs(a - dir) / (fan * 1.9));
      const hw = len * rnd(0.11, 0.2);
      const bx = cx + rnd(-0.25, 0.25) * R, by = cy + rnd(-0.25, 0.25) * R;
      const nx = -Math.sin(a), ny = Math.cos(a);
      const tip = at(bx, by, a + rnd(-0.05, 0.05), len);
      const p1 = [bx + nx * hw, by + ny * hw], p2 = [bx - nx * hw, by - ny * hw];
      const blade = [p1];
      if (Math.random() < 0.65) {               // 톱니: 변 중간이 안으로 꺾였다 다시 나감
        const t = rnd(0.45, 0.7);
        const ex = p1[0] + (tip[0] - p1[0]) * t, ey = p1[1] + (tip[1] - p1[1]) * t;
        blade.push([ex - nx * hw * 0.55, ey - ny * hw * 0.55]);
        blade.push([ex + Math.cos(a) * hw * 0.5 + nx * hw * 0.15, ey + Math.sin(a) * hw * 0.5 + ny * hw * 0.15]);
      }
      blade.push(tip, p2);
      polys.push(blade);
    }
    return polys;
  }

  // 날카롭게 꺾이는 굵은 가지 + 꺾인 곳의 가시
  function branchPolys(x0, y0, x1, y1, w) {
    const path = zig(x0, y0, x1, y1, Math.floor(rnd(3, 6)), Math.hypot(x1 - x0, y1 - y0) * 0.12);
    const polys = [ribbon(path, w, w * 0.25)];
    for (let i = 1; i < path.length - 1; i++) {
      if (Math.random() < 0.7) {
        const [px, py] = path[i];
        const a = Math.atan2(path[i + 1][1] - py, path[i + 1][0] - px) + (Math.random() < 0.5 ? 1 : -1) * rnd(0.6, 1.3);
        const l = w * rnd(1.2, 3);
        polys.push([[px + Math.cos(a + 1.57) * w * 0.3, py + Math.sin(a + 1.57) * w * 0.3], [px + Math.cos(a) * l, py + Math.sin(a) * l], [px - Math.cos(a + 1.57) * w * 0.3, py - Math.sin(a + 1.57) * w * 0.3]]);
      }
    }
    return polys;
  }

  // 2~3개씩 나란한 형광 연두 칼날
  function bladePolys(x, y, ang, len, w) {
    const polys = [];
    const n = Math.random() < 0.5 ? 2 : 3;
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * w * rnd(1.6, 2.4);
      const l = len * rnd(0.6, 1);
      const bx = x + nx * o + Math.cos(ang) * rnd(0, len * 0.2), by = y + ny * o + Math.sin(ang) * rnd(0, len * 0.2);
      polys.push([[bx + nx * w / 2, by + ny * w / 2], [bx + Math.cos(ang) * l, by + Math.sin(ang) * l], [bx - nx * w / 2, by - ny * w / 2], [bx - Math.cos(ang) * l * 0.12, by - Math.sin(ang) * l * 0.12]]);
    }
    return polys;
  }

  function spikePoly(x, y, ang, len, w) {
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    return [[x + nx * w / 2, y + ny * w / 2], [x + Math.cos(ang) * len, y + Math.sin(ang) * len], [x - nx * w / 2, y - ny * w / 2]];
  }

  function addShape(s, step) {
    s.born = step;
    fxShapes.push(s);
  }

  function polyPath(c, poly, ox, oy, s, jx, jy) {
    c.beginPath();
    for (let i = 0; i < poly.length; i++) {
      const x = ox + (poly[i][0] - ox) * s + jx, y = oy + (poly[i][1] - oy) * s + jy;
      if (i) c.lineTo(x, y); else c.moveTo(x, y);
    }
    c.closePath();
  }

  // 한 스텝 그리기
  function drawFx(step, k) {
    const c = fxCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    if (!glitterDense) { glitterDense = makeGlitter('dense'); glitterSparse = makeGlitter('sparse'); }
    const sh = { x: 3.5 * u, y: 4.5 * u };     // 보라 그림자 방향
    const boil = 1.2 * u;

    if (step <= whiteUntil) {                  // 임팩트 프레임 (흰 화면)
      c.fillStyle = '#fff4f7';
      c.fillRect(0, 0, W, H);
    }
    if (k > 0.86) {                            // 마지막: 글리터 마젠타가 화면 전체를 덮음
      c.fillStyle = glitterDense;
      c.fillRect(0, 0, W, H);
    }

    for (let i = fxShapes.length - 1; i >= 0; i--) {
      if (fxShapes[i].life && step - fxShapes[i].born >= fxShapes[i].life) fxShapes.splice(i, 1);
    }
    for (const s of fxShapes) {
      const age = step - s.born;
      const sc = s.grow ? (age === 0 ? 0.55 : age === 1 ? 0.85 : 1) : 1;   // 2~3단계로 팍 커짐
      const jx = (Math.random() - 0.5) * boil, jy = (Math.random() - 0.5) * boil;
      const ox = s.ox ?? 0, oy = s.oy ?? 0;
      for (const poly of s.polys) {
        if (s.shadow !== false) {
          polyPath(c, poly, ox, oy, sc, jx + sh.x, jy + sh.y);
          c.fillStyle = CAPRI.violet;
          c.fill();
        }
        polyPath(c, poly, ox, oy, sc, jx, jy);
        c.fillStyle = s.fill === 'dense' ? glitterDense : s.fill === 'sparse' ? glitterSparse : s.fill;
        c.fill();
      }
      if (s.dots) {
        for (const d of s.dots) {
          c.fillStyle = d.c;
          c.beginPath(); c.arc(d.x + jx, d.y + jy, d.r, 0, Math.PI * 2); c.fill();
        }
      }
      if (s.line) {
        c.strokeStyle = CAPRI.light;
        c.lineWidth = 2 * u;
        c.lineJoin = 'miter';
        c.beginPath();
        s.line.forEach(([x, y], i) => (i ? c.lineTo(x + jx, y + jy) : c.moveTo(x + jx, y + jy)));
        c.stroke();
      }
    }
  }

  // 한 스텝마다 새 모양을 만든다
  function spawnStep(step, k) {
    const px = L.portRight * dpr, py = L.cy * dpr;
    const diag = Math.hypot(W, H);
    const m = reduceMotion ? 0.45 : 1;
    const times = (x) => { const n = x * m; return Math.floor(n) + (Math.random() < n % 1 ? 1 : 0); };
    const out = () => rnd(-Math.PI, Math.PI);
    let loud = 0;

    // ① 깨어남: 포트에서 칼날·점·작은 가시가 튐
    if (k < 0.2) {
      for (let i = 0; i < times(1.5); i++) {
        const a = out();
        addShape({ polys: bladePolys(px + rnd(-20, 20) * u, py + rnd(-20, 20) * u, a, rnd(50, 130) * u, rnd(5, 9) * u), fill: CAPRI.green, life: 5 }, step);
      }
      addShape({ polys: spikyMass(px, py, rnd(30, 55) * u, out()), fill: 'dense', grow: true, ox: px, oy: py }, step);
      addShape({ polys: [], shadow: false, dots: Array.from({ length: 4 }, () => ({ x: px + rnd(-90, 90) * u, y: py + rnd(-70, 70) * u, r: rnd(3, 9) * u, c: Math.random() < 0.5 ? CAPRI.green : CAPRI.pink })), life: 3 }, step);
      loud = 0.6;
    }

    // ② 분출: 포트에서 바깥으로 머리카락 덩어리와 가지가 뻗어 나감
    if (k >= 0.12) {
      for (let i = 0; i < times(0.8 + k * 2.6); i++) {
        const nearPort = Math.random() < 1 - k;
        const a = out();
        const dist = nearPort ? diag * rnd(0.03, 0.12 + k * 0.35) : 0;
        const cx = nearPort ? px + Math.cos(a) * dist : rnd(0, W);
        const cy = nearPort ? py + Math.sin(a) * dist : rnd(0, H);
        const R = rnd(50, 110 + k * 220) * u;
        addShape({ polys: spikyMass(cx, cy, R, nearPort ? a : -Math.PI / 2 + rnd(-0.9, 0.9)), fill: 'dense', grow: true, ox: cx, oy: cy }, step);
      }
      for (let i = 0; i < times(0.5 + k * 1.2); i++) {
        const a = out();
        const len = diag * rnd(0.15, 0.25 + k * 0.4);
        const ox = Math.random() < 0.6 ? px : rnd(0, W), oy = Math.random() < 0.6 ? py : rnd(0, H);
        addShape({ polys: branchPolys(ox, oy, ox + Math.cos(a) * len, oy + Math.sin(a) * len, rnd(12, 26) * u), fill: 'sparse', grow: true, ox, oy }, step);
        loud = Math.max(loud, 0.8 + k * 0.4);
      }
      // Z자 번개 (잠깐 번쩍) — 마젠타 / 연두 / 검정
      for (let i = 0; i < times(1 + k * 2); i++) {
        const x0 = rnd(0, W), y0 = rnd(0, H), a = out(), len = diag * rnd(0.1, 0.3);
        const col = pick([CAPRI.pink, CAPRI.pink, CAPRI.green, CAPRI.black]);
        addShape({ polys: [ribbon(zig(x0, y0, x0 + Math.cos(a) * len, y0 + Math.sin(a) * len, Math.floor(rnd(3, 6)), len * 0.18), rnd(8, 16) * u, 1.5 * u)], fill: col, life: 2 }, step);
      }
      // 검은 가시
      for (let i = 0; i < times(0.6 + k * 1.5); i++) {
        const a = out();
        addShape({ polys: [spikePoly(rnd(0, W), rnd(0, H), a, rnd(80, 260) * u, rnd(6, 14) * u)], fill: CAPRI.black, shadow: false }, step);
      }
      // 연두 칼날 묶음
      for (let i = 0; i < times(0.4 + k * 0.8); i++) {
        addShape({ polys: bladePolys(rnd(0, W), rnd(0, H), out(), rnd(70, 200) * u, rnd(6, 11) * u), fill: CAPRI.green }, step);
      }
      // 연분홍 지그재그 선 (전기 테두리)
      for (let i = 0; i < times(0.6 + k); i++) {
        const a = out(), len = diag * rnd(0.2, 0.45);
        const line = zig(px, py, px + Math.cos(a) * len, py + Math.sin(a) * len, Math.floor(rnd(4, 8)), len * 0.08);
        addShape({ polys: [], shadow: false, line, life: 2 }, step);
      }
      // 둥근 점
      if (Math.random() < 0.5 * m) {
        addShape({ polys: [], shadow: false, life: 4, dots: Array.from({ length: 3 }, () => ({ x: rnd(0, W), y: rnd(0, H), r: rnd(4, 14) * u, c: Math.random() < 0.6 ? CAPRI.green : CAPRI.pink })) }, step);
      }
    }

    // ③ 임팩트 프레임: 한가운데쯤 단 한 번 흰 화면 (동작 줄이기에선 없음)
    if (!reduceMotion && whiteUntil < 0 && k >= 0.5) { whiteUntil = step + 1; loud = 1.3; }

    if (loud > 0) SFX.bolt(clamp01(px / W) * 1.6 - 0.8 + rnd(-0.3, 0.3), Math.min(1.3, loud));
  }

  function startStorm() {
    if (mode !== 'insert') return;
    mode = 'storm';
    stormStart = performance.now();
    fxShapes = [];
    lastStep = -1;
    whiteUntil = -1;
    SFX.storm(STORM_DUR);
  }

  function stormFrame(now) {
    const k = clamp01((now - stormStart) / 1000 / STORM_DUR);
    const step = Math.floor((now - stormStart) / STEP_MS);
    if (step !== lastStep) {                  // 12fps로 끊어서 갱신
      lastStep = step;
      if (k < 1) spawnStep(step, k);
      drawFx(step, k);
      if (!reduceMotion) {
        const amp = 2 + 12 * k * k;
        intro.style.transform = `translate(${Math.round((Math.random() - 0.5) * amp)}px, ${Math.round((Math.random() - 0.5) * amp)}px)`;
      }
    }
    if (k >= 1) startBlackout();
  }

  function startBlackout() {
    mode = 'black';
    blackStart = performance.now();
    intro.style.transform = '';
    stage.classList.add('is-gone');
    fxCtx.setTransform(1, 0, 0, 1, 0, 0);
    fxCtx.clearRect(0, 0, W, H);
    fxShapes = [];
    SFX.blackout();
  }

  function blackFrame(now) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const t = (now - blackStart) / 1000;
    // 꺼진 화면 속에서 마지막으로 튀는 작은 스파크
    if (t > 0.55 && t < 0.68) {
      if (!dyingDone) { dyingDone = true; SFX.dyingSpark(); }
      // 작은 Z자 번개 하나 (보라 그림자 포함, 평면 색)
      const px = L.portRight * dpr, py = L.cy * dpr;
      const poly = ribbon(zig(px, py, px + 46 * u, py - 18 * u, 3, 10 * u), 7 * u, 1 * u);
      ctx.fillStyle = CAPRI.violet;
      polyPath(ctx, poly, 0, 0, 1, 3 * u, 4 * u); ctx.fill();
      ctx.fillStyle = CAPRI.pink;
      polyPath(ctx, poly, 0, 0, 1, 0, 0); ctx.fill();
    }
    if (t >= BLACK_HOLD) finish();
  }

  /* ---------- 메인 루프 ---------- */
  function frame(now) {
    if (mode === 'black') {
      blackFrame(now);
    } else {
      const t = (now - startTime) / 1000 + timeOffset;
      render(Math.min(t, STAGE_AT + 30));     // 붉은 화면 배경은 계속 움직임
      if (mode === 'intro' && t >= STAGE_AT) enterStage();
      if (mode === 'storm') stormFrame(now);
    }
    if (!finished) rafId = requestAnimationFrame(frame);
  }

  /* ---------- 시작 / 건너뛰기 / 종료 ---------- */
  const nowT = () => (performance.now() - startTime) / 1000 + timeOffset;
  const endT = () => 600;     // 칩을 꽂을 때까지 앰비언스 유지

  // 오디오가 켜져 있으면 지금 인트로 시점부터 소리를 맞춰 재생
  function syncAudio() {
    if (!running || finished || mode === 'storm' || mode === 'black') return;
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
    resetStage();
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

  // 클릭/키 입력 시 로고 연출을 건너뛰고 붉은 화면(칩)으로
  function skip() {
    if (!running || finished || skipped || mode !== 'intro') return;
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
    SFX.stop(0.3);
    audioOn = false;
    stage.hidden = true;
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
    if (e.key !== 'Escape' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (mode === 'stage') {                         // 칩 스테이지: Enter/Space로 칩 꽂기
      if (e.key !== 'Escape') { SFX.unlock().then(syncAudio); insertChip(); }
      return;
    }
    if (mode === 'intro') interact();
  });
  window.addEventListener('resize', () => {
    resize();
    if (mode === 'stage') { layoutStage(); chipPos = { x: L.startX, y: L.startY, rot: -6 }; placeChip(); }
  });
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
