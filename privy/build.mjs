import { build } from "esbuild";
// Optional peers of Privy we don't use (Solana, Stripe onramp, AGW, account abstraction) are stubbed out.
// Pass 1 learns which names Privy imports from each stub, pass 2 builds with exactly those names.
const STUB = [/^@stripe\/stripe-js/, /^@solana\//, /^@solana-program\//, /^@farcaster\/mini-app-solana/, /^@abstract-foundation\//, /^permissionless/];
const want = new Map();
const NL = String.fromCharCode(10);
const stub = {
  name: "stub",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => (STUB.some((r) => r.test(a.path)) ? { path: a.path, namespace: "stub" } : undefined));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => {
      const names = [...(want.get(a.path) || [])];
      const lines = [
        'const n = new Proxy(function () {}, { get: () => n, apply: () => { throw new Error("not in Chog Pet"); }, construct: () => { throw new Error("not in Chog Pet"); } });',
        "export default n;",
        ...names.map((x, i) => `const s${i} = n; export { s${i} as ${x} };`),
      ];
      return { contents: lines.join(NL), loader: "js" };
    });
  },
};
const opts = {
  entryPoints: ["src/bridge.jsx"],
  bundle: true,
  format: "esm",
  splitting: true,
  outdir: "../public/js/privy",
  entryNames: "bridge",
  chunkNames: "c-[hash]",
  minify: true,
  target: "es2020",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', global: "globalThis" },
  logLevel: "silent",
  logLimit: 0,
  legalComments: "none",
  plugins: [stub],
};
try {
  await build({ ...opts, write: false });
} catch (e) {
  for (const er of e.errors || []) {
    const m = /No matching export in "stub:([^"]+)" for import "([^"]+)"/.exec(er.text);
    if (!m) {
      console.error(er.text);
      process.exit(1);
    }
    if (!want.has(m[1])) want.set(m[1], new Set());
    want.get(m[1]).add(m[2]);
  }
}
await build({ ...opts, logLevel: "error" });
console.log("built ../public/js/privy/bridge.js");
