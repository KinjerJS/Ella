package dev.ella.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.List;

/**
 * The Ella client: connects to the launcher, keeps the connection alive, and dispatches
 * protocol messages onto an {@link EllaHost}.
 *
 * <p>See docs/protocol.md. The launcher is the server because it outlives the game; this
 * side reconnects on its own so a game started or restarted at any point rejoins the
 * session without user action.
 */
public final class EllaCore {

    public static final int PROTOCOL_VERSION = 1;

    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final long BACKOFF_START_MS = 1000L;
    private static final long BACKOFF_MAX_MS = 30_000L;

    private final EllaHost host;
    private final SlotPool pool;
    private final int port;
    private final String token;
    private final File workspace;

    private volatile boolean running;
    private volatile Socket socket;
    private volatile Writer writer;
    private Thread thread;

    /** Language the game is currently displaying, used to pick a display name. */
    private volatile String preferredLocale = "en";

    public EllaCore(EllaHost host, SlotPool pool, int port, String token, File workspace) {
        this.host = host;
        this.pool = pool;
        this.port = port;
        this.token = token;
        this.workspace = workspace;
    }

    /**
     * Reads the settings the launcher passed on the command line.
     *
     * @return a configured instance, or null when Ella was not asked to run — which is
     *         the normal case for a game the user started themselves
     */
    public static EllaCore fromSystemProperties(EllaHost host, SlotPool pool) {
        String port = System.getProperty("ella.port");
        String token = System.getProperty("ella.token");
        String workspace = System.getProperty("ella.workspace");

        if (port == null || token == null) {
            EllaLog.info("No ella.port/ella.token supplied; live editing is off.");
            return null;
        }

        try {
            return new EllaCore(host, pool, Integer.parseInt(port), token,
                workspace == null ? null : new File(workspace));
        } catch (NumberFormatException badPort) {
            EllaLog.warn("Ignoring malformed ella.port: " + port);
            return null;
        }
    }

    public void start() {
        if (running) return;
        running = true;

        thread = new Thread(new Runnable() {
            @Override
            public void run() {
                connectionLoop();
            }
        }, "Ella-IPC");
        // Daemon: a launcher that never comes back must not stop the game from exiting.
        thread.setDaemon(true);
        thread.start();
    }

    public void stop() {
        running = false;
        closeQuietly();
        if (thread != null) thread.interrupt();
    }

    public boolean isConnected() {
        Socket current = socket;
        return current != null && current.isConnected() && !current.isClosed();
    }

    public void setPreferredLocale(String locale) {
        if (locale != null) preferredLocale = locale;
    }

    // -----------------------------------------------------------------------
    // Connection
    // -----------------------------------------------------------------------

    private void connectionLoop() {
        long backoff = BACKOFF_START_MS;

        while (running) {
            try {
                Socket connection = new Socket();
                connection.connect(new InetSocketAddress("127.0.0.1", port), 5000);
                connection.setTcpNoDelay(true);

                socket = connection;
                OutputStream output = connection.getOutputStream();
                writer = new OutputStreamWriter(output, UTF8);

                EllaLog.info("Connected to the Ella launcher on port " + port);
                backoff = BACKOFF_START_MS;

                sendHello();
                readLoop(connection);
            } catch (IOException disconnected) {
                if (running) {
                    EllaLog.debug("Ella launcher unreachable (" + disconnected.getMessage()
                        + "); retrying in " + backoff + "ms");
                }
            } finally {
                closeQuietly();
            }

            if (!running) break;

            try {
                Thread.sleep(backoff);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                break;
            }
            backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
        }
    }

    private void readLoop(Socket connection) throws IOException {
        BufferedReader reader =
            new BufferedReader(new InputStreamReader(connection.getInputStream(), UTF8));

        String line;
        while (running && (line = reader.readLine()) != null) {
            if (line.trim().isEmpty()) continue;
            try {
                // Deliberately the deprecated instance method: the static
                // JsonParser.parseString only exists from Gson 2.8.6, and 1.8.9 ships an
                // older copy. This form works on every version Ella targets.
                @SuppressWarnings("deprecation")
                JsonObject parsed = new JsonParser().parse(line).getAsJsonObject();
                handle(parsed);
            } catch (RuntimeException malformed) {
                // One bad message must not tear down a working session.
                EllaLog.warn("Ignoring malformed message from launcher: " + malformed);
            }
        }
    }

    private void closeQuietly() {
        Socket current = socket;
        socket = null;
        writer = null;
        if (current != null) {
            try {
                current.close();
            } catch (IOException ignored) {
                // Already gone; nothing useful to do.
            }
        }
    }

    // -----------------------------------------------------------------------
    // Sending
    // -----------------------------------------------------------------------

    private synchronized void send(JsonObject message) {
        Writer target = writer;
        if (target == null) return;

        try {
            target.write(message.toString());
            target.write("\n");
            target.flush();
        } catch (IOException broken) {
            // Closing here makes the read loop fall through to a reconnect.
            closeQuietly();
        }
    }

