import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAmebaRpcController } from '../src/controller';
import type { AmebaRpcMessage } from '../src/types';

describe('AbortSignal Tests', () => {
  let controller1: any;
  let controller2: any;
  let messageHistory: AmebaRpcMessage[] = [];

  beforeEach(() => {
    messageHistory = [];

    // Create first controller
    controller1 = createAmebaRpcController({
      controllerId: 'controller1',
      onSendMessage: (message: AmebaRpcMessage) => {
        messageHistory.push(message);
        // Forward message to controller2
        setTimeout(() => controller2.insertMessage(message), 0);
      }
    });

    // Create second controller
    controller2 = createAmebaRpcController({
      controllerId: 'controller2',
      onSendMessage: (message: AmebaRpcMessage) => {
        messageHistory.push(message);
        // Forward message to controller1
        setTimeout(() => controller1.insertMessage(message), 0);
      }
    });
  });

  afterEach(() => {
    controller1?.release();
    controller2?.release();
  });

  it('should handle AbortSignal as single argument - no abort case', async () => {
    let receivedSignal: AbortSignal | null = null;
    let isAborted = false;

    // Register a function that accepts AbortSignal
    controller2.register('testAbortSingleNoAbort', async (signal: AbortSignal) => {
      receivedSignal = signal;
      
      // Listen for abort event
      signal.addEventListener('abort', () => {
        isAborted = true;
      });

      return 'received-signal';
    });

    // Create AbortController and call the function
    const abortController = new AbortController();
    const result = await controller1.invoke('testAbortSingleNoAbort', abortController.signal);

    expect(result).toBe('received-signal');
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal?.aborted).toBe(false);
    expect(isAborted).toBe(false);
  });

  it('should handle AbortSignal as single argument - with abort propagation', async () => {
    let receivedSignal: AbortSignal | null = null;
    let isAborted = false;

    // Register a function that accepts AbortSignal
    controller2.register('testAbortSingleWithAbort', async (signal: AbortSignal) => {
      receivedSignal = signal;
      
      // Listen for abort event
      signal.addEventListener('abort', () => {
        isAborted = true;
      });

      return 'received-signal';
    });

    // Create AbortController and call the function
    const abortController = new AbortController();
    const result = await controller1.invoke('testAbortSingleWithAbort', abortController.signal);

    expect(result).toBe('received-signal');
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal?.aborted).toBe(false);
    expect(isAborted).toBe(false);

    // Test abort functionality - abort from original controller should propagate
    abortController.abort();

    // Wait for abort event to propagate
    await new Promise(resolve => setTimeout(resolve, 50));
    
    expect(isAborted).toBe(true);
    expect(receivedSignal?.aborted).toBe(true);
  });

  it('should handle multiple AbortSignals as arguments - no abort case', async () => {
    let receivedSignals: AbortSignal[] = [];
    let abortedCount = 0;

    // Register a function that accepts two AbortSignals
    controller2.register('testAbortMultipleNoAbort', async (signal1: AbortSignal, signal2: AbortSignal) => {
      receivedSignals = [signal1, signal2];
      
      // Listen for abort events
      signal1.addEventListener('abort', () => {
        abortedCount++;
      });
      
      signal2.addEventListener('abort', () => {
        abortedCount++;
      });

      return 'received-two-signals';
    });

    // Create two AbortControllers and call the function
    const abortController1 = new AbortController();
    const abortController2 = new AbortController();
    
    const result = await controller1.invoke('testAbortMultipleNoAbort', 
      abortController1.signal, abortController2.signal);

    expect(result).toBe('received-two-signals');
    expect(receivedSignals).toHaveLength(2);
    expect(receivedSignals[0]).toBeInstanceOf(AbortSignal);
    expect(receivedSignals[1]).toBeInstanceOf(AbortSignal);
    expect(receivedSignals[0].aborted).toBe(false);
    expect(receivedSignals[1].aborted).toBe(false);
    expect(abortedCount).toBe(0);
  });

  it('should handle multiple AbortSignals as arguments - with abort propagation', async () => {
    let receivedSignals: AbortSignal[] = [];
    let abortedCount = 0;

    // Register a function that accepts two AbortSignals
    controller2.register('testAbortMultipleWithAbort', async (signal1: AbortSignal, signal2: AbortSignal) => {
      receivedSignals = [signal1, signal2];
      
      // Listen for abort events
      signal1.addEventListener('abort', () => {
        abortedCount++;
      });
      
      signal2.addEventListener('abort', () => {
        abortedCount++;
      });

      return 'received-two-signals';
    });

    // Create two AbortControllers and call the function
    const abortController1 = new AbortController();
    const abortController2 = new AbortController();
    
    const result = await controller1.invoke('testAbortMultipleWithAbort', 
      abortController1.signal, abortController2.signal);

    expect(result).toBe('received-two-signals');
    expect(receivedSignals).toHaveLength(2);
    expect(receivedSignals[0]).toBeInstanceOf(AbortSignal);
    expect(receivedSignals[1]).toBeInstanceOf(AbortSignal);
    expect(abortedCount).toBe(0);

    // Test abort functionality for first signal
    abortController1.abort();
    await new Promise(resolve => setTimeout(resolve, 50));
    
    expect(abortedCount).toBe(1);
    expect(receivedSignals[0].aborted).toBe(true);
    expect(receivedSignals[1].aborted).toBe(false);

    // Test abort functionality for second signal
    abortController2.abort();
    await new Promise(resolve => setTimeout(resolve, 50));
    
    expect(abortedCount).toBe(2);
    expect(receivedSignals[1].aborted).toBe(true);
  });

  it('should handle AbortSignal as return value - no abort case', async () => {
    let returnedAbortController: AbortController;

    // Register a function that returns AbortSignal
    controller2.register('testAbortReturnNoAbort', async () => {
      returnedAbortController = new AbortController();
      return returnedAbortController.signal;
    });

    // Call the function
    const result = await controller1.invoke('testAbortReturnNoAbort');

    expect(result).toBeInstanceOf(AbortSignal);
    expect(result.aborted).toBe(false);

    // Verify no abort state initially
    let isAborted = false;
    result.addEventListener('abort', () => {
      isAborted = true;
    });

    expect(isAborted).toBe(false);
  });

  it('should handle AbortSignal as return value - with abort propagation', async () => {
    let returnedAbortController: AbortController;

    // Register a function that returns AbortSignal
    controller2.register('testAbortReturnWithAbort', async () => {
      returnedAbortController = new AbortController();
      return returnedAbortController.signal;
    });

    // Call the function
    const result = await controller1.invoke('testAbortReturnWithAbort');

    expect(result).toBeInstanceOf(AbortSignal);
    expect(result.aborted).toBe(false);

    // Test that the returned signal responds to abort
    let isAborted = false;
    result.addEventListener('abort', () => {
      isAborted = true;
    });

    // Abort from the original controller
    returnedAbortController.abort();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(isAborted).toBe(true);
    expect(result.aborted).toBe(true);
  });

  it('should handle mixed arguments with AbortSignal and other types - no abort case', async () => {
    let receivedArgs: any[] = [];

    // Register a function that accepts mixed arguments
    controller2.register('testMixedNoAbort', async (num: number, signal: AbortSignal, str: string) => {
      receivedArgs = [num, signal, str];
      return 'mixed-args-received';
    });

    // Create AbortController and call with mixed arguments
    const abortController = new AbortController();
    const result = await controller1.invoke('testMixedNoAbort', 42, abortController.signal, 'test');

    expect(result).toBe('mixed-args-received');
    expect(receivedArgs).toHaveLength(3);
    expect(receivedArgs[0]).toBe(42);
    expect(receivedArgs[1]).toBeInstanceOf(AbortSignal);
    expect(receivedArgs[2]).toBe('test');
    expect(receivedArgs[1].aborted).toBe(false);
  });

  it('should handle mixed arguments with AbortSignal and other types - with abort propagation', async () => {
    let receivedArgs: any[] = [];

    // Register a function that accepts mixed arguments
    controller2.register('testMixedWithAbort', async (num: number, signal: AbortSignal, str: string) => {
      receivedArgs = [num, signal, str];
      return 'mixed-args-received';
    });

    // Create AbortController and call with mixed arguments
    const abortController = new AbortController();
    const result = await controller1.invoke('testMixedWithAbort', 42, abortController.signal, 'test');

    expect(result).toBe('mixed-args-received');
    expect(receivedArgs).toHaveLength(3);
    expect(receivedArgs[0]).toBe(42);
    expect(receivedArgs[1]).toBeInstanceOf(AbortSignal);
    expect(receivedArgs[2]).toBe('test');

    // Test abort functionality
    let isAborted = false;
    receivedArgs[1].addEventListener('abort', () => {
      isAborted = true;
    });

    abortController.abort();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(isAborted).toBe(true);
    expect(receivedArgs[1].aborted).toBe(true);
  });

  it('should handle same AbortSignal instance in multiple arguments - object reference test', async () => {
    let receivedArgs: any[] = [];

    // Register a function that accepts the same AbortSignal in multiple positions
    controller2.register('testSameAbortSignalRef', async (signal1: AbortSignal, signal2: AbortSignal, signal3: AbortSignal) => {
      receivedArgs = [signal1, signal2, signal3];
      return 'same-signal-received';
    });

    // Create single AbortController and pass the same signal to multiple arguments
    const abortController = new AbortController();
    const signal = abortController.signal;
    
    const result = await controller1.invoke('testSameAbortSignalRef', signal, signal, signal);

    expect(result).toBe('same-signal-received');
    expect(receivedArgs).toHaveLength(3);
    
    // Verify all three arguments are AbortSignal instances
    expect(receivedArgs[0]).toBeInstanceOf(AbortSignal);
    expect(receivedArgs[1]).toBeInstanceOf(AbortSignal);
    expect(receivedArgs[2]).toBeInstanceOf(AbortSignal);
    
    // CRITICAL: Verify that all three arguments are the SAME object instance
    expect(receivedArgs[0]).toBe(receivedArgs[1]);
    expect(receivedArgs[1]).toBe(receivedArgs[2]);
    expect(receivedArgs[0]).toBe(receivedArgs[2]);
    
    // Verify all signals have the same aborted state
    expect(receivedArgs[0].aborted).toBe(false);
    expect(receivedArgs[1].aborted).toBe(false);
    expect(receivedArgs[2].aborted).toBe(false);
  });

  it('should handle same AbortSignal instance in multiple arguments - with abort propagation', async () => {
    let receivedArgs: any[] = [];
    let abortEventCount = 0;

    // Register a function that accepts the same AbortSignal in multiple positions
    controller2.register('testSameAbortSignalAbort', async (signal1: AbortSignal, signal2: AbortSignal, signal3: AbortSignal) => {
      receivedArgs = [signal1, signal2, signal3];
      
      // Listen for abort events on each argument
      signal1.addEventListener('abort', () => {
        abortEventCount++;
      });
      
      signal2.addEventListener('abort', () => {
        abortEventCount++;
      });
      
      signal3.addEventListener('abort', () => {
        abortEventCount++;
      });

      return 'same-signal-received';
    });

    // Create single AbortController and pass the same signal to multiple arguments
    const abortController = new AbortController();
    const signal = abortController.signal;
    
    const result = await controller1.invoke('testSameAbortSignalAbort', signal, signal, signal);

    expect(result).toBe('same-signal-received');
    expect(receivedArgs).toHaveLength(3);
    
    // CRITICAL: Verify that all three arguments are the SAME object instance
    expect(receivedArgs[0]).toBe(receivedArgs[1]);
    expect(receivedArgs[1]).toBe(receivedArgs[2]);
    expect(receivedArgs[0]).toBe(receivedArgs[2]);

    // Test abort functionality - should only fire once per unique signal
    abortController.abort();
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Since it's the same object instance, each addEventListener should fire
    // but we're testing the same signal, so abort event should fire for each listener
    expect(abortEventCount).toBe(3); // 3 listeners on the same signal
    
    // Verify all signals show aborted state (they're the same object)
    expect(receivedArgs[0].aborted).toBe(true);
    expect(receivedArgs[1].aborted).toBe(true);
    expect(receivedArgs[2].aborted).toBe(true);
  });

  it('should handle mixed same and different AbortSignals', async () => {
    let receivedArgs: any[] = [];
    let signal1AbortCount = 0;
    let signal2AbortCount = 0;

    // Register a function that accepts mixed AbortSignals
    controller2.register('testMixedSameAndDifferent', async (
      signal1: AbortSignal, 
      signal2: AbortSignal, 
      signal1Again: AbortSignal, 
      signal2Again: AbortSignal
    ) => {
      receivedArgs = [signal1, signal2, signal1Again, signal2Again];
      
      // Listen for abort events
      signal1.addEventListener('abort', () => signal1AbortCount++);
      signal2.addEventListener('abort', () => signal2AbortCount++);
      signal1Again.addEventListener('abort', () => signal1AbortCount++);
      signal2Again.addEventListener('abort', () => signal2AbortCount++);

      return 'mixed-signals-received';
    });

    // Create two different AbortControllers
    const abortController1 = new AbortController();
    const abortController2 = new AbortController();
    
    const result = await controller1.invoke('testMixedSameAndDifferent', 
      abortController1.signal, 
      abortController2.signal, 
      abortController1.signal,  // Same as first
      abortController2.signal   // Same as second
    );

    expect(result).toBe('mixed-signals-received');
    expect(receivedArgs).toHaveLength(4);
    
    // Verify object instance relationships
    expect(receivedArgs[0]).toBe(receivedArgs[2]); // signal1 === signal1Again
    expect(receivedArgs[1]).toBe(receivedArgs[3]); // signal2 === signal2Again
    expect(receivedArgs[0]).not.toBe(receivedArgs[1]); // signal1 !== signal2
    expect(receivedArgs[2]).not.toBe(receivedArgs[3]); // signal1Again !== signal2Again

    // Test abort functionality for first signal
    abortController1.abort();
    await new Promise(resolve => setTimeout(resolve, 50));
    
    expect(signal1AbortCount).toBe(2); // Two listeners on the same signal
    expect(signal2AbortCount).toBe(0);
    expect(receivedArgs[0].aborted).toBe(true);
    expect(receivedArgs[2].aborted).toBe(true);
    expect(receivedArgs[1].aborted).toBe(false);
    expect(receivedArgs[3].aborted).toBe(false);

    // Test abort functionality for second signal
    abortController2.abort();
    await new Promise(resolve => setTimeout(resolve, 50));
    
    expect(signal1AbortCount).toBe(2); // No change
    expect(signal2AbortCount).toBe(2); // Two listeners on the same signal
    expect(receivedArgs[1].aborted).toBe(true);
    expect(receivedArgs[3].aborted).toBe(true);
  });
});