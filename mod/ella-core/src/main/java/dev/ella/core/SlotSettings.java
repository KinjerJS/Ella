package dev.ella.core;

import java.util.Map;

/**
 * Mutable settings for one slot.
 *
 * <p>This is the mechanism that makes live editing possible. A normal Minecraft block
 * bakes its properties in at construction, so changing one means re-registering — which
 * the frozen registries forbid. Ella's placeholder blocks instead read every property
 * from this object at call time, so writing to it changes the block's behaviour
 * immediately.
 *
 * <p>Fields are {@code volatile} because they are written from the IPC thread and read
 * from the render and server threads without any lock. Each field is independent, so a
 * torn read across two fields is harmless: the worst case is one frame drawn with a
 * half-applied change.
 */
public final class SlotSettings {

    // --- appearance ---------------------------------------------------------

    /** One of {@code solid}, {@code cutout}, {@code cutout_mipped}, {@code translucent}. */
    public volatile String renderLayer = "solid";

    /** Whether neighbouring faces are culled. Must be false for anything transparent. */
    public volatile boolean opaque = true;

    public volatile boolean emissive = false;

    /** -1 means no tint. */
    public volatile int tintIndex = -1;

    /** 0..15 */
    public volatile int lightLevel = 0;

    // --- physical -----------------------------------------------------------

    /** -1 means unbreakable. */
    public volatile float hardness = 1.5f;

    public volatile float resistance = 6.0f;

    /** Generic name; each adapter maps it onto its own version's sound type. */
    public volatile String soundType = "stone";

    public volatile boolean fullCube = true;

    // --- interaction --------------------------------------------------------

    /** One of {@code full}, {@code none}, {@code custom}. */
    public volatile String collision = "full";

    /**
     * How the block orients itself when placed: {@code none}, {@code horizontal} (four
     * compass directions) or {@code all} (six, including up and down).
     *
     * <p>Unlike every other setting here, this one cannot be made fully dynamic. A block's
     * state properties are baked into its {@code BlockStateContainer} at construction, so
     * the {@code facing} property has to exist on every slot from registration. What this
     * value changes is whether placement <em>uses</em> it — which is enough to make the
     * option feel live, because an already-placed block keeps the facing it was given.
     */
    public volatile String rotation = "none";

    /** {@code [x1, y1, z1, x2, y2, z2]} in 0..16 model space. */
    private volatile float[] hitbox = { 0, 0, 0, 16, 16, 16 };

    // --- item ---------------------------------------------------------------

    public volatile int stackSize = 64;

    public volatile String rarity = "common";

    public volatile boolean handheld = false;

    public volatile boolean glint = false;

    // --- display ------------------------------------------------------------

    public volatile String displayName = "";

    /** The project entry currently bound here, or null when the slot is free. */
    public volatile String entryId = null;

    public float[] hitbox() {
        // Defensive copy: callers must not be able to mutate the live array.
        float[] current = hitbox;
        return new float[] { current[0], current[1], current[2], current[3], current[4], current[5] };
    }

    /** Hitbox in block space (0..1), which is what most Minecraft APIs expect. */
    public float[] hitboxNormalised() {
        float[] current = hitbox;
        return new float[] {
            current[0] / 16f, current[1] / 16f, current[2] / 16f,
            current[3] / 16f, current[4] / 16f, current[5] / 16f,
        };
    }

    public void resetToDefaults() {
        renderLayer = "solid";
        opaque = true;
        emissive = false;
        tintIndex = -1;
        lightLevel = 0;
        hardness = 1.5f;
        resistance = 6.0f;
        soundType = "stone";
        fullCube = true;
        collision = "full";
        rotation = "none";
        hitbox = new float[] { 0, 0, 0, 16, 16, 16 };
        stackSize = 64;
        rarity = "common";
        handheld = false;
        glint = false;
        displayName = "";
        entryId = null;
    }

    /**
     * Applies the keys present in {@code values}, ignoring anything unrecognised.
     *
     * @return the keys that were actually applied, so the launcher can tell the user
     *         which settings this version silently could not honour
     */
    public java.util.List<String> apply(Map<String, Object> values) {
        java.util.List<String> applied = new java.util.ArrayList<String>();

        for (Map.Entry<String, Object> entry : values.entrySet()) {
            if (applyOne(entry.getKey(), entry.getValue())) {
                applied.add(entry.getKey());
            }
        }
        return applied;
    }

    private boolean applyOne(String key, Object value) {
        if (value == null) return false;

        try {
            if ("renderLayer".equals(key)) { renderLayer = asString(value); return true; }
            if ("opaque".equals(key)) { opaque = asBoolean(value); return true; }
            if ("emissive".equals(key)) { emissive = asBoolean(value); return true; }
            if ("tintIndex".equals(key)) { tintIndex = asInt(value); return true; }
            if ("lightLevel".equals(key)) { lightLevel = clamp(asInt(value), 0, 15); return true; }
            if ("hardness".equals(key)) { hardness = asFloat(value); return true; }
            if ("resistance".equals(key)) { resistance = Math.max(0f, asFloat(value)); return true; }
            if ("soundType".equals(key)) { soundType = asString(value); return true; }
            if ("fullCube".equals(key)) { fullCube = asBoolean(value); return true; }
            if ("collision".equals(key)) { collision = asString(value); return true; }
            if ("rotation".equals(key)) { rotation = asString(value); return true; }
            if ("stackSize".equals(key)) { stackSize = clamp(asInt(value), 1, 99); return true; }
            if ("rarity".equals(key)) { rarity = asString(value); return true; }
            if ("handheld".equals(key)) { handheld = asBoolean(value); return true; }
            if ("glint".equals(key)) { glint = asBoolean(value); return true; }
            if ("hitbox".equals(key)) { return applyHitbox(value); }
        } catch (RuntimeException malformed) {
            // A bad value must never take the game down; report it as not applied.
            EllaLog.warn("Ignoring malformed value for setting '" + key + "': " + value);
            return false;
        }

        return false;
    }

    private boolean applyHitbox(Object value) {
        if (!(value instanceof java.util.List)) return false;
        java.util.List<?> list = (java.util.List<?>) value;
        if (list.size() != 6) return false;

        float[] parsed = new float[6];
        for (int i = 0; i < 6; i++) {
            parsed[i] = clamp(asFloat(list.get(i)), 0f, 16f);
        }
        // Reject an inverted box rather than handing the game a degenerate bounding box.
        if (parsed[3] <= parsed[0] || parsed[4] <= parsed[1] || parsed[5] <= parsed[2]) {
            return false;
        }

        hitbox = parsed;
        return true;
    }

    private static String asString(Object value) {
        return String.valueOf(value);
    }

    private static boolean asBoolean(Object value) {
        if (value instanceof Boolean) return (Boolean) value;
        return Boolean.parseBoolean(String.valueOf(value));
    }

    private static int asInt(Object value) {
        if (value instanceof Number) return ((Number) value).intValue();
        return (int) Double.parseDouble(String.valueOf(value));
    }

    private static float asFloat(Object value) {
        if (value instanceof Number) return ((Number) value).floatValue();
        return Float.parseFloat(String.valueOf(value));
    }

    private static int clamp(int value, int min, int max) {
        return value < min ? min : (value > max ? max : value);
    }

    private static float clamp(float value, float min, float max) {
        return value < min ? min : (value > max ? max : value);
    }

    public boolean isBound() {
        return entryId != null;
    }
}
