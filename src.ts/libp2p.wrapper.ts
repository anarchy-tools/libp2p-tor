import { TCP } from "@libp2p/tcp";
import { mplex } from "@libp2p/mplex";
import { Noise } from "@chainsafe/libp2p-noise";
import { StreamHandler } from "@libp2p/interface-registrar";
import type { Libp2pOptions } from "libp2p";
import { createLibp2p } from "libp2p";
import { fromString } from "uint8arrays";
import { deserializePeerId } from "./util.js";
import { encode } from "it-length-prefixed";
import { pipe } from "it-pipe";

const relays: Record<string, any> = {};

const unregister: StreamHandler = async ({ connection }) => {
  delete relays[connection.remotePeer.toString()];
};

const listRelays: StreamHandler = async ({ stream }) => {
  pipe(
    Object.values(relays).map((d) => fromString(JSON.stringify(d))),
    encode(),
    stream.sink
  );
};

const register: StreamHandler = async ({ connection }) => {
  (relays[connection.remotePeer.toString()] = deserializePeerId(
    connection.remotePeer
  )),
    console.log("registered peer");
};

export const runRelay = async (options: Libp2pOptions) => {
  //@ts-ignore
  options.transports = [new TCP()];
  //@ts-ignore
  options.connectionEncryption = [new Noise()];
  //@ts-ignore
  options.streamMuxers = [mplex()()];

  const node = await createLibp2p(options);
  await node.start();

  node.handle("/tor/1.0.0/register", register, {});
  node.handle("/tor/1.0.0/unregister", unregister, {});
  node.handle("/tor/1.0.0/relays", listRelays, {});
  return node;
};
