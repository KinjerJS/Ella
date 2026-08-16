package dev.ella.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Gson helpers.
 *
 * <p>Gson is used rather than a bundled JSON library because Minecraft already ships it on
 * every version Ella targets. It is a {@code compileOnly} dependency for that reason —
 * shading a second copy in would risk clashing with the game's.
 */
public final class Json {

    private Json() {
    }

    /** Converts a JSON object into plain Java values, for {@link SlotSettings#apply}. */
    public static Map<String, Object> toMap(JsonObject object) {
        Map<String, Object> map = new LinkedHashMap<String, Object>();
        if (object == null) return map;

        for (Map.Entry<String, JsonElement> entry : object.entrySet()) {
            map.put(entry.getKey(), toValue(entry.getValue()));
        }
        return map;
    }

    private static Object toValue(JsonElement element) {
        if (element == null || element.isJsonNull()) return null;

        if (element.isJsonPrimitive()) {
            JsonPrimitive primitive = element.getAsJsonPrimitive();
            if (primitive.isBoolean()) return primitive.getAsBoolean();
            if (primitive.isNumber()) return primitive.getAsNumber();
            return primitive.getAsString();
        }

        if (element.isJsonArray()) {
            JsonArray array = element.getAsJsonArray();
            List<Object> values = new ArrayList<Object>(array.size());
            for (JsonElement child : array) {
                values.add(toValue(child));
            }
            return values;
        }

        return toMap(element.getAsJsonObject());
    }

    public static String string(JsonObject object, String key, String fallback) {
        if (object == null || !object.has(key) || object.get(key).isJsonNull()) return fallback;
        return object.get(key).getAsString();
    }

    public static int integer(JsonObject object, String key, int fallback) {
        if (object == null || !object.has(key) || object.get(key).isJsonNull()) return fallback;
        try {
            return object.get(key).getAsInt();
        } catch (RuntimeException notANumber) {
            return fallback;
        }
    }

    public static JsonObject object(JsonObject parent, String key) {
        if (parent == null || !parent.has(key) || !parent.get(key).isJsonObject()) return null;
        return parent.getAsJsonObject(key);
    }

    /**
     * Picks a display name out of a locale map, preferring the game's language and
     * falling back to English, which the protocol guarantees is present.
     */
    public static String localised(JsonObject names, String preferredLocale) {
        if (names == null) return "";
        if (preferredLocale != null && names.has(preferredLocale)) {
            return names.get(preferredLocale).getAsString();
        }
        return names.has("en") ? names.get("en").getAsString() : "";
    }

    public static JsonArray ofStrings(Iterable<String> values) {
        JsonArray array = new JsonArray();
        for (String value : values) {
            array.add(new JsonPrimitive(value));
        }
        return array;
    }
}
