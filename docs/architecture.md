# Ella — Architecture

Ella is a model-testing workbench for Blockbench authors. It bundles a minimal Minecraft
launcher, a block/item editor, and an in-game mod that renders your work-in-progress models
live, without restarting the game.

## Why there is no single mod jar

Ella targets Minecraft **1.8.9 through 26.2**. No single jar can span that range:

| Break | Version | Impact |
|---|---|---|
| JSON models introduced | 1.8 | Natural floor — below this there is nothing for Blockbench to target |
| The Flattening | 1.13 | Block/item registries, blockstates and metadata all rewritten |
| Forge rewrite | 1.13 | `@Mod`/`GameRegistry` replaced; ForgeGradle 2 → 3+ |
| NeoForge fork | 1.20.2 | Forge and NeoForge APIs diverge permanently |
| Data components | 1.20.5 | Item NBT model replaced |
| Java target | 1.8 → 26.2 | Java 8 → 16 → 17 → 21 |

Obfuscation mappings also change every single version.

**Forge is still the right loader family**, for three reasons:

1. It is the only loader that exists on 1.8.9 and 1.12.2 (Fabric starts at 1.14).
2. It is still published for 26.2, so one family really does cover the whole range.
3. It ships a native OBJ loader, which is the planned model-source extension.

NeoForge support can be added later at low cost: its API is a fork of Forge 1.20.1, so the
modern adapter is largely reusable.

## Component layout

```
┌────────────────────────────┐
│  Launcher  (Electron/TS)   │  version picker · editor UI · Blockbench bridge · export
│                            │
│  ┌──────────────────────┐  │
│  │ Ella IPC server      │◄─┼──── TCP, newline-delimited JSON, port 25585
│  └──────────────────────┘  │
└────────────┬───────────────┘
             │ launches (correct Java + Forge + injected mod jar)
             ▼
┌────────────────────────────┐
│  Minecraft + Ella mod      │
│                            │
│  ella-core   (Java 8, version-agnostic)                       │
│    slot pool · protocol codec · settings model · pack writer  │
│         ▲                                                     │
│    thin adapter per version bucket                            │
│    forge-1.8.9 · forge-1.12.2 · forge-mid · forge-modern      │
└────────────────────────────┘
```

`ella-core` holds all logic that does not touch Minecraft classes. Each adapter is a thin
bridge (roughly 200–400 lines) implementing a small SPI against its own Forge API.

### Build topology

Adapters are **independent Gradle builds**, not subprojects of one build. ForgeGradle 2
(needed for 1.12.2) and modern ForgeGradle cannot coexist in a single build, and the Java
toolchains differ. `ella-core` builds first as a plain Java 8 jar with no Forge dependency;
each adapter consumes that jar and shades it into its output.

## Live editing without restarting

Minecraft freezes its registries after startup on every version, so blocks genuinely cannot
be registered at runtime. Ella works around this with a **slot pool**:

1. At startup the mod registers N empty placeholder blocks and items (`ella:block_000` …).
   N is configurable; 128 costs nothing.
2. Models and textures live in a resource pack directory on disk that the mod injects into
   the resource stack.
3. On save, the launcher writes the JSON/PNG and asks the mod to run a resource reload
   (the programmatic equivalent of F3+T). The model updates in place.
4. Block properties are read at call time from a mutable per-slot settings object rather
   than baked into constants, so they can change live.

Live-editable: render layer, light level, hardness, resistance, sounds, tint, hitbox,
collision box, full-cube, occlusion, item stack size, rarity.

**Rotation is the one setting that is only half dynamic**, and for the same underlying
reason the pool exists. A block's state properties are baked into its state container at
construction, exactly as registry entries are frozen after startup — so a `facing`
property cannot be added later. Every slot therefore registers with one from the start,
and the `rotation` setting decides whether placement varies it. Changing the setting takes
effect on the next block placed; blocks already in the world keep the facing they were
given, which is the same behaviour vanilla has.

The blockstate lists a variant per direction, with `facing=north` unrotated so a fixed
block renders exactly as authored.

The only hard limit: exceeding N slots requires a restart.

## Two cross-version traps worth knowing

Both were found while building the adapters, and both fail *silently* — the game loads,
logs nothing useful, and simply renders the wrong thing.

**Default blockstate variant.** A block with no properties uses the variant named `normal`
on 1.8.9 and 1.12.2, and the empty-string variant from 1.13 onwards. Ella writes both keys
into every generated blockstate; the unused one is ignored.

