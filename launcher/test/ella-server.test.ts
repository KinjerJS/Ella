import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { EllaServer, RequestFailedError } from '../src/main/ella-server.ts';
import {
  PROTOCOL_VERSION,
  type Envelope,
  type HelloPayload,
  type ResultEnvelope,
} from '../src/shared/protocol.ts';

/** Minimal stand-in for the in-game mod. */
class FakeGame {
  socket: net.Socket;
  buffer = '';
  received: Envelope[] = [];
  private waiters: Array<(msg: Envelope) => void> = [];

  constructor(socket: net.Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let newline: number;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line) as Envelope;

        // A real adapter answers pings; doing the same here keeps the connection alive
        // and stops heartbeats from satisfying a `next()` waiter.
        if (message.type === 'ping') {
          this.send({ v: PROTOCOL_VERSION, id: message.id, type: 'result', ok: true } as Envelope);
          continue;
        }

        // Hand straight to a waiter when one exists, otherwise queue it. Doing both
        // would let the same message be read twice.
        const waiter = this.waiters.shift();
        if (waiter) waiter(message);
        else this.received.push(message);
      }
    });
  }

  static async connect(port: number): Promise<FakeGame> {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    await once(socket, 'connect');
    return new FakeGame(socket);
  }

  send(message: Envelope): void {
    this.socket.write(JSON.stringify(message) + '\n');
  }

  /** Resolves with the next message, consuming it from the queue. */
  next(): Promise<Envelope> {
    return new Promise((resolve) => {
      const queued = this.received.shift();
      if (queued) return resolve(queued);
      this.waiters.push(resolve);
    });
  }

  hello(token: string, overrides: Partial<HelloPayload> = {}, v = PROTOCOL_VERSION): void {
    this.send({
      v,
      id: 'hello-1',
      type: 'hello',
      payload: {
        token,
        minecraftVersion: '1.12.2',
        loader: 'forge',
        loaderVersion: '14.23.5.2859',
        adapter: 'forge-1.12.2',
        adapterVersion: '0.1.0',
        javaVersion: '8',
        slots: { block: 128, item: 128 },
        capabilities: ['render_layer.cutout', 'reload.programmatic'],
        ...overrides,
      },
    });
  }
}

async function startServer(): Promise<{ server: EllaServer; port: number }> {
  const server = new EllaServer('test-token');
  const port = await server.listen(0);
  return { server, port };
}

test('accepts a valid handshake and reports capabilities', async () => {
  const { server, port } = await startServer();
  try {
    const game = await FakeGame.connect(port);
    const connected = once(server, 'connected');
    game.hello('test-token');

    const [info] = await connected;
    assert.equal(info.hello.minecraftVersion, '1.12.2');
    assert.equal(server.connected, true);
    assert.equal(server.hasCapability('render_layer.cutout'), true);
    assert.equal(server.hasCapability('model.obj'), false);

    const reply = await game.next();
    assert.equal(reply.type, 'result');
    assert.equal((reply as ResultEnvelope).ok, true);
  } finally {
    await server.close();
  }
});

test('rejects a handshake carrying the wrong token', async () => {
  const { server, port } = await startServer();
  try {
    const game = await FakeGame.connect(port);
    game.hello('wrong-token');

    const reply = await game.next();
    assert.equal((reply as ResultEnvelope).ok, false);
    assert.equal((reply as ResultEnvelope).error?.code, 'BAD_TOKEN');
    assert.equal(server.connected, false);
  } finally {
    await server.close();
  }
});

test('rejects a mismatched protocol version', async () => {
  const { server, port } = await startServer();
  try {
    const game = await FakeGame.connect(port);
    game.hello('test-token', {}, PROTOCOL_VERSION + 1);

    const reply = await game.next();
    assert.equal((reply as ResultEnvelope).error?.code, 'PROTOCOL_VERSION_MISMATCH');
  } finally {
    await server.close();
  }
});

test('correlates a request with its reply', async () => {
  const { server, port } = await startServer();
  try {
    const game = await FakeGame.connect(port);
    const connected = once(server, 'connected');
    game.hello('test-token');
    await connected;
    await game.next(); // handshake result

    const pending = server.patchSettings(0, 'block', { lightLevel: 7 });
    const request = await game.next();
    assert.equal(request.type, 'settings.patch');
    assert.deepEqual(request.payload, { slot: 0, kind: 'block', settings: { lightLevel: 7 } });

    game.send({
      v: PROTOCOL_VERSION,
      id: request.id,
      type: 'result',
      ok: true,
      payload: { applied: ['lightLevel'], ignored: [] },
    } as Envelope);

    assert.deepEqual(await pending, { applied: ['lightLevel'], ignored: [] });
  } finally {
    await server.close();
  }
});

