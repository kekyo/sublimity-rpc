import { describe, it, expect } from 'vitest';
import { createSublimityRpcController, createConsoleLogger } from '../src/index';

describe('Controller tests', () => {
  it('overall full-duplex test', async () => {
    const sender = createSublimityRpcController({
      onSendMessage: message => { receiver.insertMessage(message); }
    });

    const receiver = createSublimityRpcController({
      logger: createConsoleLogger(),
      onSendMessage: message => { sender.insertMessage(message); }
    });

    const disposer1 = receiver.register('add', async (a: number, b: number) => a + b);
    expect(disposer1).toBeDefined();

    const disposer2 = sender.register('add', async (a: string, b: string) => a + b);
    expect(disposer2).toBeDefined();

    const result1 = await sender.invoke('add', 1, 2);
    expect(result1).toBe(3);

    const result2 = await receiver.invoke('add', "1", "2");
    expect(result2).toBe("12");

    disposer1.release();
    disposer2.release();

    sender.release();
    receiver.release();
  });

  it('function is not found', async () => {
    const sender = createSublimityRpcController({
      onSendMessage: message => { receiver.insertMessage(message); },
      produceStackTrace: true
    });

    const receiver = createSublimityRpcController({
      onSendMessage: message => { sender.insertMessage(message); },
      produceStackTrace: true
    });

    try {
      await sender.invoke('add', 1, 2);
      expect(false).toBe(true);  // Fail assertion
    } catch (error) {
      expect(error.name).toBe('Error');
      expect(error.message).toBe("Function 'add' is not found");
    }

    sender.release();
    receiver.release();
  });

  it('standard error handling', async () => {
    const sender = createSublimityRpcController({
      onSendMessage: message => { receiver.insertMessage(message); },
      produceStackTrace: true
    });

    const receiver = createSublimityRpcController({
      onSendMessage: message => { sender.insertMessage(message); },
      produceStackTrace: true
    });

    const disposer = receiver.register(
      'add',
      (a: number, b: number) => new Promise((_, __) => { throw new Error('test'); }));

    try {
      await sender.invoke('add', 1, 2);
      expect(false).toBe(true);  // Fail assertion
    } catch (error) {
      expect(error.name).toBe('Error');
      expect(error.message).toBe('test');
    }

    disposer.release();
    sender.release();
    receiver.release();
  });

  it('unnormal error handling', async () => {
    const sender = createSublimityRpcController({
      onSendMessage: message => { receiver.insertMessage(message); },
      produceStackTrace: true
    });

    const receiver = createSublimityRpcController({
      onSendMessage: message => { sender.insertMessage(message); },
      produceStackTrace: true
    });

    const disposer = receiver.register(
      'add',
      (a: number, b: number) => new Promise((_, __) => { throw 'test'; }));

    try {
      await sender.invoke('add', 1, 2);
      expect(false).toBe(true);  // Fail assertion
    } catch (error) {
      expect(error.name).toBe('String');
      expect(error.message).toBe('test');
    }

    disposer.release();
    sender.release();
    receiver.release();
  });

  it('Promise wrapped error handling', async () => {
    const sender = createSublimityRpcController({
      onSendMessage: message => { receiver.insertMessage(message); },
      produceStackTrace: true
    });

    const receiver = createSublimityRpcController({
      onSendMessage: message => { sender.insertMessage(message); },
      produceStackTrace: true
    });

    const disposer = receiver.register(
      'add',
      (a: number, b: number) => new Promise((_, reject) => reject(new Error('test'))));

    try {
      await sender.invoke('add', 1, 2);
      expect(false).toBe(true);  // Fail assertion
    } catch (error) {
      expect(error.name).toBe('Error');
      expect(error.message).toBe('test');
    }

    disposer.release();
    sender.release();
    receiver.release();
  });

  it('an anonymous function', async () => {
    const sender = createSublimityRpcController({
      onSendMessage: message => { receiver.insertMessage(message); }
    });

    const receiver = createSublimityRpcController({
      onSendMessage: message => { sender.insertMessage(message); }
    });

    const disposer = receiver.register(
      'callOne',
      async (f: (a: number) => Promise<number>) => {
        return await f(1);
      }
    );

    const result = await sender.invoke(
      'callOne',
      async (a: number) => a + 5);
    expect(result).toBe(6);

    disposer.release();
    sender.release();
    receiver.release();
  });

  it('anonymous functions', async () => {
    const sender = createSublimityRpcController({
      onSendMessage: message => { receiver.insertMessage(message); }
    });

    const receiver = createSublimityRpcController({
      onSendMessage: message => { sender.insertMessage(message); }
    });

    const disposer = receiver.register(
      'callTwo',
      async (fa: (a: number) => Promise<number>, fb: (a: number) => Promise<number>) => {
        return await fa(1) + await fb(2);
      }
    );

    const result = await sender.invoke(
      'callTwo',
      async (a: number) => a + 5,
      async (a: number) => a * 3);
    expect(result).toBe(12);

    disposer.release();
    sender.release();
    receiver.release();
  });

  it('duplex anonymous function invocation', async () => {
    const sender = createSublimityRpcController({
      onSendMessage: message => { receiver.insertMessage(message); }
    });

    const receiver = createSublimityRpcController({
      onSendMessage: message => { sender.insertMessage(message); }
    });

    const disposer = receiver.register(
      'callDuplex',
      async (f: (fi: (a: number) => Promise<number>) => Promise<number>) => {
        return await f(async a => a + 7);
      }
    );

    const result = await sender.invoke(
      'callDuplex',
      async (fi: (a: number) => Promise<number>) => {
        return await fi(13);
      }
    );
    expect(result).toBe(20);

    disposer.release();
    sender.release();
    receiver.release();
  });

  it('an anonymous function throw error', async () => {
    const sender = createSublimityRpcController({
      onSendMessage: message => { receiver.insertMessage(message); },
      produceStackTrace: true
    });

    const receiver = createSublimityRpcController({
      onSendMessage: message => { sender.insertMessage(message); },
      produceStackTrace: true
    });

    const disposer = receiver.register(
      'callOne',
      async (f: (a: number) => Promise<number>) => {
        return await f(1);
      }
    );

    try {
      await sender.invoke(
        'callOne',
        async (a: number) => { throw new Error('test'); });
      expect(false).toBe(true);  // Fail assertion
    } catch (error) {
      expect(error.name).toBe('Error');
      expect(error.message).toBe('test');
    }

    disposer.release();
    sender.release();
    receiver.release();
  });

  it('returning a function from remote call', async () => {
    const sender = createSublimityRpcController({
      onSendMessage: message => { receiver.insertMessage(message); }
    });

    const receiver = createSublimityRpcController({
      onSendMessage: message => { sender.insertMessage(message); }
    });

    const disposer = receiver.register(
      'getFunctionFactory',
      async (multiplier: number) => {
        return async (value: number) => value * multiplier;
      }
    );

    const resultFunction = await sender.invoke<(value: number) => Promise<number>>('getFunctionFactory', 3);
    
    const result = await resultFunction(5);
    expect(result).toBe(15);

    disposer.release();
    sender.release();
    receiver.release();
  });
});
