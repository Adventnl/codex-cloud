import { EventEmitter } from 'node:events';
import type { RpcMessage } from './types.js';
export interface LiveEvent {
  sequence: number;
  taskId?: string;
  timestamp: string;
  message: RpcMessage;
}
// Bounded reconnect buffer only. Official Codex rollouts own durable conversation history.
export class Events extends EventEmitter {
  private sequence = 0;
  private buffer: LiveEvent[] = [];
  private sizes = new Map<number, number>();
  private bytes = 0;
  publish(message: RpcMessage, taskId?: string) {
    const event = {
      sequence: ++this.sequence,
      taskId,
      timestamp: new Date().toISOString(),
      message,
    };
    const size = JSON.stringify(event).length * 2;
    if (size <= 8_000_000) {
      this.buffer.push(event);
      this.sizes.set(event.sequence, size);
      this.bytes += size;
      while (this.buffer.length > 1500 || this.bytes > 8_000_000) {
        const removed = this.buffer.shift()!;
        this.bytes -= this.sizes.get(removed.sequence)!;
        this.sizes.delete(removed.sequence);
      }
    }
    this.emit('event', event);
    return event;
  }
  since(sequence: number) {
    return this.buffer.filter((e) => e.sequence > sequence);
  }
}
