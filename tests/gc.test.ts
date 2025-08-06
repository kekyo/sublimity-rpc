import { describe, it, expect } from 'vitest';
import { createSublimityRpcController } from '../src/controller';
import { SublimityRpcMessage } from '../src/types';

describe('Garbage Collection Tests', () => {
  it('should warn on logger after GC collection of anonymous functions', async () => {
    let capturedLog2: string[] = [];
    const logger2 = {
      debug: message => {
        capturedLog2.push(message);
      },
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    // Create two controllers to simulate RPC communication
    // [test actor]        ==> controller1 --> controller2 ==> testFunction()
    // anonymousFunction() <== controller1 <-- controller2 <==/ (callback)
    const controller1 = createSublimityRpcController({
      onSendMessage: (message) => {
        // Forward message to controller2
        setTimeout(() => controller2.insertMessage(message), 0);
      }
    });

    const controller2 = createSublimityRpcController({
      onSendMessage: (message) => {
        // Forward message to controller1
        setTimeout(() => controller1.insertMessage(message), 0);
      },
      logger: logger2
    });

    // Register a function that accepts another function as parameter
    controller2.register('testFunction', async (callback: (a: number) => Promise<number>) => {
      // Call the callback function successfully
      const result = await callback(42);
      return result * 2;
    });

    // Create an anonymous function and call the registered function
    let anonymousFunction: ((a: number) => Promise<number>) | undefined = async (a: number) => {
      return a + 10;
    };

    // Call the function with the anonymous callback
    const result = await controller1.invoke('testFunction', anonymousFunction);
    expect(result).toBe(104); // (42 + 10) * 2

    // Clear the reference to the anonymous function
    anonymousFunction = undefined;

    // Force garbage collection (Node.js specific)
    if (global.gc) {
      // Run GC multiple times to ensure cleanup
      for (let i = 0; i < 5; i++) {
        global.gc();
        // Give some time for finalization registry to run
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    } else {
      // If gc is not available, create memory pressure to trigger GC
      const arrays: any[] = [];
      for (let i = 0; i < 10000; i++) {
        arrays.push(new Array(1000).fill(i));
      }
      arrays.length = 0;

      // Wait for potential GC
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    expect(capturedLog2).toHaveLength(1);
    expect(capturedLog2[0]).toContain("Function purged: functionId=");

    // Clean up
    controller1.release();
    controller2.release();
  });

  it('should fail spurious calls after GC collection of anonymous functions', async () => {
    let capturedFunctionId: string | undefined;
    let messageHistory: SublimityRpcMessage[] = [];

    // Create two controllers to simulate RPC communication
    // [test actor]        ==> controller1 --> controller2 ==> testFunction()
    // anonymousFunction() <== controller1 <-- controller2 <==/ (callback)
    const controller1 = createSublimityRpcController({
      onSendMessage: (message) => {
        messageHistory.push(message);
        // Forward message to controller2
        setTimeout(() => controller2.insertMessage(message), 0);
      }
    });

    const controller2 = createSublimityRpcController({
      onSendMessage: (message) => {
        messageHistory.push(message);
        // Forward message to controller1
        setTimeout(() => controller1.insertMessage(message), 0);
      }
    });

    // Register a function that accepts another function as parameter
    controller2.register('testFunction', async (callback: (a: number) => Promise<number>) => {
      // Capture the __srpcId of the callback function
      const fobj = callback as any;
      capturedFunctionId = fobj.__srpcId;

      // Call the callback function successfully
      const result = await callback(42);
      return result * 2;
    });

    // Create an anonymous function and call the registered function
    let anonymousFunction: ((a: number) => Promise<number>) | undefined = async (a: number) => {
      return a + 10;
    };

    // Call the function with the anonymous callback
    const result = await controller1.invoke('testFunction', anonymousFunction);
    expect(result).toBe(104); // (42 + 10) * 2
    expect(capturedFunctionId).toBeDefined();

    // Clear the reference to the anonymous function
    anonymousFunction = undefined;

    // Force garbage collection (Node.js specific)
    if (global.gc) {
      // Run GC multiple times to ensure cleanup
      for (let i = 0; i < 5; i++) {
        global.gc();
        // Give some time for finalization registry to run
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    } else {
      // If gc is not available, create memory pressure to trigger GC
      const arrays: any[] = [];
      for (let i = 0; i < 10000; i++) {
        arrays.push(new Array(1000).fill(i));
      }
      arrays.length = 0;

      // Wait for potential GC
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Now try to call the function directly with the captured function ID
    // This should fail because the anonymous function was garbage collected
    // Create a fake invoke message with the captured function ID
    const fakeInvokeMessage: SublimityRpcMessage = {
      kind: 'invoke',
      messageId: crypto.randomUUID(),
      functionId: capturedFunctionId!,
      args: [100]
    };

    // Insert the fake message directly
    controller2.insertMessage(fakeInvokeMessage);

    // Wait for the error message to be sent
    await new Promise(resolve => setTimeout(resolve, 50));

    // Check that an error message was sent indicating the function was not found
    const errorMessages = messageHistory.filter(msg => msg.kind === 'error');
    const lastErrorMessage = errorMessages[errorMessages.length - 1];

    expect(lastErrorMessage).toBeDefined();
    expect(lastErrorMessage.kind).toBe('error');
    if (lastErrorMessage.kind === 'error') {
      expect(lastErrorMessage.error.message).toContain('is not found');
    }

    // Clean up
    controller1.release();
    controller2.release();
  });
  
  it('should handle multiple anonymous functions and GC properly', async () => {
    let capturedFunctionIds: string[] = [];
    let messageHistory: SublimityRpcMessage[] = [];

    const controller1 = createSublimityRpcController({
      onSendMessage: (message) => {
        messageHistory.push(message);
        setTimeout(() => controller2.insertMessage(message), 0);
      }
    });

    const controller2 = createSublimityRpcController({
      onSendMessage: (message) => {
        messageHistory.push(message);
        setTimeout(() => controller1.insertMessage(message), 0);
      }
    });

    // Register a function that accepts multiple callback functions
    controller2.register('multiCallback', async (
      cb1: (x: number) => Promise<number>,
      cb2: (x: number) => Promise<number>
    ) => {
      // Capture function IDs
      capturedFunctionIds.push((cb1 as any).__srpcId);
      capturedFunctionIds.push((cb2 as any).__srpcId);

      const result1 = await cb1(10);
      const result2 = await cb2(20);
      return result1 + result2;
    });

    // Create multiple anonymous functions
    let func1: ((x: number) => Promise<number>) | null = async (x) => x * 2;
    let func2: ((x: number) => Promise<number>) | null = async (x) => x * 3;

    // Call with multiple callbacks
    const result = await controller1.invoke('multiCallback', func1, func2);
    expect(result).toBe(80); // (10 * 2) + (20 * 3)
    expect(capturedFunctionIds).toHaveLength(2);

    // Clear references
    func1 = null;
    func2 = null;

    // Force GC
    if (global.gc) {
      for (let i = 0; i < 5; i++) {
        global.gc();
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    } else {
      // Create memory pressure
      const arrays: any[] = [];
      for (let i = 0; i < 10000; i++) {
        arrays.push(new Array(1000).fill(i));
      }
      arrays.length = 0;
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Try to call with captured function IDs - both should fail
    for (const functionId of capturedFunctionIds) {
      const fakeMessage: SublimityRpcMessage = {
        kind: 'invoke',
        messageId: crypto.randomUUID(),
        functionId,
        args: [50],
      };

      controller2.insertMessage(fakeMessage);
    }

    // Wait for error messages
    await new Promise(resolve => setTimeout(resolve, 100));

    // Should have at least 2 error messages for the spurious calls
    const errorMessages = messageHistory.filter(msg => msg.kind === 'error');
    const spuriousErrors = errorMessages.filter(msg => 
      msg.kind === 'error' && msg.error.message.includes('is not found')
    );

    expect(spuriousErrors.length).toBeGreaterThanOrEqual(2);

    // Clean up
    controller1.release();
    controller2.release();
  });
});
