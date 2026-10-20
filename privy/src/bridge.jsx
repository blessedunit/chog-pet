// Privy login for Chog Pet, built into public/js/privy.bundle.js (npm run build in this folder).
// The page loads it only when someone taps "Connect wallet" and the worker has a PRIVY_APP_ID.
// It hands back an EIP-1193 provider; the free personal_sign sign-in in wallet.js stays exactly the same,
// so the worker doesn't care whether the wallet came from MetaMask, WalletConnect or an X / email login.
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider, usePrivy, useWallets, useLogin } from "@privy-io/react-auth";
import { defineChain } from "viem";

const monad = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadVision", url: "https://monadvision.com" } },
});

const cancelled = () => Object.assign(new Error("Sign-in cancelled."), { code: 4001 });
const api = { ready: false };
let waiting = null; // { resolve, reject } of the login() in flight
const onReady = [];

function finish(fn, arg) {
  const w = waiting;
  waiting = null;
  if (w) w[fn](arg);
}

function Bridge() {
  const { ready, authenticated, logout } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const [ask, setAsk] = useState(0);
  const { login } = useLogin({
    onError: (code) => finish("reject", code === "exited_auth_flow" ? cancelled() : new Error("Sign-in failed.")),
  });
  api.login = login;
  api.logout = logout;
  api.authenticated = authenticated;
  api.ask = () => setAsk((n) => n + 1);
  useEffect(() => {
    api.ready = ready;
    if (ready) onReady.splice(0).forEach((f) => f());
  }, [ready]);
  // logged in and a wallet is there: hand it over (a wallet you connected beats a Privy email wallet)
  useEffect(() => {
    if (!waiting || !authenticated || !walletsReady || !wallets.length) return;
    const w = wallets.find((x) => x.walletClientType !== "privy") || wallets[0];
    const done = waiting;
    waiting = null;
    w.getEthereumProvider().then((provider) => done.resolve({ provider, address: w.address.toLowerCase() }), done.reject);
  }, [ask, authenticated, walletsReady, wallets]);
  return null;
}

// Privy can't start (wrong app id, origin not allowed, offline): say so instead of hanging
const untilReady = () =>
  api.ready
    ? Promise.resolve()
    : new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error("Sign-in isn't available right now. You can still babysit any Chog.")), 12000);
        onReady.push(() => (clearTimeout(t), res()));
      });

export function start(appId) {
  const el = document.createElement("div");
  el.id = "privy-root";
  document.body.appendChild(el);
  createRoot(el).render(
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["twitter", "wallet", "google", "email"],
        appearance: {
          theme: "dark",
          accentColor: "#8b5cf6",
          landingHeader: "Sign in to Chog Pet",
          loginMessage: "Free. No transaction, no gas.",
          showWalletLoginFirst: false,
          walletChainType: "ethereum-only",
          walletList: ["metamask", "rabby_wallet", "phantom", "okx_wallet", "coinbase_wallet", "rainbow", "wallet_connect"],
        },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        defaultChain: monad,
        supportedChains: [monad],
      }}
    >
      <Bridge />
    </PrivyProvider>,
  );
  return {
    async login() {
      await untilReady();
      finish("reject", cancelled());
      return new Promise((resolve, reject) => {
        waiting = { resolve, reject };
        if (api.authenticated) api.ask(); // still logged in to Privy from last time: just take the wallet
        else api.login();
      });
    },
    // back from X / Google: Privy finishes the login on its own after the redirect, so just wait for the wallet
    async resume() {
      await untilReady();
      finish("reject", cancelled());
      return new Promise((resolve, reject) => {
        waiting = { resolve, reject };
        api.ask();
        setTimeout(() => finish("reject", new Error("Sign-in didn't finish. Tap Sign in to try again.")), 30000);
      });
    },
    async logout() {
      await untilReady();
      if (api.authenticated) await api.logout();
    },
  };
}
