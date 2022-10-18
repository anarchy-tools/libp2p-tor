import { EventEmitter } from "node:events";
import type { Libp2p, Libp2pOptions } from "libp2p";
import type { StreamHandler } from "@libp2p/interface-registrar";
import { createLibp2pNode } from "./libp2p.wrapper";
import { keys } from "@libp2p/crypto";
import type { ECDHKey } from "@libp2p/crypto/keys/interface";
import { pipe } from "it-pipe";
import { encode } from "it-length-prefixed";
import { Multiaddr } from "@multiformats/multiaddr";
import { PeerId } from "@libp2p/interface-peer-id";

export class Relay extends EventEmitter {
  private _libp2p: Libp2p;
  private permanentKey: ECDHKey;
  public registries: Multiaddr[];

  constructor(registries: Multiaddr[]) {
    super();
    this.registries = registries;
  }

  async run(
    options: Libp2pOptions = {
      addresses: {
        listen: ["/ip4/127.0.0.1/tcp/0"],
      },
    }
  ) {
    this.permanentKey = await keys.generateEphemeralKeyPair("P-256");
    this._libp2p = await createLibp2pNode(options);
    await this._libp2p.start();
    await this.register();
  }

  handle(protocol: string, handler: StreamHandler, options = {}) {
    return this._libp2p.handle(protocol, handler, options);
  }

  dialProtocol(peerId: Multiaddr | PeerId, protocol: string, options = {}) {
    //@ts-ignore
    return this._libp2p.dialProtocol(peerId, protocol, options);
  }

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
