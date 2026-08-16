/*
 * Ella Live Sync — a Blockbench plugin.
 *
 * Ella already watches the model file on disk, so a normal Ctrl+S reaches the game. This
 * plugin removes the Ctrl+S: it saves automatically after each edit, so the block in game
 * updates as you model.
 *
 * Deliberately no socket to the launcher. The file watcher is already the transport, and
 * writing the file the game loads is both simpler and impossible to get out of step with
 * what a manual save would produce.
 *
 * APIs used here were checked against the installed Blockbench build with
 * inspect-api.mjs; re-run it after a Blockbench update if something stops working.
 *
 * Install: copy this file into %APPDATA%/Blockbench/plugins (or the Plugins menu's
 * "Load Plugin from File").
 */

(function () {
  'use strict';

  const PLUGIN_ID = 'ella_live_sync';

  /** Milliseconds of quiet before saving. Dragging a cube fires edits continuously. */
  const DEBOUNCE_MS = 400;

  let enabled = true;
  let timer = null;
  let toggleAction = null;
  let listeners = [];

  function saveNow() {
    timer = null;
    if (!enabled) return;

    // No path means the project has never been saved; triggering a save would open a
    // file dialog, which is the opposite of unobtrusive.
    if (typeof Project === 'undefined' || !Project || !Project.save_path) return;

    try {
      // Going through the normal save action rather than writing the file directly means
      // the output is byte-for-byte what a manual Ctrl+S produces, whatever format the
      // project is in.
      BarItems.save_project.trigger();
    } catch (error) {
      console.error('[Ella] auto-save failed', error);
      if (typeof Blockbench !== 'undefined' && Blockbench.showQuickMessage) {
        Blockbench.showQuickMessage('Ella: auto-save failed', 2000);
      }
    }
  }

  function scheduleSave() {
    if (!enabled) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(saveNow, DEBOUNCE_MS);
  }

  function on(event, handler) {
    Blockbench.on(event, handler);
    listeners.push([event, handler]);
  }

  Plugin.register(PLUGIN_ID, {
    title: 'Ella Live Sync',
    author: 'Ella',
    description:
      'Saves the open model after each edit so Ella pushes it into the running game ' +
      'without pressing Ctrl+S.',
    icon: 'sync',
    version: '0.1.0',
    variant: 'desktop',

    onload() {
      toggleAction = new Action('ella_toggle_live_sync', {
        name: 'Ella: live sync',
        description: 'Save automatically after each edit so the running game updates.',
        icon: 'sync',
        click() {
          enabled = !enabled;
          if (!enabled && timer) {
            clearTimeout(timer);
            timer = null;
          }
          Blockbench.showQuickMessage(
            enabled ? 'Ella live sync: on' : 'Ella live sync: off',
            1500,
          );
        },
      });

      MenuBar.addAction(toggleAction, 'file');

      // `finish_edit` fires once per undoable action, which is the right granularity:
      // one save per meaningful change rather than one per mouse move.
      on('finish_edit', scheduleSave);
      on('edit_texture', scheduleSave);
      on('update_selection', () => {
        // Not an edit, but it is a reliable moment to flush a pending save if the user
        // stopped mid-drag.
        if (timer) scheduleSave();
      });

      console.log('[Ella] live sync loaded');
    },

    onunload() {
      if (timer) clearTimeout(timer);
      timer = null;

      for (const [event, handler] of listeners) {
        if (Blockbench.removeListener) Blockbench.removeListener(event, handler);
      }
      listeners = [];

      if (toggleAction) toggleAction.delete();
      toggleAction = null;
    },
  });
})();
