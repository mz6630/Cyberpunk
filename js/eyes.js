/* =========================================================
   NIGHT CITY : JACK IN — SHARD OPTICS (칩 속 AI의 눈)
   정전 뒤 어둠 속에서 켜지는 한 쌍의 광학 센서.
   디자인: 사이트 HUD 톤의 오리지널 렌즈 (시안 프레임 · 노란 조리개 홍채 · 셔터 눈꺼풀)

   1. 눈동자가 마우스/터치를 따라옴 (가까우면 조리개가 좁아지고, 멀면 넓어짐)
   2. 살아 있는 느낌: 불규칙한 깜빡임 · 두 번 깜빡임 · 윙크 · 미세 떨림 · 딴 데 보기 · 졸기
   3. 모니터 밖 사용자를 인식하는 반응
      - 마우스가 창 밖으로 나가면 두리번거리며 찾고, 돌아오면 놀람
      - 다른 탭에 다녀오면 삐짐
      - 키보드를 치면 아래(사용자 손)를 내려다봄
      - 오래 가만히 있으면 졸다가, 움직이면 화들짝
      - 마우스를 마구 흔들면 어지러워함
      - 렌즈를 클릭하면 그쪽 눈이 움찔, 다른 곳을 클릭하면 그쪽을 쳐다봄
      - 커서가 렌즈에 오래 붙어 있으면 '너무 가까워'
      - 접속 시각(사용자 컴퓨터 시계)에 따라 인사가 달라짐

   사용: ShardEyes.start(canvas) / ShardEyes.stop()
   ========================================================= */
