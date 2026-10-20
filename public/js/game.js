// Candle Catch: the play mini-game. 20 seconds on the pet's own screen. Catch green candles (+1) and Mon
// coins (+3, a Degen gets +5), dodge red candles (three hearts). Five catches in a row double the points
// until a red one hits; the last 5 seconds are a rally with more coins. The score feeds the pet's fun.
import { draw, text, textWidth, PAL } from "./sprites.js";
import { sfx } from "./sfx.js";
import { GAME_LEN } from "./sim.js";

const W = 128;
const LEN = GAME_LEN;
const PUMP = LEN - 5;

export class CandleCatch {
  constructor(screen, persona, onEnd) {
    this.sc = screen;
    this.p = persona;
    this.onEnd = onEnd;
    this.x = 64;
    this.vx = 0;
    this.items = [];
    this.pop = [];
    this.score = 0;
    this.maxLives = persona.mind === "gamer" ? 4 : 3;
    this.lives = this.maxLives;
    this.streak = 0;
    this.best = 0;
    this.slow = persona.mind === "sleepy" ? 0.85 : 1;
    this.pumped = false;
    this.t = -2.4; // countdown before the round
    this.spawn = 0;
    this.left = false;
    this.right = false;
    this.target = null;
    this.hurt = 0;
    this.over = 0;
    this.ended = false;
    this.chart = Array.from({ length: 22 }, (_, i) => 50 + Math.sin(i / 2) * 8 + Math.random() * 10);
    this.lastCount = 3;
  }

  press(dir, down) {
    if (dir < 0) this.left = down;
    else this.right = down;
    if (down) this.target = null;
  }
  pointer(x) {
    this.target = x;
  }
  quit() {
    if (this.ended || this.over > 0) return;
    if (this.t < 0) {
      // quit before it started: no round, no cost
      this.ended = true;
      return this.onEnd(null);
    }
    this.over = 0.6;
    sfx.over();
  }

  update(dt) {
    if (this.ended) return;
    if (this.over > 0) {
      this.over -= dt;
      if (this.over <= 0) {
        this.ended = true;
        this.onEnd(this.score);
      }
      return;
    }
    this.t += dt;
    if (this.t < 0) {
      const c = Math.ceil(-this.t / 0.8);
      if (c !== this.lastCount) {
        this.lastCount = c;
        sfx.tick();
      }
      return;
    }
    if (this.lastCount !== 0) {
      this.lastCount = 0;
      sfx.go();
    }
    const k = Math.min(1, this.t / LEN);
    // player
    const sp = 120;
    let dir = (this.right ? 1 : 0) - (this.left ? 1 : 0);
    if (this.target != null && !dir) {
      const d = this.target - this.x;
      dir = Math.abs(d) < 2 ? 0 : Math.sign(d);
    }
    this.x = Math.max(11, Math.min(W - 11, this.x + dir * sp * dt));
    // spawn
    this.spawn -= dt;
    const pump = this.t >= PUMP;
    if (pump && !this.pumped) {
      this.pumped = true;
      sfx.go();
      this.pop.push({ txt: "RALLY!", x: 48, y: 40, t: -0.4, col: PAL.y });
    }
    if (this.spawn <= 0) {
      this.spawn = (pump ? 0.3 : 0.6 - k * 0.26) + Math.random() * 0.14;
      const r = Math.random();
      const red = 0.24 + k * 0.12;
      const coin = pump ? 0.3 : 0.12;
      const type = r < red ? "rcandle" : r < red + coin ? "coin" : "gcandle";
      this.items.push({ type, x: 8 + Math.random() * (W - 16), y: 4, v: (32 + k * 40 + Math.random() * 14) * this.slow });
    }
    // move + catch
    const py = 102;
    for (const it of this.items) {
      it.y += it.v * dt;
      if (!it.gone && it.y > py - 16 && it.y < py + 8 && Math.abs(it.x - this.x) < 11) {
        it.gone = true;
        if (it.type === "rcandle") {
          this.lives--;
          this.hurt = 0.35;
          if (this.streak >= 5) this.pop.push({ txt: "COMBO LOST", x: 34, y: 60, t: 0, col: PAL.r });
          this.streak = 0;
          sfx.hurt();
          this.pop.push({ txt: "-1", x: it.x, y: py - 14, t: 0, col: PAL.r });
        } else {
          this.streak++;
          this.best = Math.max(this.best, this.streak);
          const mult = this.streak >= 5 ? 2 : 1;
          const pts = (it.type === "coin" ? (this.p.core === "degen" ? 5 : 3) : 1) * mult;
          this.score += pts;
          it.type === "coin" ? sfx.coin() : sfx.catch();
          if (this.streak === 5) this.pop.push({ txt: "COMBO X2", x: 40, y: 60, t: 0, col: PAL.y }), sfx.coin();
          this.pop.push({ txt: "+" + pts, x: it.x, y: py - 14, t: 0, col: it.type === "coin" ? PAL.v : PAL.g });
        }
      }
    }
    this.items = this.items.filter((it) => !it.gone && it.y < W + 8);
    for (const p of this.pop) {
      p.t += dt;
      p.y -= 18 * dt;
    }
    this.pop = this.pop.filter((p) => p.t < 0.7);
    if (this.hurt > 0) this.hurt -= dt;
    if (this.lives <= 0 || this.t >= LEN) {
      this.over = 1.8;
      sfx.over();
    }
  }

