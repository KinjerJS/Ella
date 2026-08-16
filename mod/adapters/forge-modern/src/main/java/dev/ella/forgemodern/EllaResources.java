package dev.ella.forgemodern;

import dev.ella.core.EllaLog;
import net.minecraft.network.chat.Component;
import net.minecraft.server.packs.PackLocationInfo;
import net.minecraft.server.packs.PackSelectionConfig;
import net.minecraft.server.packs.PackType;
import net.minecraft.server.packs.PathPackResources;
import net.minecraft.server.packs.repository.Pack;
import net.minecraft.server.packs.repository.PackSource;
import net.minecraftforge.event.AddPackFindersEvent;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Optional;

/**
 * Adds the launcher's workspace directory to the client resource stack.
 *
 * <p>Unlike the 1.12.2 adapter, this needs no reflection: modern Forge has a dedicated
 * {@link AddPackFindersEvent}. It does have to run at startup though, before the first
 * resource load — which is why the workspace path is read from the {@code ella.workspace}
 * system property the launcher passes on the command line, rather than waiting for the
 * protocol handshake.
 */
final class EllaResources {

    private static final String PACK_ID = "ella_workspace";

    private EllaResources() {
    }

    /** The workspace pack directory, or null when Ella was not launched by the tool. */
    static Path workspacePack() {
        String workspace = System.getProperty("ella.workspace");
        if (workspace == null || workspace.isEmpty()) return null;

        Path pack = Paths.get(workspace).resolve("pack");
        return Files.isDirectory(pack) ? pack : null;
    }

    static void onAddPackFinders(AddPackFindersEvent event) {
        if (event.getPackType() != PackType.CLIENT_RESOURCES) return;

        Path pack = workspacePack();
        if (pack == null) {
            EllaLog.info("No Ella workspace pack to inject.");
            return;
        }

        event.addRepositorySource(consumer -> {
            PackLocationInfo location = new PackLocationInfo(
                PACK_ID,
                Component.literal("Ella workspace"),
                PackSource.BUILT_IN,
                Optional.empty());

            // Forced on and at the top of the stack: this pack exists to override whatever
            // else is loaded, and a user toggling it off would silently break the tool.
            PackSelectionConfig selection =
                new PackSelectionConfig(true, Pack.Position.TOP, true);

            Pack created = Pack.readMetaAndCreate(
                location,
                new PathPackResources.PathResourcesSupplier(pack),
                PackType.CLIENT_RESOURCES,
                selection);

            if (created != null) {
                consumer.accept(created);
                EllaLog.info("Injected workspace resource pack: " + pack);
            } else {
                EllaLog.warn("Workspace pack could not be read: " + pack);
            }
        });
    }
}
