import { Registry } from "../src.ts/registry.js";
import { Proxy } from "../src.ts/proxy.js";
import { Router } from "../src.ts/router";
import { equals } from "uint8arrays";
import { expect } from "chai";

describe("registry", () => {
  let registry: Registry,
    proxies = [],
    router: Router;

  before(async () => {
    registry = new Registry();
    await registry.run();
    Array.from(new Array(5)).map(() =>
      proxies.push(new Proxy(registry._libp2p.getMultiaddrs()))
    );
    router = new Router(registry._libp2p.getMultiaddrs());
    await router.run({
      addresses: {
        listen: ["/ip4/127.0.0.1/tcp/0"],
      },
    });
  });

  it("should give the correct pubkey for the correct relay", async () => {
    const proxy = proxies[0];
    await proxy.run();

    await router.fetchKeys();
    const pubKey = router.proxies[0].publicKey;
    expect(equals(pubKey, proxy.key())).to.equal(true);
  });

  it("should perform a handshake with relays", async () => {
    await proxies.reduce(async (_, proxy) => {
      await proxy.run();
    }, Promise.resolve());
  });
});
