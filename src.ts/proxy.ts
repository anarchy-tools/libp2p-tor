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
import * as crypto from "@libp2p/crypto";
import type { PrivateKey } from "@libp2p/interface-keys";
import { iv } from "./constants";

export class Proxy extends Libp2pWrapped {
  private torKey: PrivateKey;
  public registries: Multiaddr[];
  private keys: Record<
    number,
    {
      sharedKey: Uint8Array;
      key: ECDHKey;
      aes: crypto.aes.AESCipher;
      publicKey: Uint8Array;
    }
  >;

  constructor(registries: Multiaddr[]) {
    super();
    this.registries = registries;
    this.keys = {};
    this.torKey = null;
  }

  async run(
    options: Libp2pOptions = {
      addresses: {
        listen: ["/ip4/127.0.0.1/tcp/0"],
      },
    }
  ) {
    await super.run(options);
    this.torKey = await crypto.keys.generateKeyPair("RSA", 1024);
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
      //@ts-ignore
      const cellData: Uint8Array = Uint8Array.from(
        //@ts-ignore
        await this.torKey.decrypt((cell.data as Uint8Array).slice(0, 128))
      );
      const ecdhKey = await generateEphemeralKeyPair("P-256");
      const sharedKey = await ecdhKey.genSharedKey(cellData);
      this.keys[`${cell.circuitId}`] = {
        sharedKey,
        key: ecdhKey,
        aes: await crypto.aes.create(sharedKey, iv),
        publicKey: cellData,
      };

      const hmac = await crypto.hmac.create("SHA256", sharedKey);
      const digest = await hmac.digest(sharedKey);
      console.log(digest.length);
      const data = new Uint8Array(digest.length + ecdhKey.key.length);
      data.set(ecdhKey.key);
      data.set(digest, ecdhKey.key.length);
      pipe(
        [
          new Cell({
            circuitId: cell.circuitId,
            command: CellCommand.CREATED,
            data,
          }).encode(),
        ],
        encode(),
        stream.sink
      );
    }
  };

  async register() {
    await this.registries.reduce<any>(async (_a, registry) => {
      try {
        const stream = await this.dialProtocol(registry, "/tor/1.0.0/register");
        pipe(
          [
            fromString(
              JSON.stringify({
                key: this.torKey.public.marshal(),
                addr: this._libp2p.getMultiaddrs()[0].toString(),
              })
            ),
          ],
          encode(),
          stream.sink
        );
        await pipe(stream.source, decode(), async (source) => {
          for await (const data of source) {
            if (data.subarray()[0] != 1) throw new Error();
          }
        });
      } catch (e) {
        console.log(e);
      }
    }, Promise.resolve());
  }

  key() {
    return this.torKey.public.marshal();
  }
}
