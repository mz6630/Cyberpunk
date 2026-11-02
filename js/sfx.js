/* =========================================================
   NIGHT CITY : JACK IN — Intro SFX
   인트로 연출 타이밍에 맞춘 효과음을 Web Audio로 직접 합성합니다.
   (외부 음원 파일 없음 → 저작권 걱정 없음, 용량 0)

   0.10        상단 섬광 라인: 짧은 하이 틱 + 정전기
   0.33        가로 잔상: 노이즈 휩쓸림(whoosh) + 저음 낙하
   0.40–0.77   로고 형성: 빠르게 끊기는 디지털 글리치 소리
   0.77        로고 고정: 묵직한 임팩트(붐) + 금속성 히트
   1.0 –9.97   낮은 전기 험(drone)
   3.88/4.32/8.0  미세 글리치
   9.97        시안 플래시: 상승하는 전기 잽
  10.40–10.77  흩어짐: 글리치 스터터
  10.77        전원 차단: 피치가 떨어지는 파워다운
  11.0 –19.0   붉은 배경 앰비언스 → 페이드아웃

   사용: IntroSFX.unlock() (사용자 클릭 안에서)
         IntroSFX.play(fromT, endT) / IntroSFX.stop() / IntroSFX.setMuted(bool)
   ========================================================= */
