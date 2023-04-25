import type { Libp2pOptions } from "libp2p";
import { Libp2pWrapped } from "./libp2p.wrapper";
import { generateEphemeralKeyPair } from "@libp2p/crypto/keys";
import type { ECDHKey } from "@libp2p/crypto/keys/interface";
import { pipe } from "it-pipe";
import { encode, decode } from "it-length-prefixed";
import { Multiaddr, multiaddr } from "@multiformats/multiaddr";
import { Cell, CellCommand, RelayCell, RelayCellCommand } from "./tor";
import { StreamHandler } from "@libp2p/interface-registrar";
import { fromString, equals, toString } from "uint8arrays";
import * as crypto from "@libp2p/crypto";
import type { PrivateKey } from "@libp2p/interface-keys";
import { iv } from "./constants";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import { peerIdFromString } from "@libp2p/peer-id";

const createHmac = crypto.hmac.create;

export class Proxy extends Libp2pWrapped {
  private torKey: PrivateKey;
  public registries: Multiaddr[];
  private keys: Record<
    number,
    {
      sharedKey: Uint8Array;
      key: ECDHKey;
      aes: crypto.aes.AESCipher;
      publicKey: Uint8Array;
      hmac: Awaited<ReturnType<typeof createHmac>>;
      nextHop: {
        multiaddr: Multiaddr;
        circuitId: number;
      };
    }
  >;
  private active: Record<number, Multiaddr>;

  constructor(registries: Multiaddr[]) {
    super();
    this.registries = registries;
    this.keys = {};
    this.torKey = null;
    this.active = {};
  }

  async run(
    options: Libp2pOptions = {
      addresses: {
        listen: ["/ip4/127.0.0.1/tcp/0"],
      },
    }
  ) {
    await super.run(options);
    this.torKey = await crypto.keys.generateKeyPair("RSA", 1024);
    await this.register();
    await this.handle("/tor/1.0.0/message", this.handleTorMessage);
    await this.handle("/tor/1.0.0/advertise", this.handleAdvertise);
  }

  handleAdvertise: StreamHandler = async ({ stream }) => {
    const pubKey = await pipe(stream.source, decode(), async (source) => {
      let _pubKey: Uint8Array;
      for await (const data of source) {
        _pubKey = data.subarray();
      }
      return _pubKey;
    });
    const hash = await sha256.digest(pubKey);
    const cid = CID.create(1, 0x01, hash);
    await this._libp2p.contentRouting.provide(cid);
  };

  handleTorMessage: StreamHandler = async ({ stream }) => {
    const cell = await pipe(stream.source, decode(), async (source) => {
      let _cell: Cell;
      for await (const data of source) {
        _cell = Cell.from(data.subarray());
      }
      return _cell;
    });
    let returnCell: Uint8Array;
    if (cell.command == CellCommand.CREATE) {
      const cellData: Uint8Array = Uint8Array.from(
        //@ts-ignore
        await this.torKey.decrypt((cell.data as Uint8Array).slice(0, 128))
      );
      returnCell = new Cell({
        circuitId: cell.circuitId,
        command: CellCommand.CREATED,
        data: await this.handleCreateCell(cell.circuitId, cellData),
      }).encode();
    } else if (cell.command == CellCommand.RELAY) {
      console.log("relay");
      const aes = this.keys[`${cell.circuitId}`].aes;
      const nextHop = this.keys[`${cell.circuitId}`].nextHop;
      if (nextHop == undefined) {
        console.log("next hop not defined");
        returnCell = await this.handleRelayCell({
          circuitId: cell.circuitId,
          relayCell: RelayCell.from(await aes.decrypt(cell.data as Uint8Array)),
        });
      } else {
        console.log("sending to next hop");
        const relayCell = RelayCell.from(
          await aes.decrypt(cell.data as Uint8Array)
        );
        const nextHopStream = await this.dialProtocol(
          nextHop.multiaddr,
          "/tor/1.0.0/message"
        );
        pipe(
          [
            new Cell({
              circuitId: nextHop.circuitId,
              data: relayCell.encode(),
              command: CellCommand.RELAY,
            }).encode(),
          ],
          encode(),
          nextHopStream.sink
        );
        const nextCell = await pipe(
          nextHopStream.source,
          decode(),
          async (source) => {
            let _cell: Cell;
            for await (const data of source) {
              _cell = Cell.from(data.subarray());
            }
            return _cell;
          }
        );
        returnCell = new Cell({
          command: CellCommand.RELAY,
          circuitId: cell.circuitId,
          data: await aes.encrypt(nextCell.data as Uint8Array),
        }).encode();
      }
    }
    pipe([returnCell], encode(), stream.sink);
  };

