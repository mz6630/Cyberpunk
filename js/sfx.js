/* =========================================================
   NIGHT CITY : JACK IN — Intro SFX
   인트로 화면 연출과 같은 타이밍·같은 강약 곡선으로 효과음을 합성합니다.
   (Web Audio, 외부 음원 파일 없음)

   소리 재료는 모두 '전기' 계열입니다.
   spark 스파크 · crackle 지지직 · arc 아크 방전 버즈 · hum 변압기 험
   neon 네온사인 버즈 · relay 릴레이 딸깍 · chatter 데이터 잡음

   [로고 전]
   0.00 – 0.33  배경이 켜지는 만큼 전원이 올라오는 소리 (낮은 스웰 + 라이저)
   0.10 – 0.25  상단 노란 라인: 스파크 + 오른쪽으로 지나가는 '지익'
   0.26 – 0.33  글리치 라인: 짧은 지지직
   0.33 – 0.40  가로 잔상: 왼쪽 → 오른쪽으로 쓸려가는 휩쓸림
   0.40 – 0.47  흰색 잔상: 밝은 전기 터짐
   [로고]
   0.47 – 0.77  로고 형성: 아크 방전 (화면 글리치가 줄어드는 만큼 약해짐)
   0.77         로고 고정: 임팩트 + 전기 충격
   0.77 – 1.50  잦아드는 글리치: 지지직이 화면과 같이 사라짐
   1.0 –10.85   변압기 험 + 네온 버즈 (로고가 빛나는 동안)
   3.88/4.32/8.0  짧은 합선 (화면 미세 글리치와 같은 길이·강약)
   [로고 후]
   9.97 – 10.25 시안 플래시: 충전되며 치솟는 아크
  10.40 – 10.77 흩어짐: 점점 거세지는 아크 + 지지직
  10.77 – 10.93 전원 차단: 험과 버즈가 함께 꺼짐
  10.93 – 11.00 정적
  11.00 – 11.50 배경 재점등: 릴레이 딸깍 + 형광등 깜빡임 + 험 스웰
  11.50 – 칩 대기: 낮은 험 + 데이터 잡음 + 가끔 튀는 정전기 (칩을 꽂을 때까지 계속)
   [칩]
   insert()   칩이 미끄러져 들어가 딸깍, 핸드셰이크 데이터음
   storm(d)   붉은 전기 폭풍 바닥 소리 (점점 커짐)
   bolt(pan)  번개 한 줄기 (화면 번개와 동시에)
   blackout() 정전: 모든 소리 차단 + '툭'
   dyingSpark() 암전 속 마지막 작은 스파크

   사용: IntroSFX.unlock()  → Promise<boolean>
         IntroSFX.play(fromT, endT) / stop() / setMuted(bool) / onReady(fn)
   ========================================================= */
