package dev.ella.forge189;

import dev.ella.core.EllaCore;
import dev.ella.core.EllaLog;
import dev.ella.core.SlotPool;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.common.event.FMLInitializationEvent;
import net.minecraftforge.fml.common.event.FMLPreInitializationEvent;
import net.minecraftforge.fml.common.event.FMLServerStoppingEvent;
import net.minecraftforge.fml.relauncher.Side;
import net.minecraftforge.fml.relauncher.SideOnly;

/**
 * Ella's 1.8.9 entry point.
 *
 * <p>Client-side only: Ella is a modelling tool, and everything it does — resource packs,
 * render layers, live reloads — is a client concern. Marking it so keeps it from being
 * demanded of servers.
 *
 * <p>Registration happens inline here rather than through the registry events of later
 * versions, which 1.8.9 does not have.
 */
/*
 * `acceptedMinecraftVersions` must match this adapter's entry in ADAPTERS
 * (launcher/src/shared/version.ts), and a launcher test fails if the two drift.
 *
 * Without it FML derives the range from `mcversion` in mcmod.info, which yields the exact
 * version and nothing else — the mod then refuses to load on 1.8.8 with "Ella (ella) wants
 * Minecraft [1.8.9,1.8.9]" while the launcher cheerfully offered 1.8.8 as live-editable.
 * The mappings say one jar serves both versions; this is where that has to be said out
 * loud to the loader.
 */
@Mod(
    modid = EllaMod.MOD_ID,
    name = "Ella",
    version = EllaMod.VERSION,
    clientSideOnly = true,
    acceptedMinecraftVersions = "[1.8.8,1.9)",
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

        Registration.registerAll(pool);
        registerClientModels();
    }

    /**
     * Split out and side-guarded so the class loader never touches the client-only model
     * API on a server. Called from preInit because 1.8.9 bakes models before init.
     */
    @SideOnly(Side.CLIENT)
    private static void registerClientModels() {
        Registration.registerModels();
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
