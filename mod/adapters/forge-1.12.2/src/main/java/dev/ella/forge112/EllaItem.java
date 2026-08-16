package dev.ella.forge112;

import dev.ella.core.SlotSettings;
import net.minecraft.creativetab.CreativeTabs;
import net.minecraft.item.EnumRarity;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.util.NonNullList;
import net.minecraftforge.fml.relauncher.Side;
import net.minecraftforge.fml.relauncher.SideOnly;

/**
 * A placeholder item, reading its properties from a live {@link SlotSettings} for the
 * same reason {@link EllaBlock} does.
 */
public class EllaItem extends Item {

    /** Same guard as EllaBlock: protects reads during superclass construction. */
    private static final SlotSettings DEFAULTS = new SlotSettings();

    private final SlotSettings settings;
    private final int slot;

    public EllaItem(SlotSettings settings, int slot) {
        this.settings = settings;
        this.slot = slot;
        // The real limit is enforced by getItemStackLimit below; this only sets a
        // starting point for code that reads the field directly.
        setMaxStackSize(64);
    }

    private SlotSettings live() {
        SlotSettings current = settings;
        return current != null ? current : DEFAULTS;
    }

    public int slot() {
        return slot;
    }

    public SlotSettings settings() {
        return settings;
    }

    @Override
    public int getItemStackLimit(ItemStack stack) {
        return live().stackSize;
    }

    @Override
    public EnumRarity getRarity(ItemStack stack) {
        String rarity = live().rarity;
        if ("uncommon".equals(rarity)) return EnumRarity.UNCOMMON;
        if ("rare".equals(rarity)) return EnumRarity.RARE;
        if ("epic".equals(rarity)) return EnumRarity.EPIC;
        return EnumRarity.COMMON;
    }

    @Override
    public boolean hasEffect(ItemStack stack) {
        return live().glint || super.hasEffect(stack);
    }

    /** Bound slots only — see {@link EllaItemBlock} for why. */
    @Override
    @SideOnly(Side.CLIENT)
    public void getSubItems(CreativeTabs tab, NonNullList<ItemStack> items) {
        if (!isInCreativeTab(tab)) return;
        if (live().isBound()) items.add(new ItemStack(this));
    }

    @Override
    public String getItemStackDisplayName(ItemStack stack) {
        String name = live().displayName;
        return name == null || name.isEmpty() ? super.getItemStackDisplayName(stack) : name;
    }
}
