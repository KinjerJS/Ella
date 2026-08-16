# Ella IPC Protocol v1

Transport between the launcher and the in-game mod.

## Transport

- **TCP, newline-delimited JSON (NDJSON)**, UTF-8. One JSON object per line, no embedded newlines.
- **The launcher is the server, the mod is the client.** The launcher starts first and binds
  the port; the mod connects during client init and reconnects with exponential backoff
  (1s → 30s cap) if the launcher restarts.
- Default port `25585`, bound to `127.0.0.1` only.
- The launcher passes configuration as JVM args: `-Della.port=<port> -Della.workspace=<path> -Della.token=<token>`.

Plain TCP is deliberate: it needs no third-party library on Java 8, which matters for the
1.8.9 and 1.12.2 adapters.

## Envelope

Every message:

```json
{ "v": 1, "id": "3f2a...", "type": "slot.assign", "payload": { } }
```

| Field | Meaning |
|---|---|
| `v` | Protocol version, currently `1`. Mismatch → connection refused with a clear error. |
| `id` | Correlation id (UUID). Responses echo it. Notifications may omit it. |
| `type` | Message type, `namespace.verb`. |
| `payload` | Type-specific object. |

Responses use `type: "result"`:

```json
{ "v": 1, "id": "3f2a...", "type": "result", "ok": true,  "payload": { } }
{ "v": 1, "id": "3f2a...", "type": "result", "ok": false, "error": { "code": "SLOT_OUT_OF_RANGE", "message": "..." } }
```

`error.message` is a developer-facing English string. The launcher maps `error.code` to a
localized message for display — never surface `message` to the user directly.

## Handshake

### `hello` — mod → launcher

Sent immediately on connect.

```json
{
  "v": 1, "id": "...", "type": "hello",
  "payload": {
    "token": "…",
    "minecraftVersion": "1.12.2",
    "loader": "forge",
    "loaderVersion": "14.23.5.2859",
    "adapter": "forge-1.12.2",
    "adapterVersion": "0.1.0",
    "javaVersion": "8",
    "slots": { "block": 128, "item": 128 },
    "capabilities": ["render_layer.cutout", "..."]
  }
}
```

`token` must match the one passed on the command line, otherwise the launcher drops the
connection. This prevents an unrelated process from driving the editor.

### `welcome` — launcher → mod

```json
{
  "v": 1, "id": "...", "type": "welcome",
  "payload": {
    "workspace": "K:/projects/Ella/workspaces/demo",
    "projectId": "demo",
    "namespace": "ella",
    "packRoot": "K:/projects/Ella/workspaces/demo/pack"
  }
}
```

`packRoot` is the directory the mod injects into the resource stack. It must exist before
the mod connects.

## Capabilities

Declared by the adapter, consumed by the editor to enable or grey out controls.

| Capability | Meaning |
|---|---|
| `render_layer.cutout` | `cutout` render layer selectable |
| `render_layer.cutout_mipped` | `cutout_mipped` selectable |
| `render_layer.translucent` | `translucent` selectable |
| `render_layer.runtime` | Render layer can change without a restart |
| `light.dynamic` | Light level changeable at runtime |
| `hitbox.custom` | Custom hitbox/collision box supported |
| `hitbox.runtime` | Hitbox changeable at runtime |
| `reload.programmatic` | Mod can trigger a resource reload itself (no manual F3+T) |
| `model.obj` | OBJ model source supported |
| `item.rarity` | Item rarity selectable |
| `item.components` | Data components available (1.20.5+) |
| `entry.place` | `entry.place` supported |

Unknown capability strings are ignored, so adapters may add new ones without breaking older
launchers.

## Messages

### `slot.assign` — launcher → mod

Bind a project entry to a slot. Idempotent: reassigning the same slot replaces it.

```json
{
  "slot": 0,
  "kind": "block",
  "entryId": "ruby_lamp",
  "registryName": "ella:block_000",
  "displayName": { "en": "Ruby Lamp", "fr": "Lampe de rubis" },
  "settings": { "renderLayer": "cutout", "lightLevel": 15, "hardness": 0.3 }
}
```

Model and texture files are written to disk by the launcher before this is sent; the
message carries no binary data.

### `slot.clear` — launcher → mod

```json
{ "slot": 0, "kind": "block" }
```

### `settings.patch` — launcher → mod

Partial update of a live slot. Only the listed keys change. Cheaper than a full reassign
and does not require a resource reload unless the model changed.

```json
{ "slot": 0, "kind": "block", "settings": { "lightLevel": 7 } }
```

The response reports which keys were actually applied, so the editor can flag any the
running version silently could not honour:

```json
{ "applied": ["lightLevel"], "ignored": [] }
```

### `resources.reload` — launcher → mod

Triggers a client resource reload. Debounced launcher-side (250 ms) so a burst of file
writes causes one reload.

```json
{ "reason": "model_changed", "entryId": "ruby_lamp" }
```

### `entry.give` / `entry.place` — launcher → mod

Quality-of-life: put the block/item in the player's hand, or place it directly in front of
the player.

```json
{ "slot": 0, "kind": "block", "count": 1 }
```

### `log` — mod → launcher

Forwards game-side events so the editor can show errors (a broken model JSON, a missing
texture) without the user reading `latest.log`.

```json
{ "level": "warn", "source": "model_loader", "message": "…", "entryId": "ruby_lamp" }
```

### `ping` / `result`

`ping` is sent by the launcher every 10s. Two missed replies mark the game as disconnected.

## Error codes

| Code | Meaning |
|---|---|
| `PROTOCOL_VERSION_MISMATCH` | `v` not supported |
| `BAD_TOKEN` | Handshake token did not match |
| `SLOT_OUT_OF_RANGE` | Slot index ≥ pool size |
| `UNKNOWN_KIND` | `kind` not `block` or `item` |
| `UNSUPPORTED_SETTING` | Setting not available on this version |
| `RELOAD_FAILED` | Resource reload threw |
| `NOT_IN_WORLD` | `entry.give`/`entry.place` with no player loaded |
