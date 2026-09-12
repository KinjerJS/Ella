package dev.ella.forgemodern;

import dev.ella.core.EllaCore;
import dev.ella.core.EllaLog;
import dev.ella.core.SlotPool;
import net.minecraftforge.event.AddPackFindersEvent;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.event.lifecycle.FMLClientSetupEvent;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;

/**
 * Ella's modern Forge entry point, written against 1.21.1.
 *
 * <p>Client-only: everything Ella does — resource packs, render layers, live reloads — is
 * a client concern. This version of {@code @Mod} carries no {@code dist} attribute, so
 * that is declared in mods.toml instead and the IPC client is started from the client
 * setup event rather than the constructor.
 */
@Mod(EllaMod.MOD_ID)
public final class EllaMod {

    public static final String MOD_ID = "ella";
    public static final String VERSION = "0.2.1";

    private static final int DEFAULT_SLOTS = 128;

    private static SlotPool pool;
    private static EllaCore core;

    /**
     * Forge 1.21.1 constructs a mod by looking for a constructor taking
     * {@link FMLJavaModLoadingContext} first, then falling back to a no-argument one — it
     * accepts nothing else. Taking an {@code IEventBus} directly, which several other
     * loader versions do allow, fails here with a bare
     * {@code NoSuchMethodException: <init>()} that names the fallback rather than the
     * signature actually wanted.
     */
    public EllaMod(FMLJavaModLoadingContext context) {
        IEventBus modBus = context.getModEventBus();

        EllaLogBridge.install();

        int blocks = slotCount("ella.slots.block");
        int items = slotCount("ella.slots.item");
        pool = new SlotPool(blocks, items);

        EllaLog.info("Ella " + VERSION + " starting with " + blocks + " block and "
            + items + " item slots");

        Registration.register(modBus, pool);

        modBus.addListener(EllaResources::onAddPackFinders);
        modBus.addListener(this::clientSetup);
    }

    public static SlotPool pool() {
        return pool;
    }

    private void clientSetup(FMLClientSetupEvent event) {
        // Started after registration, so the pool is fully populated before the launcher
        // can bind anything to it.
        event.enqueueWork(() -> {
            core = EllaCore.fromSystemProperties(new ForgeHost(pool), pool);
            if (core != null) core.start();
        });
    }

    private static int slotCount(String property) {
        String configured = System.getProperty(property);
        if (configured == null) return DEFAULT_SLOTS;

        try {
            // Bounds match the launcher's own clamp so the two cannot disagree.
            return Math.max(16, Math.min(1024, Integer.parseInt(configured)));
        } catch (NumberFormatException malformed) {
            EllaLog.warn("Ignoring malformed " + property + ": " + configured);
            return DEFAULT_SLOTS;
        }
    }
}
