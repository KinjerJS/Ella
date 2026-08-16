package dev.ella.core;

import java.util.HashMap;
import java.util.Map;

/**
 * The fixed pool of placeholder blocks and items.
 *
 * <p>Minecraft freezes its registries after startup on every version Ella targets, so
 * blocks genuinely cannot be created at runtime. The adapter therefore registers N empty
 * placeholders during normal mod init, and this class hands out their settings objects.
 * "Creating a block" at runtime is really binding a project entry to one of these.
 *
 * <p>The settings arrays are allocated once and never replaced, so a block that captured
 * its {@link SlotSettings} reference at registration keeps seeing live updates.
 */
public final class SlotPool {

    public static final String BLOCK = "block";
    public static final String ITEM = "item";

    private final Map<String, SlotSettings[]> pools = new HashMap<String, SlotSettings[]>();

    public SlotPool(int blockCount, int itemCount) {
        pools.put(BLOCK, allocate(blockCount));
        pools.put(ITEM, allocate(itemCount));
    }

    private static SlotSettings[] allocate(int count) {
        SlotSettings[] settings = new SlotSettings[Math.max(0, count)];
        for (int i = 0; i < settings.length; i++) {
            settings[i] = new SlotSettings();
        }
        return settings;
    }

    public int size(String kind) {
        SlotSettings[] pool = pools.get(kind);
        return pool == null ? 0 : pool.length;
    }

    public boolean isKnownKind(String kind) {
        return pools.containsKey(kind);
    }

    public boolean isValidSlot(String kind, int slot) {
        return slot >= 0 && slot < size(kind);
    }

    /**
     * The settings for a slot.
     *
     * @throws IllegalArgumentException if the kind is unknown or the slot out of range
     */
    public SlotSettings get(String kind, int slot) {
        SlotSettings[] pool = pools.get(kind);
        if (pool == null) {
            throw new IllegalArgumentException("Unknown slot kind: " + kind);
        }
        if (slot < 0 || slot >= pool.length) {
            throw new IllegalArgumentException(
                "Slot " + slot + " is out of range for " + kind + " pool of " + pool.length);
        }
        return pool[slot];
    }

    /** Registry path for a slot, matching what the launcher generates. */
    public static String registryPath(String kind, int slot) {
        return kind + "_" + pad(slot);
    }

    /** Model path the slot's blockstate redirects to. */
    public static String redirectModelPath(int slot) {
        return "slot_" + pad(slot);
    }

    private static String pad(int slot) {
        if (slot < 10) return "00" + slot;
        if (slot < 100) return "0" + slot;
        return String.valueOf(slot);
    }

    /** Translation key for a slot, matching the launcher's generated lang files. */
    public static String translationKey(String kind, int slot) {
        return kind + ".ella." + registryPath(kind, slot);
    }

    public int boundCount(String kind) {
        SlotSettings[] pool = pools.get(kind);
        if (pool == null) return 0;

        int bound = 0;
        for (SlotSettings settings : pool) {
            if (settings.isBound()) bound++;
        }
        return bound;
    }

    public void clearAll() {
        for (SlotSettings[] pool : pools.values()) {
            for (SlotSettings settings : pool) {
                settings.resetToDefaults();
            }
        }
    }
}