(() => {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  let master = null;
  let comp = null;
  let session = null;
  let noiseBuf = null;
  let curveHard = null;
  let curveSoft = null;
  let muted = false;
  const readyFns = [];
  const VOLUME = 0.75;

  try { muted = localStorage.getItem('njci-muted') === '1'; } catch (e) { /* 저장소 없음 */ }

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

  function makeCurve(k) {
    const n = 2048, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return c;
  }

  function init() {
    if (ctx) return true;
    if (!AC) return false;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 5;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : VOLUME;
    comp.connect(master).connect(ctx.destination);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    curveHard = makeCurve(60);
    curveSoft = makeCurve(6);

    ctx.addEventListener('statechange', () => {
      if (ctx.state === 'running') readyFns.splice(0).forEach((fn) => fn());
    });
    return true;
  }

  function unlock(waitMs = 250) {
    if (!init()) return Promise.resolve(false);
    if (ctx.state === 'running') return Promise.resolve(true);
    const p = ctx.resume().then(() => ctx.state === 'running', () => false);
    return Promise.race([p, new Promise((r) => setTimeout(() => r(ctx.state === 'running'), waitMs))]);
  }

  function onReady(fn) {
    if (ctx && ctx.state === 'running') fn();
    else readyFns.push(fn);
  }

  /* ---------- 기본 재료 ---------- */
  const SILENT = 0.0001;

  function env(g, t, peak, attack, hold, release) {
    const p = Math.max(peak, 0.0002);
    g.gain.setValueAtTime(SILENT, t);
    g.gain.exponentialRampToValueAtTime(p, t + attack);
    g.gain.setValueAtTime(p, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(SILENT, t + attack + hold + release);
  }

  function noiseSrc(t, dur) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
    return src;
  }

  function filter(type, freq, q = 1) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  function shaper(curve) {
    const w = ctx.createWaveShaper();
    w.curve = curve;
    w.oversample = '2x';
    return w;
  }

  // 좌우 위치 (화면에서 움직이는 방향을 따라감)
  function panner(t, dur, from = 0, to) {
    if (!ctx.createStereoPanner) return ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(from, t);
    if (to !== undefined) p.pan.linearRampToValueAtTime(to, t + dur);
    return p;
  }

  function noise(t, dur, o = {}) {
    const f = filter(o.type || 'bandpass', o.freq || 2000, o.q ?? 1);
    f.frequency.setValueAtTime(o.freq || 2000, t);
    if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + dur);
    const g = ctx.createGain();
    const a = o.attack ?? 0.003, r = o.release ?? 0.02;
    env(g, t, o.gain ?? 0.3, a, Math.max(0, dur - a - r), r);
    noiseSrc(t, dur).connect(f).connect(g).connect(panner(t, dur, o.pan ?? 0, o.panTo)).connect(session);
  }

  function sub(t, f0, f1, dur, gain, glide = 0.5) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + Math.min(dur, glide));
    const g = ctx.createGain();
    env(g, t, gain, 0.004, 0, dur);
    o.connect(g).connect(session);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /* ---------- 전기 사운드 ---------- */
  function spark(t, level = 1, pan = 0) {
    noise(t, 0.012, { type: 'highpass', freq: 2500, q: 0.7, gain: 0.5 * level, attack: 0.0005, release: 0.01, pan });
    noise(t + 0.004, 0.09, { type: 'bandpass', freq: 5200, q: 1.5, gain: 0.1 * level, attack: 0.002, release: 0.08, pan });
  }

  /**
   * 지지직: 불규칙한 아주 짧은 딱딱 소리의 연속.
   * shape(u)로 구간 안의 강약(0–1)을 화면 연출과 맞춘다.
   */
  function crackle(t0, t1, density, seed, level = 1, shape = () => 1, pan = 0) {
    if (t1 <= t0) return;
    const rng = seeded(seed);
    const hp = filter('highpass', 1800, 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    let t = t0;
    while (t < t1) {
      const k = shape((t - t0) / (t1 - t0));
      if (rng() < density * Math.max(k, 0.05)) {
        g.gain.setValueAtTime((0.15 + rng() * 0.85) * level * 0.55 * k, t);
        g.gain.setValueAtTime(0, t + 0.0008 + rng() * 0.004);
      }
      t += 0.002 + (rng() * 0.012) / Math.max(density, 0.1);
    }
    g.gain.setValueAtTime(0, t1);
    noiseSrc(t0, t1 - t0).connect(hp).connect(g).connect(panner(t0, t1 - t0, pan)).connect(session);
  }

  // 아크 방전: 왜곡된 저주파 버즈가 끊겼다 붙었다 함 (shape로 강약)
  function arc(t0, t1, o = {}) {
    const rng = seeded(o.seed || 5);
    const level = o.level ?? 1;
    const shape = o.shape || (() => 1);
    const base = o.freq || 120;
    const bus = ctx.createGain();
    const ws = shaper(curveHard);
    const bp = filter('bandpass', o.tone || 1400, 0.8);
    bp.frequency.setValueAtTime(o.tone || 1400, t0);
    if (o.toneTo) bp.frequency.exponentialRampToValueAtTime(o.toneTo, t1);
    const hp = filter('highpass', 90, 0.7);
    const gate = ctx.createGain();
    gate.gain.setValueAtTime(0, t0);
    let t = t0;
    while (t < t1) {
      const k = shape((t - t0) / (t1 - t0));
      const on = 0.015 + rng() * 0.07;
      const off = rng() < 0.6 ? 0.005 + rng() * 0.03 : 0;
      gate.gain.setValueAtTime((0.35 + rng() * 0.65) * level * 0.3 * k, t);
      if (off) gate.gain.setValueAtTime(0, t + on);
      t += on + off;
    }
    gate.gain.setValueAtTime(0, t1);
    [1, 1.007, 2.01].forEach((m, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(base * m, t0);
      if (o.freqTo) osc.frequency.exponentialRampToValueAtTime(o.freqTo * m, t1);
      const og = ctx.createGain();
      og.gain.value = i === 2 ? 0.35 : 0.6;
      osc.connect(og).connect(bus);
      osc.start(t0); osc.stop(t1 + 0.05);
    });
    const n = noiseSrc(t0, t1 - t0);
    const ng = ctx.createGain();
    ng.gain.value = 0.5;
    n.connect(ng).connect(bus);
    bus.connect(ws).connect(bp).connect(hp).connect(gate).connect(panner(t0, t1 - t0, o.pan ?? 0, o.panTo)).connect(session);
  }

  // 변압기 험 (끝날 때 피치가 살짝 떨어지며 꺼질 수 있음)
  function hum(t0, t1, level, o = {}) {
    const fadeIn = o.fadeIn ?? 0.6, fadeOut = o.fadeOut ?? 0.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(SILENT, t0);
    g.gain.exponentialRampToValueAtTime(level, t0 + fadeIn);
    g.gain.setValueAtTime(level, Math.max(t0 + fadeIn, t1 - fadeOut));
    g.gain.exponentialRampToValueAtTime(SILENT, t1);
    const ws = shaper(curveSoft);
    const lp = filter('lowpass', 420, 1.5);
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.frequency.value = 0.25;
    lfoG.gain.value = 90;
    lfo.connect(lfoG).connect(lp.frequency);
    const bus = ctx.createGain();
    bus.gain.value = 0.6;
    [[60, 'sawtooth', 0.5], [60.4, 'sawtooth', 0.4], [120, 'triangle', 0.35], [180, 'sine', 0.15]].forEach(([hz, type, v]) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(hz, t0);
      if (o.dropAt) {
        osc.frequency.setValueAtTime(hz, o.dropAt);
        osc.frequency.exponentialRampToValueAtTime(hz * 0.45, t1);
      }
      const og = ctx.createGain();
      og.gain.value = v;
      osc.connect(og).connect(bus);
      osc.start(t0); osc.stop(t1 + 0.05);
    });
    bus.connect(ws).connect(lp).connect(g).connect(session);
    lfo.start(t0); lfo.stop(t1 + 0.05);
  }

  // 네온사인 버즈: 120Hz 배음의 가늘고 높은 지잉 (빛나는 로고와 함께)
  function neon(t0, t1, level, o = {}) {
    const fadeIn = o.fadeIn ?? 0.8, fadeOut = o.fadeOut ?? 0.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(SILENT, t0);
    g.gain.exponentialRampToValueAtTime(level, t0 + fadeIn);
    g.gain.setValueAtTime(level, Math.max(t0 + fadeIn, t1 - fadeOut));
    g.gain.exponentialRampToValueAtTime(SILENT, t1);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 120;
    const ws = shaper(curveHard);
    const bp = filter('bandpass', 2600, 2.5);
    // 아주 느린 밝기 흔들림
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.frequency.value = 0.6;
    lfoG.gain.value = level * 0.35;
    lfo.connect(lfoG).connect(g.gain);
    const pre = ctx.createGain();
    pre.gain.value = 0.4;
    osc.connect(pre).connect(ws).connect(bp).connect(g).connect(session);
    osc.start(t0); osc.stop(t1 + 0.05);
    lfo.start(t0); lfo.stop(t1 + 0.05);
  }

  // 전원이 올라오는 소리 (배경이 켜지는 곡선과 같이 커짐)
  function powerOn(t, dur) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(38, t);
    o.frequency.exponentialRampToValueAtTime(58, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(SILENT, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + dur);
    g.gain.exponentialRampToValueAtTime(SILENT, t + dur + 0.08);
    o.connect(g).connect(session);
    o.start(t); o.stop(t + dur + 0.1);
    noise(t, dur, { type: 'lowpass', freq: 180, sweepTo: 2200, q: 2, gain: 0.1, attack: dur * 0.9, release: 0.05 });
  }

  function relay(t, level = 1) {
    // 묵직한 딸깍 (접점이 붙는 소리)
    noise(t, 0.02, { type: 'bandpass', freq: 1800, q: 3, gain: 0.35 * level, attack: 0.0005, release: 0.018 });
    sub(t, 120, 60, 0.12, 0.3 * level, 0.08);
    noise(t + 0.012, 0.015, { type: 'highpass', freq: 3000, q: 0.7, gain: 0.15 * level, attack: 0.0005, release: 0.012 });
  }

  // 형광등 깜빡임: 버즈가 켜졌다 꺼졌다 하다가 안정
  function flicker(t0, t1, seed) {
    const rng = seeded(seed);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 120;
    const ws = shaper(curveHard);
    const bp = filter('bandpass', 1800, 1.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    let t = t0;
    while (t < t1) {
      const u = (t - t0) / (t1 - t0);
      const on = rng() < 0.35 + u * 0.5;
      g.gain.setValueAtTime(on ? 0.03 + rng() * 0.03 : 0, t);
      t += 0.02 + rng() * 0.06;
    }
    g.gain.setValueAtTime(0, t1);
    const pre = ctx.createGain();
    pre.gain.value = 0.4;
    osc.connect(pre).connect(ws).connect(bp).connect(g).connect(session);
    osc.start(t0); osc.stop(t1 + 0.05);
  }

  // 데이터 잡음: 배경 UI가 깜빡이는 느낌의 아주 작은 디지털 틱
  function chatter(t0, t1, seed, level = 1) {
    const rng = seeded(seed);
    let t = t0 + rng() * 0.3;
    while (t < t1) {
      const burst = 1 + Math.floor(rng() * 4);
      const freq = 1200 + rng() * 3800;
      const pan = rng() * 1.6 - 0.8;
      for (let i = 0; i < burst; i++) {
        noise(t + i * 0.03, 0.012, { freq, q: 8, gain: 0.05 * level, attack: 0.001, release: 0.01, pan });
      }
      t += 0.25 + rng() * 0.9;
    }
  }

  function shortCircuit(t, dur, seed, level = 1) {
    const shape = (u) => Math.sin(u * Math.PI);          // 화면 미세 글리치와 같은 강약
    arc(t, t + dur, { seed, level: 0.8 * level, freq: 120, tone: 1600, shape });
    crackle(t, t + dur, 0.85, seed + 1, level, shape);
    spark(t + dur * 0.35, 0.6 * level, (seed % 3) * 0.3 - 0.3);
  }

  function impact(t) {
    sub(t, 95, 33, 1.4, 0.9);
    noise(t, 0.25, { type: 'lowpass', freq: 900, sweepTo: 120, q: 0.7, gain: 0.5, release: 0.2 });
    spark(t, 1.2);
    arc(t, t + 0.16, { seed: 41, level: 1.1, freq: 90, tone: 1100, shape: (u) => 1 - u });
  }

  function chargeArc(t, dur) {
    const shape = (u) => 0.4 + 0.6 * Math.sin(u * Math.PI);   // 플래시 밝기 곡선
    arc(t, t + dur, { seed: 51, level: 1.1, freq: 70, freqTo: 260, tone: 900, toneTo: 4200, shape });
    noise(t, dur, { freq: 1500, sweepTo: 7000, q: 1.5, gain: 0.16, attack: 0.05, release: 0.1 });
    crackle(t, t + dur, 0.9, 53, 1, shape);
  }

  function powerDown(t, dur) {
    arc(t, t + dur + 0.1, { seed: 61, level: 0.9, freq: 140, freqTo: 25, tone: 1500, toneTo: 180, shape: (u) => 1 - u * 0.7 });
    noise(t, dur + 0.1, { type: 'lowpass', freq: 3000, sweepTo: 150, q: 1, gain: 0.2, release: dur });
    sub(t + 0.03, 70, 30, 0.45, 0.32);
    crackle(t, t + dur, 0.5, 63, 0.7, (u) => 1 - u);
  }

  /* ---------- 타임라인 (intro.js의 T와 같은 시각) ---------- */
  const HUM_END = 10.93;

  function timeline(endT) {
    return [
      // ── 로고 전 ──
      { at: 0.00, fn: (t) => powerOn(t, 0.33) },
      { at: 0.10, fn: (t) => {
        spark(t, 0.55, 0.1);
        noise(t, 0.15, { freq: 3500, sweepTo: 6000, q: 3, gain: 0.07, attack: 0.01, release: 0.05, pan: 0.05, panTo: 0.55 });
      } },
      { at: 0.26, fn: (t) => crackle(t, t + 0.07, 0.9, 3, 0.6) },
      { at: 0.33, fn: (t) => {
        noise(t, 0.12, { freq: 600, sweepTo: 7000, q: 1.2, gain: 0.35, attack: 0.015, release: 0.05, pan: -0.7, panTo: 0.7 });
        sub(t, 160, 50, 0.3, 0.32);
        crackle(t, t + 0.07, 0.6, 4, 0.5);
      } },
      { at: 0.40, fn: (t) => {
        noise(t, 0.08, { type: 'highpass', freq: 3000, q: 0.7, gain: 0.3, attack: 0.003, release: 0.05 });
        spark(t, 1);
      } },
      // ── 로고 ──
      { at: 0.47, fn: (t) => {
        const shape = (u) => 1 - u * 0.35;
        arc(t, t + 0.3, { seed: 11, level: 1, freq: 120, tone: 1800, shape });
        crackle(t, t + 0.3, 0.95, 12, 1, shape);
      } },
      { at: 0.77, fn: (t) => impact(t) },
      { at: 0.77, fn: (t) => crackle(t + 0.05, t + 0.73, 0.8, 14, 0.7, (u) => Math.pow(1 - u, 2.2)) },
      { at: 1.00, fn: (t, from) => {
        const t0 = Math.max(1, from);
        const len = HUM_END - t0;
        hum(t, t + len, 0.09, { fadeIn: from > 1.5 ? 0.15 : 1.2, fadeOut: 0.16, dropAt: t + len - 0.16 });
        if (t0 < 10.6) neon(t + 0.3, t + Math.max(0.4, 10.77 - t0), 0.02, { fadeIn: from > 1.5 ? 0.2 : 1.5, fadeOut: 0.05 });
      } },
      { at: 3.88, fn: (t) => shortCircuit(t, 0.20, 21, 0.8) },
      { at: 4.32, fn: (t) => shortCircuit(t, 0.30, 23, 1) },
      { at: 8.00, fn: (t) => shortCircuit(t, 0.30, 29, 0.9) },
      // ── 로고 후 ──
      { at: 9.97, fn: (t) => chargeArc(t, 0.28) },
      { at: 10.25, fn: (t) => crackle(t, t + 0.15, 0.6, 31, 0.5) },
      { at: 10.40, fn: (t) => {
        const shape = (u) => 0.5 + u * 0.5;                    // 화면이 점점 거세짐
        arc(t, t + 0.37, { seed: 37, level: 1, freq: 110, tone: 2000, shape, pan: -0.3, panTo: 0.3 });
        crackle(t, t + 0.37, 1, 38, 1, shape);
      } },
      { at: 10.77, fn: (t) => powerDown(t, 0.16) },
      // 10.93–11.00 정적
      { at: 11.00, fn: (t) => { relay(t); flicker(t + 0.03, t + 0.5, 81); crackle(t + 0.02, t + 0.45, 0.25, 82, 0.5, (u) => 1 - u); } },
      // 붉은 화면(칩 대기)부터는 칩을 꽂을 때까지 끝없이 이어지는 앰비언스
      { at: 11.00, fn: (t, from) => idle(t, from > 11.2 ? 0.4 : 0.5) },
    ];
  }

  /* ---------- 칩 대기 앰비언스 (끝 시간 없음) ---------- */
  let idleTimer = 0;
  function idle(t, fadeIn = 0.5) {
    const sess = session;
    const g = ctx.createGain();
    g.gain.setValueAtTime(SILENT, t);
    g.gain.exponentialRampToValueAtTime(1, t + fadeIn);
    g.connect(sess);
    // 험: 정지 시간 없이 계속 (세션이 끊기면 같이 사라짐)
    const ws = shaper(curveSoft);
    const lp = filter('lowpass', 400, 1.5);
    const hg = ctx.createGain();
    hg.gain.value = 0.05 * 0.6;
    [[60, 'sawtooth', 0.5], [60.4, 'sawtooth', 0.4], [120, 'triangle', 0.35]].forEach(([hz, type, v]) => {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = hz;
      const og = ctx.createGain(); og.gain.value = v;
      o.connect(og).connect(ws);
      o.start(t);
      idleNodes.push(o);
    });
    ws.connect(lp).connect(hg).connect(g);
    // 데이터 잡음 + 가끔 튀는 정전기: 1초 앞씩 계속 예약
    const prevSession = session;
    let seed = 91, next = t + 0.6;
    clearInterval(idleTimer);
    const tickFn = () => {
      if (session !== prevSession || !ctx) { clearInterval(idleTimer); return; }
      const until = ctx.currentTime + 1.2;
      while (next < until) {
        const keep = session;
        session = g;                       // 앰비언스 버스로 보냄
        chatter(next, next + 1, seed++, 1);
        if (Math.random() < 0.5) crackle(next, next + 1, 0.03, seed++, 0.3);
        session = keep;
        next += 1;
      }
    };
    tickFn();
    idleTimer = setInterval(tickFn, 400);
  }
  const idleNodes = [];
  function stopIdle() {
    clearInterval(idleTimer);
    const now = ctx ? ctx.currentTime : 0;
    idleNodes.splice(0).forEach((o) => { try { o.stop(now + 0.1); } catch (e) { /* 이미 멈춤 */ } });
  }

  /* ---------- 칩 연출용 단발 효과음 ---------- */
  function ensureSession() {
    if (!ctx || ctx.state !== 'running') return false;
    if (!session) {
      session = ctx.createGain();
      session.connect(comp);
    }
    return true;
  }

  // 칩이 포트에 들어감: 미끄러지는 소리 → 딸깍 → 핸드셰이크 데이터음
  function insert() {
    if (!ensureSession()) return;
    const t = ctx.currentTime + 0.01;
    noise(t, 0.3, { type: 'bandpass', freq: 2400, sweepTo: 700, q: 2, gain: 0.12, attack: 0.02, release: 0.08 });
    relay(t + 0.3, 1.2);
    spark(t + 0.31, 0.7, -0.3);
    for (let i = 0; i < 9; i++) {
      noise(t + 0.4 + i * 0.045, 0.02, { freq: 1500 + (i % 3) * 900, q: 9, gain: 0.07, attack: 0.001, release: 0.015, pan: -0.3 });
    }
  }

  // 붉은 전기 폭풍의 바닥 소리 (점점 커짐)
  function storm(dur) {
    if (!ensureSession()) return;
    const t = ctx.currentTime + 0.01;
    const up = (u) => 0.25 + 0.75 * u * u;
    arc(t, t + dur, { seed: 101, level: 1.1, freq: 60, freqTo: 140, tone: 700, toneTo: 3500, shape: up, pan: -0.4, panTo: 0.4 });
    arc(t + 0.1, t + dur, { seed: 103, level: 0.9, freq: 115, tone: 1800, toneTo: 5000, shape: up, pan: 0.5, panTo: -0.5 });
    crackle(t, t + dur, 1, 105, 1.1, up);
    noise(t, dur, { type: 'lowpass', freq: 200, sweepTo: 3000, q: 1.5, gain: 0.22, attack: dur * 0.9, release: 0.05 });
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(30, t);
    o.frequency.exponentialRampToValueAtTime(70, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(SILENT, t);
    g.gain.exponentialRampToValueAtTime(0.45, t + dur);
    o.connect(g).connect(session);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // 번개 한 줄기 (화면에 큰 번개가 칠 때 바로 호출)
  function bolt(pan = 0, level = 1) {
    if (!ensureSession()) return;
    const t = ctx.currentTime + 0.005;
    spark(t, 0.9 * level, pan);
    arc(t, t + 0.06 + Math.random() * 0.08, { seed: Math.floor(Math.random() * 1e6), level: 0.8 * level, freq: 90 + Math.random() * 80, tone: 1500 + Math.random() * 2000, shape: (u) => 1 - u, pan });
    if (level > 0.8) sub(t, 80, 35, 0.35, 0.25 * level, 0.2);
  }

  // 정전: 모든 소리가 한 번에 끊기고 '툭' 하는 차단음만 남음
  function blackout() {
    if (!ctx || ctx.state !== 'running') return;
    stop(0.015);
    session = ctx.createGain();
    session.connect(comp);
    const t = ctx.currentTime + 0.02;
    relay(t, 1.4);
    sub(t, 60, 22, 0.9, 0.6, 0.6);
    noise(t, 0.12, { type: 'lowpass', freq: 600, sweepTo: 60, q: 1, gain: 0.3, release: 0.1 });
  }

  // 암전 중 마지막으로 꺼져 가는 작은 스파크
  function dyingSpark() {
    if (!ensureSession()) return;
    const t = ctx.currentTime + 0.01;
    spark(t, 0.35, -0.4);
    crackle(t, t + 0.12, 0.6, 333, 0.35, (u) => 1 - u, -0.4);
  }

  function play(fromT = 0, endT = 19) {
    if (!ctx || ctx.state !== 'running') return false;
    stop();
    session = ctx.createGain();
    session.gain.value = 1;
    session.connect(comp);
    const base = ctx.currentTime + 0.03 - fromT;
    for (const ev of timeline(endT)) {
      const continuous = ev.at === 1.0 || (ev.at === 11.0 && ev.fn.length === 2);
      if (!continuous && ev.at < fromT - 0.02) continue;
      // 험/앰비언스는 중간에 들어와도 지금부터 이어서 재생
      if (ev.at === 1.0 && fromT >= HUM_END - 0.2) continue;
      if (ev.at === 11.0 && fromT > endT - 0.5) continue;
      ev.fn(base + Math.max(ev.at, fromT), fromT);
    }
    return true;
  }

  function stop(fade = 0.08) {
    stopIdle();
    if (!session) return;
    const s = session;
    session = null;
    const now = ctx.currentTime;
    s.gain.cancelScheduledValues(now);
    s.gain.setValueAtTime(s.gain.value, now);
    s.gain.linearRampToValueAtTime(0, now + fade);
    setTimeout(() => s.disconnect(), fade * 1000 + 80);
  }

  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem('njci-muted', muted ? '1' : '0'); } catch (e) { /* 저장소 없음 */ }
    if (master) master.gain.setTargetAtTime(muted ? 0 : VOLUME, ctx.currentTime, 0.03);
  }

  window.IntroSFX = {
    supported: !!AC,
    unlock,
    onReady,
    play,
    stop,
    setMuted,
    insert,
    storm,
    bolt,
    blackout,
    dyingSpark,
    get running() { return !!ctx && ctx.state === 'running'; },
    get muted() { return muted; },
  };
})();
