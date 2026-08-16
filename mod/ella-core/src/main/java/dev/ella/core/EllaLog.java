package dev.ella.core;

/**
 * Logging indirection.
 *
 * <p>ella-core cannot depend on a logging framework: 1.8.9 and modern Forge ship
 * different ones, and pulling in a copy would risk a classloader conflict. Each adapter
 * installs a sink that forwards to whatever its version uses.
 */
public final class EllaLog {

    /** Where a log line goes. */
    public interface Sink {
        void log(Level level, String message, Throwable error);
    }

    public enum Level {
        DEBUG, INFO, WARN, ERROR
    }

    private static volatile Sink sink = new Sink() {
        @Override
        public void log(Level level, String message, Throwable error) {
            // Before an adapter installs its sink, stderr is the only thing guaranteed
            // to exist. Losing early startup lines would hide exactly the failures that
            // are hardest to diagnose.
            System.err.println("[Ella/" + level + "] " + message);
            if (error != null) error.printStackTrace();
        }
    };

    private EllaLog() {
    }

    public static void setSink(Sink newSink) {
        if (newSink != null) sink = newSink;
    }

    public static void debug(String message) {
        sink.log(Level.DEBUG, message, null);
    }

    public static void info(String message) {
        sink.log(Level.INFO, message, null);
    }

    public static void warn(String message) {
        sink.log(Level.WARN, message, null);
    }

    public static void error(String message, Throwable error) {
        sink.log(Level.ERROR, message, error);
    }
}
