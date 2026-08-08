/**
 * The press room's voice.
 *
 * Eleven cues and a bed, synthesised. No files, no dependency, no CDN — the same
 * reason `press/` is plain CSS. The client ships to GitHub Pages and the whole
 * point of a sound design that weighs zero bytes is that the first connection of
 * the evening is already slow enough waking Render up; a sprite of samples would
 * be the largest asset in the build by an order of magnitude and would arrive
 * exactly when nobody wants to wait.
 *
 * The voices are a cheap two-colour press, because that is what the screen is: a
 * platen cycling, a slug of hot metal dropping into the galley, a brass rule laid
 * on the stone, the linotype's end-of-line bell, and a rubber stamp hitting paper
 * for the correction. A sampled library would be somebody else's idea of a
 * newsroom bolted onto ours, and it could not be retuned by changing a number.
 *
 * Three rules carry the implementation:
 *
 *   1. **Everything is scheduled on the AudioContext clock, never setTimeout.**
 *      The reveal fires a rule tick per card against the same server schedule the
 *      pixels play. setTimeout jitter under React render load is 20-50ms, which is
 *      audible against a card animating off its own delay.
 *   2. **A cue you cannot cancel is a bug.** Phases get cut short constantly here —
 *      everyone submits early, the host skips, the host's laptop sleeps and the
 *      room pauses. Every voice owns a group gain tracked in `live`, so `killAll()`
 *      silences a sequence already scheduled seconds deep.
 *   3. **Host device only.** Eight phones must not fight the television, and the
 *      one on hotel wifi is the one everybody hears. The phone's half of this is
 *      `haptics.js`.
 */

let ctx = null;
let master = null;    // every voice lands here
let noiseBuf = null;
let muted = false;

/**
 * Whether a gesture has ever armed the context.
 *
 * Not the same question as `ctx.state === 'running'`, and conflating the two costs
 * you cues. `resume()` is asynchronous: for tens of milliseconds after the click
 * that unlocks audio the state still reads `suspended`, and anything fired in that
 * window is silently dropped. The same gap reopens after every `visibilitychange`
 * resume — which on this client is a live path, because `socket.js` already treats
 * a returning tab as a first-class event. So playback gates on intent, not on
 * state: a context that is resuming honours what is scheduled against it, whereas
 * one that never had a gesture only accumulates nodes that never sound.
 */
let armed = false;

/**
 * Voices currently scheduled or sounding, bucketed by channel.
 *
 * Channels exist because the countdown has to be cancellable on its own: a room
 * resumed after the host's screen came back re-stamps the phase and reschedules
 * its countdown, and if that could only be done by killing everything it would
 * also kill the phase cue that just played.
 */
const live = new Map();

function bucket(channel) {
  let set = live.get(channel);
  if (!set) { set = new Set(); live.set(channel, set); }
  return set;
}

const clampF = (v) => Math.max(v, 1);
const clampG = (v) => Math.max(v, 0.0001);

export function audioReady() {
  return armed && !!ctx;
}

function ensure() {
  if (ctx) return ctx;
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;

  try {
    ctx = new AC();
  } catch {
    // Some embedded webviews expose the constructor and refuse to build one. There
    // is nothing to recover and nothing to tell the room — the game is complete
    // without sound, so this stays silent rather than throwing into a live round.
    return null;
  }

  // Eight rule ticks, a stamp and a bell can overlap inside 200ms at the reveal.
  // Without this the peak clips on a television's own speakers, which is the only
  // place this is ever actually played.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 12;
  comp.ratio.value = 6;
  comp.attack.value = 0.003;
  comp.release.value = 0.18;

  master = ctx.createGain();
  master.gain.value = 0.85;
  master.connect(comp).connect(ctx.destination);

  // One 2-second buffer of white noise, shared by every voice that needs it. Each
  // cue reads a filtered window of it; generating noise per cue would allocate a
  // buffer per reveal row.
  const frames = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;

  /* Every platform suspends the context out from under us and none of them resume
   * it: iOS on any audio interruption, Android Chrome when the tab backgrounds,
   * desktop when the laptop lid closes. A host that shut the laptop between rounds
   * would otherwise come back to a silent screen for the rest of the night with no
   * fix short of a reload. Registered here rather than in the hook so that a caller
   * cannot forget it. */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ctx.state === 'suspended') ctx.resume().catch(() => {});
  });

  return ctx;
}