    private void sendHello() {
        JsonObject payload = new JsonObject();
        payload.addProperty("token", token);
        payload.addProperty("minecraftVersion", host.minecraftVersion());
        payload.addProperty("loader", host.loaderName());
        payload.addProperty("loaderVersion", host.loaderVersion());
        payload.addProperty("adapter", host.adapterId());
        payload.addProperty("adapterVersion", host.adapterVersion());
        payload.addProperty("javaVersion", System.getProperty("java.version", "unknown"));
        payload.addProperty("packFormat", host.packFormat());

        JsonObject slots = new JsonObject();
        slots.addProperty(SlotPool.BLOCK, pool.size(SlotPool.BLOCK));
        slots.addProperty(SlotPool.ITEM, pool.size(SlotPool.ITEM));
        payload.add("slots", slots);

        payload.add("capabilities", Json.ofStrings(host.capabilities()));

        JsonObject message = new JsonObject();
        message.addProperty("v", PROTOCOL_VERSION);
        message.addProperty("id", "hello");
        message.addProperty("type", "hello");
        message.add("payload", payload);
        send(message);
    }

    private void respond(String id, JsonObject payload) {
        if (id == null) return;
        JsonObject message = new JsonObject();
        message.addProperty("v", PROTOCOL_VERSION);
        message.addProperty("id", id);
        message.addProperty("type", "result");
        message.addProperty("ok", true);
        if (payload != null) message.add("payload", payload);
        send(message);
    }

    private void respondError(String id, String code, String description) {
        if (id == null) return;
        JsonObject error = new JsonObject();
        error.addProperty("code", code);
        error.addProperty("message", description);

        JsonObject message = new JsonObject();
        message.addProperty("v", PROTOCOL_VERSION);
        message.addProperty("id", id);
        message.addProperty("type", "result");
        message.addProperty("ok", false);
        message.add("error", error);
        send(message);
    }

    /** Forwards a game-side event so the editor can show it without opening latest.log. */
    public void sendLog(String level, String source, String description, String entryId) {
        JsonObject payload = new JsonObject();
        payload.addProperty("level", level);
        payload.addProperty("source", source);
        payload.addProperty("message", description);
        if (entryId != null) payload.addProperty("entryId", entryId);

        JsonObject message = new JsonObject();
        message.addProperty("v", PROTOCOL_VERSION);
        message.addProperty("type", "log");
        message.add("payload", payload);
        send(message);
    }

    // -----------------------------------------------------------------------
    // Dispatch
    // -----------------------------------------------------------------------

    private void handle(JsonObject message) {
        String type = Json.string(message, "type", "");
        String id = message.has("id") ? message.get("id").getAsString() : null;
        JsonObject payload = Json.object(message, "payload");

        if ("result".equals(type)) {
            // Only the handshake reply, which needs no action beyond not failing.
            return;
        }

        if ("ping".equals(type)) {
            respond(id, null);
            return;
        }

        if ("welcome".equals(type)) {
            handleWelcome(payload);
            return;
        }

        if ("slot.assign".equals(type)) {
            handleAssign(id, payload);
            return;
        }

        if ("slot.clear".equals(type)) {
            handleClear(id, payload);
            return;
        }

        if ("settings.patch".equals(type)) {
            handlePatch(id, payload);
            return;
        }

        if ("resources.reload".equals(type)) {
            handleReload(id);
            return;
        }

        if ("entry.give".equals(type)) {
            handleGive(id, payload);
            return;
        }

        if ("entry.place".equals(type)) {
            handlePlace(id, payload);
            return;
        }

        EllaLog.debug("Ignoring unknown message type: " + type);
    }

    private void handleWelcome(JsonObject payload) {
        String packRoot = Json.string(payload, "packRoot", null);
        if (packRoot == null && workspace != null) {
            packRoot = new File(workspace, "pack").getAbsolutePath();
        }
        if (packRoot == null) {
            EllaLog.warn("Welcome carried no packRoot; live models will not load.");
            return;
        }

        try {
            host.injectResourcePack(new File(packRoot));
            EllaLog.info("Live workspace pack: " + packRoot);
        } catch (RuntimeException failed) {
            EllaLog.error("Could not inject the workspace resource pack", failed);
        }
    }

    private void handleAssign(String id, JsonObject payload) {
        String kind = Json.string(payload, "kind", "");
        int slot = Json.integer(payload, "slot", -1);

        String rejection = validate(kind, slot);
        if (rejection != null) {
            respondError(id, rejection, kind + " slot " + slot + " is not usable");
            return;
        }

        SlotSettings settings = pool.get(kind, slot);
        settings.entryId = Json.string(payload, "entryId", null);
        settings.displayName = Json.localised(Json.object(payload, "displayName"), preferredLocale);

        JsonObject values = Json.object(payload, "settings");
        if (values != null) settings.apply(Json.toMap(values));

        try {
            host.onSlotAssigned(kind, slot, settings);
            respond(id, null);
        } catch (RuntimeException failed) {
            EllaLog.error("Failed to assign " + kind + " slot " + slot, failed);
            respondError(id, "RELOAD_FAILED", String.valueOf(failed.getMessage()));
        }
    }

