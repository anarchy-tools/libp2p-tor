import { Registry } from "../src.ts/registry.js";
import { Relay } from "../src.ts/relay.js";
import { toString, equals } from "uint8arrays";
import { pipe } from "it-pipe";
import { decode } from "it-length-prefixed";
import { expect } from "chai";

describe("registry", () => {
  let registry,
    relays = [];

  before(async () => {
    registry = new Registry();
    await registry.run({
      addresses: {
        listen: ["/ip4/127.0.0.1/tcp/5000"],
        announce: ["/ip4/127.0.0.1/tcp/5000"],
      },
    });
    relays.push(new Relay(registry._libp2p.getMultiaddrs()));
  });

  it("should run the registry", async () => {
    const relay = relays[0];
    await relay.run({
      addresses: {
        listen: ["/ip4/127.0.0.1/tcp/0"],
        announce: ["/ip4/127.0.0.1/tcp/5000"],
      },
    });
    const stream = await relay.dialProtocol(
      registry._libp2p.getMultiaddrs()[0],
      "/tor/1.0.0/relays"
    );
    await new Promise<void>((resolve) => {
      pipe(stream.source, decode(), async function (source) {
        let str = "";
        for await (const data of source) {
          str += toString(data.subarray());
        }
        const peer = JSON.parse(str);
        const pubKey = Uint8Array.from(Object.values(peer.publicKey));
        expect(equals(pubKey, relay.key())).to.equal(true);
        resolve();
      });
    });
  });
});
