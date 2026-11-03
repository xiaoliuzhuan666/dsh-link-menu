/**
 * Host half of dsh-link-menu.
 *
 * All the behaviour lives in the browser. This file exists because the
 * client-module scanner skips a loader entry whose Host fiber never started, so
 * a client-only plugin still needs a Host half that imports cleanly and mounts
 * without waiting on anything.
 */

export const name = "dsh-link-menu";

/** Nothing is read from the Host context. */
export const inject = [];

/** Intentionally empty: the browser half owns every menu action. */
export function apply() {}