test('surfaces a failed request as a typed error', async () => {
  const { server, port } = await startServer();
  try {
    const game = await FakeGame.connect(port);
    const connected = once(server, 'connected');
    game.hello('test-token');
    await connected;
    await game.next();

    const pending = server.assignSlot({
      slot: 999,
      kind: 'block',
      entryId: 'x',
      registryName: 'ella:block_999',
      displayName: { en: 'X' },
      settings: {},
    });
    const request = await game.next();
    game.send({
      v: PROTOCOL_VERSION,
      id: request.id,
      type: 'result',
      ok: false,
      error: { code: 'SLOT_OUT_OF_RANGE', message: 'slot 999 >= 128' },
    } as Envelope);

    await assert.rejects(pending, (error: RequestFailedError) => {
      assert.equal(error.code, 'SLOT_OUT_OF_RANGE');
      return true;
    });
  } finally {
    await server.close();
  }
});

test('forwards game log notifications', async () => {
  const { server, port } = await startServer();
  try {
    const game = await FakeGame.connect(port);
    const connected = once(server, 'connected');
    game.hello('test-token');
    await connected;

    const logged = once(server, 'log');
    game.send({
      v: PROTOCOL_VERSION,
      type: 'log',
      payload: { level: 'warn', source: 'model_loader', message: 'missing texture' },
    });

    const [entry] = await logged;
    assert.equal(entry.source, 'model_loader');
  } finally {
    await server.close();
  }
});

test('handles several messages arriving in one packet', async () => {
  // TCP gives no message boundaries; two lines can land in a single read.
  const { server, port } = await startServer();
  try {
    const game = await FakeGame.connect(port);
    const connected = once(server, 'connected');
    const logged = once(server, 'log');

    game.socket.write(
      JSON.stringify({
        v: PROTOCOL_VERSION, id: 'h', type: 'hello',
        payload: {
          token: 'test-token', minecraftVersion: '1.21.1', loader: 'forge',
          loaderVersion: '1', adapter: 'forge-modern', adapterVersion: '0.1.0',
          javaVersion: '21', slots: { block: 8, item: 8 }, capabilities: [],
        },
      }) + '\n' +
        JSON.stringify({
          v: PROTOCOL_VERSION, type: 'log',
          payload: { level: 'info', source: 's', message: 'm' },
        }) + '\n',
    );

    await connected;
    const [entry] = await logged;
    assert.equal(entry.message, 'm');
  } finally {
    await server.close();
  }
});

test('handles a message split across packets', async () => {
  const { server, port } = await startServer();
  try {
    const game = await FakeGame.connect(port);
    const connected = once(server, 'connected');

    const line = JSON.stringify({
      v: PROTOCOL_VERSION, id: 'h', type: 'hello',
      payload: {
        token: 'test-token', minecraftVersion: '1.21.1', loader: 'forge',
        loaderVersion: '1', adapter: 'forge-modern', adapterVersion: '0.1.0',
        javaVersion: '21', slots: { block: 8, item: 8 }, capabilities: [],
      },
    }) + '\n';

    game.socket.write(line.slice(0, 20));
    await new Promise((resolve) => setTimeout(resolve, 10));
    game.socket.write(line.slice(20));

    const [info] = await connected;
    assert.equal(info.hello.minecraftVersion, '1.21.1');
  } finally {
    await server.close();
  }
});

test('emits disconnected and fails pending requests when the game goes away', async () => {
  const { server, port } = await startServer();
  try {
    const game = await FakeGame.connect(port);
    const connected = once(server, 'connected');
    game.hello('test-token');
    await connected;
    await game.next();

    const pending = server.reloadResources('manual');
    const disconnected = once(server, 'disconnected');
    game.socket.destroy();

    await disconnected;
    assert.equal(server.connected, false);
    await assert.rejects(pending, /disconnected/i);
  } finally {
    await server.close();
  }
});

test('rejects a request when no game is connected', async () => {
  const { server } = await startServer();
  try {
    await assert.rejects(server.reloadResources('manual'), /No game connected/);
  } finally {
    await server.close();
  }
});

test('ignores unknown notification types', async () => {
  const { server, port } = await startServer();
  try {
    const game = await FakeGame.connect(port);
    const connected = once(server, 'connected');
    game.hello('test-token');
    await connected;

    // A newer adapter sending something this launcher predates must not break it.
    game.send({ v: PROTOCOL_VERSION, type: 'something.new', payload: {} });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(server.connected, true);
  } finally {
    await server.close();
  }
});
