// Sublimity pure RPC engine - Simply core implementation of pure RPC engine.
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

/**
 * Logger interface.
 */
export interface Logger {
  readonly debug: (message: string) => void;
  readonly info: (message: string) => void;
  readonly warn: (message: string) => void;
  readonly error: (message: string) => void;
}

/**
 * Base RPC message interface.
 */
export interface SublimityRpcMessageBase {
  readonly kind: "invoke" | "result" | "error" | "purge" | "none";
  /**
   * Message ID.
   * @remarks This is a unique identifier for a calling transaction.
   */
  readonly messageId: string;
}

/**
 * Invoke message interface.
 */
export interface SublimityRpcMessageInvoke extends SublimityRpcMessageBase {
  readonly kind: "invoke";
  /**
   * Function ID.
   * @remarks This is a unique identifier for a target function.
   */
  readonly functionId: string;
  /**
   * Arguments.
   * @remarks This is a list of arguments to be passed to the target function.
   */
  readonly args: any[];
  /**
   * One-way flag.
   * @remarks This is a flag to indicate if the message is one-way. Default is false.
   */
  readonly oneWay?: boolean;
}

/**
 * Result message interface.
 */
export interface SublimityRpcMessageResult extends SublimityRpcMessageBase {
  readonly kind: "result";
  /**
   * Result
   * @remarks This is the result of the target function.
   */
  readonly result: any;
}

/**
 * Error message interface.
 */
export interface SublimityRpcMessageError extends SublimityRpcMessageBase {
  readonly kind: "error";
  /**
   * Error
   * @remarks This is the error object.
   */
  readonly error: Error;
}

/**
 * Purge message interface.
 */
export interface SublimityRpcMessagePurge extends SublimityRpcMessageBase {
  readonly kind: "purge";
  /**
   * Error
   * @remarks This is the function id.
   */
  readonly functionId: string;
}

/**
 * Nothing operator interface.
 */
export interface SublimityRpcMessageNone extends SublimityRpcMessageBase {
  readonly kind: "none";
}

/**
 * Sublimity RPC message type.
 */
export type SublimityRpcMessage =
  SublimityRpcMessageInvoke | SublimityRpcMessageResult | SublimityRpcMessageError | SublimityRpcMessagePurge | SublimityRpcMessageNone;

/**
 * Sublimity RPC controller options interface.
 */
export interface SublimityRpcControllerOptions {
  /**
   * Controller ID.
   * @remarks This is the ID of the controller. Default is a random UUID.
   */
  controllerId?: string;
  /**
   * Logger.
   * @remarks This is the logger to be used by the controller. Default is console logger.
   */
  logger?: Logger;
  /**
   * Send message handler. Always required.
   * @remarks 
   * - Return void for traditional async message passing (fire-and-forget)
   * - Return Promise<SublimityRpcMessage> for synchronous RPC pattern (must return response message)
   */
  onSendMessage: (message: SublimityRpcMessage) => void | Promise<SublimityRpcMessage>;
  /**
   * Produce stack trace.
   * @remarks This is the flag to produce stack trace to return to the caller. Default is false.
   */
  produceStackTrace?: boolean;
}

/**
 * Target function type.
 */
export type TargetFunction<TResult, TParameters extends any[]> =
  (...args: TParameters) => Promise<TResult>;

/**
 * Target generator function type.
 */
export type TargetGeneratorFunction<TResult, TParameters extends any[]> =
  (...args: TParameters) => AsyncGenerator<TResult, void, unknown>;

/**
 * Releasable interface.
 */
export interface Releasable extends Disposable {
  readonly release: () => void;
}

/**
 * Sublimity RPC controller interface.
 */
export interface SublimityRpcController extends Releasable {
  /**
   * Register a function.
   * @param functionId - The ID of the function to register.
   * @param f - The function to register.
   * @returns A releasable object.
   * @remarks This is the method to register a function.
   */
  readonly register: <TResult = any, TParameters extends any[] = any[]>(
    functionId: string,
    f: TargetFunction<TResult, TParameters>) => Releasable;

  /**
   * Register a generator function.
   * @param functionId - The ID of the function to register.
   * @param f - The generator function to register.
   * @returns A releasable object.
   * @remarks This is the method to register a function.
   */
  readonly registerGenerator: <TResult, TParameters extends any[]>(
    functionId: string, f: TargetGeneratorFunction<TResult, TParameters>) => Releasable;

  /**
   * Invoke a function.
   * @param functionId - The ID of the function to invoke.
   * @param args - The arguments to pass to the function.
   * @returns A promise that resolves to the result of the function.
   * @remarks This is the method to invoke a function.
   */
  readonly invoke: <TResult = any, TParameters extends any[] = any[]>(
    functionId: string, ...args: TParameters) => Promise<TResult>;

  /**
   * Invoke a one-way function.
   * @param functionId - The ID of the function to invoke.
   * @param args - The arguments to pass to the function.
   */
  readonly invokeOneWay: <TParameters extends any[]>(
    functionId: string, ...args: TParameters) => void;

  /**
   * Invoke a generator function.
   * @param functionId - The ID of the function to invoke.
   * @param args - The arguments to pass to the function.
   * @returns A promise that resolves to the result of the function.
   * @remarks This is the method to invoke a function.
   */
  readonly iterate: <TResult = any, TParameters extends any[] = any[]>(
    functionId: string, ...args: TParameters) => AsyncGenerator<TResult, void, unknown>;

  /**
   * Insert a RPC message to controller (fire-and-forget).
   * @param message - The message to insert.
   * @remarks Insert a RPC message. Then the controller will handle and invocation to target function.
   */
  readonly insertMessage: (message: SublimityRpcMessage) => void;
  
  /**
   * Insert a RPC message to controller and return response.
   * @param message - The message to insert.
   * @returns Promise that resolves with response message.
   * @remarks Processes RPC message and returns response for synchronous RPC pattern.
   */
  readonly insertMessageWaitable: (message: SublimityRpcMessage) => Promise<SublimityRpcMessage>;
}
