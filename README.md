# Ella

A model-testing workbench for Blockbench authors.

Pick a Minecraft version, create a block or item, open it in Blockbench, and watch it update
**live in the running game** — no restart, no manual file copying, no writing a mod. Export
the finished work as a resource pack zip when you are done.

Targets **Minecraft 1.8.9 → 26.2** on Forge.

## Status

Early but working end to end in code: the launcher builds and runs, all three built adapter
jars compile against real Forge toolchains, and 304 launcher tests plus 23 Java tests pass.

Ella opens on a five-step guide — install a version, create a project, add a block, point
at Blockbench, launch — where every step reads its own state rather than being ticked, so
it can never claim something is done when it is not, and a step that stops being true goes
back to undone on its own. Once all five pass, the guide folds away and the same space
becomes a dashboard. Every control that is disabled says in its tooltip why, because a
greyed-out button with no reason reads as a broken app rather than a missing prerequisite.

**A project is bound to the version it was authored for.** Opening it preselects that
version, and launching a different one stops first to say what the change would do — listed
against the project's own files, entry by entry, with an offer to rewrite the ones Ella can.
The two divergences that matter are both silent in game: a `parent` overrides a model's own
geometry below 1.9, and vanilla's texture folders were renamed in 1.13. Finding either from
a black block in the world is exactly what that dialog exists to prevent.

**Changes that touch files can be taken back from the notification that reports them** — a
deletion, a rename, a texture variable removed, a model Ella rewrote. Files a deletion took
wait in a per-session stash rather than being destroyed, so the offer is real rather than a
promise the disk cannot keep.

| Component | State |
|---|---|
| Project format & IPC protocol specs | done |
| `ella-core` (shared Java 8 module) | done — 23 tests |
| Electron launcher (versions, download, launch) | done |
| Forge install + adapter injection | done |
| Adapter presence check on every launch | done |
| Version install / uninstall | done |
| Quick launch from any view | done |
| Guided setup — five steps read off live state | done |
| Animated splash while the launcher starts | done |
| Project and entry deletion | done |
| Undo a change from its notification | done |
| Projects bound to a Minecraft version, with model migration | done |
| Turntable previews of blocks and items | done |
| Block/item editor with capability gating | done |
| Blockbench open + file watch | done |
| Blockbench live-sync plugin | done |
| Resource pack `.zip` export | done |
| Windows installer + portable `.exe` | done — built and smoke-tested |
| Linux AppImage | built by CI, not yet smoke-tested |
| GitHub Actions build & release workflow | written, not yet run against a remote |
| Forge adapter 1.12.2 (`[1.12, 1.13)`) | **verified in game** — blocks render in hand and placed |
| Forge adapter 1.8.9 (`[1.8.8, 1.9)`) | **verified in game** — mod loads, blocks register and place |
| Forge adapter 1.21.1 (`[1.21.1, 1.21.2)`) | builds and loads; in-game rendering not yet confirmed |
| Forge adapter 1.16.5–1.20.1 | not started |
| Minecraft 1.7.10 and older | **not possible** — see below |
| OBJ model source | designed for, not implemented |

The full loop works on 1.12.2: the launcher installs Minecraft and Forge, picks the right
JDK, injects the adapter, the mod registers its slot pool and connects back, the workspace
pack loads, and blocks render correctly in hand and in the world.

Getting there took seven real bugs, each documented where it was found — see the gotchas
in [`docs/building.md`](docs/building.md) and the cross-version traps in
[`docs/architecture.md`](docs/architecture.md). Six of the seven were invisible to the
compiler and only surfaced in a running game.

**1.7.10 and older cannot be supported, and the reason is not effort.** The JSON model
system arrived in 1.8: the 1.7.10 client jar contains zero model and blockstate files
against 1.8.9's 1935, and its `assets/minecraft/` holds only fonts, languages, shaders,
texts and textures. Block shape on 1.7.10 lives in Java code and item appearance in
atlas sprites, so there is no file for Blockbench to edit and no file for a save to
update. Ella could only fake it by reimplementing a model interpreter inside the mod —
which is precisely the "renders something close to what the file says" failure this
design exists to avoid. Texture-only live editing on plain cubes would be possible; ask
if that is worth having.

**Version coverage is narrow and deliberately honest.** An adapter claims only the
versions it was compiled against, because Forge changed the block properties and item
component APIs inside every bucket — "compiles for 1.21.1" says nothing about 1.21.11.
`ADAPTERS` in `src/shared/version.ts` is the single source of truth, and its ranges must
match what each adapter declares to its loader. The launcher shows *Live editing*,
*Adapter not built yet*, or *Vanilla only* per version rather than offering a jar the game
will refuse.

## Layout

```
launcher/           Electron + TypeScript — launcher, editor UI, Blockbench bridge
mod/
  ella-core/        version-agnostic Java 8 core (slot pool, protocol, settings)
  adapters/         one thin Forge adapter per version bucket
blockbench-plugin/  optional plugin: saves after each edit
docs/               architecture, project format, protocol, building
```

Adapters are independent Gradle builds — the 1.12.2 and modern toolchains cannot share
one. `ella-core` is compiled from source into each adapter rather than published, so an
adapter can never be built against a stale core.

## Requirements

Running the packaged app:

- JDK 8 and 21 — Minecraft's, not Ella's. Ella auto-detects installed JDKs and picks the
  right one per version, and says so before launching rather than failing halfway.
- Blockbench

Building from source additionally needs Node.js 20+ and a JDK 17 for Gradle.

## Packaging

```bash
cd launcher && npm run dist
```

Produces a per-user installer and a portable `.exe` in `launcher/release/`; on Linux,
`npm run dist:linux` produces an AppImage instead. The adapter
jars have to be built first — see [`docs/building.md`](docs/building.md#packaging), which
also covers the CI workflow and the one Windows privilege error worth knowing about.

See [`docs/building.md`](docs/building.md) to build, and
[`docs/architecture.md`](docs/architecture.md) for the design and the reasoning behind it.

## Language policy

Code, comments and docs are English. All user-facing text goes through i18n with English
and French locales; a test fails if an English string lands without its French counterpart.
