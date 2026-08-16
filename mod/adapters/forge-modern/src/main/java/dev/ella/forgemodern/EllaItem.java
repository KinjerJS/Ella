package dev.ella.forgemodern;

import dev.ella.core.SlotSettings;
import net.minecraft.core.component.DataComponents;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Rarity;

/**
 * Placeholder item reading its behaviour from a live {@link SlotSettings}.
 *
 * <p>Less is dynamic here than on 1.12.2. Since 1.20.5 stack size and rarity are data
 * components rather than overridable methods, so they are fixed once the item is
 * registered. Ella works around that by stamping the current values onto each
 * {@link ItemStack} it hands out — see {@link #applySettings} — which is why an item
 * received through the editor reflects the settings and one pulled from the creative tab
 * shows the registered defaults.
 */
public class EllaItem extends Item {

    /** Same guard as EllaBlock: protects reads during superclass construction. */
    private static final SlotSettings DEFAULTS = new SlotSettings();

    private final SlotSettings settings;
    private final int slot;

    public EllaItem(SlotSettings settings, int slot) {
        super(new Item.Properties().stacksTo(64));
        this.settings = settings;
        this.slot = slot;
    }

    public int slot() {
        return slot;
    }

    public SlotSettings settings() {
        return settings;
    }

    /** Live settings, or defaults while the superclass constructor is running. */
    private SlotSettings live() {
        SlotSettings current = settings;
        return current != null ? current : DEFAULTS;
    }

    @Override
    public boolean isFoil(ItemStack stack) {
        // Still a plain method on this version, so the glint really is live.
        return live().glint || super.isFoil(stack);
    }

    /**
     * Stamps the component-backed settings onto a stack Ella is about to hand over.
     *
     * <p>Static and takes its settings as a parameter: it stamps whichever slot's values
     * the caller is handing out, which is not necessarily this item's own.
     */
    static ItemStack applySettings(ItemStack stack, SlotSettings settings) {
        stack.set(DataComponents.MAX_STACK_SIZE, Math.max(1, Math.min(99, settings.stackSize)));
        stack.set(DataComponents.RARITY, rarityOf(settings.rarity));
        return stack;
    }

    private static Rarity rarityOf(String rarity) {
        if ("uncommon".equals(rarity)) return Rarity.UNCOMMON;
        if ("rare".equals(rarity)) return Rarity.RARE;
        if ("epic".equals(rarity)) return Rarity.EPIC;
        return Rarity.COMMON;
    }
}
