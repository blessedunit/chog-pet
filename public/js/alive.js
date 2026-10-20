// Chog Pet "it notices you": small reactions to the person in front of the screen.
//   pointer near the screen -> the card leans a pixel towards it and its gloss follows; hover still -> curious "?"
//   hold on the screen      -> scratch: hearts and a happy wiggle (the tap itself still pets, main.js handles it)
//   drag the egg side to side fast -> dizzy stars
//   no input for 40 s       -> it dozes off (z's) until you move
//   back on the tab after >60 s -> a happy hop and a tiny "you're back!"
// Personality changes the flavour where it's cheap. Reduced motion: no leaning/wiggles, reactions stay static.

const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const DOZE_AFTER = 40000;
const AWAY_AFTER = 60000;
const HOLD = 450;

const BACK = {
  romantic: "missed you! <3", grumpy: "oh. you're back.", smug: "knew you'd be back", chaotic: "YOU'RE BACK!!",
  sleepy: "*yawn* oh, hi", drama: "you LEFT me!", gamer: "welcome back, p2", chill: "hey, welcome back",
};
const SCRATCH = {
  romantic: ["<3 <3 <3", "never stop"], grumpy: ["...fine. more.", "don't tell anyone"], chaotic: ["hehehehe", "AGAIN"],
  sleepy: ["*purr*", "mmm... nice"], smug: ["i deserve this", "a little left"], drama: ["best day of my LIFE", "i'm crying"],
  gamer: ["+1 happiness", "buff applied"], chill: ["ahh, right there", "*purr*"],
};
const DIZZY = { chaotic: "AGAIN! AGAIN!", grumpy: "stop that.", drama: "the room is SPINNING", gamer: "lag spike", smug: "very funny." };

export class Alive {
  constructor(screen) {
    this.s = screen;
    this.still = still;
    this.lcd = screen.c.parentElement || screen.c;
    this.dev = (this.lcd.closest && this.lcd.closest("#device")) || this.lcd;
    this.lastInput = performance.now();
    this.pt = null; // pointer in LCD px (may be outside 0..128), or null
    this.ptAt = 0;
    this.inside = false;
    this.hoverAt = 0; // when the pointer last moved inside the screen
    this.lean = 0; // current lean, LCD px
    this.leanY = 0;
    this.gx = 0; // gloss offset -1..1
    this.press = null; // {at, x, y, id}
    this.scratch = null; // {at (frame), hearts}
    this.dizzy = null; // {at}
    this.doze = false;
    this.wakeAt = -99;
    this.hop = null; // {at}
    this.curious = null; // {at}
    this.shake = { dir: 0, x: 0, flips: [] };
    this.hiddenAt = 0;
    this._bind();
  }

  setPet() {
    this.scratch = this.dizzy = this.hop = this.curious = null;
    this.doze = false;
    this.lastInput = performance.now();
  }

  _busy() {
    const s = this.s;
    const menu = document.getElementById("menu");
    return s.mode !== "pet" || !s.portrait || !!s.game || (menu && !menu.hidden);
  }

  _input() {
    this.lastInput = performance.now();
    if (this.doze) {
      this.doze = false;
      this.wakeAt = this.s.f;
    }
  }

  _toLcd(e) {
    const r = this.lcd.getBoundingClientRect();
    if (!r.width) return null;
    return { x: ((e.clientX - r.left) / r.width) * 128, y: ((e.clientY - r.top) / r.height) * 128, r };
  }

