import { TCP } from "@libp2p/tcp";
import { mplex } from "@libp2p/mplex";
import { Noise } from "@chainsafe/libp2p-noise";
import { StreamHandler } from "@libp2p/interface-registrar";
import type { Libp2pOptions } from "libp2p";
import { createLibp2p } from "libp2p";

const relays = {};

const unregister: StreamHandler = async ({ connection }) => {
  delete relays[connection.remotePeer.toString()];
};

const listRelays: StreamHandler = async ({ connection, stream }) => {
  //TODO: write this out
};

const register: StreamHandler = async ({ connection }) => {
  relays[connection.remotePeer.toString()] = {
    remoteAddr: connection.remoteAddr,
    remotePeer: connection.remotePeer,
  };
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
