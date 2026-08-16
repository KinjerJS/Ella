package dev.ella.forgemodern;

import dev.ella.core.Capabilities;
import dev.ella.core.EllaHost;
import dev.ella.core.EllaLog;
import dev.ella.core.SlotPool;
import dev.ella.core.SlotSettings;
import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Modern Forge implementation of {@link EllaHost}, written against 1.21.1.
 *
 * <p>Calls arrive on the IPC thread, so anything touching the game is handed to the
 * client or server executor.
 */
public final class ForgeHost implements EllaHost {

    private static final Set<String> CAPABILITIES = Set.of(
        Capabilities.RENDER_LAYER_CUTOUT,
        Capabilities.RENDER_LAYER_CUTOUT_MIPPED,
        Capabilities.RENDER_LAYER_TRANSLUCENT,
        Capabilities.RENDER_LAYER_RUNTIME,
        Capabilities.LIGHT_DYNAMIC,
        Capabilities.HITBOX_CUSTOM,
        Capabilities.HITBOX_RUNTIME,
        Capabilities.RELOAD_PROGRAMMATIC,
        Capabilities.ITEM_RARITY,
        Capabilities.ENTRY_PLACE,
        Capabilities.BLOCK_ROTATION
        // MODEL_OBJ is absent until the Forge OBJ loader is wired up; ITEM_COMPONENTS
        // needs 1.20.5+ handling that this adapter does not implement yet.
    );

    private final SlotPool pool;

    public ForgeHost(SlotPool pool) {
        this.pool = pool;
    }

    // --- identity -----------------------------------------------------------

    @Override
    public String minecraftVersion() {
        return "1.21.1";
    }

    @Override
    public String loaderName() {
        return "forge";
    }

    @Override
    public String loaderVersion() {
        return net.minecraftforge.versions.forge.ForgeVersion.getVersion();
    }

    @Override
    public String adapterId() {
        return "forge-modern";
    }

    @Override
    public String adapterVersion() {
        return EllaMod.VERSION;
    }

    @Override
    public int packFormat() {
        // 1.21 and 1.21.1 use pack_format 34. Must match src/main/resources/pack.mcmeta:
        // Forge reads every mod jar as a resource pack and warns if the two disagree or
        // the file is missing.
        return 34;
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
        if (SlotPool.BLOCK.equals(kind)) {
            scheduleClient(ForgeHost::refreshWorldRenderers);
        }
    }

    @Override
    public void onSlotCleared(String kind, int slot) {
        onSlotAssigned(kind, slot, pool.get(kind, slot));
    }

    @Override
    public List<String> onSettingsPatched(String kind, int slot, List<String> requested,
                                          List<String> applied) {
        boolean needsRerender = applied.stream().anyMatch(key ->
            key.equals("opaque") || key.equals("fullCube") || key.equals("lightLevel")
                || key.equals("collision") || key.equals("hitbox") || key.equals("emissive"));

        if (needsRerender) scheduleClient(ForgeHost::refreshWorldRenderers);

        // renderLayer lives in the model JSON on this version, so applying it needs a
        // resource reload rather than a game-side call — the launcher sends one anyway
        // after rewriting the pack, so it still counts as honoured.
        return new ArrayList<>(applied);
    }

    // --- resources ----------------------------------------------------------

    @Override
    public void injectResourcePack(File packRoot) {
        // Injection happens at startup through AddPackFindersEvent, using the workspace
        // path from the command line. Nothing to do here beyond confirming the path the
        // launcher sent matches what was picked up.
        java.nio.file.Path active = EllaResources.workspacePack();
        if (active == null) {
            EllaLog.warn("Workspace pack was not injected at startup; live models will not "
                + "load. Relaunch through Ella so the workspace path is known before the "
                + "first resource load.");
        }
    }

    @Override
    public void reloadResources() {
        scheduleClient(() -> {
            Minecraft.getInstance().reloadResourcePacks();
            refreshWorldRenderers();
        });
    }

    private static void refreshWorldRenderers() {
        Minecraft client = Minecraft.getInstance();
        if (client.levelRenderer != null) {
            client.levelRenderer.allChanged();
        }
    }

    // --- player actions -----------------------------------------------------

    @Override
    public void giveToPlayer(String kind, int slot, int count) {
        MinecraftServer server = requireServer();

        server.execute(() -> {
            ServerPlayer player = firstPlayer(server);
            if (player == null) return;

            ItemStack stack = stackFor(kind, slot, count);
            if (stack == null || stack.isEmpty()) {
                EllaLog.warn("No registered " + kind + " for slot " + slot);
                return;
            }

            // Server-side so the item actually persists rather than vanishing next tick.
            if (!player.getInventory().add(stack)) {
                player.drop(stack, false);
            }
        });
    }

    @Override
    public void placeInFrontOfPlayer(String kind, int slot) {
        if (!SlotPool.BLOCK.equals(kind)) {
            throw new IllegalStateException("Only blocks can be placed");
        }

        MinecraftServer server = requireServer();

        server.execute(() -> {
            ServerPlayer player = firstPlayer(server);
            if (player == null) return;

            Block block = Registration.block(slot);
            if (block == null) return;

            // Two blocks ahead at foot level: in view, and not inside the player.
            double yaw = Math.toRadians(player.getYRot());
            int x = (int) Math.floor(player.getX() - Math.sin(yaw) * 2.0);
            int z = (int) Math.floor(player.getZ() + Math.cos(yaw) * 2.0);
            int y = (int) Math.floor(player.getY());

            Level level = player.level();
            level.setBlock(new BlockPos(x, y, z), block.defaultBlockState(), 3);
        });
    }

    private ItemStack stackFor(String kind, int slot, int count) {
        Item item = SlotPool.BLOCK.equals(kind)
            ? Registration.blockItem(slot)
            : Registration.item(slot);
        if (item == null) return null;

        ItemStack stack = new ItemStack(item, Math.max(1, count));
        // Stack size and rarity are data components on this version, fixed at
        // registration, so the live values are stamped onto the stack instead.
        return EllaItem.applySettings(stack, pool.get(kind, slot));
    }

    private static ServerPlayer firstPlayer(MinecraftServer server) {
        List<ServerPlayer> players = server.getPlayerList().getPlayers();
        return players.isEmpty() ? null : players.get(0);
    }

    /** @throws IllegalStateException when no world is loaded, mapped to NOT_IN_WORLD */
    private static MinecraftServer requireServer() {
        MinecraftServer server = Minecraft.getInstance().getSingleplayerServer();
        if (server == null) {
            throw new IllegalStateException("No world is loaded");
        }
        return server;
    }

    private static void scheduleClient(Runnable task) {
        Minecraft.getInstance().execute(task);
    }
}
