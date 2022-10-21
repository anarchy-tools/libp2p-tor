import type { Libp2pOptions } from "libp2p";
import { Libp2pWrapped } from "./libp2p.wrapper";
import { generateEphemeralKeyPair } from "@libp2p/crypto/keys";
import type { ECDHKey } from "@libp2p/crypto/keys/interface";
import { pipe } from "it-pipe";
import { encode, decode } from "it-length-prefixed";
import { Multiaddr } from "@multiformats/multiaddr";
import { Cell, CellCommand, RelayCell } from "./tor";
import { StreamHandler } from "@libp2p/interface-registrar";
import { fromString } from "uint8arrays";
import { Buffer } from "node:buffer";
import * as crypto from "@libp2p/crypto";

export class Proxy extends Libp2pWrapped {
  private torKey: ECDHKey;
  public registries: Multiaddr[];
  public pubKeys: Record<number, Uint8Array>;
  private keys: Record<
    number,
    { sharedKey: Uint8Array; aes: crypto.aes.AESCipher }
  >;

  constructor(registries: Multiaddr[]) {
    super();
    this.registries = registries;
    this.pubKeys = {};
    this.keys = {};
  }

  async run(
    options: Libp2pOptions = {
      addresses: {
        listen: ["/ip4/127.0.0.1/tcp/0"],
      },
    }
  ) {
    await super.run(options);
    this.torKey = await generateEphemeralKeyPair("P-256");
    await this.register();
    await this.handle("/tor/1.0.0/message", this.handleTorMessage);
  }

  handleTorMessage: StreamHandler = async ({ stream }) => {
    const cell = await pipe(stream.source, decode(), async (source) => {
      let _cell: Cell;
      for await (const data of source) {
        _cell = Cell.from(data.subarray());
      }
      return _cell;
    });
    if (cell.command == CellCommand.CREATE) {
      cell.data = (cell.data as Uint8Array).slice(0, 65);
      this.pubKeys[`${cell.circuitId}`] = cell.data;
      const sharedKey = await this.torKey.genSharedKey(cell.data);
      const key = (this.keys[`${cell.circuitId}`] = {
        sharedKey,
        aes: await crypto.aes.create(
          sharedKey,
          Uint8Array.from([
            0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
          ])
        ),
      });
      pipe(
        [
          await key.aes.encrypt(
            new Cell({
              circuitId: cell.circuitId,
              command: CellCommand.CREATED,
              data: Uint8Array.from([]),
            }).encode()
          ),
        ],
        encode(),
        stream.sink
      );
    }
  };

  async register() {
    await this.registries.reduce<any>(async (_a, registry) => {
      const stream = await this.dialProtocol(registry, "/tor/1.0.0/register");
      pipe([this.torKey.key], encode(), stream.sink);
      await pipe(stream.source, decode(), async (source) => {
        for await (const data of source) {
          if (data.subarray()[0] != 1) throw new Error();
        }
      });
    }, Promise.resolve());
  }

  key() {
    return this.torKey.key;
  }
}