(() => {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  let master = null;      // 음소거용
  let comp = null;
  let session = null;     // 이번 재생에 쓰는 노드 묶음 (건너뛰기 때 통째로 끊음)
  let noiseBuf = null;
  let muted = false;
  const VOLUME = 0.7;

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

  function init() {
    if (ctx || !AC) return !!ctx;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : VOLUME;
    comp.connect(master).connect(ctx.destination);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  // 반드시 클릭/키 입력 이벤트 안에서 호출해야 소리가 켜짐
  function unlock() {
    if (!init()) return Promise.resolve(false);
    return ctx.state === 'suspended' ? ctx.resume().then(() => true, () => false) : Promise.resolve(true);
  }

  /* ---------- 소리 재료 ---------- */
  function env(g, t, peak, attack, hold, release) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }

  function noise(t, dur, o = {}) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.freq || 2000, t);
    if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + dur);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    env(g, t, o.gain ?? 0.3, o.attack ?? 0.003, Math.max(0, dur - (o.attack ?? 0.003) - (o.release ?? 0.02)), o.release ?? 0.02);
    src.connect(f).connect(g).connect(session);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  function tone(t, dur, o = {}) {
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0 || 440, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + (o.glide || dur));
    let out = osc;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(o.lp, t);
      if (o.lpTo) f.frequency.exponentialRampToValueAtTime(o.lpTo, t + dur);
      out = out.connect(f);
    }
    const g = ctx.createGain();
    env(g, t, o.gain ?? 0.2, o.attack ?? 0.005, o.hold ?? 0, o.release ?? dur);
    out.connect(g).connect(session);
    osc.start(t);
    osc.stop(t + (o.attack ?? 0.005) + (o.hold ?? 0) + (o.release ?? dur) + 0.05);
  }

  // 디지털 글리치: 아주 짧은 노이즈 조각 + 사각파 블립이 불규칙하게 끊김
  function stutter(t0, t1, density, seed, level = 1) {
    const rng = seeded(seed);
    let t = t0;
    while (t < t1) {
      const len = 0.012 + rng() * 0.035;
      if (rng() < density) {
        if (rng() < 0.65) {
          noise(t, len, { freq: 700 + rng() * 6000, q: 2 + rng() * 8, gain: (0.12 + rng() * 0.2) * level, release: 0.008 });
        } else {
          const f = 180 * Math.pow(2, Math.floor(rng() * 5));
          tone(t, len, { type: 'square', f0: f, f1: f * (0.5 + rng()), gain: 0.05 * level, attack: 0.002, release: len, lp: 4000 });
        }
      }
      t += len + rng() * 0.03;
    }
  }

  function boom(t, level = 1) {
    tone(t, 1.4, { type: 'sine', f0: 95, f1: 34, glide: 0.5, gain: 0.85 * level, attack: 0.004, release: 1.4 });
    tone(t, 0.35, { type: 'triangle', f0: 190, f1: 60, glide: 0.2, gain: 0.25 * level, release: 0.35 });
    noise(t, 0.25, { type: 'lowpass', freq: 900, sweepTo: 120, q: 0.7, gain: 0.45 * level, release: 0.2 });
    // 금속성 히트
    noise(t, 0.6, { freq: 3200, q: 14, gain: 0.12 * level, attack: 0.002, release: 0.55 });
  }

  function drone(t0, t1, level, fadeIn = 0.6, fadeOut = 0.4) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(level, t0 + fadeIn);
    g.gain.setValueAtTime(level, Math.max(t0 + fadeIn, t1 - fadeOut));
    g.gain.exponentialRampToValueAtTime(0.0001, t1);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 260;
    f.Q.value = 3;
    // 느린 흔들림
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.frequency.value = 0.35;
    lfoG.gain.value = 70;
    lfo.connect(lfoG).connect(f.frequency);
    f.connect(g).connect(session);
    [55, 55.6, 110.3].forEach((hz, i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'square' : 'sawtooth';
      o.frequency.value = hz;
      const og = ctx.createGain();
      og.gain.value = i === 2 ? 0.12 : 0.5;
      o.connect(og).connect(f);
      o.start(t0); o.stop(t1 + 0.05);
    });
    lfo.start(t0); lfo.stop(t1 + 0.05);
  }

  function zap(t) {
    tone(t, 0.28, { type: 'sawtooth', f0: 220, f1: 2600, glide: 0.24, gain: 0.12, attack: 0.01, hold: 0.12, release: 0.14, lp: 5000 });
    tone(t, 0.3, { type: 'sine', f0: 880, f1: 3520, glide: 0.26, gain: 0.1, attack: 0.01, release: 0.3 });
    noise(t, 0.3, { freq: 2500, sweepTo: 8000, q: 3, gain: 0.22, attack: 0.02, release: 0.12 });
    // 전기 지글거림
    stutter(t + 0.05, t + 0.28, 0.9, 99, 0.6);
  }

  function powerDown(t) {
    tone(t, 0.45, { type: 'sawtooth', f0: 330, f1: 28, glide: 0.4, gain: 0.22, attack: 0.005, release: 0.45, lp: 2400, lpTo: 120 });
    noise(t, 0.35, { type: 'lowpass', freq: 3000, sweepTo: 150, q: 1, gain: 0.2, release: 0.3 });
    tone(t + 0.15, 0.1, { type: 'square', f0: 60, gain: 0.08, release: 0.1, lp: 400 });
  }

  /* ---------- 타임라인 ---------- */
  // at: 인트로 시간(초). fn이 이 시점 이전이면 건너뛰기 후 재생 시 생략
  function timeline(endT) {
    return [
      { at: 0.10, fn: (t) => { tone(t, 0.06, { type: 'square', f0: 2400, gain: 0.04, release: 0.06, lp: 6000 }); noise(t, 0.2, { freq: 5000, q: 1, gain: 0.04 }); } },
      { at: 0.26, fn: (t) => stutter(t, t + 0.07, 0.8, 3, 0.5) },
      { at: 0.33, fn: (t) => {
        noise(t, 0.16, { freq: 600, sweepTo: 7000, q: 1.2, gain: 0.35, attack: 0.02, release: 0.05 });
        tone(t, 0.3, { type: 'sine', f0: 160, f1: 50, gain: 0.35, release: 0.3 });
      } },
      { at: 0.40, fn: (t) => noise(t, 0.08, { freq: 7000, q: 0.8, gain: 0.25, release: 0.04 }) },
      { at: 0.40, fn: (t) => stutter(t, t + 0.37, 0.95, 11, 1) },
      { at: 0.77, fn: (t) => boom(t) },
      { at: 0.80, fn: (t) => stutter(t, t + 0.6, 0.35, 17, 0.5) },
      { at: 1.00, fn: (t, from) => drone(t, Math.max(t + 0.5, t + (9.97 - Math.max(1, from))), 0.07, 1.2, 0.05) },
      { at: 3.88, fn: (t) => stutter(t, t + 0.2, 0.75, 21, 0.85) },
      { at: 4.32, fn: (t) => stutter(t, t + 0.3, 0.85, 23, 1) },
      { at: 8.00, fn: (t) => stutter(t, t + 0.3, 0.8, 29, 0.95) },
      { at: 9.97, fn: (t) => zap(t) },
      { at: 10.25, fn: (t) => stutter(t, t + 0.15, 0.5, 31, 0.4) },
      { at: 10.40, fn: (t) => stutter(t, t + 0.37, 1, 37, 0.9) },
      { at: 10.77, fn: (t) => powerDown(t) },
      { at: 11.00, fn: (t, from) => {
        const len = Math.max(0.8, endT - Math.max(11, from));
        drone(t, t + len, 0.045, 0.5, Math.min(1.5, len * 0.4));
        noise(t, len, { type: 'bandpass', freq: 1800, q: 0.5, gain: 0.012, attack: 0.5, release: Math.min(1.5, len * 0.4) });
      } },
    ];
  }

  /**
   * 인트로 시간 fromT 부터 효과음을 예약한다.
   * @param {number} fromT 지금 인트로가 몇 초 지점인지
   * @param {number} endT 인트로가 끝나는 시점 (앰비언스 길이)
   */
  function play(fromT = 0, endT = 19) {
    if (!ctx || ctx.state !== 'running') return;
    stop();
    session = ctx.createGain();
    session.gain.value = 1;
    session.connect(comp);
    const base = ctx.currentTime + 0.03 - fromT;   // 인트로 0초에 해당하는 오디오 시각
    for (const ev of timeline(endT)) {
      if (ev.at < fromT - 0.02 && ev.at !== 1.0 && ev.at !== 11.0) continue;
      // 드론/앰비언스는 중간에 들어와도 지금부터 이어서 재생
      if ((ev.at === 1.0 && fromT >= 9.9) || (ev.at === 11.0 && fromT > endT)) continue;
      const at = Math.max(ev.at, fromT);
      ev.fn(base + at, fromT);
    }
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
    play,
    stop,
    setMuted,
    get muted() { return muted; },
  };
})();
