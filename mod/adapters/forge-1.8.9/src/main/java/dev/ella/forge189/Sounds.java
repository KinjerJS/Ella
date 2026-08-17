package dev.ella.forge189;

import net.minecraft.block.Block;

/**
 * Maps Ella's version-neutral sound names onto 1.8.9's sound types.
 *
 * <p>The editor deliberately exposes generic names rather than a version's own enum, so
 * one project can target 1.8.9 and 26.2 at once. Translating them is an adapter's job.
 *
 * <p>1.8.9 predates the {@code SoundType} class of later versions: the types are static
 * fields on {@link Block} and the nested class is {@code Block.SoundType}. Two of the
 * names also differ from their modern spellings — gravel is {@code soundTypeGravel} here
 * rather than {@code GROUND}, and wool is {@code soundTypeCloth}.
 */
final class Sounds {

    private Sounds() {
    }

    static Block.SoundType byName(String name) {
        if (name == null) return Block.soundTypeStone;

        if ("wood".equals(name)) return Block.soundTypeWood;
        if ("gravel".equals(name)) return Block.soundTypeGravel;
        if ("grass".equals(name)) return Block.soundTypeGrass;
        if ("metal".equals(name)) return Block.soundTypeMetal;
        if ("glass".equals(name)) return Block.soundTypeGlass;
        if ("wool".equals(name)) return Block.soundTypeCloth;
        if ("sand".equals(name)) return Block.soundTypeSand;
        if ("snow".equals(name)) return Block.soundTypeSnow;

        return Block.soundTypeStone;
    }
}
