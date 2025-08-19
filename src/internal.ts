// Ameba pure RPC engine - Internal helper functions.
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { AmebaRpcMessage, TargetFunction, Logger } from "./types";

export interface __SpecialObject {
  __srpcId: string | undefined;
}

export interface __AbortSignal extends AbortSignal, __SpecialObject {
}

export interface __TargetFunction extends TargetFunction<any, any[]>, __SpecialObject {
}

export interface __AbortFunction extends __TargetFunction {
  __srpcAbortController: AbortController | undefined;
}

export interface __Descriptor {
  __srpcType: 'function' | 'abort' | undefined;
  __srpcId: string | undefined;
}

/**
 * Extract AbortSignal from arguments.
 * @param args - The arguments to extract AbortSignal from.
 * @returns The AbortSignal if found, otherwise undefined.
 */
export const extractAbortSignal = (args: any[]): AbortSignal | undefined => {
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
 * Transform arguments array with a transformer function.
 * @param args - The arguments to transform.
 * @param transformer - The transformer function.
 * @returns The transformed arguments array.
 */
export const transformArguments = (args: any[], transformer: (arg: any) => any): any[] => {
  const transformed = [];
  for (let argIndex = 0; argIndex < args.length; argIndex++) {
    transformed.push(transformer(args[argIndex]));
  }
  return transformed;
};

/**
 * Create a safe error object for RPC transmission.
 * @param error - The error to convert.
 * @param controllerId - The controller ID.
 * @param produceStackTrace - Whether to include stack trace.
 * @returns A safe error object.
 */
export const createSafeError = (
  error: any, 
  controllerId: string, 
  produceStackTrace: boolean
): Error => {
  const seo: Error = {
    name: error instanceof Error ? error.name : (error as any).constructor.name,
    message: error instanceof Error ? error.message : String(error)
  };
  if (produceStackTrace && error.stack) {
    seo.stack = `\n------- Remote stack trace [${controllerId}]:\n${error.stack}`;
  }
  return seo;
};

/**
 * Reconstruct an Error object from RPC message.
 * @param errorObj - The error object from RPC message.
 * @param produceStackTrace - Whether to include stack trace.
 * @returns A reconstructed Error object.
 */
export const reconstructError = (errorObj: Error, produceStackTrace: boolean): Error => {
  const error = new Error(errorObj.message);
  error.name = errorObj.name;
  if (produceStackTrace && errorObj.stack) {
    error.stack += errorObj.stack;
  }
  return error;
};

/**
 * Try to register a function or AbortSignal.
 * @param arg - The argument to process.
 * @param context - The context containing object map, function registry, etc.
 * @returns The special descriptor object if the object is a function or AbortSignal, otherwise the original object.
 */
export const tryRegisterSpecialObject = (
  arg: any,
  context: {
    objectMap: Map<string, WeakRef<__SpecialObject>>,
    functionRegistry: Map<string, __TargetFunction>,
    fr: FinalizationRegistry<string>,
    logger: Logger,
    onSendMessage: (message: AmebaRpcMessage) => void | Promise<AmebaRpcMessage>
  }
): any => {
  const { objectMap, functionRegistry, fr, logger, onSendMessage } = context;

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
 * @param context - The context containing object map, function registry, etc.
 * @returns The stub function, AbortSignal, or original argument.
 */
export const tryRegisterStubObject = (
  arg: any,
  context: {
    objectMap: Map<string, WeakRef<__SpecialObject>>,
    functionRegistry: Map<string, __TargetFunction>,
    fr: FinalizationRegistry<string>,
    invoke: (functionId: string, ...args: any[]) => Promise<any>
  }
): any => {
  const { objectMap, functionRegistry, fr, invoke } = context;

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
};

/**
 * Handle function not found error.
 * @param functionId - The function ID that was not found.
 * @param messageId - The message ID.
 * @param waitableMode - Whether in waitable mode.
 * @param context - The context containing onSendMessage and logger.
 * @returns Error response for waitable mode or void.
 */
export const handleFunctionNotFound = (
  functionId: string,
  messageId: string,
  waitableMode: boolean,
  context: {
    onSendMessage: (message: AmebaRpcMessage) => void | Promise<AmebaRpcMessage>,
    logger: Logger
  }
): AmebaRpcMessage | void => {
  const { onSendMessage, logger } = context;
  
  if (waitableMode) {
    // Return error response
    return {
      kind: "error",
      messageId,
      error: new Error(`Function '${functionId}' is not found`)
    };
  } else {
    try {
      // Send error message to peer controller
      onSendMessage({
        kind: "error",
        messageId,
        error: new Error(`Function '${functionId}' is not found`)
      });
    } catch (error: unknown) {
      // Unknown sending to peer error
      logger.warn(`Failed sending error message to peer: messageId=${messageId}, functionId=${functionId}, error=${error}`);
    }
  }
};