/** Autoplay needs a gesture. Safe to call on every click; it no-ops once running. */
export function unlockAudio() {
  const c = ensure();
  if (!c) return;
  armed = true;
  if (c.state === 'suspended') c.resume().catch(() => {});
}

export function setMuted(next) {
  muted = next;
  if (muted) { killAll(); stopBed(); }
}

// ── synthesis primitives ─────────────────────────────────────────────────────

/** A group gain every voice hangs off, so the voice can be killed as one thing. */
function group(t, dur, channel) {
  const g = ctx.createGain();
  g.gain.value = 1;
  g.connect(master);

  const set = bucket(channel);
  const rec = { g };
  set.add(rec);
  rec.timer = setTimeout(() => {
    try { g.disconnect(); } catch { /* already torn down */ }
    set.delete(rec);
  }, Math.max((t - ctx.currentTime + dur) * 1000 + 250, 0));

  return g;
}

/** Hard-edged AD envelope. Exponential ramps cannot reach zero, hence clampG. */
function env(t, dur, peak, attack = 0.002) {
  const a = Math.min(attack, dur * 0.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(clampG(peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  return g;
}

function osc(bus, type, freq, t, dur, peak, { to, attack } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(clampF(freq), t);
  if (to) o.frequency.exponentialRampToValueAtTime(clampF(to), t + dur);
  o.connect(env(t, dur, peak, attack)).connect(bus);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(bus, t, dur, peak, { type = 'bandpass', freq = 2000, q = 1, to, attack } = {}) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(clampF(freq), t);
  if (to) f.frequency.exponentialRampToValueAtTime(clampF(to), t + dur);
  f.Q.value = q;
  s.connect(f).connect(env(t, dur, peak, attack)).connect(bus);
  s.start(t);
  s.stop(t + dur + 0.02);
}

/**
 * A struck bell — inharmonic partials over a common decay.
 *
 * The one thing a square wave genuinely cannot fake, and the reason it is worth
 * its own primitive: a bell's overtones are not integer multiples, which is
 * exactly what stops it reading as a beep. Both bells in this file are this
 * function with different ratios — the linotype's is bright and nearly pure, the
 * deadline's is fat and detuned.
 */
function struck(bus, t, dur, peak, freq, partials) {
  partials.forEach(([ratio, mix, decay = 1]) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = clampF(freq * ratio);
    o.connect(env(t, dur * decay, peak * mix, 0.001)).connect(bus);
    o.start(t);
    o.stop(t + dur * decay + 0.02);
  });
}

// ── the eleven ───────────────────────────────────────────────────────────────

export const VOICES = {
  /**
   * The platen cycling — a phase turning over. The page's punctuation.
   *
   * Woodier and heavier than an electrical relay, with a scrap of paper on top,
   * because the metaphor is a press and not a scoreboard.
   */
  platen: {
    dur: 0.16,
    render(t, bus, { level = 1 } = {}) {
      noise(bus, t, 0.030, 0.40 * level, { type: 'lowpass', freq: 900, to: 260 });
      osc(bus, 'square', 84, t, 0.090, 0.30 * level, { to: 52 });
      osc(bus, 'sine', 42, t + 0.004, 0.110, 0.22 * level);
      noise(bus, t + 0.018, 0.045, 0.09 * level, { type: 'highpass', freq: 3200 });
    },
  },

  /**
   * A slug of type dropping into the galley — one player's lie filed.
   *
   * Hot metal, so it rings very slightly. Fires once per submission and lands at
   * full weight on the last one, which on the shared screen is the moment the
   * room has been waiting for.
   */
  slug: {
    dur: 0.14,
    render(t, bus, { level = 1 } = {}) {
      noise(bus, t, 0.022, 0.28 * level, { freq: 1800, q: 2, to: 900 });
      osc(bus, 'square', 196, t, 0.070, 0.24 * level, { to: 120 });
      osc(bus, 'triangle', 660, t + 0.006, 0.055, 0.07 * level);
    },
  },

  /** A brass rule laid on the stone — one reveal card landing. Eight of these can
   *  fall inside a couple of seconds, so it is the smallest sound here. */
  rule: {
    dur: 0.04,
    render(t, bus, { level = 1 } = {}) {
      noise(bus, t, 0.012, 0.18 * level, { type: 'highpass', freq: 2800 });
      osc(bus, 'square', 900, t, 0.010, 0.04 * level);
    },
  },

  /** A pen tick — a vote landing. The rule's lighter, brighter sibling. */
  ballot: {
    dur: 0.03,
    render(t, bus, { level = 1 } = {}) {
      noise(bus, t, 0.014, 0.16 * level, { freq: 3600, q: 2.5 });
      osc(bus, 'square', 1320, t, 0.012, 0.05 * level);
    },
  },

  /**
   * Paper riffled — the ballot going up.
   *
   * A swept band with four bursts inside it rather than one clean sweep: a riffle
   * is a sequence of sheets, and the irregularity is the whole character. Fires
   * once a round, so the extra sources cost nothing worth counting.
   */
  riffle: {
    dur: 0.40,
    render(t, bus, { level = 1 } = {}) {
      noise(bus, t, 0.30, 0.11 * level, { freq: 700, q: 0.6, to: 5200, attack: 0.02 });
      [0.02, 0.09, 0.17, 0.24].forEach((at, i) => {
        noise(bus, t + at, 0.020, (0.07 + i * 0.012) * level, { type: 'highpass', freq: 2200 + i * 700 });
      });
    },
  },

  /**
   * The linotype's end-of-line bell — one per second of the last five.
   *
   * A bell rather than a beep on purpose: the last five seconds of a 25-second
   * vote are the most tense part of the round, and a square-wave beep there reads
   * as an alarm clock. The final second drops a fifth and rings twice as long.
   */
  bell: {
    dur: 0.30,
    render(t, bus, { level = 1, last = false } = {}) {
      const f = last ? 784 : 1046;
      const d = last ? 0.52 : 0.26;
      struck(bus, t, d, 0.26 * level, f, [[1, 1], [2.76, 0.34, 0.6], [5.4, 0.12, 0.35]]);
      noise(bus, t, 0.008, 0.07 * level, { type: 'highpass', freq: 5000 });
    },
  },

  /**
   * Deadline — the clock beat the room.
   *
   * A mechanical bell hammered rather than struck once: two detuned bells under a
   * fast tremolo, which is what the amplitude modulation is doing. Harsh enough
   * to be unmistakably different from the countdown's own bell.
   */
  deadline: {
    dur: 1.0,
    render(t, bus, { level = 1 } = {}) {
      const dur = 0.9;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(clampG(0.30 * level), t + 0.010);
      g.gain.setValueAtTime(clampG(0.30 * level), t + dur - 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g.connect(bus);

      // The hammer bouncing on the gong, ~22 times a second.
      const trem = ctx.createGain();
      trem.gain.value = 0.55;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 22;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.45;
      lfo.connect(lfoGain).connect(trem.gain);
      lfo.start(t);
      lfo.stop(t + dur + 0.02);
      trem.connect(g);

      [[466, 1], [622, 0.5]].forEach(([f, mix]) => {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.setValueAtTime(f, t);
        o.frequency.setValueAtTime(f, t + dur - 0.26);
        o.frequency.exponentialRampToValueAtTime(f * 0.88, t + dur);
        const og = ctx.createGain();
        og.gain.value = mix;
        o.connect(og).connect(trem);
        o.start(t);
        o.stop(t + dur + 0.02);
      });
    },
  },

  /**
   * The press coming up to speed — the last seconds of a timed phase.
   *
   * Long, low and meant to be felt rather than heard. It is the only cue that is
   * doing tension rather than punctuation, and the only one anybody would notice
   * the absence of.
   */
  rollRise: {
    dur: 8,
    render(t, bus, { level = 1, dur = 8 } = {}) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(clampG(0.15 * level), t + dur * 0.85);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g.connect(bus);

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(120, t);
      lp.frequency.exponentialRampToValueAtTime(820, t + dur);
      lp.Q.value = 3;
      lp.connect(g);

      [[46, 1], [46.6, 0.8], [92, 0.35]].forEach(([f, mix]) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * 1.5, t + dur);
        const og = ctx.createGain();
        og.gain.value = mix;
        o.connect(og).connect(lp);
        o.start(t);
        o.stop(t + dur + 0.05);
      });
    },
  },

  /**
   * The correction stamp hitting paper — the truth card.
   *
   * The payoff of the whole round and the biggest sound in the file. Everything
   * else here is punctuation; this is the sentence. It is an impact with a swell
   * under it rather than a fanfare, because the screen does not break frame
   * either — the truth is *printed*, in the same two colours as everything else.
   */
  stamp: {
    dur: 1.1,
    render(t, bus, { level = 1 } = {}) {
      noise(bus, t, 0.035, 0.45 * level, { type: 'lowpass', freq: 1400, to: 400 });
      noise(bus, t + 0.006, 0.060, 0.14 * level, { type: 'highpass', freq: 2600 });
      osc(bus, 'square', 150, t, 0.100, 0.34 * level, { to: 70 });
      osc(bus, 'sine', 60, t, 0.170, 0.30 * level, { to: 40 });

      // The ink spreading. A fifth, held, well under the impact.
      osc(bus, 'square', 196, t + 0.03, 0.80, 0.10 * level, { attack: 0.03 });
      osc(bus, 'square', 294, t + 0.03, 0.75, 0.07 * level, { attack: 0.04 });
      osc(bus, 'sine', 392, t + 0.06, 0.62, 0.05 * level, { attack: 0.05 });
    },
  },

  /**
   * Nobody found it. The stamp's opposite, used where the stamp would have gone.
   *
   * A round where every player voted for a lie is a genuinely good outcome for
   * whoever wrote them, but the truth card still lands on a room that got it
   * wrong, and a triumphant sound there reads as the screen mocking the table.
   */
  sigh: {
    dur: 0.75,
    render(t, bus, { level = 1 } = {}) {
      osc(bus, 'square', 233, t, 0.62, 0.17 * level, { to: 110 });
      osc(bus, 'square', 175, t + 0.06, 0.56, 0.11 * level, { to: 82 });
      noise(bus, t, 0.05, 0.12 * level, { type: 'lowpass', freq: 800 });
    },
  },

  /** The final edition going out — game over. Four notes up, the bell on the last. */
  finalEdition: {
    dur: 1.6,
    render(t, bus, { level = 1 } = {}) {
      [[294, 0], [392, 0.13], [494, 0.26], [587, 0.39]].forEach(([f, at], i) => {
        const d = i === 3 ? 0.80 : 0.16;
        osc(bus, 'square', f, t + at, d, 0.19 * level);
        osc(bus, 'square', f * 2, t + at, d, 0.055 * level);
      });
      struck(bus, t + 0.39, 0.9, 0.22 * level, 1175, [[1, 1], [2.76, 0.30, 0.6], [5.4, 0.10, 0.35]]);
      noise(bus, t + 0.39, 0.55, 0.10 * level, { freq: 3000, q: 0.5, to: 1200 });
    },
  },
};