  render(g) {
    const sc = this.sc;
    const [r, gg, b] = sc.bgRGB || [60, 40, 120];
    g.fillStyle = `rgb(${r * 0.28 | 0},${gg * 0.26 | 0},${b * 0.34 | 0})`;
    g.fillRect(0, 0, W, W);
    // a faint candle chart scrolling in the back
    const off = (this.t * 8) % 6;
    for (let i = 0; i < this.chart.length; i++) {
      const x = Math.round(i * 6 - off);
      const h = 6 + ((i * 7) % 9);
      const up = (i * 5) % 3 !== 0;
      g.fillStyle = up ? "rgba(70,227,143,0.16)" : "rgba(255,79,94,0.14)";
      g.fillRect(x, Math.round(this.chart[i]), 3, h);
      g.fillRect(x + 1, Math.round(this.chart[i]) - 3, 1, h + 6);
    }
    g.fillStyle = "rgba(255,255,255,0.08)";
    g.fillRect(0, 114, W, 1);
    for (const it of this.items) {
      const w = 7, h = it.type === "coin" ? 7 : 9;
      if (it.type === "coin" && Math.floor(this.t * 6) % 2) g.fillStyle = "rgba(255,216,77,0.3)", g.fillRect(Math.round(it.x - 9), Math.round(it.y - 9), 18, 18);
      draw(g, it.type, Math.round(it.x - w), Math.round(it.y - h), { scale: 2 });
    }
    // player: the pet's own face
    const shake = this.hurt > 0 ? (Math.floor(this.hurt * 40) % 2 ? 2 : -2) : 0;
    const bob = this.t > 0 && (this.left || this.right || this.target != null) ? Math.floor(this.t * 10) % 2 : 0;
    if (sc.face) {
      if (this.hurt > 0 && Math.floor(this.hurt * 30) % 2) g.globalAlpha = 0.5;
      g.drawImage(sc.face, Math.round(this.x - 11 + shake), 92 - bob);
      g.globalAlpha = 1;
    }
    g.fillStyle = "rgba(0,0,0,0.3)";
    g.fillRect(Math.round(this.x - 8), 115, 16, 2);
    for (const p of this.pop) text(g, p.txt, Math.round(p.x - 4), Math.round(p.y), p.col);
    // hud
    g.fillStyle = "rgba(20,10,46,0.75)";
    g.fillRect(0, 0, W, 11);
    text(g, String(this.score).padStart(3, "0"), 3, 3, PAL.y);
    for (let i = 0; i < this.maxLives; i++) draw(g, i < this.lives ? "life" : "lifeOff", W - 8 * this.maxLives + i * 8, 3);
    const left = Math.max(0, 1 - Math.max(0, this.t) / LEN);
    const bw = W - 8 * this.maxLives - 26;
    g.fillStyle = "#0d0820";
    g.fillRect(20, 4, bw, 3);
    g.fillStyle = this.t >= PUMP ? (Math.floor(this.t * 8) % 2 ? PAL.y : PAL.o) : left > 0.25 ? PAL.g : PAL.r;
    g.fillRect(20, 4, Math.round(bw * left), 3);
    if (this.streak >= 5 && this.t >= 0 && !this.over) text(g, "X2", 3, 14, Math.floor(this.t * 6) % 2 ? PAL.y : PAL.o);
    if (this.t >= PUMP && !this.over) {
      g.fillStyle = "rgba(255,216,77,0.08)";
      g.fillRect(0, 11, W, W - 11);
    }
    if (this.t < 0) {
      const c = Math.ceil(-this.t / 0.8);
      const s = String(c);
      g.fillStyle = "rgba(10,6,24,0.5)";
      g.fillRect(0, 11, W, W - 11);
      text(g, "CATCH", 16, 22, PAL.g, 2);
      draw(g, "gcandle", 64, 14, { scale: 2 });
      draw(g, "coin", 84, 16, { scale: 2 });
      text(g, "+1", 68, 34, "#d6d1e4");
      text(g, "+" + (this.p.core === "degen" ? 5 : 3), 89, 34, "#d6d1e4");
      text(g, "DODGE", 16, 50, PAL.r, 2);
      draw(g, "rcandle", 64, 44, { scale: 2 });
      text(g, "-1 LIFE", 84, 52, "#d6d1e4");
      text(g, s, Math.round((W - textWidth(s, 4)) / 2), 68, "#ffffff", 4);
    }
    if (this.over > 0) {
      g.fillStyle = "rgba(10,6,24,0.66)";
      g.fillRect(0, 11, W, W - 11);
      const t1 = this.lives <= 0 ? "OUCH!" : "TIME!";
      text(g, t1, Math.round((W - textWidth(t1, 2)) / 2), 40, this.lives <= 0 ? PAL.r : PAL.y, 2);
      const s = String(this.score);
      text(g, s, Math.round((W - textWidth(s, 4)) / 2), 60, "#ffffff", 4);
      text(g, "POINTS", 52, 86, "#a68bff");
      if (this.best >= 5) {
        const c = "BEST COMBO " + this.best;
        text(g, c, Math.round((W - textWidth(c)) / 2), 98, PAL.y);
      }
    }
  }
}
