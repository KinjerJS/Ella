package dev.ella.forgemodern;

import net.minecraft.world.level.block.SoundType;

/**
 * Maps Ella's version-neutral sound names onto modern {@link SoundType} constants.
 *
 * <p>Kept separate from the 1.12.2 version of this class rather than shared, because the
 * constant names differ (GROUND/PLANT/CLOTH became GRAVEL/GRASS/WOOL) — the mapping is
 * exactly the sort of per-version knowledge an adapter exists to hold.
 */
final class Sounds {

    private Sounds() {
    }

    static SoundType byName(String name) {
        if (name == null) return SoundType.STONE;

        if ("wood".equals(name)) return SoundType.WOOD;
        if ("gravel".equals(name)) return SoundType.GRAVEL;
        if ("grass".equals(name)) return SoundType.GRASS;
        if ("metal".equals(name)) return SoundType.METAL;
        if ("glass".equals(name)) return SoundType.GLASS;
        if ("wool".equals(name)) return SoundType.WOOL;
        if ("sand".equals(name)) return SoundType.SAND;
        if ("snow".equals(name)) return SoundType.SNOW;

        return SoundType.STONE;
    }
}
