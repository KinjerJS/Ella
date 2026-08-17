package dev.ella.forge189;

import dev.ella.core.Capabilities;
import dev.ella.core.EllaHost;
import dev.ella.core.EllaLog;
import dev.ella.core.SlotPool;
import dev.ella.core.SlotSettings;
import net.minecraft.block.Block;
import net.minecraft.client.Minecraft;
import net.minecraft.entity.player.EntityPlayerMP;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.server.MinecraftServer;
import net.minecraft.util.BlockPos;
import net.minecraft.util.MathHelper;
import net.minecraft.world.World;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * The 1.8.9 implementation of {@link EllaHost}.
 *
 * <p>Every method here can be called from the IPC thread, so anything touching the game
 * is handed to the client or server scheduler. Doing the work inline would be a data race
 * against the render and tick loops — the kind that produces crashes far from the cause.
 */
public final class ForgeHost implements EllaHost {

    private static final Set<String> CAPABILITIES = new HashSet<String>(Arrays.asList(
        Capabilities.RENDER_LAYER_CUTOUT,
        Capabilities.RENDER_LAYER_CUTOUT_MIPPED,
        Capabilities.RENDER_LAYER_TRANSLUCENT,
        Capabilities.RENDER_LAYER_RUNTIME,
        Capabilities.LIGHT_DYNAMIC,
        Capabilities.HITBOX_CUSTOM,
        Capabilities.HITBOX_RUNTIME,
        Capabilities.RELOAD_PROGRAMMATIC,
        Capabilities.ENTRY_PLACE,
        Capabilities.BLOCK_ROTATION
        // Same omissions as 1.12.2: ITEM_RARITY predates the launcher's enum, MODEL_OBJ
        // needs the Forge OBJ loader — which 1.8.9 does not have at all — and
        // ITEM_COMPONENTS only exists from 1.20.5.
    ));

    private final SlotPool pool;

    public ForgeHost(SlotPool pool) {
        this.pool = pool;
    }

    // --- identity -----------------------------------------------------------

    @Override
    public String minecraftVersion() {
        return "1.8.9";
    }

    @Override
    public String loaderName() {
        return "forge";
    }

    @Override
    public String loaderVersion() {
        return net.minecraftforge.common.ForgeVersion.getVersion();
    }

    @Override
    public String adapterId() {
        return "forge-1.8.9";
    }

    @Override
    public String adapterVersion() {
        return EllaMod.VERSION;
    }

    @Override
    public int packFormat() {
        // 1.8 and 1.8.9 use pack_format 1. Must match src/main/resources/pack.mcmeta,
        // which Forge reads from the mod jar itself.
        return 1;
    }

    @Override
    public Set<String> capabilities() {
        return CAPABILITIES;
    }

    @Override
    public int slotCount(String kind) {
        return pool.size(kind);
    }

    // --- slots --------------------------------------------------------------

    @Override
    public void onSlotAssigned(String kind, int slot, SlotSettings settings) {
        if (!SlotPool.BLOCK.equals(kind)) return;

        // Sound is a field on this version rather than a getter, so it has to be pushed
        // rather than pulled — see EllaBlock.applySound.
        EllaBlock block = Registration.block(slot);
        if (block != null) block.applySound();

        scheduleClient(new Runnable() {
            @Override
            public void run() {
                refreshWorldRenderers();
            }
        });
    }

    @Override
    public void onSlotCleared(String kind, int slot) {
        onSlotAssigned(kind, slot, pool.get(kind, slot));
    }

    @Override
    public List<String> onSettingsPatched(String kind, int slot, List<String> requested,
                                          List<String> applied) {
        boolean needsRerender = false;
        for (String key : applied) {
            if ("soundType".equals(key) && SlotPool.BLOCK.equals(kind)) {
                EllaBlock block = Registration.block(slot);
                if (block != null) block.applySound();
            }
            if ("renderLayer".equals(key) || "opaque".equals(key) || "fullCube".equals(key)
                || "lightLevel".equals(key) || "emissive".equals(key)) {
                needsRerender = true;
            }
        }

        if (needsRerender) {
            scheduleClient(new Runnable() {
                @Override
                public void run() {
                    refreshWorldRenderers();
                }
            });
        }

        // Every key core managed to apply is genuinely honoured on this version, except
        // the ones whose capability is not declared — the launcher greys those out, so
        // reaching here with one means the project targets a newer version.
        List<String> honoured = new ArrayList<String>();
        for (String key : applied) {
            if ("rarity".equals(key) && !CAPABILITIES.contains(Capabilities.ITEM_RARITY)) {
                continue;
            }
            honoured.add(key);
        }
        return honoured;
    }