**Where the render layer lives.** From 1.19, Forge reads `render_type` straight out of the
model JSON, so on modern versions the render layer is a pure resource-pack concern — Ella
writes it into the slot's redirect model and a reload applies it, with no game-side call at
all. Older versions have no such key and get their layer from the block's own
`getRenderLayer` override instead. Ella does both unconditionally: the key is ignored where
it is not understood, and the override is harmless where the model wins.

**Where a blockstate's `model` points.** Before 1.13 the value is resolved relative to
`models/block/` — the prefix is implicit — and from 1.13 it is a full path from `models/`.
So `ella:block/slot_000` means `models/block/block/slot_000.json` on 1.12.2 and
`models/block/slot_000.json` on 1.21. Ella writes the redirect model at both paths so one
blockstate serves the range. This quirk is specific to blockstates: a `parent` inside a
model file is a full path on every version, which is why item models need only one copy —
and why a block can render correctly in hand while showing the missing-model cube in the
world.

**Translation keys and lang file format.** 1.12.2 reads `assets/<ns>/lang/en_us.lang` as
`key=value` lines and looks up `tile.<ns>.<path>.name` for blocks; 1.13 onwards read
`en_us.json` and look up `block.<ns>.<path>`. Ella writes both formats and both key
conventions — a version ignores what it does not understand, and writing only one leaves
half the range showing a raw key instead of a name.

**Only bound slots appear in the creative tab.** The pool registers 128 blocks so that
binding one needs no restart, but an unbound slot's model is a bare `cube_all` with no
texture. Showing all 128 fills the tab with identical untextured cubes, and picking one is
indistinguishable from a bug in the block you were actually working on.

Transparency needs *two* things on every version — a non-solid render layer **and**
neighbour occlusion switched off. Setting only one is the single most common mistake when
moving a Blockbench model into the game, so the editor detects it and offers the fix.

## Modded version files

A Forge version file layers onto the vanilla one through `inheritsFrom`. Two things about
that merge are easy to get wrong, and both fail far from their cause:

- **Do not synthesize an empty `arguments` object.** An empty array is truthy, so code
  testing `version.arguments?.jvm` concludes the file uses the modern argument format and
  skips the legacy path that supplies `-cp`. The launch then has no classpath at all and
  fails with *Could not find or load main class*.
- **The client jar, natives and Java version all follow the vanilla id**, not the modded
  one. A Forge version directory holds a version file but no jar, and `1.12.2-forge-…`
  does not parse as a version at all — it sorts after every known release, so a naive
  "is it at least 1.20.5?" says yes and hands 1.12.2 a Java 21 runtime. Launchwrapper
  then dies casting the system classloader to `URLClassLoader`, an error that points
  nowhere near the cause. The merge records the base id in `ellaBaseVersionId`, and
  `requiredJavaVersion` strips modded suffixes as a second line of defence.

Both mistakes share a shape worth remembering: a modded version id looks enough like a
version to pass through code unnoticed, and fails somewhere else entirely.

## Install and uninstall

Downloaded content falls into three groups, and the difference decides what an uninstall
may touch:

| Group | Location | On uninstall |
|---|---|---|
| Version files, natives, Forge version | `versions/`, `natives/` | deleted |
| Libraries, asset objects | `libraries/`, `assets/objects/` | **kept — shared** |
| Worlds, options, mods folder | `instances/<version>/` | kept unless explicitly opted in |

Libraries and assets are content-addressed and deduplicated across every installed
version, so deleting one version's copies would break the others. Reclaiming that space
needs a garbage collection pass over all versions — a separate operation, not part of
uninstalling one.

The instance directory holds the only irreplaceable data Ella manages. Deleting it is a
second, unticked choice in the confirmation, stated in plain terms.

Deleting a project applies the same principle one level down. Removing an *entry* keeps
its model and texture by default — recreating the entry is cheap, redrawing the model is
not — while deleting a *project* has no such variant, so it names the count of authored
files and requires the project name to be typed.

Before every launch the instance is checked against the built adapter jar by hash:
missing, stale or duplicate Ella jars are corrected, and any other mod in the folder is
left alone. Doing this on launch rather than only at install time means a rebuilt adapter
reaches the game with no reinstall step, and an emptied mods folder repairs itself.

## Capability negotiation

1.8.9 cannot do everything 26.2 can. Rather than pretending otherwise, each adapter
declares a capability set in its `hello` message. The editor greys out controls the running
version cannot honour and says why. One UI serves the whole range honestly.

See [`protocol.md`](protocol.md) and [`project-format.md`](project-format.md).

## Language policy

Code, comments, identifiers and documentation are English. Every user-facing string is
resolved through i18n with English and French locales.
