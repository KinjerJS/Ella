package dev.ella.core;

import java.io.File;
import java.util.List;
import java.util.Set;

/**
 * The service each version adapter implements.
 *
 * <p>Everything here touches Minecraft classes, which is precisely why it is an interface:
 * ella-core holds all the logic that does not, so the per-version work stays small.
 *
 * <p>Unless stated otherwise, methods are called from the IPC thread. Implementations must
 * hand anything that touches the game over to the main thread themselves — every version
 * has its own scheduler for that, which is one of the things an adapter exists to know.
 */
public interface EllaHost {

    // --- identity -----------------------------------------------------------

    String minecraftVersion();

    /** {@code forge}, {@code neoforge} or {@code fabric}. */
    String loaderName();

    String loaderVersion();

    /** Adapter id, e.g. {@code forge-1.12.2}. */
    String adapterId();

    String adapterVersion();

    /**
     * The {@code pack_format} this version expects. Reported by the adapter because the
     * value changes almost every release, so a launcher-side table would be wrong for
     * anything newer than the launcher build.
     */
    int packFormat();

    Set<String> capabilities();

    /** Pool size for {@code block} or {@code item}. */
    int slotCount(String kind);

    // --- slots --------------------------------------------------------------

    /**
     * Called after core has updated the slot's settings, so the adapter can apply
     * anything that needs a game-side action — registering a render layer, refreshing a
     * block state, updating a translation.
     */
    void onSlotAssigned(String kind, int slot, SlotSettings settings);

    void onSlotCleared(String kind, int slot);

    /**
     * Called after a partial settings update.
     *
     * @param requested keys the launcher asked to change
     * @param applied   keys core managed to apply to {@link SlotSettings}
     * @return the subset of {@code applied} this version can actually honour; anything
     *         left out is reported back to the user as ignored
     */
    List<String> onSettingsPatched(String kind, int slot, List<String> requested, List<String> applied);

    // --- resources ----------------------------------------------------------

    /**
     * Makes the given directory part of the client's resource stack. Called once, when
     * the launcher sends its welcome message.
     */
    void injectResourcePack(File packRoot);

    /** Triggers a client resource reload, the programmatic equivalent of F3+T. */
    void reloadResources();

    // --- player actions -----------------------------------------------------

    /** @throws IllegalStateException when no player is loaded */
    void giveToPlayer(String kind, int slot, int count);

    /** @throws IllegalStateException when no player is loaded */
    void placeInFrontOfPlayer(String kind, int slot);
}
