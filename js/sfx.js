/* =========================================================
   NIGHT CITY : JACK IN — Intro SFX
   인트로 연출 타이밍에 맞춘 효과음을 Web Audio로 직접 합성합니다.
   (외부 음원 파일 없음 → 저작권 걱정 없음, 용량 0)

   소리 재료는 모두 '전기' 계열입니다.
   - spark   : 날카로운 스파크 딱 소리
   - crackle : 지지직거리는 정전기/합선
   - arc     : 왜곡된 60Hz 계열 버즈가 끊겼다 붙었다 하는 아크 방전
   - hum     : 변압기처럼 낮게 웅웅거리는 전원 험

   0.10        상단 섬광 라인: 스파크 + 정전기
   0.33        가로 잔상: 노이즈 휩쓸림 + 저음 낙하
   0.40–0.77   로고 형성: 아크 방전 + 합선 지지직
   0.77        로고 고정: 묵직한 임팩트 + 전기 충격
   1.0 –9.97   변압기 험
   3.88/4.32/8.0  짧은 합선
   9.97        시안 플래시: 충전되며 치솟는 아크
  10.40–10.77  흩어짐: 아크 방전 + 지지직
  10.77        전원 차단: 꺼지는 버즈
  11.0 –19.0   붉은 배경 앰비언스 → 페이드아웃

   사용: IntroSFX.unlock()  → Promise<boolean> (소리를 낼 수 있게 되었는지)
         IntroSFX.play(fromT, endT) / IntroSFX.stop() / IntroSFX.setMuted(bool)
         IntroSFX.onReady(fn)  오디오가 (나중에라도) 켜지면 호출
   ========================================================= */
