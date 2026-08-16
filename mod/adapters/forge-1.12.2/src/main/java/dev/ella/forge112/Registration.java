package dev.ella.forge112;

import dev.ella.core.SlotPool;
import net.minecraft.block.Block;
import net.minecraft.client.renderer.block.model.ModelResourceLocation;
import net.minecraft.creativetab.CreativeTabs;
import net.minecraft.item.Item;
import net.minecraft.item.ItemBlock;
import net.minecraft.item.ItemStack;
import net.minecraft.util.ResourceLocation;
import net.minecraftforge.client.event.ModelRegistryEvent;
import net.minecraftforge.client.model.ModelLoader;
import net.minecraftforge.event.RegistryEvent;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent;
import net.minecraftforge.fml.relauncher.Side;
import net.minecraftforge.fml.relauncher.SideOnly;

import java.util.ArrayList;
import java.util.List;

/**
 * Registers the slot pool during normal mod startup.
 *
 * <p>Everything here happens while registries are still open. Nothing is registered later,
 * because nothing can be: binding a project entry to a slot at runtime only changes the
 * settings object a placeholder already reads from.
 */
@Mod.EventBusSubscriber(modid = EllaMod.MOD_ID)
public final class Registration {

    private static final List<EllaBlock> BLOCKS = new ArrayList<EllaBlock>();
    private static final List<EllaItem> ITEMS = new ArrayList<EllaItem>();
    private static final List<ItemBlock> BLOCK_ITEMS = new ArrayList<ItemBlock>();

    /** Creative tab so the placeholders can be found without the launcher running. */
    public static final CreativeTabs TAB = new CreativeTabs(EllaMod.MOD_ID) {
        @Override
        public ItemStack createIcon() {
            return BLOCK_ITEMS.isEmpty()
                ? new ItemStack(net.minecraft.init.Blocks.STONE)
                : new ItemStack(BLOCK_ITEMS.get(0));
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

    @SubscribeEvent
    public static void registerBlocks(RegistryEvent.Register<Block> event) {
        SlotPool pool = EllaMod.pool();

        for (int slot = 0; slot < pool.size(SlotPool.BLOCK); slot++) {
            EllaBlock block = new EllaBlock(pool.get(SlotPool.BLOCK, slot), slot);
            String path = SlotPool.registryPath(SlotPool.BLOCK, slot);

            block.setRegistryName(new ResourceLocation(EllaMod.MOD_ID, path));
            block.setTranslationKey(EllaMod.MOD_ID + "." + path);
            block.setCreativeTab(TAB);

            BLOCKS.add(block);
            event.getRegistry().register(block);
        }

        EllaLogBridge.info("Registered " + BLOCKS.size() + " block slots");
    }

    @SubscribeEvent
    public static void registerItems(RegistryEvent.Register<Item> event) {
        SlotPool pool = EllaMod.pool();

        // One ItemBlock per placeholder block, so blocks can be held and placed.
        for (EllaBlock block : BLOCKS) {
            ItemBlock itemBlock = new EllaItemBlock(block);
            itemBlock.setRegistryName(block.getRegistryName());
            itemBlock.setCreativeTab(TAB);
            BLOCK_ITEMS.add(itemBlock);
            event.getRegistry().register(itemBlock);
        }

        for (int slot = 0; slot < pool.size(SlotPool.ITEM); slot++) {
            EllaItem item = new EllaItem(pool.get(SlotPool.ITEM, slot), slot);
            String path = SlotPool.registryPath(SlotPool.ITEM, slot);

            item.setRegistryName(new ResourceLocation(EllaMod.MOD_ID, path));
            item.setTranslationKey(EllaMod.MOD_ID + "." + path);
            item.setCreativeTab(TAB);

            ITEMS.add(item);
            event.getRegistry().register(item);
        }

        EllaLogBridge.info("Registered " + ITEMS.size() + " item slots");
    }

    /**
     * Points every placeholder at its inventory model.
     *
     * <p>The model files themselves come from the launcher's workspace pack, which is why
     * the pack must be injected before the first resource load rather than after.
     */
    @SubscribeEvent
    @SideOnly(Side.CLIENT)
    public static void registerModels(ModelRegistryEvent event) {
        for (ItemBlock itemBlock : BLOCK_ITEMS) {
            ModelLoader.setCustomModelResourceLocation(
                itemBlock, 0, new ModelResourceLocation(itemBlock.getRegistryName(), "inventory"));
        }
        for (EllaItem item : ITEMS) {
            ModelLoader.setCustomModelResourceLocation(
                item, 0, new ModelResourceLocation(item.getRegistryName(), "inventory"));
        }
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
