// Talking to the Chog Pet worker, plus who "you" are: an anonymous sitter id per browser, or a signed wallet.
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
    } catch {}
  },
};
export { store };

let anon = store.get("pet.anon");
if (!anon || !/^[a-z0-9]{8,40}$/.test(anon)) {
  anon = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join("");
  store.set("pet.anon", anon);
}
export const me = {
  anon,
  token: store.get("pet.token"),
  address: store.get("pet.addr"),
  holder: store.get("pet.holder") === "1",
};
export function setSession(s) {
  me.token = s ? s.token : null;
  me.address = s ? s.address : null;
  me.holder = !!(s && s.holder);
  store.set("pet.token", me.token);
  store.set("pet.addr", me.address);
  store.set("pet.holder", me.holder ? "1" : null);
}

async function call(path, body) {
  const headers = {};
  if (me.token) headers.authorization = "Bearer " + me.token;
  if (body) headers["content-type"] = "application/json";
  const r = await fetch(path, body ? { method: "POST", headers, body: JSON.stringify(body) } : { headers });
  let j = null;
  try {
    j = await r.json();
  } catch {}
  if (!r.ok && !(j && j.code === "cooldown")) throw Object.assign(new Error((j && j.error) || "network"), { status: r.status, body: j });
  return j;
}

export const api = {
  pet: (id) => call(`/api/pet/${id}?viewer=${me.token ? me.address : me.anon}`),
  act: (id, action, extra = {}) => call(`/api/pet/${id}/act`, { action, ...extra, anon: me.anon }),
  ticket: (id) => call(`/api/pet/${id}/ticket`, { anon: me.anon }),
  name: (id, name) => call(`/api/pet/${id}/name`, { name }),
  board: () => call("/api/board"),
  town: () => call("/api/town"),
  now: () => call("/api/now"),
  config: () => call("/api/config"),
  line: () => call("/api/line"),
  stats: () => call("/api/stats"),
  auth: (address, ts, signature) => call("/api/auth", { address, ts, signature }),
  meCheck: () => call("/api/me"),
};
