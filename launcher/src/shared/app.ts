/**
 * The launcher's own identity.
 *
 * Shared rather than main-only because it is needed on both sides: Minecraft is told which
 * launcher started it, a crash report has to name the build it came from, and the sidebar
 * shows it so a user filing that report does not have to go looking.
 *
 * Written out rather than read from package.json, because the renderer has no filesystem
 * and bundling the manifest to recover one string is not a trade worth making. A test keeps
 * the two in step.
 */

export const APP_NAME = 'Ella';
export const APP_VERSION = '0.2.0';
