package dev.ella.forge112;

import dev.ella.core.EllaLog;
import net.minecraft.client.Minecraft;
import net.minecraft.client.resources.FolderResourcePack;
import net.minecraft.client.resources.IResourcePack;

import java.io.File;
import java.lang.reflect.Field;
import java.util.List;

/**
 * Makes the launcher's workspace directory part of the client's resource stack.
 *
 * <p>{@code Minecraft.defaultResourcePacks} is private with no accessor in 1.12.2, so this
 * goes through reflection. An access transformer would be tidier, but ATs are configured
 * per-loader and would have to be rewritten for each adapter; reflection keeps the trick
 * contained in one file per version.
 *
 * <p>Two field names are tried because a Forge mod runs against MCP names in a development
 * workspace and SRG names in production, and the same jar has to work in both.
 */
final class EllaResources {

    /** MCP name (development) and SRG name (production) for defaultResourcePacks. */
    private static final String[] FIELD_NAMES = { "defaultResourcePacks", "field_110449_ao" };

    private static File injected;

    private EllaResources() {
    }

    /**
     * Adds {@code packRoot} to the resource stack if it is not already there.
     *
     * @return true when the pack is in place
     */
    static synchronized boolean inject(File packRoot) {
        if (packRoot == null || !packRoot.isDirectory()) {
            EllaLog.warn("Workspace pack directory does not exist: " + packRoot);
            return false;
        }

        // Re-injecting the same directory on every reconnect would stack duplicate packs.
        if (packRoot.equals(injected)) return true;

        List<IResourcePack> packs = resourcePackList();
        if (packs == null) return false;

        try {
            packs.add(new FolderResourcePack(packRoot) {
                @Override
                public String getPackName() {
                    return "Ella workspace";
                }
            });
            injected = packRoot;
            EllaLog.info("Injected workspace resource pack: " + packRoot.getAbsolutePath());
            return true;
        } catch (RuntimeException failed) {
            EllaLog.error("Could not add the workspace resource pack", failed);
            return false;
        }
    }

    @SuppressWarnings("unchecked")
    private static List<IResourcePack> resourcePackList() {
        Minecraft client = Minecraft.getMinecraft();

        for (String name : FIELD_NAMES) {
            try {
                Field field = Minecraft.class.getDeclaredField(name);
                field.setAccessible(true);
                Object value = field.get(client);
                if (value instanceof List) {
                    return (List<IResourcePack>) value;
                }
            } catch (NoSuchFieldException wrongName) {
                // Expected for whichever of the two names does not apply here.
            } catch (IllegalAccessException blocked) {
                EllaLog.error("Access to Minecraft." + name + " was denied", blocked);
                return null;
            }
        }

        EllaLog.error(
            "Could not find Minecraft's resource pack list under any known field name; "
                + "live model loading is unavailable on this build.", null);
        return null;
    }

    /** Whether a workspace pack is currently injected. */
    static boolean isInjected() {
        return injected != null;
    }
}
