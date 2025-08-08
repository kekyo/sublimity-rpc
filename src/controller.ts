// Sublimity pure RPC engine - Simply core implementation of pure RPC engine.
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { createDeferred, createDeferredGenerator, Deferred } from "async-primitives";
import { SublimityRpcController, SublimityRpcControllerOptions, SublimityRpcMessage, TargetFunction, TargetGeneratorFunction } from "./types";
import { createConsoleLogger } from "./logger";

interface __SpecialObject {
  __srpcId: string | undefined;
}

interface __AbortSignal extends AbortSignal, __SpecialObject {
}

interface __TargetFunction extends TargetFunction<any, any[]>, __SpecialObject {
}

interface __AbortFunction extends __TargetFunction {
  __srpcAbortController: AbortController | undefined;
}

interface __Descriptor {
  __srpcType: 'function' | 'abort' | undefined;
  __srpcId: string | undefined;
}

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
   * Extract AbortSignal from arguments.
   * @param args - The arguments to extract AbortSignal from.
   * @returns The AbortSignal if found, otherwise undefined.
   */
  const extractAbortSignal = (args: any[]): AbortSignal | undefined => {
    // Extract AbortSignal from arguments
    for (let argIndex = args.length - 1; argIndex >= 0; argIndex--) {
      const arg = args[argIndex];
      if (arg instanceof AbortSignal) {
        return arg;
      }
    }
    return undefined;
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
   * Try to register a function or AbortSignal.
   * @param obj - The object to register.
   * @returns The special descriptor object if the object is a function or AbortSignal, otherwise the original object.
   */
  const tryRegisterSpecialObject = (arg: any): any => {
    // Is argument a function?
    if (arg instanceof Function) {
      // Is this function does not registered?
      let fobj = arg as __TargetFunction;
      if (!fobj.__srpcId) {
        // Register anonymous function to object map
        const functionId = crypto.randomUUID();
        fobj.__srpcId = functionId;
        objectMap.set(functionId, new WeakRef(fobj));
        fr.register(fobj, functionId, fobj);
        // Also register in functionRegistry to keep it alive until peer sends purge
        functionRegistry.set(functionId, fobj);
      }

      // Return function descriptor object
      const functionDescriptor: __Descriptor = {
        __srpcType: 'function',
        __srpcId: fobj.__srpcId
      };
      return functionDescriptor;
    }
    // Is argument an AbortSignal?
    else if (arg instanceof AbortSignal) {
      // Is this AbortSignal does not registered?
      let aobj = arg as __AbortSignal;
      let abortSignalId = aobj.__srpcId;
      if (!abortSignalId) {
        // Register AbortSignal to object map
        abortSignalId = crypto.randomUUID();
        aobj.__srpcId = abortSignalId;
        objectMap.set(abortSignalId, new WeakRef(aobj));
        fr.register(aobj, abortSignalId, aobj);

        // Add abort event listener
        const handleAbort = () => {
          // Create message ID
          const messageId = crypto.randomUUID();
          try {
            // Send abort
            onSendMessage({
              kind: "invoke",
              messageId,
              functionId: abortSignalId!,
              args: [],
              oneWay: true
            });
          } catch (error: unknown) {
            logger.warn(`Failed to send abort signal: messageId=${messageId}, abortSignalId=${abortSignalId}, error=${error}`);
          }
        };
        arg.addEventListener('abort', handleAbort);
      }

      // Return abort descriptor object
      const abortDescriptor: __Descriptor = {
        __srpcType: 'abort',
        __srpcId: abortSignalId
      };
      return abortDescriptor;
    } else {
      // Return original argument if not a function or AbortSignal.
      return arg;
    }
  };

  /**
   * Try to register a stub function or create AbortSignal based on descriptor.
   * @param arg - The argument which might be a descriptor.
   * @returns The stub function, AbortSignal, or original argument.
   */
  const tryRegisterStubObject = (arg: any): any => {
    // Check if argument is a descriptor
    const descriptor = arg as __Descriptor | undefined;
    if (descriptor?.__srpcId) {
      switch (descriptor?.__srpcType) {
        // Is descriptor function?
        case 'function': {
          // Stub function is not in object map?
          const functionId = descriptor.__srpcId;
          let stubFunction = objectMap.get(functionId)?.deref() as __TargetFunction | undefined;
          if (!stubFunction) {
            // Create stub function
            stubFunction = ((...args: any[]) => invoke(functionId, ...args)) as __TargetFunction;

            // Register stub function in object map
            stubFunction.__srpcId = functionId;
            objectMap.set(functionId, new WeakRef(stubFunction));
            fr.register(stubFunction, functionId, stubFunction);
          }
          // Return stub function
          return stubFunction;
        }
        // Is descriptor abort?
        case 'abort': {
          // Stub function is not in object map?
          const abortSignalId = descriptor.__srpcId;
          let abortFunction = objectMap.get(abortSignalId)?.deref() as __AbortFunction | undefined;
          if (!abortFunction?.__srpcAbortController) {
            // Handle abort descriptor - create AbortController and register abort function
            const abortController = new AbortController();
            // Create abort function closure
            abortFunction = (async () => abortController.abort()) as __AbortFunction;
            abortFunction.__srpcAbortController = abortController;

            // Register abort function with the same ID as AbortSignal
            abortFunction.__srpcId = abortSignalId;
            objectMap.set(abortSignalId, new WeakRef(abortFunction));
            functionRegistry.set(abortSignalId, abortFunction);
          }
          // Return AbortSignal
          return abortFunction.__srpcAbortController.signal;
        }
      }
    }
    // Return original argument if not a descriptor or others.
    return arg;
  }

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
    const _args = [];
    for (let argIndex = 0; argIndex < args.length; argIndex++) {
      // Replace function arguments with special function objects
      _args.push(tryRegisterSpecialObject(args[argIndex]));
    }

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
          const result = tryRegisterStubObject(response.result);
          return result as TResult;
        } else if (response.kind === "error" && response.messageId === messageId) {
          const error = new Error(response.error.message);
          error.name = response.error.name;
          if (produceStackTrace && response.error.stack) {
            error.stack += response.error.stack;
          }
          throw error;
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
    const _args = [];
    for (let argIndex = 0; argIndex < args.length; argIndex++) {
      // Replace function arguments with special function objects
      _args.push(tryRegisterSpecialObject(args[argIndex]));
    }

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
    functionId: string, ...args: TParameters): AsyncGenerator<TResult, void, unknown> => {

    const signal = extractAbortSignal(args);

    const deferredGenerator = createDeferredGenerator<TResult>({ signal });

    // Call invoke with callback as first argument, followed by iterate args
    invoke(functionId, deferredGenerator.yield, ...args).
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
            try {
              // Send error message to peer controller
              onSendMessage({
                kind: "error",
                messageId: message.messageId,
                error: new Error(`Function '${functionId}' is not found`)
              });
            } catch (error: unknown) {
              // Unknown sending to peer error
              logger.warn(`Failed sending error message to peer: messageId=${message.messageId}, functionId=${functionId}, error=${error}`);
            }
            return;
          }

          // Replace special descriptor objects with appropriate objects
          const _args = [];
          for (let argIndex = 0; argIndex < message.args.length; argIndex++) {
            // Process argument through tryRegisterStubObject
            _args.push(tryRegisterStubObject(message.args[argIndex]));
          }

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
            const seo: Error = {
              name: error instanceof Error ? error.name : (error as any).constructor.name,
              message: error instanceof Error ? error.message : String(error)
            };
            // Add stack trace to error object if requested
            if (produceStackTrace && error.stack) {
              seo.stack = `\n------- Remote stack trace [${controllerId}]:\n${error.stack}`;
            }
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
          const _result = tryRegisterSpecialObject(result);

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
            const result = tryRegisterStubObject(message.result);

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
            const error = new Error(message.error.message);
            error.name = message.error.name;

            // Add stack trace to error object if requested
            if (produceStackTrace && message.error.stack) {
              error.stack += message.error.stack;
            }

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
          return {
            kind: "error",
            messageId: message.messageId,
            error: new Error(`Function '${functionId}' is not found`)
          };
        }

        // Replace special descriptor objects with appropriate objects
        const _args = [];
        for (let argIndex = 0; argIndex < message.args.length; argIndex++) {
          // Process argument through tryRegisterStubObject
          _args.push(tryRegisterStubObject(message.args[argIndex]));
        }

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
          const seo: Error = {
            name: error instanceof Error ? error.name : (error as any).constructor.name,
            message: error instanceof Error ? error.message : String(error)
          };
          // Add stack trace to error object if requested
          if (produceStackTrace && error.stack) {
            seo.stack = `\n------- Remote stack trace [${controllerId}]:\n${error.stack}`;
          }

          // Return error response
          return {
            kind: "error",
            messageId: message.messageId,
            error: seo
          };
        }

        // Register result as anonymous function when it is a function
        const _result = tryRegisterSpecialObject(result);
        
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
          const result = tryRegisterStubObject(message.result);

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
          const error = new Error(message.error.message);
          error.name = message.error.name;

          // Add stack trace to error object if requested
          if (produceStackTrace && message.error.stack) {
            error.stack += message.error.stack;
          }

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
