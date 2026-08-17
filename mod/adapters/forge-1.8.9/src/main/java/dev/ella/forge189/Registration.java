package dev.ella.forge189;

import dev.ella.core.SlotPool;
import net.minecraft.block.Block;
import net.minecraft.client.resources.model.ModelResourceLocation;
import net.minecraft.creativetab.CreativeTabs;
import net.minecraft.item.Item;
import net.minecraft.item.ItemBlock;
import net.minecraft.util.ResourceLocation;
import net.minecraftforge.client.model.ModelLoader;
import net.minecraftforge.fml.common.registry.GameRegistry;

import java.util.ArrayList;
import java.util.List;

/**
 * Registers the slot pool during mod startup.
 *
 * <p>Everything here happens while registries are still open. Nothing is registered later,
 * because nothing can be: binding a project entry to a slot at runtime only changes the
 * settings object a placeholder already reads from.
 *
 * <p>1.8.9 has neither the registry events nor the {@code @Mod.EventBusSubscriber} of
 * later versions, so this is called directly from preInit rather than driven by the event
 * bus. {@code GameRegistry.registerBlock} builds the item form reflectively, which is why
 * {@link EllaItemBlock} takes a plain {@code Block}.
 */
public final class Registration {

    private static final List<EllaBlock> BLOCKS = new ArrayList<EllaBlock>();
    private static final List<EllaItem> ITEMS = new ArrayList<EllaItem>();
    private static final List<ItemBlock> BLOCK_ITEMS = new ArrayList<ItemBlock>();

    /**
     * Creative tab so the placeholders can be found without the launcher running.
     *
     * <p>1.8.9's tab supplies an {@link Item} rather than an {@link net.minecraft.item.ItemStack}.
     */
    public static final CreativeTabs TAB = new CreativeTabs(EllaMod.MOD_ID) {
        @Override
        public Item getTabIconItem() {
            return BLOCK_ITEMS.isEmpty()
                ? Item.getItemFromBlock(net.minecraft.init.Blocks.stone)
                : BLOCK_ITEMS.get(0);
        }
    };

    private Registration() {
    }

    public static List<EllaBlock> blocks() {
        return BLOCKS;
    }

    public static List<EllaItem> items() {
        return ITEMS;
    }

    /** Called from preInit, before FML freezes the registries. */
    static void registerAll(SlotPool pool) {
        for (int slot = 0; slot < pool.size(SlotPool.BLOCK); slot++) {
            EllaBlock block = new EllaBlock(pool.get(SlotPool.BLOCK, slot), slot);
            String path = SlotPool.registryPath(SlotPool.BLOCK, slot);

            block.setUnlocalizedName(EllaMod.MOD_ID + "." + path);
            block.setCreativeTab(TAB);
            block.applySound();

            GameRegistry.registerBlock(block, EllaItemBlock.class, path);

            BLOCKS.add(block);
            // Fetched back rather than constructed: the registry made the instance, so
            // this is the only reference that is certainly the registered one.
            Item itemForm = Item.getItemFromBlock(block);
            if (itemForm instanceof ItemBlock) BLOCK_ITEMS.add((ItemBlock) itemForm);
        }

        for (int slot = 0; slot < pool.size(SlotPool.ITEM); slot++) {
            EllaItem item = new EllaItem(pool.get(SlotPool.ITEM, slot), slot);
            String path = SlotPool.registryPath(SlotPool.ITEM, slot);

            item.setUnlocalizedName(EllaMod.MOD_ID + "." + path);
            item.setCreativeTab(TAB);

            GameRegistry.registerItem(item, path);
            ITEMS.add(item);
        }

        EllaLogBridge.info("Registered " + BLOCKS.size() + " block and " + ITEMS.size()
            + " item slots");
    }

    /**
     * Points every placeholder at its inventory model.
     *
     * <p>Called from client preInit: 1.8.9 has no model registry event, and the mapping
     * has to be in place before the model system bakes. The model files themselves come
     * from the launcher's workspace pack, which is why the pack must be injected before
     * the first resource load rather than after.
     */
    static void registerModels() {
        for (int slot = 0; slot < BLOCK_ITEMS.size(); slot++) {
            bindModel(BLOCK_ITEMS.get(slot), SlotPool.registryPath(SlotPool.BLOCK, slot));
        }
        for (int slot = 0; slot < ITEMS.size(); slot++) {
            bindModel(ITEMS.get(slot), SlotPool.registryPath(SlotPool.ITEM, slot));
        }
    }

    private static void bindModel(Item item, String path) {
        ModelLoader.setCustomModelResourceLocation(
            item, 0,
            new ModelResourceLocation(new ResourceLocation(EllaMod.MOD_ID, path), "inventory"));
    }

    public static ItemBlock blockItem(int slot) {
        return slot >= 0 && slot < BLOCK_ITEMS.size() ? BLOCK_ITEMS.get(slot) : null;
    }

    public static EllaBlock block(int slot) {
        return slot >= 0 && slot < BLOCKS.size() ? BLOCKS.get(slot) : null;
    }

    public static EllaItem item(int slot) {
        return slot >= 0 && slot < ITEMS.size() ? ITEMS.get(slot) : null;
    }
}
