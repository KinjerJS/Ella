package dev.ella.forgemodern;

import dev.ella.core.SlotPool;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.CreativeModeTab;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Block;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Registers the slot pool while registries are still open.
 *
 * <p>Nothing is registered after startup, because nothing can be. Binding a project entry
 * to a slot at runtime only writes to the settings object a placeholder already reads.
 */
public final class Registration {

    public static final DeferredRegister<Block> BLOCKS =
        DeferredRegister.create(ForgeRegistries.BLOCKS, EllaMod.MOD_ID);

    public static final DeferredRegister<Item> ITEMS =
        DeferredRegister.create(ForgeRegistries.ITEMS, EllaMod.MOD_ID);

    // Creative tabs have no ForgeRegistries constant on this version; the vanilla
    // registry key is the way in.
    public static final DeferredRegister<CreativeModeTab> TABS =
        DeferredRegister.create(Registries.CREATIVE_MODE_TAB, EllaMod.MOD_ID);

    private static final List<RegistryObject<Block>> BLOCK_SLOTS =
        new ArrayList<>();
    private static final List<RegistryObject<Item>> BLOCK_ITEM_SLOTS =
        new ArrayList<>();
    private static final List<RegistryObject<Item>> ITEM_SLOTS =
        new ArrayList<>();

    public static final RegistryObject<CreativeModeTab> TAB = TABS.register("ella", () ->
        CreativeModeTab.builder()
            .title(Component.literal("Ella"))
            .icon(() -> BLOCK_ITEM_SLOTS.isEmpty()
                ? new ItemStack(net.minecraft.world.item.Items.STONE)
                : new ItemStack(BLOCK_ITEM_SLOTS.get(0).get()))
            .displayItems((parameters, output) -> {
                for (RegistryObject<Item> slot : BLOCK_ITEM_SLOTS) output.accept(slot.get());
                for (RegistryObject<Item> slot : ITEM_SLOTS) output.accept(slot.get());
            })
            .build());

    private Registration() {
    }

    /** Declares every slot. Must run before the registries are frozen. */
    public static void register(IEventBus modBus, SlotPool pool) {
        for (int slot = 0; slot < pool.size(SlotPool.BLOCK); slot++) {
            final int index = slot;
            String path = SlotPool.registryPath(SlotPool.BLOCK, slot);

            RegistryObject<Block> block =
                BLOCKS.register(path, () -> new EllaBlock(pool.get(SlotPool.BLOCK, index), index));
            BLOCK_SLOTS.add(block);

            BLOCK_ITEM_SLOTS.add(
                ITEMS.register(path, () -> new BlockItem(block.get(), new Item.Properties())));
        }

        for (int slot = 0; slot < pool.size(SlotPool.ITEM); slot++) {
            final int index = slot;
            String path = SlotPool.registryPath(SlotPool.ITEM, slot);
            ITEM_SLOTS.add(
                ITEMS.register(path, () -> new EllaItem(pool.get(SlotPool.ITEM, index), index)));
        }

        BLOCKS.register(modBus);
        ITEMS.register(modBus);
        TABS.register(modBus);
    }

    public static Block block(int slot) {
        return slot >= 0 && slot < BLOCK_SLOTS.size() ? BLOCK_SLOTS.get(slot).get() : null;
    }

    public static Item blockItem(int slot) {
        return slot >= 0 && slot < BLOCK_ITEM_SLOTS.size() ? BLOCK_ITEM_SLOTS.get(slot).get() : null;
    }

    public static Item item(int slot) {
        return slot >= 0 && slot < ITEM_SLOTS.size() ? ITEM_SLOTS.get(slot).get() : null;
    }
}
