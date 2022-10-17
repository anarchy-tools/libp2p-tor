import type { PeerId } from "@libp2p/interface-peer-id";
import { peerIdFromString } from "@libp2p/peer-id";
import { toString } from "uint8arrays";

export function deserializePeerId(peerID: PeerId) {
  console.log(peerID.publicKey);
  return {
    id: peerID.toString(),
    publicKey: peerID.publicKey,
    multihash: {
      bytes: peerID.multihash.bytes,
      digest: peerID.multihash.digest,
      size: peerID.multihash.size,
      code: peerID.multihash.code,
    },
    type: peerID.type,
  };
}

export function serializePeerId(peerID) {
  const init = {
    type: peerID.type,
    multihash: {
      bytes: Uint8Array.from(peerID.multihash.bytes),
      digest: Uint8Array.from(peerID.multihash.digest),
      size: peerID.multihash.size,
      code: peerID.multihash.code,
    },
  };
  return peerIdFromString(peerID.id);
}
