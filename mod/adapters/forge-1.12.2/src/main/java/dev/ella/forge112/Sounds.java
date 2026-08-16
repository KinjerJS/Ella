package dev.ella.forge112;

import net.minecraft.block.SoundType;

/**
 * Maps Ella's version-neutral sound names onto 1.12.2's {@link SoundType} constants.
 *
 * <p>The editor deliberately exposes generic names rather than a version's own enum, so
 * one project can target 1.8.9 and 26.2 at once. Translating them is an adapter's job.
 */
final class Sounds {

    private Sounds() {
    }

    static SoundType byName(String name) {
        if (name == null) return SoundType.STONE;

        if ("wood".equals(name)) return SoundType.WOOD;
        if ("gravel".equals(name)) return SoundType.GROUND;
        if ("grass".equals(name)) return SoundType.PLANT;
        if ("metal".equals(name)) return SoundType.METAL;
        if ("glass".equals(name)) return SoundType.GLASS;
        if ("wool".equals(name)) return SoundType.CLOTH;
        if ("sand".equals(name)) return SoundType.SAND;
        if ("snow".equals(name)) return SoundType.SNOW;

        return SoundType.STONE;
    }
}