(() => {
  const C = {
    cyan: '#5ef6ff',
    cyanDim: 'rgba(94, 246, 255, 0.35)',
    yellow: '#fcee0a',
    red: '#ff3344',
    lid: '#05070a',
    inner: '#061015',
  };
  const SFX = window.IntroSFX || { shutter() {}, servo() {}, eyeBoot() {}, eyeHum() {} };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let canvas = null, ctx = null, W = 0, H = 0, dpr = 1;
  let raf = 0, running = false, t0 = 0, last = 0;
  let geo = null;

  // 사용자 상태 (모니터 밖에서 일어나는 일)
  const user = { x: 0, y: 0, has: false, outside: false, lastMove: 0, speed: 0, shake: 0, hoverOn: -1, hoverSince: 0 };

  // 눈 상태
  const eyes = [0, 1].map(() => ({
    top: 1, bot: 1, topT: 1, botT: 1,     // 눈꺼풀 덮임 (0 열림 ~ 1 닫힘)
    tilt: 0, tiltT: 0,                    // 눈꺼풀 기울기 (+ 화남 / - 슬픔)
    blink: -1,                            // 깜빡임 진행 (ms, -1 = 없음)
    blinkDur: 220,
  }));
  const look = { x: 0, y: 0, tx: 0, ty: 0, jx: 0, jy: 0, cross: 0 };
  let dil = 0.5, dilT = 0.5;              // 동공 크기 0~1
  let ringRot = 0, ringSpeed = 0.15;
  let frameScale = 1, frameScaleT = 1;
  let power = 0;                          // 렌즈 전원 (켜지는 깜빡임)

  // 행동
  let mood = 'boot';                      // boot → track / search / sleepy / dizzy / sulk / tooclose
  let moodUntil = 0;
  let nextBlink = 0, nextGlance = 0, nextWink = 0;
  let glanceUntil = 0, glanceX = 0, glanceY = 0;
  let label = { text: '', shown: 0, until: 0 };

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const now = () => performance.now();

  /* ---------- 배치 ---------- */
  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vw = window.innerWidth, vh = window.innerHeight;
    W = Math.floor(vw * dpr); H = Math.floor(vh * dpr);
    canvas.width = W; canvas.height = H;
    const S = Math.min(vw, vh * 1.6);
    const R = clamp(S * 0.085, 40, 118);
    const D = R * 3.1;
    geo = { vw, vh, R, cy: vh * 0.45, cx: [vw / 2 - D / 2, vw / 2 + D / 2] };
  }

  /* ---------- 말풍선 대신 아래쪽에 타이핑되는 짧은 글 ---------- */
  function say(text, ms = 2400) {
    label = { text, shown: now(), until: now() + ms };
  }

  /* ---------- 깜빡임 ---------- */
  function blink(which = 'both', dur = 200) {
    const list = which === 'both' ? [0, 1] : [which];
    list.forEach((i) => { eyes[i].blink = 0; eyes[i].blinkDur = dur; });
    SFX.shutter(0.8, which === 'both' ? 0 : which === 0 ? -0.4 : 0.4);
  }
  function doubleBlink() { blink('both', 160); setTimeout(() => running && blink('both', 160), 230); }
  function wink(i = Math.random() < 0.5 ? 0 : 1) { blink(i, 420); }

  function setMood(m, ms = 0) {
    mood = m;
    moodUntil = ms ? now() + ms : 0;
  }

  /* ---------- 사용자 입력 ---------- */
  function onMove(e) {
    const t = now();
    if (user.has) {
      const dt = Math.max(1, t - user.lastMove);
      const v = Math.hypot(e.clientX - user.x, e.clientY - user.y) / dt;   // px/ms
      user.speed = user.speed * 0.8 + v * 0.2;
      // 방향이 자주 바뀌는 빠른 움직임 = 흔들기
      user.shake = clamp(user.shake + (v > 2.2 ? 0.06 : -0.02), 0, 1.2);
    }
    const wasAway = user.outside || !user.has;
    user.x = e.clientX; user.y = e.clientY; user.has = true; user.lastMove = t;
    user.outside = false;
    if (mood === 'sleepy') wake();
    if (wasAway && mood === 'search') found();
  }

  function onLeave() {
    if (!running || mood === 'boot') return;
    user.outside = true;
    setMood('search');
    say('WHERE’D YOU GO?', 2600);
  }

  function found() {
    setMood('surprised', 900);
    frameScaleT = 1.08; dilT = 0.2;
    SFX.servo(true);
    say('THERE YOU ARE.', 2000);
    setTimeout(() => { if (running) doubleBlink(); }, 450);
  }

  function wake() {
    setMood('surprised', 700);
    frameScaleT = 1.1; dilT = 0.15;
    blink('both', 120);
    say('!!', 900);
  }

  function onVisibility() {
    if (!running || mood === 'boot') return;
    if (document.hidden) { user.leftAt = now(); return; }
    const away = user.leftAt ? (now() - user.leftAt) / 1000 : 0;
    if (away > 1.5) {
      setMood('sulk', 3200);
      say(away > 20 ? 'YOU LEFT ME IN THE DARK.' : 'WHERE WERE YOU?', 3000);
      SFX.servo(false);
    }
  }

  function onKey(e) {
    if (!running || mood === 'boot' || e.repeat) return;
    if (mood === 'sleepy') wake();
    // 키보드는 화면 아래, 사용자의 손이 있는 곳
    glanceUntil = now() + 1400;
    glanceX = 0; glanceY = 1;
    if (Math.random() < 0.35) say('TYPING SOMETHING?', 1600);
  }

  function onDown(e) {
    if (!running || mood === 'boot') return;
    if (e.target && e.target.closest && e.target.closest('button, a')) return;
    const hit = whichEye(e.clientX, e.clientY);
    if (hit >= 0) {
      // 렌즈를 찔렀다 → 그쪽 눈 질끈, 반대쪽은 찡그림
      blink(hit, 520);
      eyes[1 - hit].tiltT = 0.5;
      setMood('poked', 900);
      say(Math.random() < 0.5 ? 'HEY!' : 'OW.', 1200);
    } else {
      // 클릭한 곳을 재빨리 쳐다봄
      glanceUntil = now() + 700;
      const g = toLook(e.clientX, e.clientY);
      glanceX = g.x; glanceY = g.y;
      SFX.servo(true, 0.6);
    }
  }

  function whichEye(x, y) {
    if (!geo) return -1;
    for (let i = 0; i < 2; i++) if (Math.hypot(x - geo.cx[i], y - geo.cy) < geo.R * 1.1) return i;
    return -1;
  }

  // 화면 좌표 → 시선 (-1~1)
  function toLook(x, y) {
    const cx = (geo.cx[0] + geo.cx[1]) / 2;
    const dx = x - cx, dy = y - geo.cy;
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.tanh(d / (geo.R * 4));
    return { x: (dx / d) * k, y: (dy / d) * k };
  }

  /* ---------- 등장 연출 ---------- */
  function bootSequence() {
    setMood('boot');
    eyes.forEach((e) => { e.top = e.bot = e.topT = e.botT = 1; });
    power = 0;
    SFX.eyeBoot();
    const at = (ms, fn) => setTimeout(() => running && fn(), ms);
    at(750, () => { eyes.forEach((e) => { e.topT = 0.55; e.botT = 0.55; }); SFX.shutter(1); });   // 반쯤 뜸
    at(1250, () => { eyes.forEach((e) => { e.topT = 0; e.botT = 0; }); SFX.servo(true); SFX.eyeHum(); });
    at(1500, () => { look.tx = -0.8; look.ty = 0.1; });     // 두리번
    at(2050, () => { look.tx = 0.8; look.ty = -0.1; });
    at(2600, () => { look.tx = 0; look.ty = 0; blink('both', 180); });
    at(3000, () => {                                       // 사용자를 발견
      setMood('track');
      dilT = 0.85; frameScaleT = 1.06;
      SFX.servo(true);
      say(greeting(), 2800);
      at(400, () => { frameScaleT = 1; doubleBlink(); });
      document.getElementById('site')?.classList.add('is-awake');
      scheduleIdle(true);
    });
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 5) return 'STILL UP? …I SEE YOU.';
    if (h < 11) return 'MORNING. I SEE YOU.';
    if (h < 18) return 'HELLO, USER. I SEE YOU.';
    return 'GOOD EVENING. I SEE YOU.';
  }

  function scheduleIdle(first) {
    const t = now();
    nextBlink = t + rnd(first ? 1800 : 2200, 5500);
    nextGlance = t + rnd(3500, 7000);
    nextWink = t + rnd(14000, 24000);
  }

  /* ---------- 매 프레임 판단 ---------- */
  function think(t) {
    if (mood === 'boot') return;
    if (moodUntil && t > moodUntil) { setMood(user.outside ? 'search' : 'track'); frameScaleT = 1; eyes.forEach((e) => (e.tiltT = 0)); }

    const still = user.has ? (t - user.lastMove) / 1000 : (t - t0) / 1000 - 3;

    // 흔들기 → 어지러움
    if (!reduceMotion && user.shake > 0.9 && mood !== 'dizzy') {
      setMood('dizzy', 1800);
      say('STOP SHAKING ME', 1600);
      user.shake = 0;
      setTimeout(() => running && doubleBlink(), 1850);
    }
    // 오래 가만히 → 졸림
    if (mood === 'track' && still > 9) { setMood('sleepy'); say('…zzz', 2500); }

    // 렌즈에 커서가 오래 붙어 있음
    const on = user.has && !user.outside ? whichEye(user.x, user.y) : -1;
    if (on !== user.hoverOn) { user.hoverOn = on; user.hoverSince = t; }
    if (on >= 0 && mood === 'track' && t - user.hoverSince > 1300) { setMood('tooclose', 1600); say('TOO CLOSE.', 1400); }

    // 기본 시선
    let tx = 0, ty = 0;
    if (mood === 'search') {
      const s = Math.sin(t / 420);
      tx = Math.sign(s) * 0.85; ty = Math.sin(t / 900) * 0.25;   // 좌우로 두리번
    } else if (mood === 'dizzy') {
      tx = Math.cos(t / 120) * 0.7; ty = Math.sin(t / 120) * 0.7;
    } else if (mood === 'sleepy') {
      tx = look.tx * 0.98; ty = 0.25;
    } else if (user.has) {
      const g = toLook(user.x, user.y); tx = g.x; ty = g.y;
    }
    if (t < glanceUntil) { tx = glanceX; ty = glanceY; }
    else if (mood === 'track' && t > nextGlance && still > 2.5) {
      // 사용자가 가만히 있으면 잠깐 딴 데를 봤다가 돌아옴
      glanceUntil = t + rnd(500, 1100);
      glanceX = rnd(-0.9, 0.9); glanceY = rnd(-0.5, 0.5);
      nextGlance = t + rnd(4000, 8000);
      SFX.servo(Math.random() < 0.5, 0.4);
    }
    look.tx = tx; look.ty = ty;
    look.cross = mood === 'tooclose' ? 0.35 : 0;

    // 동공: 커서가 가까울수록 좁게 (초점), 멀면 넓게
    if (mood === 'track' || mood === 'tooclose') {
      const d = user.has ? Math.hypot(user.x - geo.vw / 2, user.y - geo.cy) : geo.vw;
      dilT = clamp(0.25 + d / (geo.vw * 0.7), 0.2, 0.95);
      if (mood === 'tooclose') dilT = 0.12;
    } else if (mood === 'search') dilT = 0.9;
    else if (mood === 'sleepy') dilT = 0.7;
    else if (mood === 'dizzy') dilT = 0.5 + Math.sin(t / 90) * 0.3;

    // 눈꺼풀 표정
    const ex = {
      track: [0, 0, 0], search: [0, 0, 0], surprised: [-0.1, -0.1, 0], tooclose: [0.25, 0.2, 0],
      sleepy: [0.72 + Math.sin(t / 700) * 0.08, 0.12, -0.2], dizzy: [0.3, 0.25, 0], sulk: [0.48, 0.12, 0.55], poked: [0.3, 0.2, 0.4],
    }[mood] || [0, 0, 0];
    eyes.forEach((e) => { e.topT = ex[0]; e.botT = ex[1]; if (mood !== 'poked') e.tiltT = ex[2]; });

    // 깜빡임 · 윙크 (불규칙)
    if (mood === 'track' || mood === 'search') {
      if (t > nextBlink) {
        Math.random() < 0.18 ? doubleBlink() : blink('both', rnd(160, 240));
        nextBlink = t + rnd(2200, 6500);
      }
      if (mood === 'track' && t > nextWink && still < 4) {
        wink();
        say(Math.random() < 0.5 ? ';)' : 'JUST KIDDING.', 1200);
        nextWink = t + rnd(16000, 28000);
      }
    }

    ringSpeed = mood === 'dizzy' ? 6 : mood === 'search' ? 0.8 : 0.15;
    user.shake = Math.max(0, user.shake - 0.004);
  }

  /* ---------- 그리기 ---------- */
  function lerp(a, b, k) { return a + (b - a) * k; }

  function lensPath(c, cx, cy, w, h, ch) {
    c.beginPath();
    c.moveTo(cx - w + ch, cy - h); c.lineTo(cx + w - ch, cy - h); c.lineTo(cx + w, cy - h + ch);
    c.lineTo(cx + w, cy + h - ch); c.lineTo(cx + w - ch, cy + h); c.lineTo(cx - w + ch, cy + h);
    c.lineTo(cx - w, cy + h - ch); c.lineTo(cx - w, cy - h + ch); c.closePath();
  }

  function drawEye(c, i, t) {
    const e = eyes[i];
    const R = geo.R * frameScale;
    const cx = geo.cx[i], cy = geo.cy;
    const w = R * 1.18, h = R * 0.86, ch = R * 0.32;
    const side = i === 0 ? -1 : 1;
    const flick = power < 1 ? (Math.random() < power ? 1 : 0.15) : 1;

    // 홍채 위치
    const max = R * 0.42;
    const lx = clamp(look.x + look.jx + (i === 0 ? look.cross : -look.cross), -1.1, 1.1);
    const ly = clamp(look.y + look.jy, -1, 1);
    const ix = cx + lx * max, iy = cy + ly * max * 0.7;

    c.save();
    // 안쪽
    lensPath(c, cx, cy, w, h, ch);
    c.fillStyle = C.inner;
    c.fill();
    c.save();
    c.clip();
    // 스캔라인
    c.fillStyle = 'rgba(94, 246, 255, 0.05)';
    for (let y = cy - h; y < cy + h; y += 3) c.fillRect(cx - w, y, w * 2, 1);

    // 홍채: 노란 조각 링 (회전) + 시안 얇은 링 + 조리개 날
    const ri = R * 0.58;
    c.globalAlpha = flick;
    c.lineWidth = R * 0.07;
    c.strokeStyle = C.yellow;
    const seg = 14;
    for (let s = 0; s < seg; s++) {
      const a0 = ringRot + (s / seg) * Math.PI * 2;
      c.beginPath(); c.arc(ix, iy, ri, a0, a0 + (Math.PI * 2) / seg * 0.68); c.stroke();
    }
    c.lineWidth = Math.max(1, R * 0.018);
    c.strokeStyle = C.cyan;
    c.beginPath(); c.arc(ix, iy, ri * 0.8, 0, Math.PI * 2); c.stroke();

    const rp = R * lerp(0.13, 0.36, dil);       // 동공
    const blades = 6;
    const rot = -ringRot * 0.6 + dil * 1.2;
    c.fillStyle = 'rgba(252, 238, 10, 0.16)';
    c.beginPath(); c.arc(ix, iy, ri * 0.78, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(252, 238, 10, 0.75)';
    c.lineWidth = Math.max(1, R * 0.014);
    for (let b = 0; b < blades; b++) {
      const a = rot + (b / blades) * Math.PI * 2;
      c.beginPath();
      c.moveTo(ix + Math.cos(a) * rp, iy + Math.sin(a) * rp);
      c.lineTo(ix + Math.cos(a + 0.9) * ri * 0.78, iy + Math.sin(a + 0.9) * ri * 0.78);
      c.stroke();
    }
    c.fillStyle = '#000';
    c.beginPath();
    for (let b = 0; b < blades; b++) {
      const a = rot + (b / blades) * Math.PI * 2;
      const x = ix + Math.cos(a) * rp, y = iy + Math.sin(a) * rp;
      b ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.closePath(); c.fill();
    // 반사광
    c.fillStyle = C.cyan;
    c.beginPath(); c.arc(ix - rp * 0.45, iy - rp * 0.45, Math.max(1.5, R * 0.05), 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffffff';
    c.beginPath(); c.arc(ix + rp * 0.35, iy + rp * 0.3, Math.max(1, R * 0.022), 0, Math.PI * 2); c.fill();
    // 가끔 붉은 색수차 글리치
    if (Math.random() < 0.012) {
      c.globalCompositeOperation = 'lighter';
      c.strokeStyle = 'rgba(255, 51, 68, 0.6)';
      c.lineWidth = R * 0.06;
      c.beginPath(); c.arc(ix + R * 0.05, iy, ri, 0, Math.PI * 2); c.stroke();
      c.globalCompositeOperation = 'source-over';
    }
    c.globalAlpha = 1;

    // 셔터 눈꺼풀 (위/아래 날이 가운데로 모임). 기울기는 안쪽(코 쪽)이 내려가면 화난 표정
    let bl = 0;
    if (e.blink >= 0) {
      const p = e.blink / e.blinkDur;
      bl = p < 0.35 ? p / 0.35 : p < 0.5 ? 1 : 1 - (p - 0.5) / 0.5;
    }
    const top = clamp(Math.max(e.top, bl), -0.2, 1);
    const bot = clamp(Math.max(e.bot, bl), -0.2, 1);
    const tilt = e.tilt * R * 0.35 * -side;     // 안쪽이 내려감
    const yTop = cy - h + (h + 1) * top;
    const yBot = cy + h - (h + 1) * bot;
    c.fillStyle = C.lid;
    c.beginPath();
    c.moveTo(cx - w, cy - h - 2); c.lineTo(cx + w, cy - h - 2);
    c.lineTo(cx + w, yTop - tilt); c.lineTo(cx - w, yTop + tilt); c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(cx - w, cy + h + 2); c.lineTo(cx + w, cy + h + 2);
    c.lineTo(cx + w, yBot); c.lineTo(cx - w, yBot); c.closePath(); c.fill();
    c.strokeStyle = C.cyan;
    c.globalAlpha = 0.85 * flick;
    c.lineWidth = Math.max(1.5, R * 0.025);
    if (top > 0.02) { c.beginPath(); c.moveTo(cx - w, yTop + tilt); c.lineTo(cx + w, yTop - tilt); c.stroke(); }
    if (bot > 0.02) { c.beginPath(); c.moveTo(cx - w, yBot); c.lineTo(cx + w, yBot); c.stroke(); }
    c.restore();

    // 프레임 (HUD)
    c.globalAlpha = flick;
    c.strokeStyle = C.cyan;
    c.lineWidth = Math.max(1.5, R * 0.03);
    lensPath(c, cx, cy, w, h, ch); c.stroke();
    c.globalAlpha = 0.35 * flick;
    lensPath(c, cx, cy, w + R * 0.1, h + R * 0.1, ch * 1.15); c.stroke();
    // 눈금
    c.globalAlpha = 0.7 * flick;
    c.lineWidth = Math.max(1, R * 0.02);
    for (let k = -2; k <= 2; k++) {
      const x = cx + k * w * 0.32;
      c.beginPath(); c.moveTo(x, cy - h - R * 0.1); c.lineTo(x, cy - h - R * (k === 0 ? 0.24 : 0.17)); c.stroke();
    }
    c.font = `700 ${Math.max(9, R * 0.13)}px Rajdhani, Arial, sans-serif`;
    c.fillStyle = C.cyan;
    c.textAlign = i === 0 ? 'left' : 'right';
    c.fillText(i === 0 ? 'OPT-L' : 'OPT-R', i === 0 ? cx - w : cx + w, cy + h + R * 0.3);
    c.textAlign = i === 0 ? 'right' : 'left';
    c.fillStyle = 'rgba(252, 238, 10, 0.8)';
    c.fillText(`f/${(1.4 + (1 - dil) * 6).toFixed(1)}`, i === 0 ? cx + w : cx - w, cy + h + R * 0.3);
    c.restore();
  }

  function drawLabel(c, t) {
    if (!label.text || t > label.until + 400) return;
    const n = Math.min(label.text.length, Math.floor((t - label.shown) / 38));
    const fade = t > label.until ? 1 - (t - label.until) / 400 : 1;
    const txt = label.text.slice(0, n) + (n < label.text.length || Math.floor(t / 400) % 2 ? '_' : ' ');
    c.save();
    c.globalAlpha = fade;
    c.font = `700 ${Math.max(14, geo.R * 0.26)}px Rajdhani, Arial, sans-serif`;
    c.textAlign = 'center';
    c.fillStyle = C.cyan;
    c.fillText(txt, geo.vw / 2, geo.cy + geo.R * 1.55);
    c.restore();
  }

  function frame(ts) {
    if (!running) return;
    const t = now();
    const dt = Math.min(50, ts - last || 16);
    last = ts;
    think(t);

    // 부드러운 추종 (시선은 빠르게, 표정은 조금 느리게)
    const kLook = mood === 'dizzy' ? 0.35 : 0.18;
    look.x += (look.tx - look.x) * kLook;
    look.y += (look.ty - look.y) * kLook;
    // 미세 떨림 (살아 있는 눈의 미세 안구 운동)
    if (!reduceMotion && Math.random() < 0.06) { look.jx = rnd(-0.03, 0.03); look.jy = rnd(-0.03, 0.03); }
    dil += (dilT - dil) * 0.08;
    frameScale += (frameScaleT - frameScale) * 0.15;
    ringRot += ringSpeed * dt / 1000;
    if (mood === 'boot') power = Math.min(1, power + dt / 700);
    else power = 1;
    eyes.forEach((e) => {
      const k = mood === 'sleepy' ? 0.04 : 0.2;
      e.top += (e.topT - e.top) * k;
      e.bot += (e.botT - e.bot) * k;
      e.tilt += (e.tiltT - e.tilt) * 0.15;
      if (e.blink >= 0) { e.blink += dt; if (e.blink > e.blinkDur) e.blink = -1; }
    });

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, geo.vw, geo.vh);
    // 렌즈 뒤 아주 옅은 빛
    const g = ctx.createRadialGradient(geo.vw / 2, geo.cy, 0, geo.vw / 2, geo.cy, geo.R * 5);
    g.addColorStop(0, `rgba(94, 246, 255, ${0.06 * power})`);
    g.addColorStop(1, 'rgba(94, 246, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, geo.vw, geo.vh);
    drawEye(ctx, 0, t);
    drawEye(ctx, 1, t);
    drawLabel(ctx, t);
    raf = requestAnimationFrame(frame);
  }

  function start(cv) {
    stop();
    canvas = cv;
    ctx = canvas.getContext('2d');
    layout();
    running = true;
    t0 = now(); last = 0;
    user.has = false; user.outside = false; user.shake = 0;
    look.x = look.y = look.tx = look.ty = 0;
    dil = dilT = 0.5; frameScale = frameScaleT = 1;
    label = { text: '', shown: 0, until: 0 };
    bootSequence();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    document.getElementById('site')?.classList.remove('is-awake');
  }

  window.addEventListener('pointermove', (e) => running && onMove(e));
  window.addEventListener('pointerdown', (e) => running && (onMove(e), onDown(e)));
  document.addEventListener('mouseleave', () => running && onLeave());
  document.documentElement.addEventListener('mouseleave', () => running && onLeave());
  window.addEventListener('blur', () => running && !document.hidden && onLeave());
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', () => running && layout());

  window.ShardEyes = { start, stop };
})();
