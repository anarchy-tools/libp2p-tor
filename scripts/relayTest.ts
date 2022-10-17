import { runRelay } from "../src.ts/libp2p.wrapper.js";

const main = async () => {
  const node = await runRelay({
    addresses: {
      listen: ["/ip4/127.0.0.1/tcp/5000"],
      announce: ["/ip4/127.0.0.1/tcp/5000"],
    },
  });
};

main().then(() => {});
