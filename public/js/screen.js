// Chog Pet LCD: a 128x128 logical canvas, scaled up crisp by CSS, for everything pixel (food, bath, blanket,
// poop, flies, hearts, the open front door, the game). The pet itself is the Chog's original art, drawn full quality on
// a second canvas underneath (4x the resolution) with the same breathing / hop / lean pose.
// Pet animation runs on a 12 fps step for a real handheld feel; the mini-game borrows the screen at full rate.
import { draw, size, text, textWidth, PAL } from "./sprites.js";
import { mood as moodOf, stageOf } from "./sim.js";
import { TraitFX } from "./traitfx.js";
import { Alive } from "./alive.js";
import { roomDecor, floorDecor, frameFill, cardDecor, decorSpots } from "./decor.js";

export const W = 128;
const FPS = 12;
const P = 104; // the portrait is a framed card on the screen, with room around it to hop and lean
const HI = 4; // the art canvas is 4x the LCD
const OFF = 9; // gap between the card and the floor

function rnd(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export class Screen {
  constructor(canvas, art) {
    this.c = canvas;
    this.g = canvas.getContext("2d");
    this.g.imageSmoothingEnabled = false;
    this.art = art || null;
    if (art) {
      art.width = art.height = W * HI;
      this.ag = art.getContext("2d");
      this.ag.imageSmoothingQuality = "high";
    }
    this.f = 0; // logic frame
    this.anim = null;
    this.fx = [];
    this.state = null;
    this.p = null;
    this.mode = "boot"; // boot | pet | away | moved | game
    this.portrait = null;
    this.face = null;
    this.bg = "#2a1a55";
    this.game = null;
    this.last = 0;
    this.acc = 0;
    this.onAnimEnd = null;
    this.night = false;
    this.trick = null; // a little idle move now and then, picked by personality
    this.nextTrick = 30;
    this.days = null; // days in this home (null = unknown: no stage decor)
    this.stage = -1;
    this._ageHook = false;
    this.flash = null; // first look at a new stage
    this.tfx = new TraitFX(this);
    this.alive = new Alive(this);
    this._card = { x: 12, y: 15, w: P, h: P };
    this._fctx = { asleep: false, night: false, mood: "content", anim: null };
    if (typeof window !== "undefined")
      window.addEventListener("chogpet:act", (e) => {
        const d = e.detail || {};
        if (d.id === this.id && d.code === "full") this.tfx.event("full", this.f);
      });
    // the LCD keeps ticking (moods, tricks) but only paints while it is on screen: no canvas uploads (and no
    // re-filtering of the device's drop-shadow) for a screen scrolled far away
    this.onScreen = true;
    if (typeof IntersectionObserver !== "undefined")
      new IntersectionObserver((es) => { this.onScreen = es[es.length - 1].isIntersecting; }, { rootMargin: "200px 0px" }).observe(canvas);
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  /** Load the Chog's art and prepare the pixel portrait + a round face token for scenes and the game. */
  async setPet(id, persona) {
    this.p = persona;
    this.id = id;
    this.mode = "boot";
    this.days = null;
    this.stage = -1;
    this.flash = null;
    this._room0 = null;
    this.tfx.off();
    const load = (src) =>
      new Promise((res, rej) => {
        const im = new Image();
        im.crossOrigin = "anonymous";
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = src;
      });
    // the 384 px copy is quick and always there; the 1000 px original replaces it when it lands
    const img = await load(`/chogs/${id}-l.webp`);
    if (this.id !== id) return;
    this.img = img;
    this.hi = img;
    load(`/chogs/${id}-xl.webp`).then((big) => this.id === id && (this.hi = this._prep(big)), () => {});
    this.hi = this._prep(img);
    const pc = document.createElement("canvas");
    pc.width = pc.height = P;
    const pg = pc.getContext("2d", { willReadFrequently: true });
    pg.imageSmoothingQuality = "high";
    pg.drawImage(this.hi, 0, 0, P, P);
    this.portrait = pc;
    // average colour of the corners = the Chog's background, used for scenes and the glow around the device
    const d = pg.getImageData(0, 0, P, P).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (const [x, y] of [[2, 2], [P - 3, 2], [2, 40], [P - 3, 40], [6, 6], [P - 7, 6]]) {
      const i = (y * P + x) * 4;
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
    }
    this.bgRGB = [r / n, g / n, b / n].map(Math.round);
    this.bg = `rgb(${this.bgRGB.join(",")})`;
    // face token: centre crop, round mask
    const fc = document.createElement("canvas");
    fc.width = fc.height = 22;
    const fg = fc.getContext("2d");
    fg.imageSmoothingQuality = "high";
    fg.beginPath();
    fg.arc(11, 11, 11, 0, Math.PI * 2);
    fg.clip();
    fg.drawImage(img, 384 * 0.2, 384 * 0.14, 384 * 0.62, 384 * 0.62, 0, 0, 22, 22);
    this.face = fc;
    this.tfx.setPet(persona, pg, P);
    this.alive.setPet(id);
    this.mode = "pet";
    return this.bgRGB;
  }

  // the art at the size it is drawn (P * HI), downscaled once with good filtering
  _prep(img) {
    const n = P * HI;
    let src = img;
    // halve in steps: a single big jump makes the line art shimmer
    while (src.width / 2 >= n * 1.4) {
      const h = document.createElement("canvas");
      h.width = h.height = Math.round(src.width / 2);
      const hg = h.getContext("2d");
      hg.imageSmoothingQuality = "high";
      hg.drawImage(src, 0, 0, h.width, h.height);
      src = h;
    }
    const c = document.createElement("canvas");
    c.width = c.height = n;
    const cg = c.getContext("2d");
    cg.imageSmoothingQuality = "high";
    cg.drawImage(src, 0, 0, n, n);
    return c;
  }

  _roomArt() {
    const S = W * HI;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d");
    // the Chog's own colour, pulled towards Monad violet so every room feels like the same house
    const [r, gg, b] = (this.bgRGB || [90, 60, 180]).map((v, i) => v * 0.45 + [110, 84, 255][i] * 0.55);
    const mix = (k, t) => `rgb(${Math.round(r * k + t)},${Math.round(gg * k + t)},${Math.round(b * k + t)})`;
    const wall = g.createRadialGradient(S / 2, S * 0.3, S * 0.05, S / 2, S * 0.45, S * 0.75);
    wall.addColorStop(0, mix(0.95, 22));
    wall.addColorStop(1, mix(0.55, 0));
    g.fillStyle = wall;
    g.fillRect(0, 0, S, S);
    // the wall: faint pixel dots, the Chog's colour
    g.fillStyle = "rgba(255,255,255,0.10)";
    for (let y = 8; y < W - 22; y += 10) for (let x = (y / 10) % 2 ? 4 : 9; x < W; x += 10) g.fillRect(x * HI, y * HI, HI, HI);
    // floor
    const fl = W - OFF - 2;
    const floor = g.createLinearGradient(0, fl * HI, 0, S);
    floor.addColorStop(0, mix(0.42, 0));
    floor.addColorStop(1, mix(0.3, 0));
    g.fillStyle = floor;
    g.fillRect(0, fl * HI, S, S - fl * HI);
    g.fillStyle = "rgba(255,255,255,0.14)";
    g.fillRect(0, fl * HI, S, HI);
    roomDecor(g, this.stage, HI);
    return { c, bg: this.bg };
  }

  /** Days the current wallet has held this Chog (main.js can call it; otherwise it's read from the pet card). */
  setAge(days) {
    this._ageHook = true;
    this._setDays(days);
  }

  _setDays(days) {
    const d = Number(days);
    if (!(d >= 0)) return;
    this.days = d;
    const i = stageOf(d).i;
    if (i === this.stage) return;
    this.stage = i;
    this._room0 = null;
    this._stageSeen = false;
  }

  // the pet card prints the days ("<div class=days>40<small>DAYS"); read it when nobody calls setAge
  _readAge() {
    if (this._ageHook || typeof document === "undefined") return;
    const el = document.querySelector("#pcHome .days");
    if (!el) return;
    const n = parseInt(el.textContent, 10);
    if (n >= 0) this._setDays(n);
  }

  // the first time this browser sees a Chog at a stage: a short sparkle and the stage's name
  _stageFlash() {
    if (this._stageSeen || this.stage < 0 || this.mode !== "pet" || this.anim || !this.portrait) return;
    if (document.hidden || document.querySelector(".intro")) return;
    this._stageSeen = true;
    const key = `pet.stage.${this.id}`;
    let seen = -1;
    try {
      const v = localStorage.getItem(key);
      if (v != null) seen = Number(v);
      localStorage.setItem(key, String(this.stage));
    } catch {}
    if (seen >= this.stage) return;
    this.flash = { at: this.f, i: this.stage, name: stageOf(this.days).name };
    if (!this.tfx.still) for (const [x, y] of decorSpots(this.stage, this.p.side === "left")) this.burst("sparkle", 2, x, y, 6, 0.5);
  }

  /**
   * The screen as one picture (art + pixels), for the share card. clean: the Chog at its best for the picture (no
   * smudges, flies, poop or stink; the card says its mood in words instead).
   */
  snapshot({ clean = false } = {}) {
    const keep = clean ? { state: this.state, fx: this.fx } : null;
    if (keep && this.state) {
      this.state = { ...this.state, clean: 100, poop: 0 };
      this.fx = this.fx.filter((p) => p.spr !== "stink" && p.spr !== "fly");
      this._render();
    } else if (!this.onScreen) this._render();
    const c = document.createElement("canvas");
    c.width = c.height = W * HI;
    const g = c.getContext("2d");
    if (this.art && this.mode !== "boot") g.drawImage(this.art, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.c, 0, 0, W * HI, W * HI);
    if (keep && keep.state) {
      this.state = keep.state;
      this.fx = keep.fx;
      this._render();
    }
    return c;
  }

  setState(s) {
    this.state = s;
    if (this.mode === "game" || this.mode === "moved") return;
    if (this.anim && this.anim.keepMode) return;
    this.mode = s && s.away ? "away" : "pet";
  }

  /** Start a one-shot animation. Returns a promise that resolves when it ends. */
  play(name, opt = {}) {
    const len = { eat: 40, fav: 46, yuck: 30, treat: 50, love: 26, purr: 18, clean: 40, bathlove: 44, bathhate: 36, nap: 18, wake: 16, grumpy: 24, refuse: 16, happy: 22, return: 48, moved: 72, record: 30, play: 22 }[name] || 20;
    return new Promise((res) => {
      if (this.anim && this.anim.done) this.anim.done();
      this.anim = { name, at: this.f, len, opt, done: res, keepMode: name === "return" || name === "moved" };
      if (name === "yuck") this.tfx.event("yuck", this.f);
      if (name === "moved") this.mode = "moved";
      if (name === "return") this.mode = "away";
    });
  }

  burst(spr, n, x, y, spread = 10, up = 1) {
    for (let i = 0; i < n; i++) {
      this.fx.push({ spr, x: x + (Math.random() - 0.5) * spread * 2, y: y + (Math.random() - 0.5) * spread, vx: (Math.random() - 0.5) * 1.2, vy: -(0.6 + Math.random() * 0.9) * up, life: 14 + Math.random() * 10, t: 0 });
    }
  }

  // ---------- loop ----------
  _loop(ts) {
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.1, (ts - (this.last || ts)) / 1000);
    this.last = ts;
    if (this.mode === "game" && this.game) {
      const gm = this.game;
      gm.update(dt);
      if (this.game === gm) {
        gm.render(this.g);
        return;
      }
    }
    this.acc += dt;
    if (this.acc < 1 / FPS) return;
    this.acc %= 1 / FPS;
    this.f++;
    this._step();
    if (this.onScreen) this._render();
  }

  _step() {
    for (const p of this.fx) {
      p.t++;
      p.x += p.vx;
      p.y += p.vy;
    }
    this.fx = this.fx.filter((p) => p.t < p.life);
    if (this.f % 12 === 0) this._readAge();
    const fc = this._fctx;
    fc.asleep = !!(this.state && this.state.asleep);
    fc.night = this.night;
    fc.mood = this.state ? moodOf(this.state) : "content";
    fc.anim = this.anim;
    if (this.mode === "pet" && this.portrait) {
      this.tfx.step(this.f, fc);
      this._stageFlash();
    }
    this.alive.step(this.f);
    if (this.flash && this.f - this.flash.at > 34) this.flash = null;
    this._tricks();
    const a = this.anim;
    if (a && this.f - a.at >= a.len) {
      this.anim = null;
      if (a.name === "moved" || a.name === "return") this.mode = this.state && this.state.away ? "away" : "pet";
      a.done && a.done();
    }
  }

  // idle tricks: every few seconds the pet does something small that fits who it is
  _tricks() {
    const s = this.state;
    if (this.mode !== "pet" || !s || !this.p) return (this.trick = null);
    if (this.trick && this.f - this.trick.at >= this.trick.len) this.trick = null;
    const al = this.alive;
    if (al.doze || al.scratch || al.dizzy || al.curious) return (this.trick = null);
    if (this.trick || this.anim || this.f < this.nextTrick) return;
    const m = moodOf(s);
    const mind = this.p.mind;
    let pool;
    if (s.asleep) pool = ["droop", "droop", "blink"];
    else if (m === "miserable" || m === "hungry") pool = ["sigh", "look", "blink", "sigh"];
    else if (m === "sleepy") pool = ["droop", "blink", "droop"];
    else pool = ["blink", "blink", "look", "hop"];
    const extra = { chaotic: ["jitter", "jitter", "hop"], smug: ["lean", "lean"], sleepy: ["droop"], romantic: ["hearts", "hearts"], gamer: ["hop", "look"], drama: ["sigh", "hop"], grumpy: ["huff", "huff"], chill: ["look"] }[mind] || [];
    if (!s.asleep && m !== "miserable") pool = pool.concat(extra);
    const kind = pool[Math.floor(Math.random() * pool.length)];
    const len = { blink: 3, look: 22, hop: 12, jitter: 10, lean: 26, droop: 28, sigh: 18, hearts: 16, huff: 12 }[kind];
    this.trick = { kind, at: this.f, len, dir: Math.random() < 0.5 ? -1 : 1 };
    if (kind === "hearts") this.burst("heartS", 3, this.p.side === "left" ? 40 : 88, 44, 14);
    const busy = mind === "chaotic" ? 22 : mind === "sleepy" ? 70 : 40;
    this.nextTrick = this.f + busy + Math.floor(Math.random() * busy);
  }

  // portrait offset / squash / zoom for the current frame
  _pose() {
    const f = this.f;
    let ox = 0, oy = 0, sq = 0, zoom = 1;
    const s = this.state;
    const asleep = s && s.asleep;
    // idle: breathing you can see (the bottom stays put, the head rises), a slow sway
    const bt = asleep ? (f % 36) / 36 : (f % 20) / 20;
    sq = Math.round((asleep ? 3 : 2) * (0.5 - 0.5 * Math.cos(bt * Math.PI * 2)));
    if (!asleep) ox = [0, 0, 1, 1, 1, 1, 0, 0, -1, -1, -1, -1][Math.floor(f / 5) % 12];
    const tr = this.trick;
    if (tr && !this.anim) {
      const t = f - tr.at;
      switch (tr.kind) {
        case "blink": sq = t === 1 ? 6 : 3; break;
        case "look": ox = tr.dir * (t < 4 ? t : t > 17 ? 21 - t : 4); break;
        case "hop": oy = [0, -3, -6, -7, -6, -3, 0, 1, 0, -2, 0, 0][t] || 0; sq = t === 6 || t === 7 ? 3 : sq; break;
        case "jitter": ox = t % 2 ? 2 : -2; oy = t % 3 ? 0 : -1; break;
        case "lean": ox = tr.dir * (t < 5 ? t : t > 20 ? 25 - t : 5); oy = t > 4 && t < 21 ? 1 : 0; break;
        case "droop": oy = t < 20 ? Math.floor(t / 4) : Math.max(0, 5 - (t - 20) * 2); if (t === 21) sq = 4; break;
        case "sigh": oy = t < 8 ? Math.floor(t / 2) : t < 14 ? 4 : 18 - t; sq = t > 8 && t < 14 ? 3 : sq; break;
        case "huff": ox = t % 4 < 2 ? 1 : -1; zoom = t > 3 && t < 9 ? 1.03 : 1; break;
      }
    }
    if (this.p && this.p.ghost) oy += [0, -1, -2, -3, -3, -2, -1, 0][Math.floor(f / 3) % 8];
    const m = s ? moodOf(s) : "content";
    if (m === "happy" && !this.anim && Math.floor(f / 30) % 4 === 0) oy += [0, -3, -5, -3, 0, 0][Math.floor(f / 2) % 6] || 0;
    if (m === "miserable" && !this.anim) ox += Math.floor(f / 2) % 2 ? 1 : -1;
    const a = this.anim;
    if (a) {
      const t = this.f - a.at;
      switch (a.name) {
        case "eat": case "fav": case "treat": case "yuck":
          if (t > 10 && t < 40) zoom = 1.05;
          if (t > 12 && (t - 12) % 7 < 2) (sq = 4), (zoom = 1.09);
          if (a.name === "yuck" && t > 18) ox = t % 2 ? 2 : -2;
          if ((a.name === "fav" || a.name === "treat") && t > 34) oy = [0, -4, -7, -4, 0][Math.floor((t - 34) / 1.5) % 5] || 0;
          break;
        case "love": case "purr": case "happy": case "play": case "record":
          oy = [0, -4, -6, -4, 0, 0][Math.floor(t / 2) % 6] || 0;
          sq = t % 6 === 5 ? 2 : sq;
          if (a.name === "love" && t < 4) zoom = 1.04;
          break;
        case "refuse": case "grumpy": case "bathhate":
          ox = [3, -3, 2, -2, 1, -1, 0, 0][t % 8];
          break;
        case "bathlove":
          ox = [1, -1][Math.floor(t / 3) % 2];
          break;
        case "wake":
          oy = t < 6 ? -t : -6 + (t - 6);
          if (oy > 0) oy = 0;
          break;
      }
    }
    const al = this.alive.pose(f);
    ox += al.ox;
    oy += al.oy;
    sq = Math.max(sq, al.sq);
    return { ox, oy, sq, zoom, rot: al.rot };
  }

  _render() {
    const g = this.g;
    g.save();
    g.clearRect(0, 0, W, W);
    if (this.ag && (this.mode !== "pet" || !this.portrait)) this.ag.clearRect(0, 0, W * HI, W * HI);
    if (this.mode === "boot" || !this.portrait) this._boot(g);
    else if (this.mode === "away") this._away(g);
    else if (this.mode === "moved") this._moved(g);
    else this._pet(g);
    for (const p of this.fx) {
      if (p.spr === "Z") text(g, "z", Math.round(p.x), Math.round(p.y), "#ffffff");
      else draw(g, p.spr, Math.round(p.x), Math.round(p.y));
    }
    g.restore();
  }

  _boot(g) {
    g.fillStyle = "#2a1a55";
    g.fillRect(0, 0, W, W);
    const f = this.f;
    for (let i = 0; i < 18; i++) {
      const r = rnd(i * 97 + 3);
      const x = Math.floor(r() * W), y = Math.floor(r() * W);
      if ((Math.floor(f / 4) + i) % 5) g.fillStyle = "#6a4be0", g.fillRect(x, y, 1, 1);
    }
    const t = "CHOG PET";
    text(g, t, Math.round((W - textWidth(t, 2)) / 2), 52 + (Math.floor(f / 6) % 2), "#ffd84d", 2);
    const d = ".".repeat(1 + (Math.floor(f / 4) % 3));
    text(g, "LOADING" + d, 40, 74, "#a68bff");
  }

  _pet(g) {
    const s = this.state || {};
    const { ox, oy, sq, zoom, rot } = this._pose();
    const pw = P * zoom, ph = P * zoom - sq;
    // anchored to the bottom of the screen: squash and zoom read as breathing and leaning in
    const px = (W - pw) / 2 + ox, py = W - OFF - ph + oy + (P - P * zoom) / 2;
    if (this.ag) {
      const a = this.ag, S = W * HI;
      a.globalAlpha = 1;
      // a soft room in the Chog's own colour: lit from above, a floor line, the card's shadow on it
      if (!this._room0 || this._room0.bg !== this.bg) this._room0 = this._roomArt();
      a.drawImage(this._room0.c, 0, 0);
      this.tfx.back(a, this.f, this._fctx, ox, oy);
      const lift = Math.max(0, -oy);
      a.fillStyle = `rgba(10,4,30,${0.32 - lift * 0.02})`;
      a.beginPath();
      a.ellipse((W / 2 + ox) * HI, (W - OFF + 2) * HI, (pw / 2 - 4 + lift) * HI, 3.2 * HI, 0, 0, Math.PI * 2);
      a.fill();
      a.save();
      if (rot) {
        // tilt around the bottom middle of the card, where it stands
        const cx = (px + pw / 2) * HI, cy = (py + ph) * HI;
        a.translate(cx, cy);
        a.rotate(rot);
        a.translate(-cx, -cy);
      }
      a.save();
      a.globalAlpha = this.p && this.p.ghost ? 0.9 : 1;
      const r = 7 * HI, X = px * HI, Y = py * HI, Wd = pw * HI, Hd = ph * HI;
      a.beginPath();
      a.roundRect(X - 2 * HI, Y - 2 * HI, Wd + 4 * HI, Hd + 4 * HI, r + 2 * HI);
      a.fillStyle = frameFill(a, this.stage, X - 2 * HI, Y - 2 * HI, Wd + 4 * HI, Hd + 4 * HI);
      a.shadowColor = "rgba(10,4,30,0.35)";
      a.shadowBlur = 6 * HI;
      a.shadowOffsetY = 2 * HI;
      a.fill();
      a.shadowColor = "transparent";
      a.beginPath();
      a.roundRect(X, Y, Wd, Hd, r);
      a.clip();
      a.drawImage(this.hi, X, Y, Wd, Hd);
      // a little gloss on the card; it slides with the pointer, like light on a real print
      const gs = this.alive.gx * Wd * 0.35;
      const gl = a.createLinearGradient(X + gs, Y, X + Wd + gs, Y + Hd);
      gl.addColorStop(0, "rgba(255,255,255,0.16)");
      gl.addColorStop(0.35, "rgba(255,255,255,0)");
      a.fillStyle = gl;
      a.fillRect(X, Y, Wd, Hd);
      this.tfx.onCard(a, this.f, X, Y, Wd, Hd);
      a.restore();
      a.globalAlpha = 1;
      cardDecor(a, this.stage, X, Y, Wd, Hd, HI, this.f, this.p && this.p.side === "left");
      a.restore();
      // aura particles drift over the margins and the frame, never over the art itself
      a.save();
      a.beginPath();
      a.rect(0, 0, S, S);
      a.roundRect(X, Y, Wd, Hd, r);
      a.clip("evenodd");
      this.tfx.particles(a);
      a.restore();
    } else {
      g.fillStyle = this.bg;
      g.fillRect(0, 0, W, W);
      g.drawImage(this.portrait, Math.round(px), Math.round(py), Math.round(pw), Math.round(ph));
    }
    const f = this.f;
    const a = this.anim;
    const at = a ? this.f - a.at : 0;

    // dirt: smudges grow as it gets dirtier, flies when it's really bad
    const clean = s.clean == null ? 100 : s.clean;
    if (clean < 55 && !(a && (a.name === "clean" || a.name === "bathlove" || a.name === "bathhate") && at > 8)) {
      const r = rnd(this.id * 13 + 7);
      const n = Math.min(9, 2 + Math.floor((55 - clean) / 7));
      for (let i = 0; i < n; i++) {
        const x = 22 + Math.floor(r() * 84) + ox, y = 30 + Math.floor(r() * 74) + oy;
        g.fillStyle = "rgba(96,62,32,0.62)";
        g.fillRect(x, y, 6, 3);
        g.fillRect(x + 1, y - 1, 4, 1);
        g.fillRect(x + 1, y + 3, 3, 1);
        g.fillRect(x - 1, y + 1, 1, 1);
        g.fillStyle = "rgba(70,44,22,0.7)";
        g.fillRect(x + 2, y + 1, 2, 1);
        if (i % 3 === 0) g.fillRect(x + 7, y + 2, 1, 1), g.fillRect(x + 5, y + 5, 1, 1);
      }
      if (clean < 32) {
        for (let k = 0; k < 3; k++) {
          const ang = this.f / 2.6 + k * 2.1;
          const fx = Math.round(64 + Math.cos(ang) * (34 + k * 6)), fy = Math.round(56 + Math.sin(ang * 1.4) * 22);
          g.fillStyle = PAL.k;
          g.fillRect(fx, fy, 3, 2);
          g.fillStyle = this.f % 2 ? "#ffffff" : "#c9f3ff";
          g.fillRect(fx - 1, fy - 2 + (this.f % 2), 2, 2);
          g.fillRect(fx + 2, fy - 2 + (this.f % 2), 2, 2);
        }
      }
    }

    // stage things standing on the floor, on the side away from the face
    const left = this.p && this.p.side === "left";
    floorDecor(g, this.stage, left);

    // poop on the floor (on the other side from the box and the plant)
    const poops = s.poop || 0;
    const hidePoop = a && (a.name === "clean" || a.name === "bathlove" || a.name === "bathhate");
    if (!hidePoop) {
      const spots = [[6, 116], [96, 118], [22, 118]];
      for (let i = 0; i < poops; i++) {
        const [x0, y] = spots[i];
        const x = left ? W - 10 - x0 : x0;
        draw(g, "poop", x, y - 8);
        if (Math.floor(f / 5 + i) % 3 === 0) draw(g, "stink", x + 3, y - 15 - (Math.floor(f / 2) % 3));
      }
    }

    // night: the room gets dark when it sleeps, a lamp tint when it's late for the viewer
    if (s.asleep && !(a && a.name === "wake" && at > 8)) {
      const k = a && a.name === "nap" ? Math.min(1, at / 12) : 1;
      g.fillStyle = `rgba(12,8,40,${0.58 * k})`;
      g.fillRect(0, 0, W, W);
      const r = rnd(5);
      for (let i = 0; i < 14; i++) {
        const x = Math.floor(r() * W), y = 12 + Math.floor(r() * 60);
        if ((Math.floor(f / 6) + i) % 4) {
          g.fillStyle = i % 3 ? "#bfb4ff" : "#ffffff";
          g.fillRect(x, y, 1, 1);
        }
      }
      this._blanket(g, a && a.name === "nap" ? Math.min(1, at / 12) : 1);
      if (f % 16 === 0) this.fx.push({ spr: "Z", x: this.p.side === "left" ? 34 : 86, y: 50, vx: this.p.side === "left" ? -0.3 : 0.3, vy: -0.7, life: 24, t: 0 });
    } else if (this.night) {
      g.fillStyle = "rgba(30,20,80,0.16)";
      g.fillRect(0, 0, W, W);
    }
    if (a && a.name === "wake" && at <= 8) {
      g.fillStyle = `rgba(255,255,255,${(8 - at) / 10})`;
      g.fillRect(0, 0, W, W);
    }

    // rare ones sparkle
    if (this.p && this.p.sparkle && f % 9 === 0) {
      const r = Math.random();
      this.fx.push({ spr: r < 0.5 ? "sparkle" : "sparkleS", x: 8 + Math.random() * 112, y: 16 + Math.random() * 90, vx: 0, vy: -0.1, life: 10, t: 0 });
    }

    const card = this._card;
    card.x = px; card.y = py; card.w = pw; card.h = ph;
    const [mx, my] = this._mouth();
    this.tfx.front(g, f, this._fctx, card, [mx + ox, my + oy]);
    this.alive.draw(g, f, card);
    this._animOverlay(g, ox, oy);
    this._emote(g);
    if (this.flash) this._flash(g);
  }

  _flash(g) {
    const t = this.f - this.flash.at;
    if (!this.tfx.still && t < 8) {
      // a bright band sweeps across the room
      const x = -30 + t * 24;
      g.fillStyle = "rgba(255,255,255,0.22)";
      for (let y = 0; y < W; y += 1) g.fillRect(x + Math.floor(y / 2), y, 10, 1);
    }
    // the new stage as five little steps (no words): filled up to this one, the newest one blinks
    const x0 = Math.round(W / 2 - 22), y = t < 3 && !this.tfx.still ? W + 2 - t * 4 : W - 10;
    g.fillStyle = PAL.k;
    g.fillRect(x0 - 2, y - 2, 48, 8);
    for (let k = 0; k < 5; k++) {
      const on = k <= this.flash.i, now = k === this.flash.i;
      g.fillStyle = !on ? "#2b2152" : this.flash.i === 4 ? "#ffd84d" : now && Math.floor(this.f / 3) % 2 ? "#ffffff" : "#6e54ff";
      g.fillRect(x0 + k * 9, y, 7, 4);
    }
  }

  _blanket(g, k) {
    // a low patchwork quilt in Monad violets with tiny stars; its hem dips and rises a pixel as it breathes
    const breath = Math.floor(this.f / 18) % 2;
    const top = Math.round(128 - 22 * k) + breath;
    const patch = ["#6e54ff", "#8b74ff", "#5a43d6", "#a08cff"];
    const hem = (x) => top + Math.round(1.5 * Math.sin(x / 9)) ; // a soft drape instead of a ruler-straight edge
    for (let x = 0; x < W; x++) {
      const y0 = hem(x);
      for (let y = y0 + 3; y < W; y++) {
        const px = Math.floor(x / 10), py = Math.floor((y - top) / 8);
        g.fillStyle = patch[(px * 3 + py * 5) % 4];
        g.fillRect(x, y, 1, 1);
      }
      // rolled lavender hem with a darker seam under it
      g.fillStyle = "#ddd7fe"; g.fillRect(x, y0, 1, 3);
      g.fillStyle = "#3b2790"; g.fillRect(x, y0 + 3, 1, 1);
    }
    // stitches between patches and a few stars on the quilt
    g.fillStyle = "rgba(221,215,254,0.35)";
    for (let x = 10; x < W; x += 10) for (let y = top + 6; y < W; y += 2) g.fillRect(x, y, 1, 1);
    const stars = [[14, 11], [47, 15], [80, 9], [108, 16], [30, 19], [94, 20]];
    for (const [x, dy] of stars) {
      const y = top + dy;
      if (y >= W - 1) continue;
      g.fillStyle = (x + this.f) % 40 < 3 ? "#ffffff" : "#ffd84d";
      g.fillRect(x, y, 1, 1); g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3);
    }
  }

  _mouth() {
    return this.p && this.p.side === "left" ? [50, 78] : [65, 78];
  }

  _animOverlay(g, ox, oy) {
    const a = this.anim;
    if (!a) return;
    const t = this.f - a.at;
    const [mx, my] = this._mouth();
    switch (a.name) {
      case "eat": case "fav": case "treat": case "yuck": {
        const item = a.opt.item || "rice";
        const [fw] = size(item);
        const sc = 2;
        const x = mx - (fw * sc) / 2 + 6 + ox;
        if (t <= 12) {
          const y = -24 + (my - 14 + 24) * (t / 12);
          draw(g, item, Math.round(x), Math.round(y), { scale: sc });
        } else {
          const bites = Math.floor((t - 12) / 7);
          const cut = Math.max(0, fw - bites * 3);
          if (cut > 0) draw(g, item, Math.round(x), my - 14 + oy, { scale: sc, cut });
          if ((t - 12) % 7 === 1 && cut >= 0 && bites < 4) {
            for (let i = 0; i < 4; i++) this.fx.push({ spr: "crumb", x: x + cut * sc, y: my - 4, vx: (Math.random() - 0.3) * 1.6, vy: -Math.random() * 1.2, life: 8, t: 0 });
          }
        }
        if (a.name === "fav" && t === 34) this.burst("heart", 4, 64, 50, 22);
        if (a.name === "treat" && t === 34) { this.burst("sparkle", 6, 64, 50, 30); this.burst("heart", 2, 64, 50, 18); }
        if (a.name === "eat" && t === 34) this.burst("heartS", 2, 64, 50, 18);
        if (a.name === "yuck" && t > 20) draw(g, "x", 100, 24 + (t % 2));
        break;
      }
      case "love": case "purr":
        if (t % 4 === 0) this.burst(t % 8 ? "heartS" : "heart", 1, 64, 64, 26);
        break;
      case "happy": case "play": case "record":
        if (t % 5 === 0) this.burst(a.name === "record" ? "sparkle" : "note", 1, 64, 50, 34);
        break;
      case "clean": case "bathlove": case "bathhate": {
        // shower: drops fall, bubbles rise, then a sparkle
        if (t < a.len - 8) {
          g.fillStyle = "rgba(124,196,255,0.16)";
          g.fillRect(36, 14, 56, 114);
          for (let i = 0; i < 22; i++) {
            const x = 38 + ((i * 29 + Math.floor(t / 2) * 7) % 52);
            const y = 16 + ((t * 7 + i * 17) % 112);
            g.fillStyle = i % 3 ? PAL.b : PAL.e;
            g.fillRect(x, y, 2, 4);
          }
          if (t % 2 === 0) this.fx.push({ spr: "bubble", x: 16 + Math.random() * 96, y: 96 + Math.random() * 26, vx: (Math.random() - 0.5) * 0.5, vy: -0.9, life: 26, t: 0 });
        }
        g.fillStyle = PAL.k;
        g.fillRect(44, 9, 40, 6);
        g.fillRect(61, 0, 6, 10);
        g.fillStyle = PAL.s;
        g.fillRect(45, 10, 38, 4);
        g.fillRect(62, 0, 4, 10);
        g.fillStyle = PAL.S;
        for (let x = 47; x < 82; x += 4) g.fillRect(x, 13, 2, 1);
        if (t === a.len - 8) this.burst("sparkle", 5, 64, 56, 34);
        if (a.name === "bathhate" && t > 6) draw(g, "anger", 96, 22);
        break;
      }
      case "grumpy":
        draw(g, "anger", 96, 22 + (t % 2));
        break;
      case "refuse":
        draw(g, "x", 100, 24 + (t % 2));
        break;
      case "nap":
        break;
    }
  }

  // need bubble, top-right: what it wants right now
  _emote(g) {
    const s = this.state;
    if (!s || this.anim || this.talking || this.alive.curious) return;
    const m = moodOf(s);
    const icon = { hungry: "h_food", stinky: "stink", sleepy: "Z", bored: "note", miserable: "sweat" }[m];
    if (!icon || Math.floor(this.f / 8) % 4 === 3) return;
    const x = this.p.side === "left" ? 8 : 102, y = 16 + (Math.floor(this.f / 6) % 2);
    g.fillStyle = PAL.k;
    g.fillRect(x - 1, y - 1, 19, 15);
    g.fillStyle = "#ffffff";
    g.fillRect(x, y, 17, 13);
    g.fillStyle = PAL.k;
    const tx = this.p.side === "left" ? x + 3 : x + 12;
    g.fillRect(tx, y + 13, 2, 2);
    g.fillRect(this.p.side === "left" ? tx + 2 : tx - 1, y + 15, 1, 1);
    if (icon === "Z") text(g, "ZZ", x + 2, y + 4, "#3a78e0");
    else {
      const [iw, ih] = size(icon);
      draw(g, icon, x + Math.floor((17 - iw) / 2), y + Math.floor((13 - ih) / 2));
    }
  }

  _hud(g, s) {
    g.fillStyle = "rgba(20,10,46,0.72)";
    g.fillRect(0, 0, W, 11);
    const items = [["h_food", s.food], ["h_fun", s.fun], ["h_energy", s.energy], ["h_clean", s.clean]];
    items.forEach(([ic, v], i) => {
      const x = 2 + i * 32;
      draw(g, ic, x, 2);
      const val = v == null ? 0 : v;
      const col = val > 50 ? PAL.g : val > 25 ? PAL.y : PAL.r;
      g.fillStyle = "#0d0820";
      g.fillRect(x + 9, 3, 20, 5);
      if (!(val <= 25 && Math.floor(this.f / 4) % 2)) {
        g.fillStyle = col;
        g.fillRect(x + 10, 4, Math.round((18 * val) / 100), 3);
      }
    });
  }

  // ---------- scenes ----------
  _room(g, door = true) {
    const [r, gg, b] = this.bgRGB || [60, 40, 120];
    g.fillStyle = `rgb(${r * 0.32 | 0},${gg * 0.3 | 0},${b * 0.38 | 0})`;
    g.fillRect(0, 0, W, W);
    g.fillStyle = `rgb(${r * 0.2 | 0},${gg * 0.18 | 0},${b * 0.26 | 0})`;
    g.fillRect(0, 100, W, 28);
    g.fillStyle = "rgba(255,255,255,0.08)";
    g.fillRect(0, 100, W, 1);
    const dx = 88, dy = 44;
    if (!door) return { dx, dy };
    // the front door, wide open: a little night garden outside, with a path over the hill
    g.fillStyle = "#c9b8ff"; // frame
    g.fillRect(dx - 3, dy - 3, 30, 59);
    g.fillRect(dx - 1, dy - 5, 26, 2);
    g.fillStyle = "#2a1f63"; // sky
    g.fillRect(dx, dy, 24, 56);
    g.fillStyle = "#3d2f86";
    g.fillRect(dx, dy + 18, 24, 20);
    g.fillStyle = "#fff3c4"; // stars + moon
    g.fillRect(dx + 4, dy + 5, 1, 1);
    g.fillRect(dx + 15, dy + 9, 1, 1);
    g.fillRect(dx + 9, dy + 14, 1, 1);
    g.fillRect(dx + 17, dy + 3, 4, 4);
    g.fillStyle = "#2a1f63";
    g.fillRect(dx + 19, dy + 3, 2, 2);
    g.fillStyle = "#5b4bb0"; // the hill and its path
    g.fillRect(dx, dy + 36, 24, 20);
    g.fillRect(dx + 3, dy + 34, 14, 2);
    g.fillStyle = "#8f7ee6";
    for (let i = 0; i < 6; i++) g.fillRect(dx + 10 + (i % 2), dy + 54 - i * 3, 2, 1);
    g.fillStyle = "rgba(201,184,255,0.10)"; // light spilling in
    g.fillRect(dx - 12, dy + 56, 48, 4);
    return { dx, dy };
  }

  _away(g) {
    const a = this.anim;
    const { dx } = this._room(g);
    if (a && a.name === "return") {
      const t = this.f - a.at;
      // walks back out of the door to the middle, then hops
      const x = Math.max(44, dx + 2 - t * 2);
      const hop = t > 26 ? [0, -4, -6, -4, 0][Math.floor((t - 26) / 2) % 5] || 0 : Math.floor(t / 2) % 2;
      g.drawImage(this.face, Math.round(x), 74 + hop);
      if (t > 26 && t % 5 === 0) this.burst("heart", 1, x + 11, 70, 10);
      return;
    }
    // it left a note on the floor, and footprints to the door
    draw(g, "note2", 38, 92 + (Math.floor(this.f / 8) % 2));
    g.fillStyle = "rgba(255,255,255,0.18)";
    for (let x = 52; x < dx - 2; x += 7) g.fillRect(x, 104 + ((x / 7) % 2), 2, 1);
    if (Math.floor(this.f / 6) % 2) text(g, "!", 41, 82, PAL.y);
    // far up the hill a tiny figure with a bundle on a stick bobs away, looking for snacks
    const bx = dx + 12 + (Math.floor(this.f / 12) % 2), by = 44 + 31;
    g.fillStyle = "#ffd84d";
    g.fillRect(bx, by - 3 + (Math.floor(this.f / 6) % 2), 2, 3);
    g.fillRect(bx + 2, by - 4, 2, 1);
    g.fillStyle = "#ff8ee4";
    g.fillRect(bx + 3, by - 6, 3, 3);
    text(g, "OUT LOOKING", 6, 18, "#d6d1e4");
    text(g, "FOR SNACKS", 6, 26, PAL.y);
    text(g, "FEED TO", 6, 40, "#8d86a3");
    text(g, "CALL BACK", 6, 48, "#8d86a3");
  }

  _moved(g) {
    const a = this.anim;
    const t = a ? this.f - a.at : 999;
    const { dx } = this._room(g, t < 40);
    if (t < 40) {
      const x = 14 + t * 1.9;
      const bob = Math.floor(t / 2) % 2;
      if (x < dx + 2) {
        g.drawImage(this.face, Math.round(x), 74 + bob);
        draw(g, "suitcase", Math.round(x) + 18, 88 + bob);
      }
      text(g, "MOVING OUT", 6, 18, "#d6d1e4");
    } else {
      g.fillStyle = `rgba(47,226,124,${Math.max(0, 1 - (t - 40) / 10)})`;
      g.fillRect(0, 0, W, W);
      const w = textWidth("NEW HOME!", 2);
      text(g, "NEW HOME!", Math.round((W - w) / 2), 26, PAL.y, 2);
      // a little window and a plant: somewhere new
      g.fillStyle = "rgba(255,216,77,0.25)";
      g.fillRect(18, 50, 22, 18);
      g.fillStyle = "rgba(255,255,255,0.18)";
      g.fillRect(28, 50, 2, 18);
      g.fillRect(18, 58, 22, 2);
      draw(g, "i_love", 96, 86);
      g.drawImage(this.face, 53, 70 + ([0, -4, -6, -4, 0][Math.floor(t / 2) % 5] || 0));
      if (t % 6 === 0) this.burst("heart", 1, 64, 66, 14);
    }
  }
}
