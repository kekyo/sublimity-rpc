// Sublimity pure RPC engine - Simply core implementation of pure RPC engine.
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { createDeferred, createDeferredGenerator, Deferred } from "async-primitives";
import { SublimityRpcController, SublimityRpcControllerOptions, SublimityRpcMessage, TargetFunction, TargetGeneratorFunction } from "./types";
import { createConsoleLogger } from "./logger";
import {
  __SpecialObject,
  __TargetFunction,
  __AbortFunction,
  extractAbortSignal,
  transformArguments,
  createSafeError,
  reconstructError,
  tryRegisterSpecialObject,
  tryRegisterStubObject,
  handleFunctionNotFound
} from "./internal";

/**
 * Create a Sublimity RPC controller.
 * @param options - The options for the controller.
 * @returns A Sublimity RPC controller.
 */
export const createSublimityRpcController =
  (options: SublimityRpcControllerOptions): SublimityRpcController => {
  const {
    controllerId = crypto.randomUUID(),
    logger = createConsoleLogger(),
    onSendMessage,
    produceStackTrace = false
  } = options;

  const objectMap: Map<string, WeakRef<__SpecialObject>> = new Map();
  const invocations: Map<string, Deferred<any>> = new Map();

  // Function registry
  const functionRegistry: Map<string, __TargetFunction> = new Map();

  // Function finalization registry
  const fr = new FinalizationRegistry<string>(functionId => {
    // Remove function from object map
    objectMap.delete(functionId);
    try {
      // Send purge message to peer controller
      onSendMessage({
        kind: "purge",
        messageId: crypto.randomUUID(),
        functionId
      });
    } catch (error: unknown) {
      logger.warn(`Failed to send purge message: functionId=${functionId}, error=${error}`);
    }
    logger.debug(`Function purged: functionId=${functionId}`);
  });

  /**
   * Register a function.
   * @param functionId - The ID of the function to register.
   * @param f - The function to register.
   * @returns A releasable object.
   */
  const register = <TResult, TParameters extends any[]>(
    functionId: string, f: TargetFunction<TResult, TParameters>) => {

    const fobj = f as __TargetFunction;
    if (fobj.__srpcId) {
      throw new Error(`Function ${fobj.__srpcId} already registered.`);
    }

    // Register function in registry, save from GC
    fobj.__srpcId = functionId;
    functionRegistry.set(functionId, fobj);

    // Register function in object map
    objectMap.set(functionId, new WeakRef(fobj));
    fr.register(fobj, functionId, fobj);

    // Release function
    const release = () => {
      functionRegistry.delete(functionId);
      fr.unregister(fobj);
      fobj.__srpcId = undefined;
    };

    // Return releasable object
    return {
      release,
      [Symbol.dispose]: release
    };
  };

  /**
   * Register a generator function.
   * @param functionId - The ID of the function to register.
   * @param f - The generator function to register.
   * @returns A releasable object.
   * @remarks This is the method to register a function.
   */
  const registerGenerator = <TResult, TParameters extends any[]>(
    functionId: string, f: TargetGeneratorFunction<TResult, TParameters>) => {
    
    const fouter = async (callback: (value: TResult) => Promise<void>, ...args: TParameters) => {
      for await (const item of f(...args)) {
        await callback(item);
      }
    };
    return register<void, any[]>(functionId, fouter);
  };

  /**
   * Invoke a function.
   * @param functionId - The ID of the function to invoke.
   * @param args - The arguments to pass to the function.
   * @returns A promise that resolves to the result of the function.
   */
  const invoke = async <TResult, TParameters extends any[]>(
    functionId: string, ...args: TParameters): Promise<TResult> => {
    
    const signal = extractAbortSignal(args);

    // Create message ID
    const messageId = crypto.randomUUID();

    // Check each argument for functions and replace with special objects
    const _args = transformArguments(args, arg => tryRegisterSpecialObject(arg, {
      objectMap,
      functionRegistry,
      fr,
      logger,
      onSendMessage
    }));

    // Create deferred object to awaitable result (must be before onSendMessage for sync handling)
    const deferred = createDeferred<TResult>(signal);
    // Register deferred object
    invocations.set(messageId, deferred);

    try {
      // Send invoking message to peer controller
      const sendResult = onSendMessage({
        kind: "invoke",
        messageId,
        functionId,
        args: _args
      });
      
      // If onSendMessage returns a Promise<SublimityRpcMessage>, handle synchronous RPC
      if (sendResult instanceof Promise) {
        const response = await sendResult;
        
        // Remove deferred since we got immediate response
        invocations.delete(messageId);
        
        // Process response directly
        if (response.kind === "result" && response.messageId === messageId) {
          const result = tryRegisterStubObject(response.result, {
            objectMap,
            functionRegistry,
            fr,
            invoke
          });
          return result as TResult;
        } else if (response.kind === "error" && response.messageId === messageId) {
          throw reconstructError(response.error, produceStackTrace);
        } else if (response.kind === "none" && response.messageId === messageId) {
          // None response means the message was processed but has no result (one-way)
          // This shouldn't happen in invoke, but handle gracefully
          // One-way function is needed to result `Promise<any>`, so here is returning it.
          return undefined as any;
        } else {
          // Unexpected response
          throw new Error(`Unexpected response: ${response.kind} for messageId: ${messageId}`);
        }
      }
      
      // Traditional async mode: Deferred already registered above
      // Return promise to awaitable result
      return deferred.promise;
      
    } catch (error: unknown) {
      // Clean up on error
      invocations.delete(messageId);
      logger.warn(`Failed sending invoke message to peer: messageId=${messageId}, error=${error}`);
      throw error;
    }
  };

  /**
   * Invoke a one-way function.
   * @param functionId - The ID of the function to invoke.
   * @param args - The arguments to pass to the function.
   */
  const invokeOneWay = <TParameters extends any[]>(
    functionId: string, ...args: TParameters): void => {

    // Create message ID
    const messageId = crypto.randomUUID();

    // Check each argument for functions and replace with special objects
    const _args = transformArguments(args, arg => tryRegisterSpecialObject(arg, {
      objectMap,
      functionRegistry,
      fr,
      logger,
      onSendMessage
    }));

    try {
      // Send invoking message to peer controller
      onSendMessage({
        kind: "invoke",
        messageId,
        functionId,
        oneWay: true,
        args: _args
      });
    } catch (error: unknown) {
      // Invocation is completed with immediate error
      logger.warn(`Failed sending invoke message to peer: messageId=${messageId}, error=${error}`);
      throw error;
    }
  };

  /**
   * Invoke a generator function.
   * @param functionId - The ID of the function to invoke.
   * @param args - The arguments to pass to the function.
   * @returns A promise that resolves to the result of the function.
   * @remarks This is the method to invoke a function.
   */
  const iterate = <TResult = any, TParameters extends any[] = any[]>(
    functionId: string, ...args: TParameters) => {

    const signal = extractAbortSignal(args);

    const deferredGenerator = createDeferredGenerator<TResult>({ signal });

    // Call invoke with callback as first argument, followed by iterate args
    invoke<TResult, [(item: TResult) => Promise<void>, ...TParameters]>(
      functionId,
      (item: TResult) =>
        deferredGenerator.yield(item, signal),
      ...args).
    then(() => {
      // When invoke returns successfully, call return to complete the generator
      deferredGenerator.return(signal);
    }).
    catch(error => {
      // When invoke throws, call throw to error the generator
      deferredGenerator.throw(error, signal);
    });

    return deferredGenerator.generator;
  };

  /**
   * Insert a RPC message to controller.
   * @param message - The message to insert.
   * @remarks Insert a RPC message. Then the controller will handle and invocation to target function.
   */
  const insertMessage = (message: SublimityRpcMessage): void => {
    const inner = async (message: SublimityRpcMessage) => {
      // Handle message
      switch (message.kind) {
        // Handle invoke message
        case "invoke": {
          // Get function from functions map
          const functionId = message.functionId;
          const f = objectMap.get(functionId)?.deref() as __TargetFunction | undefined;
          if (!f) {
            handleFunctionNotFound(functionId, message.messageId, false, {
              onSendMessage,
              logger
            });
            return;
          }

          // Replace special descriptor objects with appropriate objects
          const _args = transformArguments(message.args, arg => tryRegisterStubObject(arg, {
            objectMap,
            functionRegistry,
            fr,
            invoke
          }));

          // If the message is one-way, return immediately
          if (message.oneWay) {
            // Invoke this one-way function
            try {
              void f(..._args);
            } catch (error: unknown) {
              // Error invoking one-way function
              logger.warn(`Error invoking one-way function: messageId=${message.messageId}, functionId=${functionId}, error=${error}`);
            }
            return;
          }

          let result: any;
          try {
            // Invoke this function
            result = await f(..._args);
          } catch (error: any) {
            // Create safe error object
            const seo = createSafeError(error, controllerId, produceStackTrace);
            try {
              // Send error message to peer controller
              onSendMessage({
                kind: "error",
                messageId: message.messageId,
                error: seo
              });
            } catch (error: unknown) {
              // Error sending
              logger.warn(`Failed sending error message to peer: messageId=${message.messageId}, error=${error}`);
            }
            return;
          }

          // Register result as anonymous function when it is a function
          const _result = tryRegisterSpecialObject(result, {
            objectMap,
            functionRegistry,
            fr,
            logger,
            onSendMessage
          });

          try {
            // Send result message to peer controller
            onSendMessage({
              kind: "result",
              messageId: message.messageId,
              result : _result
            });
          } catch (error: unknown) {
            // Error sending
            logger.warn(`Failed sending result message to peer: messageId=${message.messageId}, error=${error}`);
          }
          break;
        }

        // Handle result message
        case "result": {
          // Get deferred object
          const deferred = invocations.get(message.messageId);
          if (deferred) {
            // Remove deferred object because this transaction is completed
            invocations.delete(message.messageId);

            // Process result through tryRegisterStubObject
            const result = tryRegisterStubObject(message.result, {
              objectMap,
              functionRegistry,
              fr,
              invoke
            });

            // Resolve deferred object
            deferred.resolve(result);
          } else {
            // Deferred object is not found
            logger.warn(`Failed examine result message: messageId=${message.messageId}, result=${message.result}`);
          }
          break;
        }

        // Handle error message
        case "error": {
          // Get deferred object
          const deferred = invocations.get(message.messageId);
          if (deferred) {
            // Remove deferred object because this transaction is completed
            invocations.delete(message.messageId);

            // Create real error object
            const error = reconstructError(message.error, produceStackTrace);

            // Reject deferred object
            deferred.reject(error);
          } else {
            // Deferred object is not found
            logger.warn(`Failed examine error message: messageId=${message.messageId}, error=${message.error.name}, ${message.error.message}`);
          }
          break;
        }

        // Purge message
        case "purge": {
          const fobj = functionRegistry.get(message.functionId) as __TargetFunction | undefined;
          if (fobj) {
            logger.debug(`Purge request arrived: messageId=${message.messageId}, functionId=${message.functionId}`);

            // Remove from function registry
            functionRegistry.delete(message.functionId);
            // Remove from object map
            objectMap.delete(message.functionId);
            fr.unregister(fobj);

            delete fobj.__srpcId;
          }
          break;
        }

        // None message
        case "none": {
          logger.debug(`None message arrived: messageId=${message.messageId}`);
          break;
        }
      }
    };
    void inner(message);
  }

  /**
   * Insert a RPC message to controller and return response.
   * @param message - The message to insert.
   * @returns Promise that resolves with response message.
   * @remarks Processes RPC message and returns response for synchronous RPC pattern.
   */
  const insertMessageWaitable = async (message: SublimityRpcMessage): Promise<SublimityRpcMessage> => {
    
    switch (message.kind) {
      // Handle invoke message
      case "invoke": {
        // Get function from functions map
        const functionId = message.functionId;
        const f = objectMap.get(functionId)?.deref() as __TargetFunction | undefined;
        
        if (!f) {
          // Return error response
          return handleFunctionNotFound(functionId, message.messageId, true, {
            onSendMessage,
            logger
          }) as SublimityRpcMessage;
        }

        // Replace special descriptor objects with appropriate objects
        const _args = transformArguments(message.args, arg => tryRegisterStubObject(arg, {
          objectMap,
          functionRegistry,
          fr,
          invoke
        }));

        // Handle one-way messages
        if (message.oneWay) {
          try {
            void f(..._args);
          } catch (error: any) {
            logger.warn(`Raise an error for one-way function: messageId=${message.messageId}, ${error.message}}`);
          }
          // Return none response for one-way messages
          // (Waitable invoker has to return a message, so that is none operator)
          return {
            kind: "none",
            messageId: message.messageId,
          };
        }

        // Handle normal invocation
        let result: any;
        try {
          // Invoke this function
          result = await f(..._args);
        } catch (error: any) {
          // Create safe error object
          const seo = createSafeError(error, controllerId, produceStackTrace);

          // Return error response
          return {
            kind: "error",
            messageId: message.messageId,
            error: seo
          };
        }

        // Register result as anonymous function when it is a function
        const _result = tryRegisterSpecialObject(result, {
          objectMap,
          functionRegistry,
          fr,
          logger,
          onSendMessage
        });
        
        // Return success response
        return {
          kind: "result",
          messageId: message.messageId,
          result: _result
        };
      }

      // Handle result message
      case "result": {
        // Get deferred object
        const deferred = invocations.get(message.messageId);
        if (deferred) {
          // Remove deferred object because this transaction is completed
          invocations.delete(message.messageId);

          // Process result through tryRegisterStubObject
          const result = tryRegisterStubObject(message.result, {
            objectMap,
            functionRegistry,
            fr,
            invoke
          });

          // Resolve deferred object
          deferred.resolve(result);
        } else {
          // Deferred object is not found
          logger.warn(`Failed examine result message: messageId=${message.messageId}, result=${message.result}`);
        }
        // Return the message as-is
        return message;
      }

      // Handle error message  
      case "error": {
        // Get deferred object
        const deferred = invocations.get(message.messageId);
        if (deferred) {
          // Remove deferred object because this transaction is completed
          invocations.delete(message.messageId);

          // Create real error object
          const error = reconstructError(message.error, produceStackTrace);

          // Reject deferred object
          deferred.reject(error);
        } else {
          // Deferred object is not found
          logger.warn(`Failed examine error message: messageId=${message.messageId}, error=${message.error.name}, ${message.error.message}`);
        }
        // Return the message as-is
        return message;
      }

      // Purge message
      case "purge": {
        const fobj = functionRegistry.get(message.functionId) as __TargetFunction | undefined;
        if (fobj) {
          logger.debug(`Purge request arrived: messageId=${message.messageId}, functionId=${message.functionId}`);

          // Remove from function registry
          functionRegistry.delete(message.functionId);
          // Remove from object map
          objectMap.delete(message.functionId);
          fr.unregister(fobj);

          delete fobj.__srpcId;
        }
        // Return the message as-is
        return message;
      }

      // None message
      case "none": {
        logger.debug(`None message arrived: messageId=${message.messageId}`);
        // Return the message as-is (maybe spurious)
        return message;
      }
    }
  };

  /**
   * Release the controller.
   * @remarks Release the controller.
   */
  const release = () => {
    const fs = Array.from(functionRegistry.values());
    const ds = Array.from(invocations.values());

    objectMap.clear();
    functionRegistry.clear();
    invocations.clear();

    for (const f of fs) {
      fr.unregister(f);
    }
    for (const d of ds) {
      d.reject(new Error("Controller released"));
    }
  };

  // Controller object
  return {
    register,
    registerGenerator,
    invoke,
    invokeOneWay,
    iterate,
    insertMessage,
    insertMessageWaitable,
    release,
    [Symbol.dispose]: release
  };
};
