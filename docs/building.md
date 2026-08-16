# Building Ella

Three independent builds. Nothing is shared through a repository — the adapters compile
`ella-core` from source — so they can be built in any order.

## Launcher

```bash
cd launcher
npm install
npm test          # 202 tests, runs straight off the TypeScript sources
npm run typecheck
npm run dev       # Electron with hot reload
npm run build     # production bundle into out/
```

Tests run under Node's built-in type stripping, so there is no build step before testing.
That is why the codebase avoids TypeScript syntax needing more than stripping — no
parameter properties, enums, namespaces or decorators.

## `ella-core`

Plain Java 8 library, no Minecraft dependency.

```bash
cd mod/ella-core
gradle test
```

It is compiled against **Gson 2.8.0** on purpose — the oldest version Minecraft bundles in
Ella's range. Compiling against a newer Gson would let calls through that crash only on
1.12.2, which is exactly the kind of bug this range invites.

## Adapters

Each adapter is its own Gradle build and produces a jar the launcher injects into the
instance's `mods` folder.

```bash
cd mod/adapters/forge-1.12.2 && gradle build
cd mod/adapters/forge-modern && gradle build
```

Output lands in `build/libs/`. The launcher finds it automatically in development; there
is no install step.

Ignore the `-dev.jar` — it is deobfuscated and will not load in a normal game. The
launcher explicitly filters it out for that reason.

### Toolchains

| Adapter | Plugin | Gradle JVM | Compiles to |
|---|---|---|---|
| `forge-1.12.2` | RetroFuturaGradle 1.4.x | Java 17 | Java 8 |
| `forge-modern` | ForgeGradle 6 | Java 21 | Java 21 |

**Why RetroFuturaGradle for 1.12.2.** The original ForgeGradle 2.3 is pinned to Gradle 4.4
and Java 8. RFG provides the same deobfuscation toolchain on modern Gradle. It is pinned
to the 1.4.x line because RFG 2.x is compiled for a newer JVM than Gradle runs on here and
fails while loading the plugin jar; moving to 2.x means running Gradle itself on Java 21+.

**Why `forge-modern` sets `org.gradle.java.home`.** ForgeGradle runs game tooling inside
the Gradle JVM, so the daemon itself has to be Java 21 regardless of the toolchain setting.

The path in `mod/adapters/forge-modern/gradle.properties` is absolute and therefore only
correct on the machine it was written for. Override it on the command line rather than
editing the file, which is what CI does:

```bash
gradle build -Dorg.gradle.java.home=/path/to/jdk-21
```

The first build of either adapter downloads Forge and decompiles Minecraft — two minutes
or so, and several hundred megabytes. Later builds take seconds.

## Packaging

```bash
cd launcher
npm run dist          # installer + portable .exe into launcher/release/
npm run dist:dir      # unpacked app only, for a quick check
```

`dist` runs three steps first, each of which can also be run on its own:

| Step | What it does |
|---|---|
| `npm run build` | typechecks and bundles the app into `out/` |
| `npm run icon` | draws `build/icon.ico` — see `scripts/make-icon.mjs` |
| `npm run stage:adapters` | copies each adapter's jar into `resources/adapters/<id>/` |

Two artifacts come out: `Ella-Setup-<version>.exe`, a per-user NSIS installer that needs no
administrator rights, and `Ella-<version>-portable.exe`, a single self-extracting
executable. Both are around 80 MB, which is Electron.

**The adapters must be built first.** `stage:adapters` fails the build if it finds no jars
at all, because an installer without them still launches Minecraft but silently loses live
editing — the feature the tool exists for. Adapters that are merely *not written yet*
(`forge-1.8.9`, `forge-mid`) are skipped without complaint, and the launcher reports those
versions as vanilla-only at runtime.

The jars are packaged as `extraResources`, so they sit next to the asar as ordinary files
rather than inside it. The injector copies them into an instance's `mods` folder, and
keeping their real filename (`ella-forge-1.12.2-0.1.0.jar`) matters: the stale-jar cleanup
matches `ella-*.jar`, so renaming them would let two Ella mods accumulate in one instance.

### Signing