  _bind() {
    const on = (el, ev, fn, opt) => el && el.addEventListener(ev, fn, opt || { passive: true });
    on(window, "pointermove", (e) => {
      this._input();
      const q = this._toLcd(e);
      if (!q) return;
      this.pt = q;
      this.ptAt = performance.now();
      const inside = q.x >= 0 && q.x < 128 && q.y >= 0 && q.y < 128;
      if (inside && !this.inside) this.hoverAt = performance.now();
      if (inside && e.pointerType === "mouse" && Math.abs(e.movementX) + Math.abs(e.movementY) > 2) this.hoverAt = performance.now(), (this.curious = null);
      this.inside = inside;
      if (this.press && e.pointerId === this.press.id) this._shakeTrack(e.clientX);
    });
    on(window, "keydown", () => this._input());
    on(window, "wheel", () => this._input());
    on(window, "scroll", () => this._input());
    on(document, "pointerleave", () => (this.pt = null, this.inside = false));
    on(this.dev, "pointerdown", (e) => {
      this._input();
      if (e.button !== 0) return;
      this.curious = null;
      const q = this._toLcd(e);
      const onLcd = q && q.x >= 0 && q.x < 128 && q.y >= 0 && q.y < 128;
      this.press = { at: performance.now(), x: q ? q.x : 64, y: q ? q.y : 64, id: e.pointerId, lcd: onLcd, cx: e.clientX };
      this.shake.dir = 0;
      this.shake.x = e.clientX;
      this.shake.flips.length = 0;
    });
    const up = (e) => {
      if (!this.press || (e && e.pointerId !== this.press.id)) return;
      this.press = null;
      if (this.scratch) this._endScratch();
    };
    on(window, "pointerup", up);
    on(window, "pointercancel", up);
    // a long press on a phone would open the context menu; while the pet is being scratched it shouldn't
    this.lcd.addEventListener("contextmenu", (e) => this.press && e.preventDefault());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.hiddenAt = performance.now();
      else if (this.hiddenAt && performance.now() - this.hiddenAt > AWAY_AFTER) this._back();
      if (!document.hidden) this._input();
    });
  }

  // fast left-right drags: count direction flips of at least 14 css px inside 0.9 s
  _shakeTrack(x) {
    const sh = this.shake;
    const dx = x - sh.x;
    if (Math.abs(dx) < 14) return;
    const dir = dx > 0 ? 1 : -1;
    const now = performance.now();
    if (sh.dir && dir !== sh.dir) {
      sh.flips.push(now);
      while (sh.flips.length && now - sh.flips[0] > 900) sh.flips.shift();
      if (sh.flips.length >= 4 && !this._busy() && !this.dizzy) {
        this.dizzy = { at: this.s.f };
        this.scratch = null;
        sh.flips.length = 0;
        setTimeout(() => this.dizzy && this.say(DIZZY[this._mind()] || "whoa... dizzy"), 900);
      }
    }
    sh.dir = dir;
    sh.x = x;
  }

  _mind() {
    return (this.s.p && this.s.p.mind) || "chill";
  }

  _back() {
    if (this._busy()) return;
    this.hop = { at: this.s.f };
    this.s.burst("heart", 3, 64, 40, 26);
    setTimeout(() => this.say(BACK[this._mind()] || "you're back!", 2600, true), 350);
  }

  _endScratch() {
    const sc = this.scratch;
    this.scratch = null;
    if (sc && this.s.f - sc.at > 16 && Math.random() < 0.6) {
      const l = SCRATCH[this._mind()] || SCRATCH.chill;
      this.say(l[Math.floor(Math.random() * l.length)]);
    }
  }

  /** A tiny line in the screen's speech bubble (the same one main.js uses). */
  say(text, ms = 2600, force = false) {
    const el = document.getElementById("speech");
    if (!el || this._busy()) return;
    if (!force && el.classList.contains("show") && this.s.talking) return; // don't talk over the page
    el.textContent = text;
    el.classList.add("show");
    this.s.talking = true;
    clearTimeout(this._sayT);
    this._sayT = setTimeout(() => {
      if (el.textContent !== text) return;
      el.classList.remove("show");
      this.s.talking = false;
    }, ms);
  }

  /** 12 fps logic step. */
  step(f) {
    const s = this.s;
    const now = performance.now();
    const busy = this._busy();
    const asleep = s.state && s.state.asleep;
    // hold to scratch
    if (this.press && this.press.lcd && !this.scratch && !this.dizzy && !busy && now - this.press.at > HOLD) this.scratch = { at: f };
    if (this.scratch && (busy || !this.press)) this.scratch = null;
    if (this.scratch && this.shake.flips.length >= 2) this.scratch = null; // that's a shake, not a scratch
    if (this.scratch) {
      const t = f - this.scratch.at;
      const grump = this._mind() === "grumpy" && t < 8;
      const q = this.pt && this.inside ? this.pt : this.press;
      if (!grump && t % (this._mind() === "romantic" ? 2 : 3) === 0) s.burst(t % 6 ? "heartS" : "heart", 1, q ? q.x : 64, (q ? q.y : 64) - 6, 6);
      if (asleep && t % 10 === 0) s.fx.push({ spr: "Z", x: s.p.side === "left" ? 34 : 86, y: 46, vx: 0, vy: -0.6, life: 14, t: 0 });
    }
    if (this.dizzy && f - this.dizzy.at > 30) this.dizzy = null;
    if (this.hop && f - this.hop.at > 14) this.hop = null;
    // doze when nobody's around
    if (!this.doze && !busy && !asleep && !s.anim && now - this.lastInput > DOZE_AFTER && !document.hidden) this.doze = true;
    if (this.doze && (busy || asleep)) this.doze = false;
    if (this.doze) this.curious = null;
    if (this.doze && f % 14 === 0) s.fx.push({ spr: "Z", x: s.p.side === "left" ? 36 : 84, y: 52, vx: s.p.side === "left" ? -0.25 : 0.25, vy: -0.5, life: 22, t: 0 });
    // curious: the pointer rests on the screen
    if (!this.curious && this.inside && !this.press && !busy && !asleep && !this.doze && now - this.hoverAt > 2600 && now - this.ptAt < 15000) this.curious = { at: f };
    if (this.curious && (!this.inside || f - this.curious.at > 40)) {
      if (f - this.curious.at > 40) this.hoverAt = now + 8000; // don't ask again straight away
      this.curious = null;
    }
    // lean towards the pointer when it's around the device
    let tx = 0, ty = 0, tg = 0;
    if (this.pt && now - this.ptAt < 6000 && !busy && !asleep && !this.doze) {
      const dx = this.pt.x - 64, dy = this.pt.y - 60;
      if (Math.abs(dx) < 240 && Math.abs(dy) < 240) {
        tx = Math.max(-2, Math.min(2, Math.round(dx / 34)));
        ty = dy < -50 ? -1 : 0;
        tg = Math.max(-1, Math.min(1, dx / 90));
      }
    }
    if (this.still) tx = ty = 0;
    this.lean += Math.sign(tx - this.lean);
    this.leanY += Math.sign(ty - this.leanY);
    this.gx += (tg - this.gx) * 0.3;
  }

  /** Extra pose on top of the screen's own. Returns {ox, oy, sq, rot (radians)}. */
  pose(f, base) {
    let ox = 0, oy = 0, sq = 0, rot = 0;
    const s = this.s;
    if (s.anim) return { ox: this.lean, oy: 0, sq: 0, rot: 0 };
    ox = this.lean;
    oy = this.leanY;
    if (this.still) return { ox: 0, oy: 0, sq: this.doze ? 2 : 0, rot: 0 };
    if (this.curious) {
      const t = f - this.curious.at;
      const dir = s.p && s.p.side === "left" ? 1 : -1;
      rot = dir * Math.min(1, t / 4) * 0.035;
    }
    if (this.scratch) {
      const t = f - this.scratch.at;
      const mind = this._mind();
      if (mind === "grumpy" && t < 8) {
        ox = (s.p.side === "left" ? -1 : 1) * Math.min(4, t); // turns away first
      } else if (!(s.state && s.state.asleep)) {
        rot = [0.03, 0.05, 0.03, 0, -0.03, -0.05, -0.03, 0][t % 8] * (mind === "chaotic" ? 1.6 : 1);
        sq = t % 4 === 0 ? 2 : 1;
        oy += t % 8 < 4 ? 0 : -1;
      }
    }
    if (this.dizzy) {
      const t = f - this.dizzy.at;
      const k = Math.max(0, 1 - t / 30);
      rot = Math.sin(t / 1.6) * 0.07 * k;
      ox += Math.round(Math.sin(t / 1.6) * 3 * k);
    }
    if (this.doze) {
      oy += 2 + (Math.floor(f / 18) % 2);
      sq = 2;
    }
    if (f - this.wakeAt < 8) oy += [0, -3, -5, -4, -2, -1, 0, 0][f - this.wakeAt];
    if (this.hop) oy += [0, -3, -6, -8, -8, -6, -3, 0, 1, 0, -3, -4, -3, 0, 0][f - this.hop.at] || 0;
    return { ox, oy, sq, rot };
  }

  /** Front pixel layer: "?", "!", dizzy stars, scratch blush. */
  draw(g, f, card) {
    const s = this.s;
    const left = s.p && s.p.side === "left";
    if (this.curious && !s.talking) {
      const t = f - this.curious.at;
      if (t > 3) bubble(g, left ? 100 : 12, 18 + (Math.floor(f / 6) % 2), "?", left);
    }
    if (f - this.wakeAt < 10 && f - this.wakeAt > 0 && !s.talking) bubble(g, left ? 100 : 12, 16, "!", left);
    if (this.dizzy) {
      const t = f - this.dizzy.at;
      const cx = card.x + card.w / 2, cy = card.y + 8;
      for (let i = 0; i < 3; i++) {
        const a = t / 2.2 + (i * Math.PI * 2) / 3;
        const x = Math.round(cx + Math.cos(a) * 26), y = Math.round(cy + Math.sin(a) * 6);
        star(g, x, y, (t + i) % 4 < 2 ? "#ffd84d" : "#fff8ee");
      }
    }
    if (this.scratch && s.p && s.p.mind === "romantic") {
      // blush wash over the card
      g.fillStyle = "rgba(255,142,228,0.10)";
      g.fillRect(card.x, card.y, card.w, card.h);
    }
    if (this.scratch && s.p && s.p.mind === "grumpy" && f - this.scratch.at < 8) {
      g.fillStyle = "#ff4f5e";
      const x = left ? 18 : 102, y = 22;
      g.fillRect(x, y, 2, 1); g.fillRect(x + 4, y, 2, 1); g.fillRect(x + 1, y + 1, 1, 1); g.fillRect(x + 4, y + 1, 1, 1);
      g.fillRect(x + 1, y + 3, 1, 1); g.fillRect(x + 4, y + 3, 1, 1); g.fillRect(x, y + 4, 2, 1); g.fillRect(x + 4, y + 4, 2, 1);
    }
  }
}

