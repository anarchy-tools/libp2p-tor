import { EventEmitter } from "node:events";
import { createLibp2p } from "libp2p";
import type { Libp2p, Libp2pOptions } from "libp2p";
import { mplex } from "@libp2p/mplex";
import { Noise } from "@chainsafe/libp2p-noise";
import { TCP } from "@libp2p/tcp";
import { keys } from "@libp2p/crypto";
import type { ECDHKey } from "@libp2p/crypto/keys/interface";
import { pipe } from "it-pipe";
import { encode } from "it-length-prefixed";
import { Multiaddr } from "@multiformats/multiaddr";

export class Relay extends EventEmitter {
  private _libp2p: Libp2p;
  private key: ECDHKey;
  public registries: Multiaddr[];

  constructor(registries: Multiaddr[]) {
    super();
    this.registries = registries;
  }

  async run(options: Libp2pOptions) {
    //@ts-ignore
    options.transports = [new TCP()];
    //@ts-ignore
    options.connectionEncryption = [new Noise()];
    //@ts-ignore
    options.streamMuxers = [mplex()()];

    this.key = await keys.generateEphemeralKeyPair("P-256");
    this._libp2p = await createLibp2p(options);
    await this._libp2p.start();
    await this.register();
  }

  handle(protocol, handler, options = {}) {
    return this._libp2p.handle(protocol, handler, options);
  }

  dialProtocol(peerId, protocol, options = {}) {
    return this._libp2p.dialProtocol(peerId, protocol, options);
  }

  async register() {
    await this.registries.reduce<any>(async (_a, registry) => {
      const stream = await this._libp2p.dialProtocol(
        //@ts-ignore
        registry,
        "/tor/1.0.0/register"
      );
      pipe([this.key.key], encode(), stream.sink);
    }, Promise.resolve());
  }
}