    // --- resources ----------------------------------------------------------

    @Override
    public void injectResourcePack(final File packRoot) {
        scheduleClient(new Runnable() {
            @Override
            public void run() {
                if (EllaResources.inject(packRoot)) {
                    Minecraft.getMinecraft().refreshResources();
                }
            }
        });
    }

    @Override
    public void reloadResources() {
        scheduleClient(new Runnable() {
            @Override
            public void run() {
                // The programmatic equivalent of F3+T.
                Minecraft.getMinecraft().refreshResources();
                refreshWorldRenderers();
            }
        });
    }

    /** Forces chunk meshes to rebuild so shape and render-layer changes become visible. */
    private static void refreshWorldRenderers() {
        Minecraft client = Minecraft.getMinecraft();
        if (client.renderGlobal != null) {
            client.renderGlobal.loadRenderers();
        }
    }

    // --- player actions -----------------------------------------------------

    @Override
    public void giveToPlayer(final String kind, final int slot, final int count) {
        final MinecraftServer server = requireServer();

        server.addScheduledTask(new Runnable() {
            @Override
            public void run() {
                EntityPlayerMP player = firstPlayer(server);
                if (player == null) return;

                ItemStack stack = stackFor(kind, slot, count);
                if (stack == null) {
                    EllaLog.warn("No registered " + kind + " for slot " + slot);
                    return;
                }

                // Going through the server player rather than the client inventory is
                // what makes the item actually persist rather than vanish next tick.
                if (!player.inventory.addItemStackToInventory(stack)) {
                    // 1.8.9's three-argument form: the extra flag is "trace to the player",
                    // which keeps a dropped item from landing behind them.
                    player.dropItem(stack, false, false);
                }
            }
        });
    }

    @Override
    public void placeInFrontOfPlayer(final String kind, final int slot) {
        if (!SlotPool.BLOCK.equals(kind)) {
            throw new IllegalStateException("Only blocks can be placed");
        }

        final MinecraftServer server = requireServer();

        server.addScheduledTask(new Runnable() {
            @Override
            public void run() {
                EntityPlayerMP player = firstPlayer(server);
                if (player == null) return;

                Block block = Registration.block(slot);
                if (block == null) return;

                // Two blocks ahead at eye level, which lands in view without landing
                // inside the player.
                double yaw = Math.toRadians(player.rotationYaw);
                int x = MathHelper.floor_double(player.posX - Math.sin(yaw) * 2.0);
                int z = MathHelper.floor_double(player.posZ + Math.cos(yaw) * 2.0);
                int y = MathHelper.floor_double(player.posY);

                World world = player.worldObj;
                BlockPos position = new BlockPos(x, y, z);
                world.setBlockState(position, block.getDefaultState(), 3);
            }
        });
    }

    private ItemStack stackFor(String kind, int slot, int count) {
        Item item = SlotPool.BLOCK.equals(kind)
            ? Registration.blockItem(slot)
            : Registration.item(slot);
        return item == null ? null : new ItemStack(item, Math.max(1, count));
    }

    private static EntityPlayerMP firstPlayer(MinecraftServer server) {
        List<EntityPlayerMP> players = server.getConfigurationManager().playerEntityList;
        return players.isEmpty() ? null : players.get(0);
    }

    /** @throws IllegalStateException when no world is loaded, which core maps to NOT_IN_WORLD */
    private static MinecraftServer requireServer() {
        MinecraftServer server = Minecraft.getMinecraft().getIntegratedServer();
        if (server == null) {
            throw new IllegalStateException("No world is loaded");
        }
        return server;
    }

    private static void scheduleClient(Runnable task) {
        Minecraft.getMinecraft().addScheduledTask(task);
    }
}
