import { runRelay } from "../src.ts/libp2p.wrapper.js";
import { createLibp2p } from "libp2p";
import { mplex } from "@libp2p/mplex";
import { Noise } from "@chainsafe/libp2p-noise";
import { TCP } from "@libp2p/tcp";
import { toString, equals, fromString } from "uint8arrays";
import { pipe } from "it-pipe";
import { decode } from "it-length-prefixed";
import { serializePeerId } from "../src.ts/util.js";

const runNode = async (options) => {
  //@ts-ignore
  options.transports = [new TCP()];
  //@ts-ignore
  options.connectionEncryption = [new Noise()];
  //@ts-ignore
  options.streamMuxers = [mplex()()];

  const node = await createLibp2p(options);
  console.log("created node");
  await node.start();
  console.log("started node");

  return node;
};

const main = async () => {
  const relayer = await runRelay({
    addresses: {
      listen: ["/ip4/127.0.0.1/tcp/5000"],
      announce: ["/ip4/127.0.0.1/tcp/5000"],
    },
  });
  const node = await runNode({
    addresses: {
      listen: ["/ip4/127.0.0.1/tcp/0"],
      announce: ["/ip4/127.0.0.1/tcp/5000"],
    },
  });
  await node.dialProtocol(relayer.getMultiaddrs()[0], "/tor/1.0.0/register");
  const stream = await node.dialProtocol(
    relayer.getMultiaddrs()[0],
    "/tor/1.0.0/relays"
  );
  pipe(stream.source, decode(), async function (source) {
    let str = "";
    for await (const data of source) {
      str += toString(data.subarray());
    }
    const peer = JSON.parse(str);
    const remotePeer = serializePeerId(peer);
    console.log(
      equals(
        Uint8Array.from(Object.values(peer.publicKey)),
        remotePeer.publicKey
      )
    );
  });
};

main().then(() => {});
