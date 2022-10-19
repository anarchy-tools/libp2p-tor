import { Registry } from "../src.ts/registry.js";
import { Proxy } from "../src.ts/proxy.js";
import { Router } from "../src.ts/router";
import { equals } from "uint8arrays";
import { expect } from "chai";
import { Cell, CellCommand } from "../src.ts/tor";
import { encode, decode } from "it-length-prefixed";
import { pipe } from "it-pipe";
import { toString } from "uint8arrays";

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
    await router.fetchKeys();
    const stream = await router.dialProtocol(
      proxies[0]._libp2p.getMultiaddrs()[0],
      "/tor/1.0.0/message"
    );
    const { key, genSharedKey } = await router.build();
    const create = new Cell({
      circuitId: 1,
      command: CellCommand.CREATE,
      data: key,
    });
    pipe([create.encode()], encode(), stream.sink);
    console.log("sent cell");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const encodedCell = await pipe(stream.source, decode(), async (source) => {
      let b: Buffer;
      for await (const data of source) {
        b = Buffer.from(data.subarray());
      }
      return b;
    });
    console.log(encodedCell.readUint8(2));
    console.log(equals(proxies[0].keys[create.circuitId], key));
  });
});
