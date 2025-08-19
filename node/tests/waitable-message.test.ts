import { describe, it, expect } from 'vitest';
import { createAmebaRpcController } from '../src/controller';
import { AmebaRpcMessage } from '../src/types';

describe('Waitable message send-receive tests', () => {
  it('should handle successful synchronous RPC with return value', async () => {
    // Create sender controller with Promise-based onSendMessage
    const sender = createAmebaRpcController({
      onSendMessage: async (message: AmebaRpcMessage) => {
        // Directly process the message and return response
        const response = await receiver.insertMessageWaitable(message);
        return response;
      }
    });

    // Create receiver controller with traditional void onSendMessage
    const receiver = createAmebaRpcController({
      onSendMessage: (message: AmebaRpcMessage) => {
        // This shouldn't be called in sync mode
        throw new Error('Receiver should not send messages in this test');
      }
    });

    // Register a function that returns a value
    receiver.register('add', async (a: number, b: number) => {
      return a + b;
    });

    // Invoke the function - should get immediate response
    const result = await sender.invoke('add', 5, 3);
    
    // Verify the result
    expect(result).toBe(8);
  });

  it('should handle synchronous RPC with thrown exception', async () => {
    // Create sender controller with Promise-based onSendMessage
    const sender = createAmebaRpcController({
      produceStackTrace: true,
      onSendMessage: async (message: AmebaRpcMessage) => {
        // Directly process the message and return response
        const response = await receiver.insertMessageWaitable(message);
        return response;
      }
    });

    // Create receiver controller
    const receiver = createAmebaRpcController({
      produceStackTrace: true,
      onSendMessage: (message: AmebaRpcMessage) => {
        throw new Error('Receiver should not send messages in this test');
      }
    });

    // Register a function that throws an error
    receiver.register('divide', async (a: number, b: number) => {
      if (b === 0) {
        throw new Error('Division by zero');
      }
      return a / b;
    });

    // Invoke with valid parameters
    const result1 = await sender.invoke('divide', 10, 2);
    expect(result1).toBe(5);

    // Invoke with parameters that cause an error
    try {
      await sender.invoke('divide', 10, 0);
      throw new Error('Should have thrown an error');
    } catch (error: any) {
      expect(error.message).toBe('Division by zero');
      expect(error.name).toBe('Error');
      // Check if stack trace is included
      expect(error.stack).toContain('Remote stack trace');
    }
  });

  it('should handle synchronous RPC with one-way invocation', async () => {
    let receivedValue: number | undefined;
    
    // Create sender controller with Promise-based onSendMessage
    const sender = createAmebaRpcController({
      onSendMessage: async (message: AmebaRpcMessage) => {
        // Directly process the message and return response
        const response = await receiver.insertMessageWaitable(message);
        return response;
      }
    });

    // Create receiver controller
    const receiver = createAmebaRpcController({
      onSendMessage: (message: AmebaRpcMessage) => {
        throw new Error('Receiver should not send messages in this test');
      }
    });

    // Register a one-way function
    receiver.register('setValueOneWay', async (value: number) => {
      receivedValue = value;
    });

    // Invoke one-way - should not wait for result
    sender.invokeOneWay('setValueOneWay', 42);
    
    // Wait a bit to ensure the one-way function is executed
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // Verify the value was set
    expect(receivedValue).toBe(42);
  });

  it('should handle synchronous RPC with complex objects and functions', async () => {
    // Create sender controller with Promise-based onSendMessage
    const sender = createAmebaRpcController({
      onSendMessage: async (message: AmebaRpcMessage) => {
        const response = await receiver.insertMessageWaitable(message);
        return response;
      }
    });

    // Create receiver controller
    const receiver = createAmebaRpcController({
      onSendMessage: async (message: AmebaRpcMessage) => {
        const response = await sender.insertMessageWaitable(message);
        return response;
      }
    });

    // Register a function that accepts a callback
    receiver.register('processWithCallback', async (data: number[], callback: (result: number) => Promise<void>) => {
      const sum = data.reduce((acc, val) => acc + val, 0);
      await callback(sum);
      return sum * 2;
    });

    // Track callback invocations
    let callbackResult: number | undefined;
    
    // Invoke with a callback function
    const result = await sender.invoke('processWithCallback', 
      [1, 2, 3, 4, 5], 
      async (sum: number) => {
        callbackResult = sum;
      }
    );
    
    // Verify results
    expect(callbackResult).toBe(15); // Sum of [1, 2, 3, 4, 5]
    expect(result).toBe(30); // Sum * 2
  });

  it('should handle synchronous RPC when function is not found', async () => {
    // Create sender controller with Promise-based onSendMessage
    const sender = createAmebaRpcController({
      onSendMessage: async (message: AmebaRpcMessage) => {
        const response = await receiver.insertMessageWaitable(message);
        return response;
      }
    });

    // Create receiver controller (no functions registered)
    const receiver = createAmebaRpcController({
      onSendMessage: (message: AmebaRpcMessage) => {
        throw new Error('Receiver should not send messages in this test');
      }
    });

    // Try to invoke a non-existent function
    try {
      await sender.invoke('nonExistentFunction', 123);
      throw new Error('Should have thrown an error');
    } catch (error: any) {
      expect(error.message).toBe("Function 'nonExistentFunction' is not found");
    }
  });

  it('should handle mixed mode - sender with waitable receiver', async () => {
    // Track messages for verification
    const messageLog: string[] = [];
    
    // Create sender controller with Promise-based onSendMessage
    const sender = createAmebaRpcController({
      onSendMessage: (message: AmebaRpcMessage) => {
        messageLog.push(`sender -> receiver: ${message.kind}`);
        receiver.insertMessage(message);
      }
    });

    // Create receiver controller with traditional async mode
    const receiver = createAmebaRpcController({
      onSendMessage: async (message: AmebaRpcMessage) => {
        messageLog.push(`receiver -> sender (waitable): ${message.kind}`);
        const response = await sender.insertMessageWaitable(message);
        messageLog.push(`sender -> receiver (waitable): ${response.kind}`);
        return response;
      }
    });

    // Register functions on both sides
    receiver.register('receiverFunc', async (x: number, callback: (result: number) => Promise<number>) => {
      const doubled = await callback(x);
      return doubled + 10;
    });

    // Complex invocation: receiver calls back to sender
    const result = await sender.invoke('receiverFunc', 5, async (value: number) => {
      // This callback will be executed on receiver side, so it needs to invoke sender's function
      return value * 2; // Just return the doubled value directly since we're in the callback
    });
    
    // Verify result: 5 * 2 + 10 = 20
    expect(result).toBe(20);
    
    // Verify message flow
    expect(messageLog).toContain('sender -> receiver: invoke');
  });

  it('should handle mixed mode - waitable sender with receiver', async () => {
    // Track messages for verification
    const messageLog: string[] = [];
    
    // Create sender controller with Promise-based onSendMessage
    const sender = createAmebaRpcController({
      onSendMessage: async (message: AmebaRpcMessage) => {
        messageLog.push(`sender -> receiver (waitable): ${message.kind}`);
        const response = await receiver.insertMessageWaitable(message);
        messageLog.push(`receiver -> sender (waitable): ${response.kind}`);
        return response;
      }
    });

    // Create receiver controller with traditional async mode
    const receiver = createAmebaRpcController({
      onSendMessage: (message: AmebaRpcMessage) => {
        messageLog.push(`receiver -> sender: ${message.kind}`);
        sender.insertMessage(message);
      }
    });

    // Register functions on both sides
    receiver.register('receiverFunc', async (x: number, callback: (result: number) => Promise<number>) => {
      const doubled = await callback(x);
      return doubled + 10;
    });

    // Complex invocation: receiver calls back to sender
    const result = await sender.invoke('receiverFunc', 5, async (value: number) => {
      // This callback will be executed on receiver side, so it needs to invoke sender's function
      return value * 2; // Just return the doubled value directly since we're in the callback
    });
    
    // Verify result: 5 * 2 + 10 = 20
    expect(result).toBe(20);
    
    // Verify message flow
    expect(messageLog).toContain('sender -> receiver (waitable): invoke');
  });
});
