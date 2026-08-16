package dev.ella.forge112;

import dev.ella.core.SlotSettings;
import net.minecraft.creativetab.CreativeTabs;
import net.minecraft.item.ItemStack;
import net.minecraft.item.ItemBlock;
import net.minecraft.util.NonNullList;
import net.minecraftforge.fml.relauncher.Side;
import net.minecraftforge.fml.relauncher.SideOnly;

/**
 * The item form of a placeholder block.
 *
 * <p>Exists to keep unbound slots out of the creative tab. The pool holds 128 blocks so
 * that binding one needs no restart, but showing all 128 fills the tab with identical
 * untextured cubes — and picking one of those is indistinguishable from a bug in the
 * block you were actually working on.
 */
public class EllaItemBlock extends ItemBlock {

    private final SlotSettings settings;

    public EllaItemBlock(EllaBlock block) {
        super(block);
        this.settings = block.settings();
    }

    @Override
    @SideOnly(Side.CLIENT)
    public void getSubItems(CreativeTabs tab, NonNullList<ItemStack> items) {
        if (!isInCreativeTab(tab)) return;
        // Bound slots only. An unbound one has no model and no name to show.
        if (settings != null && settings.isBound()) {
            items.add(new ItemStack(this));
        }
    }

    /**
     * The name shown in the tab and hotbar.
     *
     * <p>Read from the slot rather than a translation key: the launcher already knows the
     * display name and pushes it over the protocol, so it is live and needs no resource
     * reload. The translation key remains as the fallback for a slot bound before the
     * name arrives.
     */
    @Override
    public String getItemStackDisplayName(ItemStack stack) {
        String name = settings == null ? null : settings.displayName;
        return name == null || name.isEmpty() ? super.getItemStackDisplayName(stack) : name;
    }
}
