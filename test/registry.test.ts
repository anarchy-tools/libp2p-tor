import { Registry } from "../src.ts/registry.js";
import { Relay } from "../src.ts/relay.js";
import { createLibp2pNode } from "../src.ts/libp2p.wrapper.js";
import { toString, equals } from "uint8arrays";
import { pipe } from "it-pipe";
import { decode } from "it-length-prefixed";
import { expect } from "chai";
import { Libp2p } from "libp2p";

describe("registry", () => {
  let registry: Registry,
    relays = [],
    node: Libp2p;

  async function fetchKeys() {
    const stream = await node.dialProtocol(
      registry._libp2p.getMultiaddrs()[0],
      "/tor/1.0.0/relays"
    );
    return new Promise<{ publicKey: Uint8Array; id: string }[]>((resolve) => {
      pipe(stream.source, decode(), async function (source) {
        let str = "";
        for await (const data of source) {
          str += toString(data.subarray());
        }
        const _peers = JSON.parse(str);
        resolve(
          _peers.map(({ id, publicKey }: { id: string; publicKey: any }) => ({
            id,
            publicKey: Uint8Array.from(Object.values(publicKey)),
          }))
        );
      });
    });
  }

  before(async () => {
    registry = new Registry();
    await registry.run();
    Array.from(new Array(5)).map(() =>
      relays.push(new Relay(registry._libp2p.getMultiaddrs()))
    );
    node = await createLibp2pNode({
      addresses: {
        listen: ["/ip4/127.0.0.1/tcp/0"],
      },
    });
  });

  it("should give the correct pubkey for the correct relay", async () => {
    const relay = relays[0];
    await relay.run();

    const peers = await fetchKeys();
    const pubKey = peers[0].publicKey;
    expect(equals(pubKey, relay.key())).to.equal(true);
  });

  it("should perform a handshake with relays", async () => {
    await relays.reduce(async (_, relay) => {
      await relay.run();
    }, Promise.resolve());
  });
});
