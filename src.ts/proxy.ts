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

export class Proxy extends Libp2pWrapped {
  private permanentKey: ECDHKey;
  public registries: Multiaddr[];
  public keys: Record<number, Uint8Array>;

  constructor(registries: Multiaddr[]) {
    super();
    this.registries = registries;
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
    this.permanentKey = await generateEphemeralKeyPair("P-256");
    await this.register();
    this._libp2p.handle("/tor/1.0.0/message", this.handleTorMessage);
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
      this.keys[`${cell.circuitId}`] = cell.data;
    }
  };

  async register() {
    await this.registries.reduce<any>(async (_a, registry) => {
      const stream = await this._libp2p.dialProtocol(
        //@ts-ignore
        registry,
        "/tor/1.0.0/register"
      );
      pipe([this.permanentKey.key], encode(), stream.sink);
    }, Promise.resolve());
  }

  key() {
    return this.permanentKey.key;
  }
}
