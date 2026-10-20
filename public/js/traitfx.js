// Chog Pet trait FX: every Chog gets a small ambient signature read from its NFT traits.
//   Aura      -> particles behind the portrait (embers, bubbles, smoke, wind, sparks, petals, motes, frost, glints)
//   Eyes      -> laser Chogs fire their beams past the frame now and then; visors and glasses catch a shine
//   Mouth     -> Rainbow Puke shows a rainbow when happy and spews one when overfed; Drooling drips; Degens flip a coin
//   Form/Base -> Skulls glow faintly at night, Radioactive glows all the time
//   Accessory -> a Fwog/PEPE buddy hops by, candles flicker on the floor, Heart floats hearts
//   Head      -> crowns glint, wizards leak tiny stars, Thunder Caps crackle
// Everything behind the card is drawn on the 4x art canvas in LCD-pixel blocks; the few front effects stay at
// the edges or are over in a blink, so the face is never hidden. Unknown traits get nothing.
// No allocations per frame: particles live in a fixed pool, colours are precomputed strings.

const HI = 4;
const N = 40;
const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// aura value -> effect kind
const AURA = {
  "Burning Aura": "fire", "Fiery Aura": "fire", Fire: "fire",
  "Aqua Aura": "aqua",
  Smoke: "smoke",
  Wind: "wind",
  "Electric Shock": "electric",
  "Rose Aura": "rose", "Rose Scent": "rose", "Pink Mist": "rose",
  Purple: "violet", "Light Purple": "violet", Violet: "violet", "Royal Aura": "royal", "Royal Blue Aura": "royal", "Royal Blue": "royal",
  Mint: "mint", "Green Aura": "mint",
  Clean: "clean",
  "Cool Aura": "cool",
  "Yellow Aura": "gold", "White Aura": "white",
};
// glow colour behind the card, per kind
const HALO = {
  fire: [255, 150, 60], aqua: [133, 230, 255], smoke: [221, 215, 254], wind: [221, 215, 254], electric: [133, 230, 255],
  rose: [255, 142, 228], violet: [110, 84, 255], royal: [110, 120, 255], mint: [143, 240, 200], clean: [255, 255, 255],
  cool: [133, 230, 255], gold: [255, 216, 77], white: [255, 255, 255], skull: [221, 215, 254], radio: [182, 255, 110],
};
// spawn interval in frames (12 fps) and the cap of live particles for each kind
const RATE = { fire: [1, 22], aqua: [7, 7], smoke: [4, 10], wind: [9, 5], electric: [30, 2], rose: [8, 6], violet: [6, 8], royal: [6, 8], mint: [7, 7], clean: [14, 3], cool: [7, 8], gold: [7, 7], white: [8, 6] };

const LASERS = { "fire laser": "fire", "Purple laser": "purple", "Green laser": "green", "cyan laser": "cyan" };
const GLASS = /visor|VR|Glass/;