(() => {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  let master = null;      // 음소거용
  let comp = null;
  let session = null;     // 이번 재생에 쓰는 노드 묶음 (건너뛰기 때 통째로 끊음)
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

  /**
   * 오디오를 켜 본다. 클릭 없이 호출하면 브라우저가 막을 수 있으며,
   * 그 경우 false로 끝나고 이후 사용자가 클릭하면 onReady 콜백이 호출된다.
   */
  function unlock(waitMs = 250) {
    if (!init()) return Promise.resolve(false);
    if (ctx.state === 'running') return Promise.resolve(true);
    const p = ctx.resume().then(() => ctx.state === 'running', () => false);
    // 막힌 경우 resume()이 끝나지 않으므로 잠깐만 기다린다
    return Promise.race([p, new Promise((r) => setTimeout(() => r(ctx.state === 'running'), waitMs))]);
  }

  function onReady(fn) {
    if (ctx && ctx.state === 'running') fn();
    else readyFns.push(fn);
  }

  /* ---------- 기본 재료 ---------- */
  function env(g, t, peak, attack, hold, release) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.setValueAtTime(Math.max(peak, 0.0002), t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
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

  function noise(t, dur, o = {}) {
    const f = filter(o.type || 'bandpass', o.freq || 2000, o.q ?? 1);
    f.frequency.setValueAtTime(o.freq || 2000, t);
    if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + dur);
    const g = ctx.createGain();
    const a = o.attack ?? 0.003, r = o.release ?? 0.02;
    env(g, t, o.gain ?? 0.3, a, Math.max(0, dur - a - r), r);
    noiseSrc(t, dur).connect(f).connect(g).connect(session);
  }

  function sub(t, f0, f1, dur, gain) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + Math.min(dur, 0.5));
    const g = ctx.createGain();
    env(g, t, gain, 0.004, 0, dur);
    o.connect(g).connect(session);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /* ---------- 전기 사운드 ---------- */
  // 날카로운 스파크 한 번
  function spark(t, level = 1) {
    noise(t, 0.012, { type: 'highpass', freq: 2500, q: 0.7, gain: 0.55 * level, attack: 0.0005, release: 0.01 });
    noise(t + 0.004, 0.09, { type: 'bandpass', freq: 5200, q: 1.5, gain: 0.12 * level, attack: 0.002, release: 0.08 });
  }

  // 지지직: 불규칙한 아주 짧은 딱딱 소리의 연속 (정전기·합선)
  function crackle(t0, t1, density, seed, level = 1) {
    const rng = seeded(seed);
    const hp = filter('highpass', 1800, 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    let t = t0;
    while (t < t1) {
      if (rng() < density) {
        const a = (0.15 + rng() * 0.85) * level * 0.6;
        g.gain.setValueAtTime(a, t);
        g.gain.setValueAtTime(0, t + 0.0008 + rng() * 0.004);
      }
      t += 0.002 + rng() * 0.012 / Math.max(density, 0.1);
    }
    g.gain.setValueAtTime(0, t1);
    noiseSrc(t0, t1 - t0).connect(hp).connect(g).connect(session);
  }

  // 아크 방전: 왜곡된 저주파 버즈가 끊겼다 붙었다 함
  function arc(t0, t1, o = {}) {
    const rng = seeded(o.seed || 5);
    const level = o.level ?? 1;
    const base = o.freq || 120;
    const bus = ctx.createGain();
    bus.gain.value = 1;
    const ws = shaper(curveHard);
    const bp = filter('bandpass', o.tone || 1400, 0.8);
    if (o.toneTo) bp.frequency.exponentialRampToValueAtTime(o.toneTo, t1);
    const hp = filter('highpass', 90, 0.7);
    const gate = ctx.createGain();
    gate.gain.setValueAtTime(0, t0);
    let t = t0;
    while (t < t1) {
      const on = 0.015 + rng() * 0.07;
      const off = rng() < 0.6 ? 0.005 + rng() * 0.03 : 0;
      gate.gain.setValueAtTime((0.35 + rng() * 0.65) * level * 0.32, t);
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
    // 버즈 안에 섞이는 지직거림
    const n = noiseSrc(t0, t1 - t0);
    const ng = ctx.createGain();
    ng.gain.value = 0.5;
    n.connect(ng).connect(bus);
    bus.connect(ws).connect(bp).connect(hp).connect(gate).connect(session);
  }

  // 변압기 험: 60Hz 계열 + 약간의 왜곡, 낮게 깔림
  function hum(t0, t1, level, fadeIn = 0.6, fadeOut = 0.4) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(level, t0 + fadeIn);
    g.gain.setValueAtTime(level, Math.max(t0 + fadeIn, t1 - fadeOut));
    g.gain.exponentialRampToValueAtTime(0.0001, t1);
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
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz;
      const og = ctx.createGain();
      og.gain.value = v;
      o.connect(og).connect(bus);
      o.start(t0); o.stop(t1 + 0.05);
    });
    bus.connect(ws).connect(lp).connect(g).connect(session);
    lfo.start(t0); lfo.stop(t1 + 0.05);
  }

  // 짧은 합선: 아크 + 지지직 + 스파크
  function shortCircuit(t, dur, seed, level = 1) {
    arc(t, t + dur, { seed, level: 0.8 * level, freq: 120, tone: 1600 });
    crackle(t, t + dur + 0.05, 0.8, seed + 1, level);
    spark(t, 0.8 * level);
  }

  function impact(t) {
    sub(t, 95, 33, 1.4, 0.9);
    noise(t, 0.25, { type: 'lowpass', freq: 900, sweepTo: 120, q: 0.7, gain: 0.5, release: 0.2 });
    // 전기 충격: 강한 스파크 + 짧은 아크 + 잔 지지직
    spark(t, 1.2);
    arc(t, t + 0.18, { seed: 41, level: 1.1, freq: 90, tone: 1100 });
    crackle(t + 0.05, t + 0.9, 0.35, 43, 0.6);
  }

  function chargeArc(t) {
    // 전기가 충전되며 치솟는 아크 (플래시)
    arc(t, t + 0.3, { seed: 51, level: 1.1, freq: 70, freqTo: 260, tone: 900, toneTo: 4200 });
    noise(t, 0.3, { freq: 1500, sweepTo: 7000, q: 1.5, gain: 0.18, attack: 0.03, release: 0.08 });
    crackle(t, t + 0.32, 0.9, 53, 1);
    spark(t + 0.28, 1.1);
  }

  function powerDown(t) {
    arc(t, t + 0.4, { seed: 61, level: 1, freq: 140, freqTo: 25, tone: 1500, toneTo: 180 });
    noise(t, 0.35, { type: 'lowpass', freq: 3000, sweepTo: 150, q: 1, gain: 0.2, release: 0.3 });
    sub(t + 0.05, 70, 30, 0.5, 0.35);
    crackle(t, t + 0.25, 0.5, 63, 0.7);
  }

  /* ---------- 타임라인 ---------- */
  function timeline(endT) {
    return [
      { at: 0.10, fn: (t) => { spark(t, 0.6); crackle(t, t + 0.15, 0.4, 2, 0.4); } },
      { at: 0.26, fn: (t) => crackle(t, t + 0.07, 0.9, 3, 0.6) },
      { at: 0.33, fn: (t) => {
        noise(t, 0.16, { freq: 600, sweepTo: 7000, q: 1.2, gain: 0.35, attack: 0.02, release: 0.05 });
        sub(t, 160, 50, 0.3, 0.35);
      } },
      { at: 0.40, fn: (t) => { spark(t, 1); arc(t, t + 0.37, { seed: 11, level: 1, freq: 120, tone: 1800 }); crackle(t, t + 0.4, 0.95, 12, 1); } },
      { at: 0.77, fn: (t) => impact(t) },
      { at: 1.00, fn: (t, from) => hum(t, t + Math.max(0.5, 9.97 - Math.max(1, from)), 0.09, 1.2, 0.05) },
      { at: 3.88, fn: (t) => shortCircuit(t, 0.2, 21, 0.8) },
      { at: 4.32, fn: (t) => shortCircuit(t, 0.3, 23, 1) },
      { at: 8.00, fn: (t) => shortCircuit(t, 0.3, 29, 0.9) },
      { at: 9.97, fn: (t) => chargeArc(t) },
      { at: 10.25, fn: (t) => crackle(t, t + 0.15, 0.6, 31, 0.6) },
      { at: 10.40, fn: (t) => { arc(t, t + 0.37, { seed: 37, level: 1, freq: 110, tone: 2000 }); crackle(t, t + 0.37, 1, 38, 1); } },
      { at: 10.77, fn: (t) => powerDown(t) },
      { at: 11.00, fn: (t, from) => {
        const len = Math.max(0.8, endT - Math.max(11, from));
        hum(t, t + len, 0.05, 0.5, Math.min(1.5, len * 0.4));
        crackle(t + 0.4, t + len - 0.3, 0.04, 71, 0.35);   // 가끔 튀는 정전기
      } },
    ];
  }

  /**
   * 인트로 시간 fromT 부터 효과음을 예약한다.
   * @param {number} fromT 지금 인트로가 몇 초 지점인지
   * @param {number} endT 인트로가 끝나는 시점 (앰비언스 길이)
   */
  function play(fromT = 0, endT = 19) {
    if (!ctx || ctx.state !== 'running') return false;
    stop();
    session = ctx.createGain();
    session.gain.value = 1;
    session.connect(comp);
    const base = ctx.currentTime + 0.03 - fromT;   // 인트로 0초에 해당하는 오디오 시각
    for (const ev of timeline(endT)) {
      const continuous = ev.at === 1.0 || ev.at === 11.0;
      if (!continuous && ev.at < fromT - 0.02) continue;
      // 험/앰비언스는 중간에 들어와도 지금부터 이어서 재생
      if ((ev.at === 1.0 && fromT >= 9.9) || (ev.at === 11.0 && fromT > endT - 0.5)) continue;
      ev.fn(base + Math.max(ev.at, fromT), fromT);
    }
    return true;
  }

  function stop() {
    if (!session) return;
    const s = session;
    session = null;
    const now = ctx.currentTime;
    s.gain.setValueAtTime(s.gain.value, now);
    s.gain.linearRampToValueAtTime(0, now + 0.06);
    setTimeout(() => s.disconnect(), 120);
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
    get running() { return !!ctx && ctx.state === 'running'; },
    get muted() { return muted; },
  };
})();