    private void handleClear(String id, JsonObject payload) {
        String kind = Json.string(payload, "kind", "");
        int slot = Json.integer(payload, "slot", -1);

        String rejection = validate(kind, slot);
        if (rejection != null) {
            respondError(id, rejection, kind + " slot " + slot + " is not usable");
            return;
        }

        pool.get(kind, slot).resetToDefaults();
        try {
            host.onSlotCleared(kind, slot);
            respond(id, null);
        } catch (RuntimeException failed) {
            respondError(id, "RELOAD_FAILED", String.valueOf(failed.getMessage()));
        }
    }

    private void handlePatch(String id, JsonObject payload) {
        String kind = Json.string(payload, "kind", "");
        int slot = Json.integer(payload, "slot", -1);

        String rejection = validate(kind, slot);
        if (rejection != null) {
            respondError(id, rejection, kind + " slot " + slot + " is not usable");
            return;
        }

        JsonObject values = Json.object(payload, "settings");
        // entrySet rather than keySet: JsonObject.keySet arrived in Gson 2.8.1, and 1.12.2
        // ships 2.8.0. Compiling the adapters against the oldest bundled Gson is what
        // catches this kind of thing before it becomes a crash on one version only.
        List<String> requested = new ArrayList<String>();
        if (values != null) {
            for (java.util.Map.Entry<String, com.google.gson.JsonElement> field : values.entrySet()) {
                requested.add(field.getKey());
            }
        }

        SlotSettings settings = pool.get(kind, slot);
        List<String> applied = values == null
            ? new ArrayList<String>()
            : settings.apply(Json.toMap(values));

        List<String> honoured;
        try {
            honoured = host.onSettingsPatched(kind, slot, requested, applied);
        } catch (RuntimeException failed) {
            EllaLog.error("Failed to apply settings to " + kind + " slot " + slot, failed);
            respondError(id, "RELOAD_FAILED", String.valueOf(failed.getMessage()));
            return;
        }

        // Anything asked for but not honoured is reported so the editor can flag it,
        // rather than letting the user believe a setting took effect when it did not.
        JsonArray appliedArray = Json.ofStrings(honoured);
        List<String> ignored = new ArrayList<String>();
        for (String key : requested) {
            if (!honoured.contains(key)) ignored.add(key);
        }

        JsonObject result = new JsonObject();
        result.add("applied", appliedArray);
        result.add("ignored", Json.ofStrings(ignored));
        respond(id, result);
    }

    private void handleReload(String id) {
        try {
            host.reloadResources();
            respond(id, null);
        } catch (RuntimeException failed) {
            EllaLog.error("Resource reload failed", failed);
            respondError(id, "RELOAD_FAILED", String.valueOf(failed.getMessage()));
        }
    }

    private void handleGive(String id, JsonObject payload) {
        String kind = Json.string(payload, "kind", "");
        int slot = Json.integer(payload, "slot", -1);
        int count = Json.integer(payload, "count", 1);

        String rejection = validate(kind, slot);
        if (rejection != null) {
            respondError(id, rejection, kind + " slot " + slot + " is not usable");
            return;
        }

        try {
            host.giveToPlayer(kind, slot, count);
            respond(id, null);
        } catch (IllegalStateException noPlayer) {
            respondError(id, "NOT_IN_WORLD", String.valueOf(noPlayer.getMessage()));
        } catch (RuntimeException failed) {
            respondError(id, "RELOAD_FAILED", String.valueOf(failed.getMessage()));
        }
    }

    private void handlePlace(String id, JsonObject payload) {
        String kind = Json.string(payload, "kind", "");
        int slot = Json.integer(payload, "slot", -1);

        String rejection = validate(kind, slot);
        if (rejection != null) {
            respondError(id, rejection, kind + " slot " + slot + " is not usable");
            return;
        }

        try {
            host.placeInFrontOfPlayer(kind, slot);
            respond(id, null);
        } catch (IllegalStateException noPlayer) {
            respondError(id, "NOT_IN_WORLD", String.valueOf(noPlayer.getMessage()));
        } catch (RuntimeException failed) {
            respondError(id, "RELOAD_FAILED", String.valueOf(failed.getMessage()));
        }
    }

    /** @return an error code, or null when the target is valid */
    private String validate(String kind, int slot) {
        if (!pool.isKnownKind(kind)) return "UNKNOWN_KIND";
        if (!pool.isValidSlot(kind, slot)) return "SLOT_OUT_OF_RANGE";
        return null;
    }
}
