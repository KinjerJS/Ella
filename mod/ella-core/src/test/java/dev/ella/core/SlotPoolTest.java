package dev.ella.core;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotSame;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

public class SlotPoolTest {

    @Test
    public void allocatesIndependentPoolsPerKind() {
        SlotPool pool = new SlotPool(8, 4);
        assertEquals(8, pool.size(SlotPool.BLOCK));
        assertEquals(4, pool.size(SlotPool.ITEM));
        assertNotSame(pool.get(SlotPool.BLOCK, 0), pool.get(SlotPool.ITEM, 0));
    }

    @Test
    public void returnsTheSameSettingsObjectEveryTime() {
        // A block captures this reference at registration; replacing it would silently
        // stop live edits from reaching the game.
        SlotPool pool = new SlotPool(4, 4);
        assertSame(pool.get(SlotPool.BLOCK, 2), pool.get(SlotPool.BLOCK, 2));
    }

    @Test
    public void rejectsAnOutOfRangeSlot() {
        SlotPool pool = new SlotPool(2, 2);
        assertFalse(pool.isValidSlot(SlotPool.BLOCK, 2));
        assertFalse(pool.isValidSlot(SlotPool.BLOCK, -1));
        try {
            pool.get(SlotPool.BLOCK, 5);
            fail("expected IllegalArgumentException");
        } catch (IllegalArgumentException expected) {
            assertTrue(expected.getMessage().contains("out of range"));
        }
    }

    @Test
    public void rejectsAnUnknownKind() {
        SlotPool pool = new SlotPool(2, 2);
        assertFalse(pool.isKnownKind("entity"));
        try {
            pool.get("entity", 0);
            fail("expected IllegalArgumentException");
        } catch (IllegalArgumentException expected) {
            assertTrue(expected.getMessage().contains("Unknown slot kind"));
        }
    }

    @Test
    public void registryPathsAreZeroPaddedToThreeDigits() {
        // Must match the launcher's generated file names exactly, or nothing resolves.
        assertEquals("block_000", SlotPool.registryPath(SlotPool.BLOCK, 0));
        assertEquals("block_007", SlotPool.registryPath(SlotPool.BLOCK, 7));
        assertEquals("item_042", SlotPool.registryPath(SlotPool.ITEM, 42));
        assertEquals("block_128", SlotPool.registryPath(SlotPool.BLOCK, 128));
    }

    @Test
    public void redirectModelPathMatchesTheLauncher() {
        assertEquals("slot_000", SlotPool.redirectModelPath(0));
        assertEquals("slot_099", SlotPool.redirectModelPath(99));
    }

    @Test
    public void translationKeyMatchesTheGeneratedLangFiles() {
        assertEquals("block.ella.block_000", SlotPool.translationKey(SlotPool.BLOCK, 0));
        assertEquals("item.ella.item_003", SlotPool.translationKey(SlotPool.ITEM, 3));
    }

    @Test
    public void countsBoundSlots() {
        SlotPool pool = new SlotPool(4, 4);
        assertEquals(0, pool.boundCount(SlotPool.BLOCK));

        pool.get(SlotPool.BLOCK, 0).entryId = "lamp";
        pool.get(SlotPool.BLOCK, 3).entryId = "gem";
        assertEquals(2, pool.boundCount(SlotPool.BLOCK));

        pool.clearAll();
        assertEquals(0, pool.boundCount(SlotPool.BLOCK));
    }

    @Test
    public void handlesAZeroSizedPoolWithoutThrowing() {
        SlotPool pool = new SlotPool(0, 0);
        assertEquals(0, pool.size(SlotPool.BLOCK));
        assertFalse(pool.isValidSlot(SlotPool.BLOCK, 0));
    }
}