// ── playback ─────────────────────────────────────────────────────────────────

/** Schedule a voice at an absolute AudioContext time. */
export function voiceAt(name, when, opts, channel = 'fx') {
  if (muted || !armed) return;
  const c = ensure();
  if (!c) return;
  const v = VOICES[name];
  if (!v) return;
  const t = Math.max(when, c.currentTime);
  v.render(t, group(t, v.dur, channel), opts);
}

/** Play now. A hair of lookahead so the envelope's first ramp is not truncated. */
export function cue(name, opts, channel) {
  const c = ensure();
  if (!c) return;
  voiceAt(name, c.currentTime + 0.005, opts, channel);
}

/**
 * Schedule a whole sequence against a shared origin.
 *
 * `elapsedMs` is how far into the sequence we already are, which for the reveal is
 * `serverNow() - startedAt` — the same number `useRevealBeat` asks the clock for.
 * Entries already in the past are dropped rather than fired late, so a shared
 * screen that reconnects eight seconds into a reveal does not replay the cards it
 * has already drawn.
 *
 * The whole sequence goes to Web Audio in one pass, so every offset is measured
 * against the audio clock. Chaining these off timers instead would put scheduler
 * jitter between beats that the pixels are hitting exactly.
 */
export function sequence(entries, elapsed = 0, channel = 'fx', grace = 0) {
  if (muted || !armed) return;
  const c = ensure();
  if (!c) return;
  const base = c.currentTime - elapsed / 1000;
  entries.forEach((e) => {
    /* `grace` is the difference between "we only just got this frame" and "we
     * rejoined a sequence already in progress", and without it the reveal loses
     * the beat it opens on every single time. That beat sits at offset 0, but
     * `elapsed` is never 0 by the time it is read: the frame has crossed a socket
     * and React has rendered, which on a good link is 20-100ms and on a phone that
     * just woke up is more. A strict `at < elapsed` reads that as history.
     *
     * Anything inside the grace is still scheduled, and `voiceAt` clamps it to the
     * current time — a beat played 60ms late against pixels that were also 60ms
     * late is in step. Anything genuinely behind us is dropped rather than fired
     * in a rush, which is what keeps a mid-reveal reconnect from re-stamping a
     * truth the screen printed eight seconds ago. */
    if (e.at < elapsed - grace) return;
    voiceAt(e.name, base + e.at / 1000, e.opts, channel);
  });
}

