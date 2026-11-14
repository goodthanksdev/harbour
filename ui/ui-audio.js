// UI sounds. Soft synthesized blips by default, no files needed.
// To use your own: put move / tab / select / open / back / launch / error (.wav, .ogg or .mp3)
// in ui\sounds\ and that sound replaces the built-in one.
'use strict';
const UISound = (() => {
  let enabled = true, volume = .25, ctx = null, master = null, voices = 0;
  const last = {};
  // [frequency, duration, start offset, loudness]
  const cues = {
    move:   [[620, .035, 0, .10], [920, .024, .01, .025]],
    tab:    [[420, .08, 0, .10], [630, .11, .045, .075]],
    select: [[660, .08, 0, .09], [880, .09, .045, .06]],
    open:   [[330, .12, 0, .08], [495, .13, .05, .055]],
    back:   [[480, .07, 0, .08], [340, .09, .035, .05]],
    launch: [[440, .12, 0, .08], [660, .14, .08, .07], [880, .20, .17, .05]],
    error:  [[220, .14, 0, .09], [180, .16, .08, .07]],
  };
  const files = {}; // cue -> HTMLAudioElement, only for files that loaded
  for (const name of Object.keys(cues)) for (const ext of ['wav', 'ogg', 'mp3']) {
    const a = new Audio(); a.preload = 'auto';
    a.addEventListener('canplaythrough', () => { if (!files[name]) files[name] = a; }, { once: true });
    a.addEventListener('error', () => {}, { once: true });
    a.src = `sounds/${name}.${ext}`;
  }
  function engine() {
    if (!ctx) { ctx = new AudioContext(); master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination); }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  function play(name) {
    if (!enabled || !cues[name] || voices > 14) return;
    const now = performance.now();
    if (now - (last[name] ?? -1e9) < (name === 'move' ? 55 : 90)) return; // fast scrolling doesn't machine-gun
    last[name] = now;
    // A little random pitch each time so repeated sounds (scrolling) don't sound robotic.
    // Moving varies most (about ±5%), launch/error barely, so they stay recognisable.
    const spread = { move: .05, tab: .035, select: .025, open: .025, back: .025, launch: .012, error: .012 }[name];
    const pitch = 1 + (Math.random() * 2 - 1) * spread;
    if (files[name]) { const a = files[name].cloneNode(); a.volume = Math.min(1, volume * 2); a.preservesPitch = false; a.playbackRate = pitch; a.play().catch(() => {}); return; }
    try {
      const c = engine(), t = c.currentTime + .004;
      for (const [baseFreq, dur, off, gain] of cues[name]) {
        const freq = baseFreq * pitch;
        const tone = c.createOscillator(), env = c.createGain();
        tone.type = name === 'move' ? 'sine' : 'triangle';
        tone.frequency.setValueAtTime(freq, t + off);
        tone.frequency.exponentialRampToValueAtTime(freq * .8, t + off + dur);
        env.gain.setValueAtTime(.0001, t + off);
        env.gain.exponentialRampToValueAtTime(gain, t + off + .004);
        env.gain.exponentialRampToValueAtTime(.0001, t + off + dur);
        tone.connect(env); env.connect(master); voices++;
        tone.onended = () => { voices--; tone.disconnect(); env.disconnect(); };
        tone.start(t + off); tone.stop(t + off + dur + .01);
      }
    } catch {}
  }
  // Nothing plays (and the audio device is let go) while Harbour is frozen.
  function suspend(on) { if (ctx) (on ? ctx.suspend() : ctx.resume()).catch(() => {}); }
  function configure(o = {}) { if (typeof o.enabled === 'boolean') enabled = o.enabled; if (Number.isFinite(o.volume)) volume = o.volume; if (master) master.gain.value = volume; }
  return { play, suspend, configure };
})();
