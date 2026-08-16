package dev.ella.core;

/**
 * Capability identifiers an adapter may declare.
 *
 * <p>Capability negotiation is how one editor serves 1.8.9 through 26.2 honestly: the
 * adapter states what it can actually do, and the launcher disables the rest with an
 * explanation rather than accepting a setting and quietly dropping it.
 *
 * <p>Must stay in step with {@code CAPABILITIES} in launcher/src/shared/protocol.ts.
 */
public final class Capabilities {

    public static final String RENDER_LAYER_CUTOUT = "render_layer.cutout";
    public static final String RENDER_LAYER_CUTOUT_MIPPED = "render_layer.cutout_mipped";
    public static final String RENDER_LAYER_TRANSLUCENT = "render_layer.translucent";
    /** Render layer can change without restarting the game. */
    public static final String RENDER_LAYER_RUNTIME = "render_layer.runtime";

    public static final String LIGHT_DYNAMIC = "light.dynamic";

    public static final String HITBOX_CUSTOM = "hitbox.custom";
    public static final String HITBOX_RUNTIME = "hitbox.runtime";

    /** The adapter can trigger a resource reload itself, with no manual F3+T. */
    public static final String RELOAD_PROGRAMMATIC = "reload.programmatic";

    public static final String MODEL_OBJ = "model.obj";

    public static final String ITEM_RARITY = "item.rarity";
    public static final String ITEM_COMPONENTS = "item.components";

    public static final String ENTRY_PLACE = "entry.place";

    /** The adapter registers a facing property, so blocks can be oriented on placement. */
    public static final String BLOCK_ROTATION = "block.rotation";

    private Capabilities() {
    }
}
