/**
 * Launcher side of the Ella IPC protocol — see docs/protocol.md.
 *
 * The launcher is the server because it outlives the game: it starts first, and the mod
 * reconnects to it whenever a new game session begins.
 */

import net from 'node:net';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  PROTOCOL_VERSION,
  encodeMessage,
  type Envelope,
  type HelloPayload,
  type LogPayload,
  type ResultEnvelope,
  type SettingsPatchResult,
  type SlotAssignPayload,
  type SlotClearPayload,
  type EntryKind,
  type ProtocolError,
} from '../shared/protocol.ts';

/** Refuse absurdly long lines rather than buffering without bound. */
const MAX_LINE_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const PING_INTERVAL_MS = 10_000;

export interface ConnectedGame {
  hello: HelloPayload;
  capabilities: Set<string>;
}

export class RequestFailedError extends Error {
  code: string;

  constructor(error: ProtocolError) {
    super(error.message);
    this.name = 'RequestFailedError';
    this.code = error.code;
  }
}

type PendingRequest = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/**
 * Events:
 *   `connected`    (game: ConnectedGame)
 *   `disconnected` ()
 *   `log`          (entry: LogPayload)
 *   `error`        (error: Error)
 */
export class EllaServer extends EventEmitter {
  private server: net.Server | null = null;
  private socket: net.Socket | null = null;
  private buffer = '';
  private pending = new Map<string, PendingRequest>();
  private pingTimer: NodeJS.Timeout | null = null;
  private missedPings = 0;

  readonly token: string;
  game: ConnectedGame | null = null;

  constructor(token: string = randomUUID()) {
    super();
    this.token = token;
  }

  get connected(): boolean {
    return this.socket !== null && this.game !== null;
  }

  listen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => this.accept(socket));
      server.once('error', reject);
      // Bound to loopback only: nothing here should be reachable from the network.
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        server.on('error', (error) => this.emit('error', error));
        this.server = server;
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : port);
      });
    });
  }

  async close(): Promise<void> {
    this.stopPinging();
    this.socket?.destroy();
    this.socket = null;
    this.game = null;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('Server closed'));
    }
    this.pending.clear();

    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server = null;
    });
  }

  private accept(socket: net.Socket): void {
    // One game at a time; a second connection replaces the first.
    if (this.socket) this.socket.destroy();

    this.socket = socket;
    this.buffer = '';
    socket.setEncoding('utf8');
    socket.setNoDelay(true);

    socket.on('data', (chunk: string) => this.onData(chunk));
    socket.on('error', () => this.dropConnection());
    socket.on('close', () => this.dropConnection());
  }

  private dropConnection(): void {
    if (!this.socket) return;
    this.socket = null;
    this.stopPinging();
    if (this.game) {
      this.game = null;
      this.emit('disconnected');
    }
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('Game disconnected'));
    }
    this.pending.clear();
  }

  private onData(chunk: string): void {
    this.buffer += chunk;

    if (this.buffer.length > MAX_LINE_BYTES) {
      this.emit('error', new Error('Oversized message from game; dropping connection'));
      this.socket?.destroy();
      return;
    }

    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length === 0) continue;

      try {
        this.handleMessage(JSON.parse(line) as Envelope);
      } catch (error) {
        this.emit('error', new Error(`Malformed message from game: ${String(error)}`));
      }
    }
  }

  private handleMessage(message: Envelope): void {
    if (message.type === 'result') {
      this.settle(message as ResultEnvelope);
      return;
    }

    switch (message.type) {
      case 'hello':
        this.handleHello(message);
        break;
      case 'log':
        this.emit('log', message.payload as LogPayload);
        break;
      default:
        // Unknown notification types are ignored so a newer adapter can add them.
        break;
    }
  }

  private handleHello(message: Envelope): void {
    const hello = message.payload as HelloPayload;

    if (message.v !== PROTOCOL_VERSION) {
      this.rejectHandshake(message.id, {
        code: 'PROTOCOL_VERSION_MISMATCH',
        message: `Expected protocol v${PROTOCOL_VERSION}, got v${message.v}`,
      });
      return;
    }

    if (hello?.token !== this.token) {
      // Stops an unrelated process on the machine from driving the editor.
      this.rejectHandshake(message.id, {
        code: 'BAD_TOKEN',
        message: 'Handshake token did not match',
      });
      return;
    }

    this.game = { hello, capabilities: new Set(hello.capabilities ?? []) };
    this.send({ v: PROTOCOL_VERSION, id: message.id, type: 'result', ok: true } as ResultEnvelope);
    this.startPinging();
    this.emit('connected', this.game);
  }

  private rejectHandshake(id: string | undefined, error: ProtocolError): void {
    this.send({ v: PROTOCOL_VERSION, id, type: 'result', ok: false, error } as ResultEnvelope);
    this.socket?.destroy();
  }

  private settle(result: ResultEnvelope): void {
    if (!result.id) return;
    const request = this.pending.get(result.id);
    if (!request) return;

    this.pending.delete(result.id);
    clearTimeout(request.timer);
    this.missedPings = 0;

    if (result.ok) request.resolve(result.payload);
    else request.reject(new RequestFailedError(result.error ?? {
      code: 'RELOAD_FAILED',
      message: 'Request failed without an error body',
    }));
  }

  private send(message: Envelope | ResultEnvelope): void {
    if (!this.socket) throw new Error('No game connected');
    this.socket.write(encodeMessage(message));
  }

  /** Sends a notification, expecting no reply. */
  notify(type: string, payload?: unknown): void {
    this.send({ v: PROTOCOL_VERSION, type, payload });
  }

  /** Sends a request and resolves with the reply payload. */
  request<T = unknown>(type: string, payload?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.socket) return reject(new Error('No game connected'));

      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request "${type}" timed out`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });

      try {
        this.send({ v: PROTOCOL_VERSION, id, type, payload });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error as Error);
      }
    });
  }

  private startPinging(): void {
    this.stopPinging();
    this.missedPings = 0;
    this.pingTimer = setInterval(() => {
      if (!this.socket) return;
      this.request('ping').catch(() => {
        // Two consecutive misses is treated as a dead game rather than a slow one.
        if (++this.missedPings >= 2) this.socket?.destroy();
      });
    }, PING_INTERVAL_MS);
  }

  private stopPinging(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.missedPings = 0;
  }

  // -------------------------------------------------------------------------
  // Typed convenience wrappers
  // -------------------------------------------------------------------------

  hasCapability(capability: string): boolean {
    return this.game?.capabilities.has(capability) ?? false;
  }

  welcome(payload: {
    workspace: string;
    projectId: string;
    namespace: string;
    packRoot: string;
  }): void {
    this.notify('welcome', payload);
  }

  assignSlot(payload: SlotAssignPayload): Promise<void> {
    return this.request('slot.assign', payload);
  }

  clearSlot(payload: SlotClearPayload): Promise<void> {
    return this.request('slot.clear', payload);
  }

  patchSettings(
    slot: number,
    kind: EntryKind,
    settings: Record<string, unknown>,
  ): Promise<SettingsPatchResult> {
    return this.request('settings.patch', { slot, kind, settings });
  }

  reloadResources(reason: 'model_changed' | 'texture_changed' | 'manual', entryId?: string):
    Promise<void> {
    return this.request('resources.reload', { reason, entryId });
  }

  give(slot: number, kind: EntryKind, count = 1): Promise<void> {
    return this.request('entry.give', { slot, kind, count });
  }

  place(slot: number, kind: EntryKind): Promise<void> {
    return this.request('entry.place', { slot, kind });
  }
}
