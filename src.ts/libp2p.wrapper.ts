import type { Libp2p, Libp2pOptions } from "libp2p";
import { createLibp2p } from "libp2p";
import { TCP } from "@libp2p/tcp";
import { mplex } from "@libp2p/mplex";
import { Noise } from "@chainsafe/libp2p-noise";

export async function createLibp2pNode(
  options: Libp2pOptions
): Promise<Libp2p> {
  options.transports = [new TCP()];
  //@ts-ignore
  options.connectionEncryption = [new Noise()];
  //@ts-ignore
  options.streamMuxers = [mplex()()];

  return await createLibp2p(options);
}
