/* =========================================================
   NIGHT CITY : JACK IN — Intro
   intro.mp4(19초)의 연출을 캔버스로 재현합니다.

   0.00 – 0.30  검은 화면 + 흩어지는 글리치 라인
   0.30 – 0.42  노란 잔상(가로로 늘어난 로고)
   0.42 – 0.80  로고 조각이 시안/노랑으로 찢어지며 등장
   0.80 – 1.25  글리치가 잦아들며 로고 안정
   1.25 – 9.95  로고 유지 (가끔 짧은 미세 글리치)
   9.95 – 10.15 시안 플래시
  10.15 – 10.90 로고가 조각나며 사라짐
  10.90 – 19.00 붉은 노이즈 배경만 유지 → 메인으로 전환

   로고 이미지: assets/logo.png (투명 배경 PNG)
   파일이 없으면 임시 워드마크로 대신 표시합니다.
   ========================================================= */
(() => {
  const LOGO_SRC = 'assets/logo.png';
  const LOGO_WIDTH = 0.65;       // 화면 너비 대비 로고 너비
  const LOGO_MAX_HEIGHT = 0.42;  // 화면 높이 대비 최대 높이
  const DURATION = 19.0;

  const T = {
    inStart: 0.30,
    smearEnd: 0.42,
    chaosEnd: 0.80,
    settleEnd: 1.25,
    outStart: 9.95,
    flashEnd: 10.15,
    outEnd: 10.90,
  };

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
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, dpr = 1, u = 1;          // u = 1080p 기준 단위
  let logo = null;                           // { base, cyan, yellow, white, w, h }
  let noisePattern = null;
  let startTime = 0;
  let timeOffset = 0;
  let skipped = false;
  let finished = false;
  let rafId = 0;

  /* ---------- 유틸 ---------- */
  const rand = (a, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
  const chance = (p) => Math.random() < p;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const easeOut = (k) => 1 - Math.pow(1 - k, 3);

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
    u = H / 1080;
    noisePattern = makeNoisePattern();
  }

  /* ---------- 배경: 촘촘한 점 스캔라인 텍스처 ---------- */
  function makeNoisePattern() {
    const tile = document.createElement('canvas');
    const size = 120;
    tile.width = tile.height = size;
    const t = tile.getContext('2d');
    const step = Math.max(3, Math.round(3 * dpr));
    for (let y = 0; y < size; y += step + 1) {
      for (let x = 0; x < size; x += step) {
        const a = Math.random() * 0.13;
        if (a < 0.02) continue;
        t.fillStyle = `rgba(255, 70, 70, ${a.toFixed(3)})`;
        t.fillRect(x, y, Math.max(1, dpr), Math.max(1, dpr));
      }
    }
    return ctx.createPattern(tile, 'repeat');
  }

  /* ---------- 배경: 떠다니는 붉은 UI 조각 / 픽셀 ---------- */
  const blocks = [];
  const pixels = [];

  function spawnBlock() {
    const type = Math.random();
    const b = {
      x: rand(W),
      y: rand(H * 0.9),
      born: performance.now(),
      life: rand(300, 2200),
      alpha: rand(0.12, 0.38),
      bright: chance(0.12),
    };
    if (type < 0.45) {        // 얇은 가로 막대
      b.kind = 'bar';
      b.w = rand(30, 200) * u; b.h = rand(2, 5) * u;
    } else if (type < 0.75) { // 테두리 박스
      b.kind = 'box';
      b.w = rand(40, 180) * u; b.h = rand(10, 34) * u;
    } else {                  // 점선 줄
      b.kind = 'dash';
      b.w = rand(60, 260) * u; b.h = rand(2, 3) * u;
    }
    blocks.push(b);
  }

  function spawnPixel() {
    pixels.push({
      x: rand(W), y: rand(H * 0.95),
      s: rand(3, 7) * u,
      born: performance.now(),
      life: rand(80, 600),
    });
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2d0607');
    g.addColorStop(0.18, '#240304');
    g.addColorStop(0.45, '#140203');
    g.addColorStop(0.75, '#050100');
    g.addColorStop(1, '#020100');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 점 스캔라인 (아래로 갈수록 옅게)
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = noisePattern;
    ctx.fillRect(0, 0, W, H * 0.8);
    ctx.restore();

    // UI 조각
    const now = performance.now();
    if (blocks.length < 60 && chance(0.5)) spawnBlock();
    if (pixels.length < 18 && chance(0.25)) spawnPixel();

    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      const age = (now - b.born) / b.life;
      if (age >= 1) { blocks.splice(i, 1); continue; }
      const flicker = chance(0.08) ? 0.3 : 1;
      const fade = age < 0.1 ? age / 0.1 : age > 0.85 ? (1 - age) / 0.15 : 1;
      const a = b.alpha * fade * flicker * (1 - b.y / H * 0.6);
      const col = b.bright ? `rgba(255, 70, 80, ${a})` : `rgba(170, 34, 40, ${a})`;
      if (b.kind === 'bar') {
        ctx.fillStyle = col;
        ctx.fillRect(b.x, b.y, b.w, b.h);
      } else if (b.kind === 'box') {
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(1, u);
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = col;
        ctx.fillRect(b.x, b.y + b.h * 0.45, b.w * 0.6, Math.max(1, 2 * u));
      } else {
        ctx.fillStyle = col;
        const seg = 6 * u;
        for (let x = 0; x < b.w; x += seg * 2) ctx.fillRect(b.x + x, b.y, seg, b.h);
      }
    }

    for (let i = pixels.length - 1; i >= 0; i--) {
      const p = pixels[i];
      const age = (now - p.born) / p.life;
      if (age >= 1) { pixels.splice(i, 1); continue; }
      ctx.fillStyle = `rgba(210, 42, 52, ${0.55 * (1 - age)})`;
      ctx.fillRect(p.x, p.y, p.s, p.s);
    }
  }

  /* ---------- 글리치 라인 (화면을 가로지르는 시안/노랑 줄) ---------- */
  function drawGlitchLines(amount, rng = Math.random) {
    const n = Math.floor(amount * 6 + (rng() < amount ? 1 : 0));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const r = rng();
      const color = r < 0.5 ? C.cyan : r < 0.85 ? C.yellow : '#ff3344';
      const w = (0.04 + rng() * 0.3) * W;
      const x = rng() * (W - w * 0.5);
      const y = rng() * H;
      const h = (1 + rng() * 3) * u;
      ctx.globalAlpha = 0.35 + rng() * 0.5;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8 * u;
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

  function buildLogo(src) {
    const base = document.createElement('canvas');
    base.width = src.naturalWidth || src.width;
    base.height = src.naturalHeight || src.height;
    base.getContext('2d').drawImage(src, 0, 0);
    logo = {
      base,
      cyan: tint(base, C.cyan),
      yellow: tint(base, C.yellow),
      white: tint(base, C.white),
      w: base.width,
      h: base.height,
    };
  }

  // logo.png가 아직 없을 때 쓰는 임시 워드마크
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
    buildLogo(c);
  }

  function logoRect() {
    let w = W * LOGO_WIDTH;
    let h = w * (logo.h / logo.w);
    if (h > H * LOGO_MAX_HEIGHT) { h = H * LOGO_MAX_HEIGHT; w = h * (logo.w / logo.h); }
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }

  function drawLogoStable(alpha = 1) {
    const r = logoRect();
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(logo.base, r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  /**
   * 로고를 가로 띠로 잘라 어긋나게 그린다.
   * @param {number} intensity 0–1 어긋남 강도
   * @param {object} o dropout(조각 누락 확률), tintBias(시안/흰색 쪽 비중), seed
   */
  function drawLogoGlitch(intensity, o = {}) {
    const rng = seeded(o.seed || 1);
    const r = logoRect();
    const dropout = o.dropout || 0;
    const tintBias = o.tintBias ?? 0.5;
    const squash = o.squash || 0;
    const maxShift = r.w * 0.22 * intensity;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // RGB 분리: 시안 잔상
    const split = o.split ?? 1;
    if (intensity > 0.05 && split > 0) {
      ctx.globalAlpha = 0.45 * intensity * split;
      ctx.shadowColor = C.cyan;
      ctx.shadowBlur = 24 * u * intensity;
      ctx.drawImage(logo.cyan, r.x - 14 * u * intensity, r.y + 3 * u * intensity, r.w, r.h);
    }

    // 가로 띠 조각
    let sy = 0;
    while (sy < 1) {
      const bh = Math.min(1 - sy, 0.03 + rng() * 0.16);
      const skip = rng() < dropout;
      if (!skip) {
        const shift = Math.pow(rng() * 2 - 1, 3) * maxShift;
        const stretch = rng() < 0.15 * intensity ? 1 + rng() * 1.4 * intensity : 1;
        const pick = rng();
        const src = pick < tintBias * 0.6 ? logo.cyan
          : pick < tintBias ? logo.white
          : pick < tintBias + 0.2 ? logo.yellow
          : logo.base;
        const glow = src === logo.base ? 0 : 18 * u * intensity;
        const dy = r.y + r.h * (0.5 + (sy - 0.5) * (1 - squash));
        const dh = r.h * bh * (1 - squash);
        ctx.globalAlpha = src === logo.base ? 1 : 0.9;
        ctx.globalCompositeOperation = src === logo.base ? 'source-over' : 'lighter';
        ctx.shadowColor = src === logo.cyan || src === logo.white ? C.cyan : C.yellow;
        ctx.shadowBlur = glow;
        const dw = r.w * stretch;
        ctx.drawImage(
          src,
          0, sy * logo.h, logo.w, bh * logo.h,
          r.x + shift - (dw - r.w) * rng(), dy, dw, dh
        );
      }
      sy += bh;
    }
    ctx.restore();
  }

  // 등장 직전: 가로로 늘어난 노란 잔상
  function drawSmear(k, seed) {
    const rng = seeded(seed);
    const r = logoRect();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = C.yellow;
    ctx.shadowBlur = 30 * u;
    const bands = 3;
    for (let i = 0; i < bands; i++) {
      const sy = 0.25 + rng() * 0.5;
      const sh = 0.06 + rng() * 0.12;
      ctx.globalAlpha = 0.7 + rng() * 0.3;
      ctx.drawImage(
        i === 0 ? logo.yellow : logo.white,
        0, sy * logo.h, logo.w, sh * logo.h,
        r.x - r.w * (0.35 - k * 0.1) + (rng() - 0.5) * 40 * u,
        r.y + r.h * (0.42 + i * 0.05),
        r.w * (1.7 - k * 0.2),
        r.h * (0.05 + rng() * 0.05)
      );
    }
    ctx.restore();
  }

  // 사라지기 직전: 시안 플래시
  function drawFlash(k) {
    const r = logoRect();
    drawLogoStable(1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.25 + 0.75 * Math.sin(k * Math.PI * 0.5);
    ctx.shadowColor = C.cyan;
    ctx.shadowBlur = 40 * u;
    ctx.drawImage(logo.cyan, r.x, r.y, r.w, r.h);
    ctx.globalAlpha *= 0.6;
    ctx.drawImage(logo.white, r.x, r.y + r.h * 0.48, r.w, r.h * 0.04);
    ctx.restore();
  }

  /* ---------- 미세 글리치 스케줄 (로고 유지 구간) ---------- */
  let nextMicro = T.settleEnd + rand(1.2, 2.5);
  let microUntil = 0;

  /* ---------- 메인 렌더 ---------- */
  function render(t) {
    const tick = Math.floor(t * 24); // 24fps 단위로 글리치 모양 갱신
    drawBackground();

    if (reduceMotion) {
      // 동작 줄이기: 글리치 없이 페이드만
      const a = t < 0.3 ? 0 : t < 1.2 ? (t - 0.3) / 0.9 : t < T.outStart ? 1 : t < T.outEnd ? 1 - (t - T.outStart) / (T.outEnd - T.outStart) : 0;
      if (a > 0) drawLogoStable(clamp01(a));
      return;
    }

    if (t < T.inStart) {
      drawGlitchLines(0.25);
    } else if (t < T.smearEnd) {
      const k = (t - T.inStart) / (T.smearEnd - T.inStart);
      drawSmear(k, tick);
      drawGlitchLines(0.8, seeded(tick + 7));
    } else if (t < T.chaosEnd) {
      const k = (t - T.smearEnd) / (T.chaosEnd - T.smearEnd);
      drawLogoGlitch(1 - k * 0.3, { dropout: 0.45 - k * 0.25, tintBias: 0.75, seed: tick });
      drawGlitchLines(1, seeded(tick + 3));
    } else if (t < T.settleEnd) {
      const k = (t - T.chaosEnd) / (T.settleEnd - T.chaosEnd);
      const intensity = Math.pow(1 - k, 2) * 0.6;
      if (intensity > 0.04) {
        drawLogoGlitch(intensity, { dropout: 0.12 * (1 - k), tintBias: 0.35 * (1 - k), seed: tick });
      } else {
        drawLogoStable();
      }
      drawGlitchLines(0.5 * (1 - k), seeded(tick + 5));
    } else if (t < T.outStart) {
      if (t >= nextMicro) {
        microUntil = t + rand(0.06, 0.14);
        nextMicro = t + rand(1.5, 3.2);
      }
      if (t < microUntil) {
        drawLogoGlitch(0.18, { tintBias: 0.15, seed: tick });
        drawGlitchLines(0.4, seeded(tick + 11));
      } else {
        drawLogoStable();
        if (chance(0.01)) drawGlitchLines(0.15);
      }
    } else if (t < T.flashEnd) {
      const k = (t - T.outStart) / (T.flashEnd - T.outStart);
      drawFlash(k);
    } else if (t < T.outEnd) {
      const k = (t - T.flashEnd) / (T.outEnd - T.flashEnd);
      drawLogoGlitch(0.45 + k * 0.55, {
        dropout: 0.15 + easeOut(k) * 0.7,
        tintBias: k < 0.4 ? 0.7 : 0.2,
        split: k < 0.15 ? 1 : 0,
        squash: k > 0.75 ? (k - 0.75) * 2 : 0,
        seed: tick,
      });
      drawGlitchLines(0.6 + k * 0.4, seeded(tick + 9));
    } else if (t < T.outEnd + 0.12) {
      drawGlitchLines(0.4, seeded(tick + 13));
    }
  }

  function frame(now) {
    const t = (now - startTime) / 1000 + timeOffset;
    render(t);
    const end = skipped ? T.outEnd + 0.4 : DURATION;
    if (t >= end) { finish(); return; }
    rafId = requestAnimationFrame(frame);
  }

  /* ---------- 시작 / 건너뛰기 / 종료 ---------- */
  function start() {
    finished = false;
    skipped = false;
    timeOffset = 0;
    nextMicro = T.settleEnd + rand(1.2, 2.5);
    microUntil = 0;
    blocks.length = 0;
    pixels.length = 0;
    intro.classList.remove('is-done');
    intro.hidden = false;
    site.classList.remove('is-visible');
    site.hidden = true;
    startTime = performance.now();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  }

  // 클릭/키 입력 시 바로 퇴장 연출로 넘어감
  function skip() {
    if (finished || skipped) return;
    const t = (performance.now() - startTime) / 1000 + timeOffset;
    skipped = true;
    if (t < T.outStart) {
      timeOffset += T.outStart - t;
    }
  }

  function finish() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(rafId);
    site.hidden = false;
    requestAnimationFrame(() => site.classList.add('is-visible'));
    intro.classList.add('is-done');
    setTimeout(() => { if (finished) intro.hidden = true; }, 850);
    document.dispatchEvent(new CustomEvent('intro:done'));
  }

  intro.addEventListener('click', skip);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') skip();
  });
  window.addEventListener('resize', resize);
  replayBtn.addEventListener('click', start);

  /* ---------- 초기화 ---------- */
  resize();
  drawBackground();

  const img = new Image();
  img.onload = () => { buildLogo(img); start(); };
  img.onerror = () => {
    console.info('[intro] assets/logo.png 가 없어 임시 워드마크로 재생합니다.');
    const ready = document.fonts ? document.fonts.load('italic 700 250px Rajdhani') : Promise.resolve();
    ready.catch(() => {}).finally(() => { buildPlaceholderLogo(); start(); });
  };
  img.src = LOGO_SRC;
})();
