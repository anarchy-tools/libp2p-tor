import { createLibp2pNode } from "./libp2p.wrapper";
import { RelayCell, Cell } from "./tor";
import { generateEphemeralKeyPair } from "@libp2p/crypto/keys";
import { toString } from "uint8arrays";
import { Multiaddr } from "@multiformats/multiaddr";
import type { Libp2pOptions } from "libp2p";
import { Libp2pWrapped } from "./libp2p.wrapper";
import { pipe } from "it-pipe";
import { decode } from "it-length-prefixed";

export class Router extends Libp2pWrapped {
  public registries: Multiaddr[];
  public proxies: { publicKey: Uint8Array; id: string }[];

  constructor(registries: Multiaddr[]) {
    super();
    this.registries = registries;
  }

  async build() {
    return await generateEphemeralKeyPair("P-256");
  }

  async fetchKeys() {
    this.proxies = await this.registries.reduce<
      Promise<{ id: string; publicKey: any }[]>
    >(async (results, registry) => {
      const stream = await this._libp2p.dialProtocol(
        //@ts-ignore
        registry,
        "/tor/1.0.0/relays"
      );
      const _results = await pipe(
        stream.source,
        decode(),
        async function (source) {
          let str = "";
          for await (const data of source) {
            str += toString(data.subarray());
          }
          const _peers = JSON.parse(str);
          return _peers.map(
            ({ id, publicKey }: { id: string; publicKey: any }) => ({
              id,
              publicKey: Uint8Array.from(Object.values(publicKey)),
            })
          );
        }
      );

      return [...(await results), ..._results];
    }, Promise.resolve([]));
  }

  async run(options: Libp2pOptions) {
    await super.run(options);
  }
}
