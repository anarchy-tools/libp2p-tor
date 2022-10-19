import { arrayify } from "@ethersproject/bytes";
import { Buffer } from "node:buffer";

export enum CellCommand {
  PADDING,
  CREATE,
  DESTROY,
  RELAY,
}

export enum RelayCellCommand {
  DATA,
  BEGIN,
  END,
  TEARDOWN,
  CONNECTED,
  EXTEND,
  TRUNCATE,
  SENDME,
  DROP,
}

interface RelayCellLike {
  streamId: number;
  digest: Uint8Array;
  len: number;
  command: RelayCellCommand;
  data: Uint8Array;
}

export class RelayCell implements RelayCellLike {
  public streamId: number;
  public digest: Uint8Array;
  public len: number;
  public command: RelayCellCommand;
  public data: Uint8Array;
  constructor(o: any) {
    this.streamId = o.streamId;
    this.digest = o.digest;
    this.len = o.len;
    this.command = o.command;
    this.data = o.data;
  }
  encode() {
    const result = Buffer.alloc(509);
    result.writeUInt16BE(0, this.streamId);
    Buffer.from(this.digest as any).copy(result, 2, 0, 6);
    result.writeUInt16BE(8, this.len);
    result.writeUInt8(10, this.command);
    Buffer.from(this.data as any).copy(result, 11, 0, 498);
    return arrayify(result);
  }
}

export class Cell {
  public circuitId: number;
  public command: CellCommand;
  public data: Uint8Array | RelayCellLike;
  constructor(o: {
    circuitId: number;
    command: CellCommand;
    data: Uint8Array | RelayCellLike;
  }) {
    this.circuitId = o.circuitId;
    this.command = o.command;
    this.data = o.data;
  }
  encode(): Uint8Array {
    const result = Buffer.alloc(512);
    result.writeUInt16BE(this.circuitId, 0);
    result.writeUInt8(this.command, 2);
    const data = Buffer.from(
      (this.data instanceof RelayCell ? this.data.encode() : this.data) as any
    );
    data.copy(result, 3, 0, 509);
    return arrayify(result);
  }

  from(Uint8Array) {}
}