Unsigned. Windows SmartScreen will warn on first run, and there is no way around that
short of a code-signing certificate. Set `CSC_LINK` and `CSC_KEY_PASSWORD` if you have one
— electron-builder picks them up with no config change.

### `Cannot create symbolic link` on Windows

electron-builder downloads a signing-tools bundle that contains macOS symlinks, and
extracting those needs a privilege a normal Windows account does not have. It fails even
though nothing in the macOS half is used. Fix it once, either way:

- enable **Developer Mode** (Settings → Privacy & security → For developers), or
- extract the archive by hand into
  `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`, skipping `darwin/`.

CI does not hit this: GitHub's Windows runners are already privileged.

## Continuous integration

`.github/workflows/build.yml` builds everything on every push to `main` and on pull
requests.

| Job | Runner | Runs on |
|---|---|---|
| `launcher` | ubuntu | always — typecheck and tests |
| `core` | ubuntu | always — `ella-core` tests |
| `adapters` | ubuntu | always — both jars, uploaded as an artifact |
| `windows` | windows | pushes and tags — the installers |
| `release` | ubuntu | tags matching `v*` — attaches the `.exe`s to a GitHub release |

Pull requests skip packaging: it is deterministic once the jobs above pass, and a Windows
runner costs several times an Ubuntu one.

The Gradle JVM is pinned per adapter with `-Dorg.gradle.java.home`, and toolchain JDKs are
found through `org.gradle.java.installations.fromEnv` — without it Gradle cannot see the
JDKs `setup-java` installed and reports the Java 8 toolchain as missing.

Cutting a release is one command:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

## Verifying an API before using it

Both adapters were written by reading the real decompiled sources rather than from memory,
and it caught several things that would otherwise have been silent bugs. The technique is
worth repeating whenever a version is added.

For 1.12.2, RFG leaves readable sources in the build directory:

```
mod/adapters/forge-1.12.2/build/rfg/mcp_patched_ated_minecraft-sources.jar
```

For modern versions, ForgeGradle produces a mapped class jar; `javap` gives exact
signatures:

```bash
javap -cp ~/.gradle/caches/forge_gradle/minecraft_user_repo/net/minecraftforge/forge/\
1.21.1-52.1.0_mapped_official_1.21.1/forge-1.21.1-52.1.0_mapped_official_1.21.1.jar \
  net.minecraft.world.item.Item
```

What this turned up:

- 1.12.2 MCP names the render layer hook `getRenderLayer`, not `getBlockLayer`, and
  `setTranslationKey`, not `setUnlocalizedName`.
- `JsonObject.keySet()` does not exist in Gson 2.8.0.
- Forge 1.21.1's `@Mod` has no `dist` attribute.
- `Player.getDestroySpeed(BlockState, BlockPos)` replaces `getDigSpeed`.
- Item stack size and rarity are **data components** from 1.20.5, not overridable methods.
- Creative tabs have no `ForgeRegistries` constant; the vanilla registry key is the way in.
- Forge 1.21.1 constructs a mod with a `FMLJavaModLoadingContext` parameter, falling back
  to a no-argument constructor — nothing else. Taking an `IEventBus` directly, which other
  loader versions accept, fails with `NoSuchMethodException: <init>()`, which names the
  fallback rather than the signature actually wanted.
- `Block`'s constructor calls overridable methods (`isOpaqueCube`, `isFullCube`, …) while
  building its default block state — **before** a subclass's fields are assigned. A block
  that reads its own fields from those overrides throws a `NullPointerException` during
  registration, and the trace points at the override rather than the constructor that
  provoked it. Both adapters route every such read through a `live()` accessor that falls
  back to shared defaults.
- Every mod jar is also read as a resource pack, so it needs a `pack.mcmeta` at its root
  even when it ships no assets. Without one Forge logs a "failed to load a valid
  ResourcePackInfo" warning. Its `pack_format` must match what the adapter reports from
  `packFormat()`.

## Blockbench plugin

No build step — it is a single JavaScript file. Install it from Ella's Settings tab, or
copy it into `%APPDATA%/Blockbench/plugins`.

`blockbench-plugin/inspect-api.mjs` reads the installed `app.asar` and reports which plugin
APIs actually exist in that build. Re-run it after a Blockbench update if the plugin stops
working.