function silence(set) {
  const t = ctx.currentTime;
  set.forEach((rec) => {
    clearTimeout(rec.timer);
    try {
      rec.g.gain.cancelScheduledValues(t);
      // A scheduled-but-unstarted group reads 1; a sounding one reads its ramp.
      // Both want the same 30ms tail — zeroing instantly clicks on TV speakers.
      rec.g.gain.setValueAtTime(Math.max(rec.g.gain.value, 0.0001), t);
      rec.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      setTimeout(() => { try { rec.g.disconnect(); } catch { /* gone */ } }, 80);
    } catch { /* already disconnected */ }
  });
  set.clear();
}

/** Silence one channel. Used where killing the rest would be collateral damage. */
export function kill(channel) {
  if (!ctx) return;
  const set = live.get(channel);
  if (set) silence(set);
}

/**
 * Silence every scheduled or sounding voice. A phase can always be cut short.
 *
 * Deliberately leaves the bed running: this runs on every phase change, and a
 * 350ms fade out into a 1.2s fade in five times a round would pump audibly under
 * the whole game. The bed is switched by `setBed`, which is a slower decision.
 */
export function killAll() {
  if (!ctx) return;
  live.forEach(silence);
}

// ── the bed ──────────────────────────────────────────────────────────────────

/**
 * The press room, idling — machinery switched on and left on.
 *
 * Persistent rather than a one-shot, because its job is the absence you notice
 * when it stops. It drops for the reveal, so the corrections land in a room that
 * has just gone quiet, and for game over, so the final edition rings on silence.
 */
let bed = null;

export function startBed() {
  if (muted || !armed || bed) return;
  const c = ensure();
  if (!c) return;

  const t = c.currentTime;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05, t + 1.2);
  g.connect(master);

  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 190;
  lp.Q.value = 1.2;
  lp.connect(g);

  // A slow drift on the cutoff so it breathes instead of sitting there as a tone.
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.09;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 38;
  lfo.connect(lfoGain).connect(lp.frequency);
  lfo.start(t);

  const oscs = [[46, 1], [46.4, 0.9], [92, 0.3]].map(([f, mix]) => {
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    const og = c.createGain();
    og.gain.value = mix;
    o.connect(og).connect(lp);
    o.start(t);
    return o;
  });

  bed = { g, oscs: [...oscs, lfo] };
}

export function stopBed() {
  if (!bed || !ctx) return;
  const { g, oscs } = bed;
  bed = null;
  const t = ctx.currentTime;
  try {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  } catch { /* nothing to fade */ }
  oscs.forEach((o) => { try { o.stop(t + 0.4); } catch { /* already stopped */ } });
  setTimeout(() => { try { g.disconnect(); } catch { /* gone */ } }, 500);
}

export function setBed(on) {
  if (on) startBed();
  else stopBed();
}
