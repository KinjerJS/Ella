package dev.ella.core;

import org.junit.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

public class SlotSettingsTest {

    private static Map<String, Object> map(Object... pairs) {
        Map<String, Object> values = new LinkedHashMap<String, Object>();
        for (int i = 0; i < pairs.length; i += 2) {
            values.put((String) pairs[i], pairs[i + 1]);
        }
        return values;
    }

    @Test
    public void appliesKnownSettingsAndReportsThem() {
        SlotSettings settings = new SlotSettings();
        List<String> applied = settings.apply(map(
            "renderLayer", "cutout",
            "opaque", Boolean.FALSE,
            "lightLevel", 15,
            "hardness", 0.3));

        assertEquals("cutout", settings.renderLayer);
        assertFalse(settings.opaque);
        assertEquals(15, settings.lightLevel);
        assertEquals(0.3f, settings.hardness, 0.0001f);
        assertEquals(4, applied.size());
    }

    @Test
    public void reportsUnknownSettingsAsNotApplied() {
        SlotSettings settings = new SlotSettings();
        List<String> applied = settings.apply(map("somethingNewer", "value"));
        assertTrue(applied.isEmpty());
    }

    @Test
    public void clampsLightLevelIntoRange() {
        SlotSettings settings = new SlotSettings();
        settings.apply(map("lightLevel", 99));
        assertEquals(15, settings.lightLevel);

        settings.apply(map("lightLevel", -4));
        assertEquals(0, settings.lightLevel);
    }

    @Test
    public void clampsStackSizeIntoRange() {
        SlotSettings settings = new SlotSettings();
        settings.apply(map("stackSize", 500));
        assertEquals(99, settings.stackSize);
    }

    @Test
    public void acceptsNumbersArrivingAsStrings() {
        // Gson hands back a LazilyParsedNumber; a launcher could also send a string.
        SlotSettings settings = new SlotSettings();
        settings.apply(map("lightLevel", "7", "hardness", "2.5"));
        assertEquals(7, settings.lightLevel);
        assertEquals(2.5f, settings.hardness, 0.0001f);
    }

    @Test
    public void ignoresMalformedValuesWithoutThrowing() {
        SlotSettings settings = new SlotSettings();
        settings.lightLevel = 5;

        List<String> applied = settings.apply(map("lightLevel", "not a number"));

        assertTrue("malformed value must not count as applied", applied.isEmpty());
        assertEquals("previous value must survive", 5, settings.lightLevel);
    }

    @Test
    public void appliesAValidHitbox() {
        SlotSettings settings = new SlotSettings();
        List<Object> box = new ArrayList<Object>();
        for (Object value : new Object[] { 2, 0, 2, 14, 10, 14 }) {
            box.add(value);
        }

        assertEquals(1, settings.apply(map("hitbox", box)).size());
        float[] hitbox = settings.hitbox();
        assertEquals(2f, hitbox[0], 0.0001f);
        assertEquals(10f, hitbox[4], 0.0001f);
    }

    @Test
    public void rejectsAnInvertedHitbox() {
        // A degenerate bounding box makes the block unclickable; refusing is safer.
        SlotSettings settings = new SlotSettings();
        List<Object> box = new ArrayList<Object>();
        for (Object value : new Object[] { 14, 0, 0, 2, 16, 16 }) {
            box.add(value);
        }

        assertTrue(settings.apply(map("hitbox", box)).isEmpty());
        assertEquals(16f, settings.hitbox()[3], 0.0001f);
    }

    @Test
    public void rejectsAHitboxOfTheWrongLength() {
        SlotSettings settings = new SlotSettings();
        List<Object> box = new ArrayList<Object>();
        box.add(0);
        box.add(0);
        assertTrue(settings.apply(map("hitbox", box)).isEmpty());
    }

    @Test
    public void normalisedHitboxDividesBySixteen() {
        SlotSettings settings = new SlotSettings();
        List<Object> box = new ArrayList<Object>();
        for (Object value : new Object[] { 0, 0, 0, 8, 16, 8 }) {
            box.add(value);
        }
        settings.apply(map("hitbox", box));

        float[] normalised = settings.hitboxNormalised();
        assertEquals(0.5f, normalised[3], 0.0001f);
        assertEquals(1.0f, normalised[4], 0.0001f);
    }

    @Test
    public void hitboxAccessorReturnsACopy() {
        SlotSettings settings = new SlotSettings();
        float[] first = settings.hitbox();
        first[0] = 99f;
        assertEquals("callers must not be able to mutate live state",
            0f, settings.hitbox()[0], 0.0001f);
    }

    @Test
    public void resetClearsBinding() {
        SlotSettings settings = new SlotSettings();
        settings.entryId = "ruby_lamp";
        settings.lightLevel = 15;
        assertTrue(settings.isBound());

        settings.resetToDefaults();

        assertFalse(settings.isBound());
        assertEquals(0, settings.lightLevel);
        assertEquals("solid", settings.renderLayer);
    }

    @Test
    public void nullValuesAreIgnored() {
        SlotSettings settings = new SlotSettings();
        Map<String, Object> values = new LinkedHashMap<String, Object>();
        values.put("renderLayer", null);
        assertTrue(settings.apply(values).isEmpty());
        assertEquals("solid", settings.renderLayer);
    }

    @Test
    public void defaultsAreSane() {
        SlotSettings settings = new SlotSettings();
        assertEquals("solid", settings.renderLayer);
        assertTrue(settings.opaque);
        assertTrue(settings.fullCube);
        assertEquals(64, settings.stackSize);
        assertNotNull(settings.hitbox());
    }
}
