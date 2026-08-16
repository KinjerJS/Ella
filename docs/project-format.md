# Ella Project Format v1

An Ella project is a **directory**, not an archive. Blockbench can open files inside it
directly and it diffs cleanly under git. Only the final export is zipped.

```
MyProject.ella/
├── project.json          manifest
├── sources/              Blockbench working files (.bbmodel), OBJ sources later
│   └── ruby_lamp.bbmodel
└── pack/                 a real resource pack, injected live by the mod
    ├── pack.mcmeta
    └── assets/<namespace>/
        ├── blockstates/ruby_lamp.json
        ├── models/block/ruby_lamp.json
        ├── models/item/ruby_lamp.json
        ├── textures/block/ruby_lamp.png
        └── lang/{en_us,fr_fr}.json
```

`pack/` is a valid resource pack at all times. That is what makes export trivial and what
the mod injects into the resource stack.

## `project.json`

```json
{
  "formatVersion": 1,
  "name": "My Project",
  "namespace": "myproject",
  "targetVersions": ["1.12.2", "1.21.1"],
  "slotPool": { "block": 128, "item": 128 },
  "entries": []
}
```

`targetVersions` drives validation: the editor warns when a setting is used that some
listed target cannot honour.

## Entries

```json
{
  "id": "ruby_lamp",
  "kind": "block",
  "displayName": { "en": "Ruby Lamp", "fr": "Lampe de rubis" },
  "slot": 0,
  "model": {
    "source": "bbmodel",
    "path": "sources/ruby_lamp.bbmodel",
    "output": "pack/assets/myproject/models/block/ruby_lamp.json"
  },
  "settings": { }
}
```

`id` is `[a-z0-9_]+` — it becomes part of a resource location.

### Model source abstraction

`model.source` is one of:

| Source | Status | Notes |
|---|---|---|
| `json` | supported | Hand-written or already-exported vanilla model JSON |
| `bbmodel` | supported | Blockbench working file, converted to vanilla JSON on save |
| `obj` | **planned** | Forge-only. Needs an OBJ loader; vanilla cannot read OBJ. |

The abstraction exists from day one so OBJ plugs in later without a format migration.
Anything reading a model must switch on `source` rather than assume JSON.

## Block settings

Keys map onto adapter capabilities. Anything the running version cannot honour is greyed
out in the editor rather than silently dropped.

| Key | Type | Default | Capability |
|---|---|---|---|
| `renderLayer` | `solid` \| `cutout` \| `cutout_mipped` \| `translucent` | `solid` | `render_layer.*` |
| `lightLevel` | 0–15 | `0` | `light.dynamic` for runtime edit |
| `hardness` | float, `-1` = unbreakable | `1.5` | — |
| `resistance` | float | `6.0` | — |
| `soundType` | enum (`stone`, `wood`, `glass`, `metal`, `wool`, …) | `stone` | — |
| `fullCube` | bool | `true` | — |
| `opaque` | bool — face culling of neighbours | `true` | — |
| `tintIndex` | int, `-1` = none | `-1` | — |
| `rotation` | `none` \| `horizontal` \| `all` | `none` | `block.rotation` |
| `collision` | `full` \| `none` \| `custom` | `full` | `hitbox.custom` |
| `hitbox` | `[x1,y1,z1,x2,y2,z2]` in 0–16 model space | full cube | `hitbox.custom` |
| `emissive` | bool | `false` | — |

**Transparency needs two things**, and getting only one is the most common mistake:
set `renderLayer` to `cutout` (binary alpha) or `translucent` (gradient alpha), **and** set
`opaque` to `false` so neighbouring faces stop being culled. The editor links these — picking
a non-solid render layer offers to clear `opaque`.

## Item settings

| Key | Type | Default | Capability |
|---|---|---|---|
| `stackSize` | 1–99 | `64` | — |
| `rarity` | `common` \| `uncommon` \| `rare` \| `epic` | `common` | `item.rarity` |
| `handheld` | bool — `item/handheld` vs `item/generated` parent | `false` | — |
| `glint` | bool | `false` | — |

## Display names

`displayName` is a locale map, minimum `en`. On export it is written into
`pack/assets/<ns>/lang/en_us.json` and `fr_fr.json`. A missing locale falls back to `en`.

## Slots

`slot` is the index in the running pool the entry is bound to, or `null` if unbound. Slot
assignment is a **runtime concern** and is persisted only as a convenience so a reopened
project lands in the same place. Exported packs never reference slots — export rewrites
everything to real registry names derived from `namespace` and `id`.
