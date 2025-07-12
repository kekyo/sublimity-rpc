// Sublimity pure RPC engine - Simply core implementation of pure RPC engine.
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { Logger } from "./types";

/**
 * Create a console logger.
 * @returns Logger object.
 */
export const createConsoleLogger = (): Logger => {
  return {
    debug: (message: string) => console.debug(message),
    info: (message: string) => console.info(message),
    warn: (message: string) => console.warn(message),
    error: (message: string) => console.error(message)
  };
};
