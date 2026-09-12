package dev.ella.forge112;

import dev.ella.core.EllaCore;
import dev.ella.core.EllaLog;
import dev.ella.core.SlotPool;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.common.event.FMLInitializationEvent;
import net.minecraftforge.fml.common.event.FMLPreInitializationEvent;
import net.minecraftforge.fml.common.event.FMLServerStoppingEvent;

/**
 * Ella's 1.12.2 entry point.
 *
 * <p>Client-side only: Ella is a modelling tool, and everything it does — resource packs,
 * render layers, live reloads — is a client concern. Marking it so keeps it from being
 * demanded of servers.
 */
/*
 * `acceptedMinecraftVersions` must match this adapter's entry in ADAPTERS
 * (launcher/src/shared/version.ts), and a launcher test fails if the two drift.
 *
 * Stating it matters even when the range looks obvious: with the attribute absent FML
 * derives the range from `mcversion` in mcmod.info and accepts only that exact version,
 * so the launcher's offer of 1.12 and 1.12.1 would have been refused by the loader.
 */
@Mod(
    modid = EllaMod.MOD_ID,
    name = "Ella",
    version = EllaMod.VERSION,
    clientSideOnly = true,
    acceptedMinecraftVersions = "[1.12,1.13)",
    acceptableRemoteVersions = "*"
)
public final class EllaMod {

    public static final String MOD_ID = "ella";
    public static final String VERSION = "0.2.1";

    /** Default pool size, overridable with {@code -Della.slots.block} / {@code .item}. */
    private static final int DEFAULT_SLOTS = 128;

    private static SlotPool pool;
    private static EllaCore core;

    public static SlotPool pool() {
        return pool;
    }

    @Mod.EventHandler
    public void preInit(FMLPreInitializationEvent event) {
        EllaLogBridge.install();

        int blocks = slotCount("ella.slots.block");
        int items = slotCount("ella.slots.item");
        pool = new SlotPool(blocks, items);

        EllaLog.info("Ella " + VERSION + " starting with " + blocks + " block and "
            + items + " item slots");
    }

    @Mod.EventHandler
    public void init(FMLInitializationEvent event) {
        // Started after registration so the pool is fully populated before the launcher
        // can bind anything to it.
        core = EllaCore.fromSystemProperties(new ForgeHost(pool), pool);
        if (core != null) core.start();
    }

    @Mod.EventHandler
    public void serverStopping(FMLServerStoppingEvent event) {
        // Slots hold references to world state indirectly; clearing on world unload
        // avoids a stale binding pointing at a world that no longer exists.
        if (pool != null) pool.clearAll();
    }

    private static int slotCount(String property) {
        String configured = System.getProperty(property);
        if (configured == null) return DEFAULT_SLOTS;

        try {
            // Bounds match the launcher's own clamp, so the two cannot disagree.
            return Math.max(16, Math.min(1024, Integer.parseInt(configured)));
        } catch (NumberFormatException malformed) {
            EllaLog.warn("Ignoring malformed " + property + ": " + configured);
            return DEFAULT_SLOTS;
        }
    }
}
