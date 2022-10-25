import { RelayCell, Cell, CellCommand, RelayCellCommand } from "./tor";
import { generateEphemeralKeyPair } from "@libp2p/crypto/keys";
import { toString } from "uint8arrays";
import { Multiaddr } from "@multiformats/multiaddr";
import type { Libp2pOptions } from "libp2p";
import { Libp2pWrapped } from "./libp2p.wrapper";
import { pipe } from "it-pipe";
import { encode, decode } from "it-length-prefixed";
import { ECDHKey } from "@libp2p/crypto/keys/interface";
import * as crypto from "@libp2p/crypto";
import { Buffer } from "node:buffer";
import { iv } from "./constants";
import { equals } from "uint8arrays";
import { multiaddr } from "multiaddr";

const rsa = crypto.keys.supportedKeys.rsa;

export class Router extends Libp2pWrapped {
  public registries: Multiaddr[];
  public proxies: {
    publicKey: {
      encrypt: (bytes: Uint8Array) => Promise<Buffer>;
      marshal: () => Uint8Array;
    };
    id: string;
    addr: Multiaddr;
  }[];
  public keys: Record<
    number,
    {
      ecdhKeys: ECDHKey[];
      hops: Multiaddr[];
      keys: Uint8Array[];
      aes: crypto.aes.AESCipher[];
    }
  >;

  constructor(registries: Multiaddr[]) {
    super();
    this.registries = registries;
    this.keys = {};
  }

  async build(length: number = 1) {
    const circId = await this.create();
    await this.extend(circId);
  }

  async extend(circId: number) {
    const endProxy = this.proxies.filter(
      (d) => !this.keys[circId].hops.includes(d.addr)
    )[0];
    const { key, genSharedKey } = await generateEphemeralKeyPair("P-256");
    this.keys[circId].ecdhKeys.push({ key, genSharedKey });
    this.keys[circId].hops.push(endProxy.addr);
    const hop = endProxy.addr.bytes;
    const encryptedKey = Uint8Array.from(
      await endProxy.publicKey.encrypt(Uint8Array.from(key))
    );
    const relayCellData = new Uint8Array(encryptedKey.length + hop.length);
    relayCellData.set(encryptedKey);
    relayCellData.set(hop, encryptedKey.length);
    console.log(relayCellData.length, encryptedKey.length);
    const hmac = await crypto.hmac.create(
      "SHA256",
      this.keys[circId].keys[this.keys[circId].keys.length - 1]
    );
    const digest = await hmac.digest(relayCellData);
    console.log(digest.length);
    const _relay = new Cell({
      circuitId: circId,
      command: CellCommand.RELAY,
      data: new RelayCell({
        streamId: circId,
        command: RelayCellCommand.EXTEND,
        data: relayCellData,
        digest,
        len: relayCellData.length,
      }),
    }).encode();
    const encryptedRelay = await [
      ...this.keys[circId].aes.slice(0, this.keys[circId].aes.length - 1),
    ]
      .reverse()
      .reduce(async (a, aes) => {
        return await aes.encrypt(await a);
      }, Promise.resolve(_relay));
    const relay = new Cell({
      circuitId: circId,
      command: CellCommand.RELAY,
      data: encryptedRelay,
    }).encode();
    const proxy = this.keys[circId].hops[0];
    const stream = await this.dialProtocol(proxy, "/tor/1.0.0/message");
    pipe([relay], encode(), stream.sink);
  }

  async create() {
    const circId = Buffer.from(crypto.randomBytes(2)).readUint16BE();
    const { genSharedKey, key } = await generateEphemeralKeyPair("P-256");
    const proxy = this.proxies[0];
    const encryptedKey = Uint8Array.from(await proxy.publicKey.encrypt(key));
    const create = new Cell({
      circuitId: circId,
      command: CellCommand.CREATE,
      data: encryptedKey,
    });
    const stream = await this.dialProtocol(proxy.addr, "/tor/1.0.0/message");
    pipe([create.encode()], encode(), stream.sink);
    const cell = await pipe(stream.source, decode(), async (source) => {
      let _cell: Cell;
      for await (const data of source) {
        _cell = Cell.from(Buffer.from(data.subarray()));
        break;
      }
      return _cell;
    });
    const proxyEcdhKey = (cell.data as Uint8Array).slice(0, 65);
    const digest = (cell.data as Uint8Array).slice(65, 65 + 32);
    const sharedKey = await genSharedKey(proxyEcdhKey);
    const hmac = await crypto.hmac.create("SHA256", sharedKey);
    if (!equals(await hmac.digest(sharedKey), digest)) {
      throw new Error("wrong digest");
    }
    this.keys[circId] = {
      ecdhKeys: [
        {
          genSharedKey,
          key,
        },
      ],
      keys: [sharedKey],
      hops: [proxy.addr],
      aes: [await crypto.aes.create(sharedKey, iv)],
    };
    return circId;
  }

  async fetchKeys() {
    this.proxies = await this.registries.reduce<
      Promise<{ id: string; addr: Multiaddr; publicKey: any }[]>
    >(async (results, registry) => {
      try {
        const stream = await this.dialProtocol(registry, "/tor/1.0.0/relays");
        const _results = await pipe(
          stream.source,
          decode(),
          async function (source) {
            let str = "";
            for await (const data of source) {
              str += toString(data.subarray());
            }
            const _peers = JSON.parse(str);
            return _peers.map(
              ({
                id,
                addr,
                publicKey,
              }: {
                id: string;
                publicKey: any;
                addr: string;
              }) => {
                return {
                  id,
                  addr: multiaddr(addr),
                  publicKey: rsa.unmarshalRsaPublicKey(
                    Uint8Array.from(Object.values(publicKey))
                  ),
                };
              }
            );
          }
        );

        return [...(await results), ..._results];
      } catch (e) {
        console.log(e);
      }
    }, Promise.resolve([]));
  }

  async run(options: Libp2pOptions) {
    await super.run(options);
    await this.fetchKeys();
  }
}
