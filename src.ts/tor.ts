import { arrayify, BytesLike } from "@ethersproject/bytes";
import { Buffer } from 'buffer';

enum CellCommand {
  PADDING,
  CREATE,
  DESTROY,
  RELAY,
}

enum RelayCellCommand {
  DATA,
  BEGIN,
  END,
  TEARDOWN,
  CONNECTED,
  EXTEND,
  TRUNCATE,
  SENDME,
  DROP
}

interface RelayCellLike {
  streamId: number;
  digest: BytesLike;
  len: number;
  command: RelayCellCommand;
  data: BytesLike;
}

class RelayCell implements RelayCellLike {
  public streamId: number;
  public digest: BytesLike;
  public len: number;
  public command: RelayCellCommand;
  public data: BytesLike;
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

class Cell {
  public circuitId: number;
  public command: CellCommand;
  public data: BytesLike | RelayCellLike;
  constructor(o: any) {
    this.circuitId = o.circuitId;
    this.command = o.command;
    this.data = o.data
  }
  encode(): BytesLike {
    const result = Buffer.alloc(512);
    result.writeUInt16BE(0, this.circuitId);
    result.writeUInt8(2, this.command);
    return arrayify(Buffer.from((this.data instanceof RelayCell ? this.data.encode() : this.data) as any).copy(result, 3, 0, 509));
  }
}
   