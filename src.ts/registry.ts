import { TCP } from "@libp2p/tcp";
import { mplex } from "@libp2p/mplex";
import { Noise } from "@chainsafe/libp2p-noise";
import { StreamHandler } from "@libp2p/interface-registrar";
import type { Libp2p, Libp2pOptions } from "libp2p";
import { createLibp2p } from "libp2p";
import { fromString, toString } from "uint8arrays";
import { encode, decode } from "it-length-prefixed";
import { pipe } from "it-pipe";
import { EventEmitter } from "node:events";

export class Registry extends EventEmitter {
  private relays: Record<string, any> = {};
  public _libp2p: Libp2p;
  unregister: StreamHandler = async ({ connection }) => {
    delete this.relays[connection.remotePeer.toString()];
  };

  listRelays: StreamHandler = async ({ stream }) => {
    pipe(
      Object.entries(this.relays).map(([id, publicKey]) =>
        fromString(JSON.stringify({ id, publicKey }))
      ),
      encode(),
      stream.sink
    );
  };

  register: StreamHandler = async ({ connection, stream }) => {
    const pubKey = await new Promise((resolve) => {
      pipe(stream.source, decode(), async (source) => {
        let key = Uint8Array.from([]);
        let merged: Uint8Array;
        for await (let data of source) {
          merged = new Uint8Array(key.length + data.length);
          merged.set(key);
          merged.set(data.subarray(), key.length);
          key = merged;
        }
        resolve(key);
      });
    });
    this.relays[connection.remotePeer.toString()] = pubKey;
    console.log("registered peer");
  };
  run = async (options: Libp2pOptions) => {
    //@ts-ignore
    options.transports = [new TCP()];
    //@ts-ignore
    options.connectionEncryption = [new Noise()];
    //@ts-ignore
    options.streamMuxers = [mplex()()];

    this._libp2p = await createLibp2p(options);
    this._libp2p.start();

    this._libp2p.handle("/tor/1.0.0/register", this.register, {});
    this._libp2p.handle("/tor/1.0.0/unregister", this.unregister, {});
    this._libp2p.handle("/tor/1.0.0/relays", this.listRelays, {});
  };
}
