package dev.ella.forgemodern;

import dev.ella.core.EllaLog;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Routes {@link EllaLog} into the game log. Modern Forge exposes SLF4J. */
final class EllaLogBridge {

    private static final Logger LOGGER = LoggerFactory.getLogger("Ella");

    private EllaLogBridge() {
    }

    static void install() {
        EllaLog.setSink((level, message, error) -> {
            switch (level) {
                case DEBUG -> LOGGER.debug(message, error);
                case WARN -> LOGGER.warn(message, error);
                case ERROR -> LOGGER.error(message, error);
                default -> LOGGER.info(message, error);
            }
        });
    }

    static void info(String message) {
        LOGGER.info(message);
    }
}
