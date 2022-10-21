import { RelayCell, Cell, CellCommand } from "./tor";
import { generateEphemeralKeyPair } from "@libp2p/crypto/keys";
import { toString } from "uint8arrays";
import { Multiaddr } from "@multiformats/multiaddr";
import type { Libp2pOptions } from "libp2p";
import { Libp2pWrapped } from "./libp2p.wrapper";
import { pipe } from "it-pipe";
import { encode, decode } from "it-length-prefixed";
import { ECDHKey } from "@libp2p/crypto/keys/interface";
import * as crypto from "@libp2p/crypto";
import { Buffer } from "node:buffer";
import { multiaddr } from "multiaddr";

export class Router extends Libp2pWrapped {
  public registries: Multiaddr[];
  public proxies: { publicKey: Uint8Array; id: string; addr: Multiaddr }[];
  public keys: Record<
    number,
    {
      ecdhKey: ECDHKey;
      hop: Multiaddr;
      key: Uint8Array;
      aes: crypto.aes.AESCipher;
    }
  >;

  constructor(registries: Multiaddr[]) {
    super();
    this.registries = registries;
    this.keys = {};
  }

  async build(length: number = 1) {
    const circId = Buffer.from(crypto.randomBytes(2)).readUint16BE();
    const { genSharedKey, key } = await generateEphemeralKeyPair("P-256");
    //@TODO: change
    const proxy = this.proxies[0];
    const sharedKey = await genSharedKey(proxy.publicKey);
    const node = (this.keys[circId] = {
      ecdhKey: {
        genSharedKey,
        key,
      },
      key: sharedKey,
      hop: proxy.addr,
      aes: await crypto.aes.create(
        sharedKey,
        Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
      ),
    });
    const create = new Cell({
      circuitId: 1,
      command: CellCommand.CREATE,
      data: key,
    });
    const stream = await this.dialProtocol(node.hop, "/tor/1.0.0/message");
    pipe([create.encode()], encode(), stream.sink);
    const cell = await pipe(stream.source, decode(), async (source) => {
      let _cell: Cell;
      for await (const data of source) {
        _cell = Cell.from(Buffer.from(await node.aes.decrypt(data.subarray())));
        break;
      }
      return _cell;
    });
    return cell;
  }

  async fetchKeys() {
    this.proxies = await this.registries.reduce<
      Promise<{ id: string; addr: Multiaddr; publicKey: any }[]>
    >(async (results, registry) => {
      try {
        const stream = await this.dialProtocol(registry, "/tor/1.0.0/relays");
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
              ({
                id,
                addr,
                publicKey,
              }: {
                id: string;
                publicKey: any;
                addr: string;
              }) => {
                return {
                  id,
                  addr: multiaddr(addr),
                  publicKey: Uint8Array.from(Object.values(publicKey)),
                };
              }
            );
          }
        );

        return [...(await results), ..._results];
      } catch (e) {
        console.log(e);
      }
    }, Promise.resolve([]));
  }

  async run(options: Libp2pOptions) {
    await super.run(options);
    await this.fetchKeys();
  }
}
