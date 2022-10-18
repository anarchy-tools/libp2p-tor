import { StreamHandler } from "@libp2p/interface-registrar";
import { createLibp2p, Libp2p, Libp2pOptions } from "libp2p";
import { createLibp2pNode } from "./libp2p.wrapper";
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
    const keys = JSON.stringify(
      Object.entries(this.relays).map(([id, publicKey]) => ({
        id,
        publicKey,
      }))
    );
    pipe([fromString(keys)], encode(), stream.sink);
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
  run = async (
    options: Libp2pOptions = {
      addresses: {
        listen: ["/ip4/127.0.0.1/tcp/5000"],
      },
    }
  ) => {
    this._libp2p = await createLibp2pNode(options);
    await this._libp2p.start();

    this._libp2p.handle("/tor/1.0.0/register", this.register, {});
    this._libp2p.handle("/tor/1.0.0/unregister", this.unregister, {});
    this._libp2p.handle("/tor/1.0.0/relays", this.listRelays, {});
  };
}