// a small white thought bubble with one glyph, the same look as the need bubble
const GLYPH = {
  "?": [".kkk.", "k...k", "...k.", "..k..", ".....", "..k.."],
  "!": ["..k..", "..k..", "..k..", "..k..", ".....", "..k.."],
};
function bubble(g, x, y, ch, left) {
  g.fillStyle = "#1d1233";
  g.fillRect(x - 1, y - 1, 13, 12);
  g.fillStyle = "#ffffff";
  g.fillRect(x, y, 11, 10);
  g.fillStyle = "#1d1233";
  const tx = left ? x + 2 : x + 7;
  g.fillRect(tx, y + 10, 2, 2);
  g.fillRect(left ? tx - 1 : tx + 2, y + 12, 1, 1);
  const rows = GLYPH[ch];
  g.fillStyle = ch === "!" ? "#ff4f5e" : "#6e54ff";
  for (let j = 0; j < rows.length; j++) for (let i = 0; i < 5; i++) if (rows[j][i] === "k") g.fillRect(x + 3 + i, y + 2 + j, 1, 1);
}
function star(g, x, y, c) {
  g.fillStyle = "#1d1233";
  g.fillRect(x - 1, y - 2, 3, 5); g.fillRect(x - 2, y - 1, 5, 3);
  g.fillStyle = c;
  g.fillRect(x, y - 1, 1, 3); g.fillRect(x - 1, y, 3, 1);
}