  async handleRelayCell({
    circuitId,
    relayCell,
  }: {
    circuitId: number;
    relayCell: RelayCell;
  }) {
    const { hmac } = this.keys[`${circuitId}`];
    const relayCellData = relayCell.data.subarray(0, relayCell.len);
    const hash = await hmac.digest(relayCellData);
    if (!equals(Uint8Array.from(hash.subarray(0, 6)), relayCell.digest))
      throw new Error("digest does not match");
    if (relayCell.command == RelayCellCommand.EXTEND) {
      return await this.handleRelayExtend({ circuitId, relayCellData });
    }
    if (relayCell.command == RelayCellCommand.BEGIN) {
      return await this.handleRelayBegin({ circuitId, relayCellData });
    }
    if (relayCell.command == RelayCellCommand.DATA) {
      return await this.handleRelayData({ circuitId, relayCellData });
    }
  }
  async handleRelayData({
    circuitId,
    relayCellData,
  }: {
    circuitId: number;
    relayCellData: Uint8Array;
  }) {
    const { aes, hmac } = this.keys[`${circuitId}`];
    if (this.active[circuitId]) {
      const stream = await this.dialProtocol(
        this.active[circuitId],
        "/tor/1.0.0/baseMessage"
      );
      pipe([relayCellData], encode(), stream.sink);
      const returnData = await pipe(stream.source, decode(), async (source) => {
        let _d: Uint8Array;
        for await (const data of source) {
          _d = data.subarray();
        }
        return _d;
      });
      return new Cell({
        command: CellCommand.RELAY,
        data: await aes.encrypt(
          new RelayCell({
            streamId: circuitId,
            data: returnData,
            len: returnData.length,
            digest: await hmac.digest(returnData),
            command: RelayCellCommand.DATA,
          }).encode()
        ),
        circuitId,
      }).encode();
    }
    return new Cell({
      command: CellCommand.RELAY,
      circuitId,
      data: await aes.encrypt(
        new RelayCell({
          command: RelayCellCommand.END,
          data: fromString(""),
          len: 0,
          digest: await hmac.digest(fromString("")),
          streamId: circuitId,
        }).encode()
      ),
    });
  }
  async handleRelayBegin({
    circuitId,
    relayCellData,
  }: {
    circuitId: number;
    relayCellData: Uint8Array;
  }) {
    const { aes, hmac } = this.keys[`${circuitId}`];
    const addr = multiaddr(relayCellData.slice(128));
    const stream = await this.dialProtocol(addr, "/tor/1.0.0/baseMessage");
    pipe([fromString("BEGIN")], encode(), stream.sink);
    const returnData = toString(
      await pipe(stream.source, decode(), async (source) => {
        let result: Uint8Array;
        for await (const data of source) {
          result = data.subarray();
        }
        return result;
      })
    );

    const data = fromString("");
    if (returnData == "BEGUN") {
      this.active[circuitId] = addr;
      return new Cell({
        command: CellCommand.RELAY,
        data: await aes.encrypt(
          new RelayCell({
            command: RelayCellCommand.CONNECTED,
            data,
            streamId: circuitId,
            digest: await hmac.digest(data),
            len: data.length,
          }).encode()
        ),
        circuitId,
      }).encode();
    } else {
      return new Cell({
        command: CellCommand.RELAY,
        data: await aes.encrypt(
          new RelayCell({
            command: RelayCellCommand.END,
            data,
            streamId: circuitId,
            digest: await hmac.digest(data),
            len: data.length,
          }).encode()
        ),
        circuitId,
      }).encode();
    }
  }
  async handleRelayExtend({
    circuitId,
    relayCellData,
  }: {
    circuitId: number;
    relayCellData: Uint8Array;
  }) {
    const { aes, hmac } = this.keys[`${circuitId}`];
    const encryptedKey = relayCellData.slice(0, 128);
    const multiAddr = multiaddr(relayCellData.slice(128));
    const hop = (this.keys[`${circuitId}`].nextHop = {
      multiaddr: multiAddr,
      circuitId: Buffer.from(crypto.randomBytes(16)).readUint16BE(),
    });
    const stream = await this.dialProtocol(multiAddr, "/tor/1.0.0/message");
    pipe(
      [
        new Cell({
          command: CellCommand.CREATE,
          data: encryptedKey,
          circuitId: hop.circuitId,
        }).encode(),
      ],
      encode(),
      stream.sink
    );
    const returnData = await pipe(stream.source, decode(), async (source) => {
      let result: Uint8Array;
      for await (const data of source) {
        result = data.subarray();
      }
      return Cell.from(result);
    });
    const returnDigest = await hmac.digest(returnData.data as Uint8Array);
    return new Cell({
      circuitId,
      command: CellCommand.RELAY,
      data: await aes.encrypt(
        new RelayCell({
          data: returnData.data as Uint8Array,
          command: RelayCellCommand.EXTENDED,
          streamId: circuitId,
          len: 65 + 32,
          digest: returnDigest,
        }).encode()
      ),
    }).encode();
  }

  async handleCreateCell(circuitId: number, cellData: Uint8Array) {
    const ecdhKey = await generateEphemeralKeyPair("P-256");
    const sharedKey = await ecdhKey.genSharedKey(cellData);
    const hmac = await createHmac("SHA256", sharedKey);
    this.keys[`${circuitId}`] = {
      sharedKey,
      key: ecdhKey,
      aes: await crypto.aes.create(sharedKey, iv),
      publicKey: cellData,
      hmac,
      nextHop: undefined,
    };

    const digest = await hmac.digest(sharedKey);
    const data = new Uint8Array(digest.length + ecdhKey.key.length);
    data.set(ecdhKey.key);
    data.set(digest, ecdhKey.key.length);
    return data;
  }

  async register() {
    await this.registries.reduce<any>(async (_a, registry) => {
      try {
        const stream = await this.dialProtocol(registry, "/tor/1.0.0/register");
        pipe(
          [
            fromString(
              JSON.stringify({
                key: this.torKey.public.marshal(),
                addr: this._libp2p.getMultiaddrs()[0].toString(),
              })
            ),
          ],
          encode(),
          stream.sink
        );
        await pipe(stream.source, decode(), async (source) => {
          for await (const data of source) {
            if (data.subarray()[0] != 1) throw new Error();
          }
        });
      } catch (e) {
        console.log(e);
      }
    }, Promise.resolve());
  }

  key() {
    return this.torKey.public.marshal();
  }
}
