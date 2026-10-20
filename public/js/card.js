// Share card (1200x630): the Chog's screen on the device, its mood and its day at home.
import { draw, PAL } from "./sprites.js";
import { stageOf } from "./sim.js";

const MONO = "'Departure Mono', monospace";

const MOOD_WORD = {
  happy: "having the best day",
  content: "doing fine",
  hungry: "hungry",
  bored: "bored",
  sleepy: "sleepy",
  stinky: "a bit stinky",
  miserable: "needs love",
  asleep: "fast asleep",
  away: "out looking for snacks",
};

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export async function makeCard({ screenCanvas, pet, persona, days, ownerView, bg }) {
  await Promise.all([document.fonts.load("700 64px Silkscreen"), document.fonts.load(`32px ${MONO}`)]).catch(() => {});
  const c = document.createElement("canvas");
  c.width = 1200;
  c.height = 630;
  const g = c.getContext("2d");
  const [r, gg, b] = bg || [120, 90, 220];
  const grad = g.createLinearGradient(0, 0, 1200, 630);
  grad.addColorStop(0, "#160d2e");
  grad.addColorStop(1, "#2a1660");
  g.fillStyle = grad;
  g.fillRect(0, 0, 1200, 630);
  // glow in the Chog's own colour
  const rg = g.createRadialGradient(330, 330, 20, 330, 330, 360);
  rg.addColorStop(0, `rgba(${r},${gg},${b},0.55)`);
  rg.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = rg;
  g.fillRect(0, 0, 1200, 630);
  // stars
  for (let i = 0; i < 70; i++) {
    g.fillStyle = i % 4 ? "rgba(190,175,255,0.5)" : "rgba(255,255,255,0.9)";
    const s = i % 5 ? 3 : 6;
    g.fillRect((i * 173) % 1200, (i * 97) % 630, s, s);
  }
  // the device
  const dx = 120, dy = 70, dw = 420, dh = 500;
  const sh = g.createLinearGradient(dx, dy, dx + dw, dy + dh);
  const SHELL = {
    Common: ["#cdbdff", "#8a68ff", "#4d2fc2", "#ff7bb5"],
    Uncommon: ["#d7fff1", "#2db897", "#157a68", "#ff7bb5"],
    Rare: ["#ffe0ef", "#f0559a", "#a8256a", "#8b6cff"],
    Epic: ["#fff6c8", "#f0a91f", "#a8650b", "#8b6cff"],
    Legendary: ["#ffffff", "#ffd1f0", "#9fd8ff", "#ffd84d"],
  };
  const col = SHELL[persona.tier] || (persona.tier === "1:1" ? SHELL.Legendary : SHELL.Common);
  sh.addColorStop(0, col[0]);
  sh.addColorStop(0.45, col[1]);
  sh.addColorStop(1, col[2]);
  g.save();
  g.shadowColor = "rgba(0,0,0,0.55)";
  g.shadowBlur = 50;
  g.shadowOffsetY = 24;
  g.beginPath();
  g.ellipse(dx + dw / 2, dy + dh / 2, dw / 2, dh / 2, 0, 0, Math.PI * 2);
  g.fillStyle = sh;
  g.fill();
  g.restore();
  g.fillStyle = "rgba(255,255,255,0.22)";
  g.beginPath();
  g.ellipse(dx + 120, dy + 90, 80, 34, -0.5, 0, Math.PI * 2);
  g.fill();
  // bezel + screen
  const sx = dx + 82, sy = dy + 104, ss = 256;
  g.fillStyle = "#24164f";
  rr(g, sx - 22, sy - 22, ss + 44, ss + 44, 34);
  g.fill();
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.save();
  rr(g, sx, sy, ss, ss, 10);
  g.clip();
  g.drawImage(screenCanvas, sx, sy, ss, ss);
  g.restore();
  // the four meters, like the strip under the screen
  const st = pet.state || {};
  [["food", "#ffb04d"], ["fun", "#ff7bb5"], ["energy", "#ffd84d"], ["clean", "#7cc4ff"]].forEach(([k, c], i) => {
    const bx = dx + 92 + i * 62, by = dy + 418, v = Math.max(0, Math.min(100, st[k] || 0));
    g.fillStyle = "rgba(20,10,46,0.55)";
    rr(g, bx, by, 52, 12, 4);
    g.fill();
    g.fillStyle = c;
    rr(g, bx + 2, by + 2, Math.max(2, (48 * v) / 100), 8, 3);
    g.fill();
  });

  // text side
  const x0 = 620;
  g.fillStyle = PAL.y;
  g.font = "700 30px Silkscreen";
  g.fillText("CHOG PET", x0, 120);
  g.fillStyle = "#ffffff";
  g.font = "700 64px Silkscreen";
  const name = pet.name.length > 14 ? pet.name.slice(0, 14) : pet.name;
  g.fillText(name, x0, 200);
  g.fillStyle = "#b9adde";
  g.font = `26px ${MONO}`;
  g.fillText(`${persona.title}${pet.name !== pet.nftName ? " · " + pet.nftName : ""}`, x0, 246);

  if (pet.state.away) {
    g.fillStyle = PAL.x;
    g.font = `40px ${MONO}`;
    g.fillText("Out looking for snacks", x0, 330);
  } else {
    // the age is the hook: big day count, its stage beside it
    g.fillStyle = PAL.y;
    g.font = `64px ${MONO}`;
    const dayT = `DAY ${days}`;
    g.fillText(dayT, x0, 334);
    const dw = g.measureText(dayT).width;
    g.fillStyle = "#ffffff";
    g.font = `24px ${MONO}`;
    g.fillText(stageOf(days).name.toUpperCase(), x0 + dw + 22, 306);
    g.fillStyle = "#b9adde";
    g.font = `20px ${MONO}`;
    g.fillText(ownerView ? "at home with me" : "in its home", x0 + dw + 22, 332);
  }
  g.fillStyle = "#d8cff5";
  g.font = `26px ${MONO}`;
  g.fillText(`Today it's ${MOOD_WORD[pet.mood] || pet.mood}.`, x0, 378);

  // meters
  const rows = [["h_food", "Food", pet.state.food], ["h_fun", "Fun", pet.state.fun], ["h_energy", "Energy", pet.state.energy], ["h_clean", "Clean", pet.state.clean]];
  rows.forEach(([ic, label, v], i) => {
    const y = 402 + i * 34;
    draw(g, ic, x0, y, { scale: 4 });
    g.fillStyle = "#9f93c8";
    g.font = `20px ${MONO}`;
    g.fillText(label, x0 + 42, y + 22);
    g.fillStyle = "rgba(255,255,255,0.1)";
    g.fillRect(x0 + 140, y + 6, 300, 16);
    g.fillStyle = v > 50 ? PAL.g : v > 25 ? PAL.y : PAL.r;
    g.fillRect(x0 + 140, y + 6, Math.round((300 * v) / 100), 16);
    // pixel ticks, like the bars on the page
    g.fillStyle = "rgba(0,0,0,0.18)";
    for (let k = 0; k < 300; k += 6) g.fillRect(x0 + 140 + k, y + 6, 3, 16);
  });

  g.fillStyle = PAL.x;
  g.font = `24px ${MONO}`;
  g.fillText(location.host, x0, 604);
  g.fillStyle = "#8d86a3";
  g.font = `18px ${MONO}`;
  g.fillText("a pet for every Chog Genesis NFT", x0 + 2, 568);
  return c;
}
