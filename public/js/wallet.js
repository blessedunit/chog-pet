// Optional wallet: find your Chogs and prove the one at home is yours. Only a free personal_sign, never a
// transaction, never a chain switch. With a Privy app id the wallet comes from Privy (any wallet over
// WalletConnect, or email/Google with a Privy wallet, so phones without MetaMask work too); without one,
// from the wallet built into the browser. The worker checks the same signature either way.
import { api, setSession } from "./api.js";

// must match worker/index.js
export const signText = (host, addr, ts) =>
  `Chog Pet sign-in\n\nSite: ${host}\nWallet: ${addr}\nChain: Monad (143)\nTime: ${ts}\n\nFree. This is not a transaction and costs no gas.`;

let privyId; // undefined = not asked yet, null = no Privy
let privy = null; // the loaded bridge
const config = () => (privyId !== undefined ? Promise.resolve(privyId) : api.config().then((c) => (privyId = (c && c.privy) || null), () => null));
config(); // ask early so the click doesn't wait
// a social login (X, Google) leaves the page and comes back with these in the URL: finish signing in then
export const backFromSocial = /[?&]privy_oauth_(code|state)=/.test(location.search);

export const hasWallet = async () => !!(await config()) || !!window.ethereum;

async function getPrivy() {
  if (!privy) {
    const { start } = await import("./privy/bridge.js");
    privy = start(privyId);
  }
  return privy;
}

// -> { provider, address }
async function connect(resume) {
  if (await config()) return resume ? (await getPrivy()).resume() : (await getPrivy()).login();
  const eth = window.ethereum;
  if (!eth) throw new Error("No wallet found in this browser. You can still babysit any Chog.");
  const [addr] = await eth.request({ method: "eth_requestAccounts" });
  return { provider: eth, address: addr.toLowerCase() };
}

export async function signIn(resume = false) {
  const { provider, address } = await connect(resume);
  // the server's clock, so a phone that is a few minutes off can still sign in
  const ts = await api.now().then((r) => r.now).catch(() => Math.floor(Date.now() / 1000));
  const msg = signText(location.host, address, ts);
  const hexMsg = "0x" + Array.from(new TextEncoder().encode(msg), (b) => b.toString(16).padStart(2, "0")).join("");
  const sig = await provider.request({ method: "personal_sign", params: [hexMsg, address] });
  const s = await api.auth(address, ts, sig);
  setSession(s);
  return s;
}

export function signOut() {
  setSession(null);
  // also end the Privy session, or the next sign-in would quietly reuse the same wallet
  if (privyId) getPrivy().then((p) => p.logout()).catch(() => {});
}
