package dev.ella.forge112;

import dev.ella.core.EllaLog;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

/**
 * Routes {@link EllaLog} through Forge's Log4j logger, so Ella's output lands in the
 * game log alongside everything else rather than on bare stderr.
 */
final class EllaLogBridge {

    private static final Logger LOGGER = LogManager.getLogger("Ella");

    private EllaLogBridge() {
    }

    static void install() {
        EllaLog.setSink(new EllaLog.Sink() {
            @Override
            public void log(EllaLog.Level level, String message, Throwable error) {
                switch (level) {
                    case DEBUG:
                        LOGGER.debug(message, error);
                        break;
                    case WARN:
                        LOGGER.warn(message, error);
                        break;
                    case ERROR:
                        LOGGER.error(message, error);
                        break;
                    case INFO:
                    default:
                        LOGGER.info(message, error);
                        break;
                }
            }
        });
    }

    static void info(String message) {
        LOGGER.info(message);
    }
}
