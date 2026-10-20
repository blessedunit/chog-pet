// Tiny 8-bit sound: square and triangle bleeps from WebAudio, no files. Muted state is remembered per browser
// (sound is ON by default). Browsers only let audio start inside a real tap/click/key, so every gesture until the
// context is running tries to start it; all bleeps go through one master gain + a soft limiter so they're clear
// but never harsh.
let ac = null;
let out = null; // master gain -> compressor -> speakers
let muted = false;
try {
  muted = localStorage.getItem("pet.mute") === "1";
} catch {}
const MASTER = 0.9;

function ctx() {
  if (!ac) {
    const A = window.AudioContext || window.webkitAudioContext;
    if (!A) return null;
    // iOS: play through the ringer switch like a game would (Safari 16.4+), the user turned sound on
    try {
      if (navigator.audioSession) navigator.audioSession.type = "playback";
    } catch {}
    try {
      ac = new A();
    } catch {
      return null;
    }
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 6;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    out = ac.createGain();
    out.gain.value = MASTER;
    out.connect(comp).connect(ac.destination);
  }
  if (ac.state !== "running") ac.resume().catch(() => {});
  return ac;
}

function tone(freq, dur, { type = "square", vol = 0.12, at = 0, to = null } = {}) {
  if (muted) return;
  const a = ctx();
  if (!a || a.state === "closed") return;
  const t = a.currentTime + 0.005 + at;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  // a 4 ms attack and an exponential tail: no clicks at either end
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.03, dur));
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.03);
}
const seq = (notes, step = 0.08, opt = {}) => notes.forEach((f, i) => f && tone(f, step * 0.95, { ...opt, at: i * step }));

export const sfx = {
  get muted() {
    return muted;
  },
  setMuted(v) {
    muted = !!v;
    try {
      localStorage.setItem("pet.mute", muted ? "1" : "0");
    } catch {}
  },
  get state() {
    return ac ? ac.state : "none";
  },
  unlock() {
    if (!muted) ctx();
  },
  click: () => tone(1046, 0.05, { vol: 0.07 }),
  move: () => tone(784, 0.04, { vol: 0.06 }),
  eat: () => seq([392, 0, 392, 0, 523], 0.07, { vol: 0.1 }),
  fav: () => seq([523, 659, 784, 1047], 0.075, { vol: 0.1 }),
  yuck: () => tone(240, 0.3, { type: "sawtooth", vol: 0.07, to: 120 }),
  happy: () => seq([659, 784, 988], 0.075, { vol: 0.1 }),
  sad: () => seq([392, 330, 262], 0.12, { type: "triangle", vol: 0.2 }),
  no: () => seq([233, 0, 233], 0.06, { vol: 0.08 }),
  love: () => seq([784, 1047, 1318], 0.065, { type: "triangle", vol: 0.22 }),
  clean: () => {
    for (let i = 0; i < 8; i++) tone(1000 + Math.random() * 600, 0.05, { type: "triangle", vol: 0.16, at: i * 0.06 });
  },
  sleep: () => seq([523, 392, 330, 262], 0.14, { type: "triangle", vol: 0.2 }),
  wake: () => seq([262, 392, 523, 784], 0.08, { type: "triangle", vol: 0.2 }),
  grumpy: () => tone(170, 0.25, { type: "sawtooth", vol: 0.08, to: 95 }),
  treat: () => seq([784, 988, 1175, 1568, 1175, 1568], 0.06, { vol: 0.09 }),
  tick: () => tone(523, 0.07, { vol: 0.09 }),
  go: () => tone(1046, 0.18, { vol: 0.1 }),
  catch: () => tone(988, 0.06, { vol: 0.08, to: 1318 }),
  coin: () => seq([988, 1318], 0.055, { vol: 0.09 }),
  hurt: () => tone(190, 0.18, { type: "sawtooth", vol: 0.09, to: 85 }),
  over: () => seq([523, 392, 523, 659, 784], 0.09, { vol: 0.1 }),
  record: () => seq([523, 659, 784, 1047, 784, 1047, 1318], 0.07, { vol: 0.1 }),
  door: () => seq([196, 247, 294, 392], 0.12, { type: "triangle", vol: 0.22 }),
  on: () => seq([659, 988], 0.07, { vol: 0.09 }),
};

// every real gesture tries to start audio until it runs (touch only counts on pointerup/click on phones)
const kick = () => {
  if (muted) return;
  ctx();
  if (ac && ac.state === "running") for (const ev of EVS) removeEventListener(ev, kick, true);
};
const EVS = ["pointerdown", "pointerup", "click", "keydown", "touchend"];
for (const ev of EVS) addEventListener(ev, kick, { capture: true, passive: true });
// a tab that comes back may have its audio suspended by the OS
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && ac && ac.state !== "running" && ac.state !== "closed") ac.resume().catch(() => {});
});
