import { http, createConfig, fallback } from "wagmi";
import { arbitrumSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const config = createConfig({
  chains: [arbitrumSepolia],
  connectors: [injected()],
  transports: {
    [arbitrumSepolia.id]: fallback([
      http("https://arb-sepolia.g.alchemy.com/v2/demo"),
      http("https://sepolia-rollup.arbitrum.io/rpc"),
    ]),
  },
  pollingInterval: 4000,
});