// alpha ramps as ready-made colour strings, so drawing never builds strings per frame
function ramp(rgb, n = 6, top = 1) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${((top * (n - i)) / n).toFixed(3)})`);
  return out;
}
const EMBER = [ramp([255, 216, 77]), ramp([255, 174, 69]), ramp([255, 142, 228])];
const AQUA = ramp([133, 230, 255]);
const SMOKE = ramp([236, 232, 255], 6, 0.8);
const WIND = ramp([221, 215, 254], 6, 0.55);
const PETAL = ramp([255, 142, 228]);
const PETAL2 = ramp([255, 214, 244]);
const VIOLET = ramp([168, 148, 255]);
const LAV = ramp([221, 215, 254]);
const ROYAL = ramp([133, 190, 255]);
const MINT = ramp([143, 240, 200]);
const WHITE = ramp([255, 255, 255]);
const GOLD = ramp([255, 216, 77]);
const CYAN = ramp([133, 230, 255]);
const RAINBOW = ["#ff8ee4", "#ffae45", "#ffd84d", "#8ff0c8", "#85e6ff", "#6e54ff"];

function hue(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return [0, 0, mx];
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, d / mx, mx];
}
const LASER_TEST = {
  fire: (h, s, v) => s > 0.45 && v > 170 && (h < 52 || h > 345),
  purple: (h, s, v) => s > 0.35 && v > 140 && h > 255 && h < 330,
  green: (h, s, v) => s > 0.4 && v > 140 && h > 70 && h < 150,
  cyan: (h, s, v) => s > 0.35 && v > 150 && h > 170 && h < 215,
};

export class TraitFX {
  constructor(screen) {
    this.s = screen;
    this.still = still;
    this.pool = [];
    for (let i = 0; i < N; i++) this.pool.push({ on: false, k: "", x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 0, c: 0, ph: 0 });
    this.off();
  }

  off() {
    this.aura = null;
    this.halo = null;
    this.haloC = null;
    this.beams = [];
    this.laser = null;
    for (const p of this.pool) p.on = false;
  }

  /** Read the traits once per pet. `pg` is the 2d context of the portrait at card size, for finding laser beams. */
  setPet(p, pg, P) {
    this.off();
    const t = (p && p.traits) || {};
    this.p = p;
    this.P = P;
    this.aura = AURA[t.Aura] || null;
    this.skull = t.Form === "Skull" || t.Base === "Skull";
    this.radio = t.Base === "Radioactive";
    this.laser = LASERS[t.Eyes] || null;
    this.glass = !this.laser && GLASS.test(t.Eyes || "");
    this.rainbow = /Rainbow Puke/.test(t.Mouth || "");
    this.drool = t.Mouth === "Drooling";
    this.coin = /Gold Tooth|BTC Coin|Mon coin/.test(t.Mouth || "") || t.Accessory === "Coin";
    this.frog = t.Accessory === "Fwog" || t.Accessory === "PEPE";
    this.candle = t.Accessory === "Green Candle" ? "gcandle" : t.Accessory === "Red Candle" ? "rcandle" : null;
    this.hearts = t.Accessory === "Heart";
    this.crown = /Crown|Krown|wreath|Thorn/.test(t.Head || "");
    this.wizard = /Wizard/.test(t.Head || "");
    this.thunder = t.Head === "Thunder Cap";
    this.left = p && p.side === "left";
    if (this.laser && pg) this.beams = this._findBeams(pg, P);
    this.zap = null; // laser shot in progress
    this.shine = null; // glass shine in progress
    this.spew = null; // rainbow spew in progress
    this.drop = null; // drool drop in progress
    this.flip = null; // coin flip in progress
    this.frogAt = -1; // fwog walk start
    this.bolt = null; // thunder cap crackle
    this.rbow = 0; // rainbow arc fade 0..1
    this.nextZap = 50 + ((p.id * 37) % 60);
    this.nextShine = 70 + ((p.id * 13) % 50);
    this.nextDrop = 40 + ((p.id * 7) % 40);
    this.nextFlip = 90 + ((p.id * 11) % 60);
    this.nextFrog = 60 + ((p.id * 5) % 80);
    this.nextBolt = 80;
    this._haloFor = null;
  }

  // laser beams leave the art on the side the Chog faces: find where they cross the card edge and their slope
  _findBeams(pg, P) {
    const test = LASER_TEST[this.laser];
    let d;
    try {
      d = pg.getImageData(0, 0, P, P).data;
    } catch {
      return [];
    }
    const out = this.left ? 1 : -1; // beams go right for left-facing Chogs (they look at the viewer's right)
    const col = (x) => {
      const runs = [];
      let a = -1, hits = 0, sr = 0, sg = 0, sb = 0;
      for (let y = Math.floor(P * 0.2); y < P - 1; y++) {
        const i = (y * P + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
        const [h, s, v] = hue(r, g, b);
        const hit = test(h, s, v);
        const core = s < 0.22 && v > 225; // the white-hot middle of a beam
        if (hit || (core && a >= 0)) {
          if (a < 0) (a = y), (hits = 0), (sr = sg = sb = 0);
          if (hit) hits++, (sr += r), (sg += g), (sb += b);
        } else if (a >= 0) {
          const len = y - a;
          if (len >= 3 && len <= 16 && hits >= 2) runs.push({ y: a + len / 2, w: len, rgb: [sr / hits, sg / hits, sb / hits].map(Math.round) });
          a = -1;
        }
      }
      return runs;
    };
    const xe = this.left ? P - 2 : 1;
    const xi = this.left ? P - 12 : 11;
    const edge = col(xe), inner = col(xi);
    const beams = [];
    for (const e of edge) {
      let best = null;
      for (const q of inner) if (Math.abs(q.y - e.y) <= 9 && (!best || Math.abs(q.y - e.y) < Math.abs(best.y - e.y))) best = q;
      if (!best) continue;
      const dy = (e.y - best.y) / 10; // per pixel outward
      beams.push({ y: e.y / P, dy, w: Math.max(3, Math.min(5, Math.round(e.w * 0.6))), rgb: e.rgb, dir: out });
    }
    // the two edges of one thick beam can show up as two runs: keep beams at least 9 px apart
    const kept = [];
    for (const b of beams) if (!kept.some((k) => Math.abs(k.y - b.y) * P < 9)) kept.push(b);
    return kept.slice(0, 2);
  }

  _spawn(k, x, y, vx, vy, life, c = 0) {
    for (const p of this.pool) {
      if (p.on) continue;
      p.on = true; p.k = k; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.life = life; p.c = c; p.ph = Math.random() * 6.28;
      return p;
    }
    return null;
  }
  _count(k) {
    let n = 0;
    for (const p of this.pool) if (p.on && p.k === k) n++;
    return n;
  }

  // where ambient particles start: the side margins (rising) or the top band (falling)
  _side() {
    return Math.random() < 0.5 ? Math.random() * 12 : 116 + Math.random() * 12;
  }

  /** One 12 fps logic step. */
  step(f, ctx) {
    if (this.still || !this.p) return;
    const awake = !ctx.asleep;
    for (const p of this.pool) {
      if (!p.on) continue;
      p.t++;
      if (p.t >= p.life) { p.on = false; continue; }
      p.x += p.vx;
      p.y += p.vy;
      if (p.k === "bubble" || p.k === "petal" || p.k === "flake" || p.k === "puff") p.x += Math.sin(p.ph + p.t / 3) * 0.35;
      if (p.k === "ember") p.x += Math.sin(p.ph + p.t / 2) * 0.25;
    }
    const k = this.aura;
    if (k) {
      const [every, cap] = RATE[k];
      if (f % every === 0 && this._count(k) < cap) {
        const r = Math.random;
        switch (k) {
          case "fire": this._spawn(k, this._side(), 60 + r() * 64, (r() - 0.5) * 0.2, -(0.8 + r() * 0.7), 20 + r() * 18, Math.floor(r() * 3)); break;
          case "aqua": this._spawn(k, this._side(), 90 + r() * 36, 0, -(0.45 + r() * 0.35), 40 + r() * 20, r() < 0.3 ? 1 : 0); break;
          case "smoke": this._spawn(k, this._side(), 100 + r() * 24, (r() - 0.5) * 0.3, -(0.3 + r() * 0.2), 34 + r() * 16, 0); break;
          case "wind": {
            const dir = (this.p.id + Math.floor(f / 240)) % 2 ? 1 : -1;
            this._spawn(k, dir > 0 ? -8 : 136, 2 + r() * 118, dir * (2.2 + r() * 1.4), 0, 70, Math.floor(4 + r() * 5));
            break;
          }
          case "electric": this._spawn(k, this._side(), 40 + r() * 70, 0, 0, 4, Math.floor(r() * 1000)); break;
          case "rose": this._spawn(k, r() * 128, -2, (r() - 0.5) * 0.3, 0.3 + r() * 0.25, 60 + r() * 30, r() < 0.5 ? 1 : 0); break;
          case "cool": this._spawn(k, r() * 128, -2, (r() - 0.5) * 0.2, 0.28 + r() * 0.2, 70 + r() * 30, r() < 0.3 ? 1 : 0); break;
          case "clean": {
            // glints sit on the frame's corners and edges
            const e = Math.floor(r() * 4);
            const x = e === 0 ? 10 : e === 1 ? 117 : 14 + r() * 100, y = e < 2 ? 18 + r() * 96 : 12;
            this._spawn(k, x, y, 0, 0, 7, 0);
            break;
          }
          default: // violet, royal, mint, gold, white: slow twinkling motes
            this._spawn(k, r() < 0.8 ? this._side() : 14 + r() * 100, r() < 0.8 ? 30 + r() * 90 : 2 + r() * 10, (r() - 0.5) * 0.12, -(0.12 + r() * 0.15), 30 + r() * 26, Math.floor(r() * 2));
        }
      }
    }
    // radioactive: a few green motes
    if (this.radio && f % 10 === 0 && this._count("radio") < 4) this._spawn("radio", this._side(), 60 + Math.random() * 60, 0, -0.2, 36, 0);
    // wizard hats leak tiny stars over the top
    if (this.wizard && awake && f % 22 === 0 && this._count("star") < 2) this._spawn("star", 30 + Math.random() * 68, 13, (Math.random() - 0.5) * 0.3, -0.35, 26, 0);

    // timed one-shots
    const happy = ctx.mood === "happy";
    if (this.laser && this.beams.length && awake && !ctx.anim && f >= this.nextZap && ctx.mood !== "miserable") {
      this.zap = { at: f };
      this.nextZap = f + (happy ? 70 : 110) + Math.floor(Math.random() * 70);
    }
    if (this.zap && f - this.zap.at > 9) this.zap = null;
    if (this.glass && awake && f >= this.nextShine) {
      this.shine = { at: f };
      this.nextShine = f + 120 + Math.floor(Math.random() * 80);
    }
    if (this.shine && f - this.shine.at > 10) this.shine = null;
    if (this.drool && awake && !ctx.anim && f >= this.nextDrop) {
      this.drop = { at: f, y: 0 };
      this.nextDrop = f + 80 + Math.floor(Math.random() * 60);
    }
    if (this.coin && awake && !ctx.anim && f >= this.nextFlip) {
      this.flip = { at: f, x: this.left ? 120 : 4 };
      this.nextFlip = f + 170 + Math.floor(Math.random() * 120);
    }
    if (this.flip && f - this.flip.at > 22) this.flip = null;
    if (this.frog && f >= this.nextFrog && this.frogAt < 0 && awake) {
      this.frogAt = f;
      this.frogDir = Math.random() < 0.5 ? 1 : -1;
    }
    if (this.frogAt >= 0 && f - this.frogAt > 90) {
      this.frogAt = -1;
      this.nextFrog = f + 220 + Math.floor(Math.random() * 200);
    }
    if (this.thunder && awake && f >= this.nextBolt) {
      this.bolt = { at: f, x: 34 + Math.floor(Math.random() * 60) };
      this.nextBolt = f + 100 + Math.floor(Math.random() * 90);
    }
    if (this.bolt && f - this.bolt.at > 4) this.bolt = null;
    if (this.hearts && awake && f % 40 === 0) this.s.burst("heartS", 1, this.left ? 112 : 16, 70, 4);
    if (this.crown && awake && f % 52 === 26) this.s.fx.push({ spr: "sparkleS", x: 30 + Math.random() * 68, y: 16 + Math.random() * 10, vx: 0, vy: 0, life: 6, t: 0 });
    if (this.spew && f - this.spew.at > 26) this.spew = null;
    // rainbow arc fades in while happy
    const want = this.rainbow && happy && awake ? 1 : 0;
    this.rbow += (want - this.rbow) * 0.12;
  }

  /** An action came back from the pet (main.js "chogpet:act" or a local reaction). */
  event(code, f) {
    if (this.rainbow && (code === "full" || code === "yuck") && !this.still) this.spew = { at: f + 10 };
  }

  _haloCanvas(rgb) {
    const S = 128 * HI;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d");
    const P = this.P;
    const x = (128 - P) / 2, y = 128 - 9 - P;
    // only the blurred shadow of a slightly bigger card lands on the canvas (the shape itself is off to the side)
    const off = S * 2;
    g.shadowColor = `rgb(${rgb.join(",")})`;
    g.shadowBlur = 12 * HI;
    g.shadowOffsetX = off;
    g.fillStyle = "#000";
    g.beginPath();
    g.roundRect((x - 2) * HI - off, (y - 2) * HI, (P + 4) * HI, (P + 4) * HI, 9 * HI);
    g.fill();
    g.fill();
    return c;
  }

  /** Behind the card, on the art canvas: the glow and the rainbow. ox/oy follow the card's pose. */
  back(a, f, ctx, ox, oy) {
    if (!this.p) return;
    // which glow: the aura, or a skull's night glow, or radioactive
    let hk = this.aura;
    if (!hk && this.radio) hk = "radio";
    if (!hk && this.skull && (ctx.night || ctx.asleep)) hk = "skull";
    if (this.radio && !this.aura) hk = "radio";
    if (hk) {
      if (this._haloFor !== hk) (this.haloC = this._haloCanvas(HALO[hk])), (this._haloFor = hk);
      const base = hk === "skull" ? 0.75 : hk === "radio" ? 0.7 : hk === "smoke" || hk === "wind" ? 0.6 : 0.78;
      a.globalAlpha = this.still ? base : base + 0.2 * Math.sin(f / 9);
      a.drawImage(this.haloC, ox * HI, oy * HI);
      a.globalAlpha = 1;
    }
    // rainbow arc over the frame when a Rainbow Puke Chog is happy
    if (this.rbow > 0.03) {
      const cx = (64 + ox) * HI, cy = (70 + oy) * HI;
      a.lineWidth = HI;
      for (let i = 0; i < 6; i++) {
        a.strokeStyle = RAINBOW[i];
        a.globalAlpha = 0.85 * this.rbow;
        a.beginPath();
        a.arc(cx, cy, (66 - i) * HI, Math.PI * 1.06, Math.PI * 1.94);
        a.stroke();
      }
      a.globalAlpha = 1;
    }
  }

  /** In front of the frame but never over the art: ambient particles. Clip is set by the caller. */
  particles(a) {
    if (this.still || !this.p) return;
    for (const p of this.pool) {
      if (!p.on) continue;
      const age = Math.min(5, Math.floor((p.t / p.life) * 6));
      const X = Math.round(p.x) * HI, Y = Math.round(p.y) * HI;
      switch (p.k) {
        case "fire": {
          const stage = Math.min(2, Math.floor((p.t / p.life) * 3));
          a.fillStyle = EMBER[Math.min(2, stage + (p.c >> 1))][Math.min(5, Math.floor(age * 0.7))];
          a.fillRect(X, Y, HI, HI);
          if (p.t < 10) a.fillRect(X, Y + HI, HI, HI);
          if (p.t < 5 && p.c === 0) a.fillRect(X, Y + 2 * HI, HI, HI);
          break;
        }
        case "aqua": {
          a.fillStyle = AQUA[Math.max(0, age - 2)];
          const r = p.c ? 2 : 1;
          a.fillRect(X - r * HI + HI, Y - r * HI, (2 * r - 1) * HI, HI);
          a.fillRect(X - r * HI + HI, Y + r * HI, (2 * r - 1) * HI, HI);
          a.fillRect(X - r * HI, Y - r * HI + HI, HI, (2 * r - 1) * HI);
          a.fillRect(X + r * HI, Y - r * HI + HI, HI, (2 * r - 1) * HI);
          a.fillStyle = WHITE[2];
          a.fillRect(X, Y - (r - 1) * HI, HI, HI);
          break;
        }
        case "smoke": {
          const s = 2 + Math.floor((p.t / p.life) * 3);
          a.fillStyle = SMOKE[age];
          a.fillRect(X, Y, s * HI, (s - 1) * HI);
          a.fillRect(X + HI, Y - HI, (s - 2) * HI, HI);
          break;
        }
        case "wind": {
          a.fillStyle = WIND[Math.abs(3 - age)];
          a.fillRect(X, Y, p.c * HI, HI);
          a.fillRect(X + (p.vx > 0 ? p.c - 2 : 1) * HI, Y - HI, HI, HI);
          break;
        }
        case "electric": {
          a.fillStyle = p.t % 2 ? "#ffd84d" : "#85e6ff";
          let x = X, y = Y;
          for (let i = 0; i < 6; i++) {
            a.fillRect(x, y, HI, HI * 2);
            x += ((p.c >> i) & 1 ? 1 : -1) * HI;
            y += HI * 2;
          }
          break;
        }
        case "rose": {
          const flip = Math.floor(p.t / 6 + p.ph) % 2;
          a.fillStyle = (p.c ? PETAL2 : PETAL)[Math.max(0, age - 3)];
          a.fillRect(X, Y, (flip ? 2 : 1) * HI, (flip ? 1 : 2) * HI);
          break;
        }
        case "cool": {
          a.fillStyle = (p.c ? CYAN : LAV)[Math.max(0, age - 3)];
          a.fillRect(X, Y, HI, HI);
          if (p.c) a.fillRect(X - HI, Y, HI * 3, HI), a.fillRect(X, Y - HI, HI, HI * 3);
          break;
        }
        case "clean": case "star": {
          const s = p.t < 2 || p.t > p.life - 3 ? 0 : 1;
          a.fillStyle = p.k === "star" ? GOLD[Math.max(0, age - 2)] : WHITE[0];
          a.fillRect(X, Y, HI, HI);
          if (s) a.fillRect(X - HI, Y, HI * 3, HI), a.fillRect(X, Y - HI, HI, HI * 3);
          if (s && p.k === "clean" && p.t === 3) a.fillRect(X - 2 * HI, Y, HI * 5, HI), a.fillRect(X, Y - 2 * HI, HI, HI * 5);
          break;
        }
        case "radio": {
          a.fillStyle = MINT[age];
          a.fillRect(X, Y, HI, HI);
          break;
        }
        default: {
          // twinkling motes: a dot that flashes into a tiny plus now and then
          const ramp = p.k === "violet" ? (p.c ? LAV : VIOLET) : p.k === "royal" ? (p.c ? LAV : ROYAL) : p.k === "mint" ? MINT : p.k === "gold" ? GOLD : WHITE;
          const tw = Math.floor(p.t / 4 + p.ph) % 5 === 0;
          a.fillStyle = ramp[Math.max(0, age - 2)];
          a.fillRect(X, Y, HI, HI);
          if (tw) {
            a.fillStyle = ramp[Math.min(5, age + 1)];
            a.fillRect(X - HI, Y, HI, HI); a.fillRect(X + HI, Y, HI, HI); a.fillRect(X, Y - HI, HI, HI); a.fillRect(X, Y + HI, HI, HI);
          }
        }
      }
    }
  }

  /** On the card itself (inside its clip, art canvas): the glass shine. X..Hd are art-canvas units. */
  onCard(a, f, X, Y, Wd, Hd) {
    if (!this.shine) return;
    const t = f - this.shine.at;
    const k = t / 10;
    const cx = X - Wd * 0.4 + (Wd * 1.8) * k;
    a.save();
    a.globalAlpha = 0.22 * Math.sin(Math.PI * k);
    a.fillStyle = "#ffffff";
    a.beginPath();
    a.moveTo(cx, Y);
    a.lineTo(cx + 9 * HI, Y);
    a.lineTo(cx - 13 * HI, Y + Hd);
    a.lineTo(cx - 22 * HI, Y + Hd);
    a.closePath();
    a.fill();
    a.restore();
  }

  /** Front pixel layer (#scr): beams, spew, drips, coin, frog, candle, crackle. card = {x, y, w, h} in LCD px. */
  front(g, f, ctx, card, mouth) {
    if (!this.p) return;
    const asleep = ctx.asleep;
    // candle on the floor, on the side away from the face
    if (this.candle) {
      const x = this.left ? 119 : 2, y = 111;
      const lit = !this.still && f % 6 < 3;
      g.fillStyle = this.candle === "gcandle" ? "rgba(70,227,143,0.18)" : "rgba(255,79,94,0.18)";
      g.fillRect(x - 2, y - 2, 11, 13);
      drawSpr(g, this.candle, x, y + (lit ? 0 : 0));
      g.fillStyle = lit ? "#ffd84d" : "#ffae45";
      g.fillRect(x + 3, y - 2, 1, 2);
    }
    if (this.still) return;
    // laser: the beams shoot past the frame to the screen edge
    if (this.zap) {
      const t = f - this.zap.at;
      for (const b of this.beams) {
        const x0 = b.dir > 0 ? card.x + card.w : card.x;
        const y0 = card.y + b.y * card.h;
        const end = b.dir > 0 ? 128 : -1;
        const reach = t < 2 ? 0.35 + t * 0.3 : 1; // it shoots out over two frames
        const len = Math.abs(end - x0) * reach;
        const fade = t > 6;
        const [r, gg, bb] = b.rgb;
        g.fillStyle = `rgba(${r},${gg},${bb},${fade ? 0.45 : 0.95})`;
        for (let i = 0; i <= len; i++) {
          const x = Math.round(x0 + b.dir * i), y = Math.round(y0 + b.dy * i);
          g.fillRect(x, y - (b.w >> 1), 1, b.w);
        }
        if (!fade) {
          g.fillStyle = "#ffffff";
          for (let i = 0; i <= len; i++) g.fillRect(Math.round(x0 + b.dir * i), Math.round(y0 + b.dy * i), 1, 1);
        }
        if (t === 2 || t === 4) {
          const ex = b.dir > 0 ? 125 : 2, ey = y0 + b.dy * Math.abs(end - x0);
          if (ey > 4 && ey < 124) this.s.fx.push({ spr: "sparkleS", x: ex - 1, y: ey - 1, vx: -b.dir * 0.4, vy: -0.3, life: 5, t: 0 });
        }
      }
    }
    // rainbow spew out of the mouth, towards the side it faces, splashing on the floor
    if (this.spew && f >= this.spew.at) {
      const t = f - this.spew.at;
      const dir = this.left ? 1 : -1;
      const [mx, my] = mouth;
      const n = Math.min(40, t * 6);
      const gone = Math.max(0, (t - 16) * 6);
      for (let i = gone; i < n; i++) {
        const x = mx + dir * i * 0.9;
        const y = my + (i * i) / 42 + Math.sin((i + t * 2) / 3);
        if (y > 124) break;
        for (let c = 0; c < 6; c++) {
          g.fillStyle = RAINBOW[c];
          g.fillRect(Math.round(x), Math.round(y) - 3 + c, 1, 1);
        }
      }
    }
    // drool: a drop forms, falls, splashes
    if (this.drop && !asleep) {
      const t = f - this.drop.at;
      const [mx, my] = mouth;
      const x = mx + (this.left ? -2 : 4);
      if (t < 8) {
        g.fillStyle = "#c9f3ff";
        g.fillRect(x, my + 4, 1, 1 + (t >> 2));
      } else {
        const y = my + 5 + (t - 8) * (t - 8) * 0.35;
        if (y < 121) {
          g.fillStyle = "#85e6ff"; g.fillRect(x, Math.round(y), 1, 2);
          g.fillStyle = "#c9f3ff"; g.fillRect(x, Math.round(y) - 1, 1, 1);
        } else {
          const s = Math.round(y - 121);
          if (s < 6) {
            g.fillStyle = "#85e6ff";
            g.fillRect(x - 1 - (s >> 1), 122, 1, 1); g.fillRect(x + 1 + (s >> 1), 122, 1, 1);
          } else this.drop = null;
        }
      }
    }
    // coin flip from the floor corner
    if (this.flip) {
      const t = f - this.flip.at;
      const y = Math.round(112 - (t * (22 - t)) / 4.2);
      const w = [7, 5, 3, 1, 3, 5][t % 6];
      const x = this.flip.x + (7 - w) / 2;
      g.fillStyle = "#1d1233";
      g.fillRect(x, y, w, 7);
      g.fillStyle = w > 2 ? "#ffd84d" : "#e39a1c";
      g.fillRect(x + (w > 1 ? 1 : 0), y + 1, Math.max(1, w - 2), 5);
      if (w >= 5) (g.fillStyle = "#fff8ee"), g.fillRect(x + 2, y + 2, 1, 2);
      if (t === 21) this.s.burst("sparkleS", 2, this.flip.x + 3, 112, 4);
    }
    // the fwog buddy hops across the floor, stops to look at you, hops on
    if (this.frogAt >= 0) {
      const t = f - this.frogAt;
      const d = this.frogDir;
      const pause = t > 38 && t < 56;
      const steps = pause ? 38 : t > 56 ? t - 18 : t;
      const x = Math.round(d > 0 ? -10 + steps * 1.9 : 130 - steps * 1.9);
      const hop = pause ? 0 : [0, -1, -3, -4, -3, -1][steps % 6];
      drawFrog(g, x, 119 + hop, d, pause && t % 12 < 2);
    }
    // thunder cap: a crackle over the head
    if (this.bolt) {
      const t = f - this.bolt.at;
      let x = this.bolt.x, y = card.y - 1;
      g.fillStyle = t % 2 ? "#ffd84d" : "#ffffff";
      for (let i = 0; i < 4; i++) {
        g.fillRect(x, y - i * 2, 1, 2);
        x += i % 2 ? 1 : -1;
      }
    }
  }
}

// tiny sprites local to the FX
const SPR = {
  gcandle: ["...k...", "..kgk..", ".kgggk.", ".kgwgk.", ".kgwgk.", ".kgggk.", ".kGGGk.", "..kgk..", "...k..."],
  rcandle: ["...k...", "..krk..", ".krrrk.", ".krwrk.", ".krrrk.", ".krrrk.", ".kRRRk.", "..krk..", "...k..."],
};
const COL = { k: "#1d1233", g: "#46e38f", G: "#1f9c5a", r: "#ff4f5e", R: "#a82645", w: "#fff8ee" };
function drawSpr(g, name, x, y) {
  const rows = SPR[name];
  for (let j = 0; j < rows.length; j++)
    for (let i = 0; i < rows[j].length; i++) {
      const c = rows[j][i];
      if (c === ".") continue;
      g.fillStyle = COL[c];
      g.fillRect(x + i, y + j, 1, 1);
    }
}
// an 8x6 fwog, facing its walking direction
const FROG = ["..kk.kk.", ".kwkkwk.", "kgggggk.", "kgggggGk", "kGgggGk.", ".k.kk.k."];
const FROG_BLINK = ["..kk.kk.", ".kkkkkk.", "kgggggk.", "kgggggGk", "kGgggGk.", ".k.kk.k."];
function drawFrog(g, x, y, dir, blink) {
  const rows = blink ? FROG_BLINK : FROG;
  for (let j = 0; j < 6; j++)
    for (let i = 0; i < 8; i++) {
      const c = rows[j][dir > 0 ? i : 7 - i];
      if (c === ".") continue;
      g.fillStyle = COL[c];
      g.fillRect(x + i, y + j - 6, 1, 1);
    }
}
