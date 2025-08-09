// Sublimity pure RPC engine - Concurrent stress test
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, test, expect } from "vitest";
import { createSublimityRpcController } from "../src/controller";
import { SublimityRpcMessage } from "../src/types";
import { delay } from "async-primitives";

describe("Concurrent Bidirectional RPC Stress Tests", () => {
  const getDelayTime = () =>
    Math.floor(Math.random() * 11) + 10;

  test("should handle 1000 concurrent bidirectional RPC calls with random delays", async () => {
    // Counters for tracking function calls
    let count1 = 0;
    let count2 = 0;

    // Create controller 1
    const controller1 = createSublimityRpcController({
      controllerId: "controller1",
      onSendMessage: (message: SublimityRpcMessage) => {
        // Random delay between 10-20ms
        const delay = getDelayTime();
        setTimeout(() => {
          try {
            controller2.insertMessage(message);
          } catch (error) {
            console.error("Controller1 failed to send message:", error);
          }
        }, delay);
      }
    });

    // Create controller 2
    const controller2 = createSublimityRpcController({
      controllerId: "controller2",
      onSendMessage: (message: SublimityRpcMessage) => {
        // Random delay between 10-20ms
        const delay = getDelayTime();
        setTimeout(() => {
          try {
            controller1.insertMessage(message);
          } catch (error) {
            console.error("Controller2 failed to send message:", error);
          }
        }, delay);
      }
    });

    // Register function in controller1
    controller1.register("incrementCounter1", async () => {
      await delay(getDelayTime());
      count1++;
      return count1;
    });

    // Register function in controller2
    controller2.register("incrementCounter2", async () => {
      await delay(getDelayTime());
      count2++;
      return count2;
    });

    // Function to create delayed calls
    const createDelayedCalls = async (
      controller: typeof controller1,
      functionId: string,
      count: number
    ): Promise<void> => {
      const promises: Promise<any>[] = [];
      
      for (let i = 0; i < count; i++) {
        // Random delay between 10-20ms for each call
        const delay = getDelayTime();
        
        const promise = new Promise<void>((resolve) => {
          setTimeout(async () => {
            try {
              await controller.invoke(functionId);
              resolve();
            } catch (error) {
              console.error(`Failed to invoke ${functionId}:`, error);
              resolve(); // Continue even on error
            }
          }, delay * i / 50); // Spread calls over time to avoid overwhelming
        });
        
        promises.push(promise);
      }
      
      await Promise.all(promises);
    };

    // Execute 1000 calls from controller1 to controller2's function
    // and 1000 calls from controller2 to controller1's function
    const startTime = Date.now();
    
    await Promise.all([
      createDelayedCalls(controller1, "incrementCounter2", 1000),
      createDelayedCalls(controller2, "incrementCounter1", 1000)
    ]);

    const elapsed = Date.now() - startTime;
    console.log(`Test completed in ${elapsed}ms`);

    // Verify counters
    expect(count1).toBe(1000);
    expect(count2).toBe(1000);

    // Clean up
    controller1.release();
    controller2.release();
  }, 60000); // 60 second timeout for this stress test

  test("should handle concurrent calls with mixed success and failure", async () => {
    let successCount1 = 0;
    let successCount2 = 0;
    let errorCount = 0;

    // Create controller 1
    const controller1 = createSublimityRpcController({
      controllerId: "controller1-mixed",
      onSendMessage: (message: SublimityRpcMessage) => {
        const delay = getDelayTime();
        setTimeout(() => {
          controller2.insertMessage(message);
        }, delay);
      }
    });

    // Create controller 2  
    const controller2 = createSublimityRpcController({
      controllerId: "controller2-mixed",
      onSendMessage: (message: SublimityRpcMessage) => {
        const delay = getDelayTime();
        setTimeout(() => {
          controller1.insertMessage(message);
        }, delay);
      }
    });

    // Register function that sometimes fails in controller1
    controller1.register("maybeIncrement1", async () => {
      await delay(getDelayTime());
      // Randomly fail 10% of the time
      if (Math.random() < 0.1) {
        throw new Error("Random failure in controller1");
      }
      successCount1++;
      return successCount1;
    });

    // Register function that sometimes fails in controller2
    controller2.register("maybeIncrement2", async () => {
      await delay(getDelayTime());
      // Randomly fail 10% of the time
      if (Math.random() < 0.1) {
        throw new Error("Random failure in controller2");
      }
      successCount2++;
      return successCount2;
    });

    // Execute calls with error handling
    const executeCallsWithErrors = async (
      controller: typeof controller1,
      functionId: string,
      count: number
    ): Promise<number> => {
      let localErrorCount = 0;
      const promises: Promise<void>[] = [];
      
      for (let i = 0; i < count; i++) {
        const delay = Math.floor(Math.random() * 11) + 10;
        
        const promise = new Promise<void>((resolve) => {
          setTimeout(async () => {
            try {
              await controller.invoke(functionId);
            } catch (error) {
              localErrorCount++;
            }
            resolve();
          }, delay * i / 100);
        });
        
        promises.push(promise);
      }
      
      await Promise.all(promises);
      return localErrorCount;
    };

    // Execute 500 calls each direction
    const [errors1, errors2] = await Promise.all([
      executeCallsWithErrors(controller1, "maybeIncrement2", 500),
      executeCallsWithErrors(controller2, "maybeIncrement1", 500)
    ]);

    errorCount = errors1 + errors2;

    // Verify results - we expect approximately 10% failures
    expect(successCount1 + successCount2 + errorCount).toBe(1000);
    expect(errorCount).toBeGreaterThan(50); // At least 5% errors
    expect(errorCount).toBeLessThan(150); // At most 15% errors
    
    console.log(`Success: controller1=${successCount1}, controller2=${successCount2}, errors=${errorCount}`);

    // Clean up
    controller1.release();
    controller2.release();
  }, 30000); // 30 second timeout

  test("should maintain order of sequential calls despite random delays", async () => {
    let results1: number[] = [];
    let results2: number[] = [];

    // Create controllers with tracking
    const controller1 = createSublimityRpcController({
      controllerId: "controller1-seq",
      onSendMessage: (message: SublimityRpcMessage) => {
        const delay = getDelayTime();
        setTimeout(() => {
          controller2.insertMessage(message);
        }, delay);
      }
    });

    const controller2 = createSublimityRpcController({
      controllerId: "controller2-seq",
      onSendMessage: (message: SublimityRpcMessage) => {
        const delay = getDelayTime();
        setTimeout(() => {
          controller1.insertMessage(message);
        }, delay);
      }
    });

    // Register functions that return sequence numbers
    let sequence1 = 0;
    controller1.register("getSequence1", async () => {
      await delay(getDelayTime());
      return ++sequence1;
    });

    let sequence2 = 0;
    controller2.register("getSequence2", async () => {
      await delay(getDelayTime());
      return ++sequence2;
    });

    // Execute sequential calls and collect results
    const executeSequentialCalls = async (
      controller: typeof controller1,
      functionId: string,
      count: number
    ): Promise<number[]> => {
      const localResults: number[] = [];
      
      for (let i = 0; i < count; i++) {
        try {
          const result = await controller.invoke<number, []>(functionId);
          localResults.push(result);
        } catch (error) {
          console.error(`Failed to invoke ${functionId}:`, error);
          localResults.push(-1); // Mark as error
        }
      }
      
      return localResults;
    };

    // Execute 100 sequential calls in each direction
    [results1, results2] = await Promise.all([
      executeSequentialCalls(controller1, "getSequence2", 100),
      executeSequentialCalls(controller2, "getSequence1", 100)
    ]);

    // Verify that results are in sequence (1, 2, 3, ...)
    for (let i = 0; i < 100; i++) {
      expect(results1[i]).toBe(i + 1);
      expect(results2[i]).toBe(i + 1);
    }

    // Clean up
    controller1.release();
    controller2.release();
  }, 30000); // 30 second timeout

  ////////////////////////////////////////////////////////////////////////////

  test("should handle 1000 concurrent bidirectional RPC calls with random delays (synch)", async () => {
    // Counters for tracking function calls
    let count1 = 0;
    let count2 = 0;

    // Create controller 1
    const controller1 = createSublimityRpcController({
      controllerId: "controller1",
      onSendMessage: async (message: SublimityRpcMessage) => {
        // Random delay between 10-20ms
        await delay(getDelayTime());
        try {
          return await controller2.insertMessageWaitable(message);
        } catch (error: any) {
          console.error("Controller1 failed to send message:", error);
          throw error;
        }
      }
    });

    // Create controller 2
    const controller2 = createSublimityRpcController({
      controllerId: "controller2",
      onSendMessage: async (message: SublimityRpcMessage) => {
        // Random delay between 10-20ms
        await delay(getDelayTime());
        try {
          return await controller1.insertMessageWaitable(message);
        } catch (error: any) {
          console.error("Controller2 failed to send message:", error);
          throw error;
        }
      }
    });

    // Register function in controller1
    controller1.register("incrementCounter1", async () => {
      await delay(getDelayTime());
      count1++;
      return count1;
    });

    // Register function in controller2
    controller2.register("incrementCounter2", async () => {
      await delay(getDelayTime());
      count2++;
      return count2;
    });

    // Function to create delayed calls
    const createDelayedCalls = async (
      controller: typeof controller1,
      functionId: string,
      count: number
    ): Promise<void> => {
      const promises: Promise<any>[] = [];
      
      for (let i = 0; i < count; i++) {
        // Random delay between 10-20ms for each call
        const delay = getDelayTime();
        
        const promise = new Promise<void>((resolve) => {
          setTimeout(async () => {
            try {
              await controller.invoke(functionId);
              resolve();
            } catch (error) {
              console.error(`Failed to invoke ${functionId}:`, error);
              resolve(); // Continue even on error
            }
          }, delay * i / 50); // Spread calls over time to avoid overwhelming
        });
        
        promises.push(promise);
      }
      
      await Promise.all(promises);
    };

    // Execute 1000 calls from controller1 to controller2's function
    // and 1000 calls from controller2 to controller1's function
    const startTime = Date.now();
    
    await Promise.all([
      createDelayedCalls(controller1, "incrementCounter2", 1000),
      createDelayedCalls(controller2, "incrementCounter1", 1000)
    ]);

    const elapsed = Date.now() - startTime;
    console.log(`Test completed in ${elapsed}ms`);

    // Verify counters
    expect(count1).toBe(1000);
    expect(count2).toBe(1000);

    // Clean up
    controller1.release();
    controller2.release();
  }, 60000); // 60 second timeout for this stress test

  test("should handle concurrent calls with mixed success and failure (synch)", async () => {
    let successCount1 = 0;
    let successCount2 = 0;
    let errorCount = 0;

    // Create controller 1
    const controller1 = createSublimityRpcController({
      controllerId: "controller1-mixed",
      onSendMessage: async (message: SublimityRpcMessage) => {
        await delay(getDelayTime());
        return await controller2.insertMessageWaitable(message);
      }
    });

    // Create controller 2  
    const controller2 = createSublimityRpcController({
      controllerId: "controller2-mixed",
      onSendMessage: async (message: SublimityRpcMessage) => {
        await delay(getDelayTime());
        return await controller1.insertMessageWaitable(message);
      }
    });

    // Register function that sometimes fails in controller1
    controller1.register("maybeIncrement1", async () => {
      await delay(getDelayTime());
      // Randomly fail 10% of the time
      if (Math.random() < 0.1) {
        throw new Error("Random failure in controller1");
      }
      successCount1++;
      return successCount1;
    });

    // Register function that sometimes fails in controller2
    controller2.register("maybeIncrement2", async () => {
      await delay(getDelayTime());
      // Randomly fail 10% of the time
      if (Math.random() < 0.1) {
        throw new Error("Random failure in controller2");
      }
      successCount2++;
      return successCount2;
    });

    // Execute calls with error handling
    const executeCallsWithErrors = async (
      controller: typeof controller1,
      functionId: string,
      count: number
    ): Promise<number> => {
      let localErrorCount = 0;
      const promises: Promise<void>[] = [];
      
      for (let i = 0; i < count; i++) {
        const delay = Math.floor(Math.random() * 11) + 10;
        
        const promise = new Promise<void>((resolve) => {
          setTimeout(async () => {
            try {
              await controller.invoke(functionId);
            } catch (error) {
              localErrorCount++;
            }
            resolve();
          }, delay * i / 100);
        });
        
        promises.push(promise);
      }
      
      await Promise.all(promises);
      return localErrorCount;
    };

    // Execute 500 calls each direction
    const [errors1, errors2] = await Promise.all([
      executeCallsWithErrors(controller1, "maybeIncrement2", 500),
      executeCallsWithErrors(controller2, "maybeIncrement1", 500)
    ]);

    errorCount = errors1 + errors2;

    // Verify results - we expect approximately 10% failures
    expect(successCount1 + successCount2 + errorCount).toBe(1000);
    expect(errorCount).toBeGreaterThan(50); // At least 5% errors
    expect(errorCount).toBeLessThan(150); // At most 15% errors
    
    console.log(`Success: controller1=${successCount1}, controller2=${successCount2}, errors=${errorCount}`);

    // Clean up
    controller1.release();
    controller2.release();
  }, 30000); // 30 second timeout

  test("should maintain order of sequential calls despite random delays (synch)", async () => {
    let results1: number[] = [];
    let results2: number[] = [];

    // Create controllers with tracking
    const controller1 = createSublimityRpcController({
      controllerId: "controller1-seq",
      onSendMessage: async (message: SublimityRpcMessage) => {
        await delay(getDelayTime());
        return await controller2.insertMessageWaitable(message);
      }
    });

    const controller2 = createSublimityRpcController({
      controllerId: "controller2-seq",
      onSendMessage: async (message: SublimityRpcMessage) => {
        await delay(getDelayTime());
        return await controller1.insertMessageWaitable(message);
      }
    });

    // Register functions that return sequence numbers
    let sequence1 = 0;
    controller1.register("getSequence1", async () => {
      await delay(getDelayTime());
      return ++sequence1;
    });

    let sequence2 = 0;
    controller2.register("getSequence2", async () => {
      await delay(getDelayTime());
      return ++sequence2;
    });

    // Execute sequential calls and collect results
    const executeSequentialCalls = async (
      controller: typeof controller1,
      functionId: string,
      count: number
    ): Promise<number[]> => {
      const localResults: number[] = [];
      
      for (let i = 0; i < count; i++) {
        try {
          const result = await controller.invoke<number, []>(functionId);
          localResults.push(result);
        } catch (error) {
          console.error(`Failed to invoke ${functionId}:`, error);
          localResults.push(-1); // Mark as error
        }
      }
      
      return localResults;
    };

    // Execute 100 sequential calls in each direction
    [results1, results2] = await Promise.all([
      executeSequentialCalls(controller1, "getSequence2", 100),
      executeSequentialCalls(controller2, "getSequence1", 100)
    ]);

    // Verify that results are in sequence (1, 2, 3, ...)
    for (let i = 0; i < 100; i++) {
      expect(results1[i]).toBe(i + 1);
      expect(results2[i]).toBe(i + 1);
    }

    // Clean up
    controller1.release();
    controller2.release();
  }, 30000); // 30 second timeout
});
