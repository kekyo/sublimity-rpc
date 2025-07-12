import { describe, it, expect } from 'vitest';
import { createSublimityRpcController } from '../src/index';
import { delay } from 'async-primitives';

describe('Async Generator tests', () => {
  it('basic async generator support', async () => {
    const sender = createSublimityRpcController({
      onSendMessage: message => { receiver.insertMessage(message); }
    });

    const receiver = createSublimityRpcController({
      onSendMessage: message => { sender.insertMessage(message); }
    });

    const disposer = receiver.registerGenerator(
      'countUp',
      async function* (start: number, end: number) {
        for (let i = start; i <= end; i++) {
          yield i;
        }
      }
    );

    const results: number[] = [];
    for await (const value of sender.iterate<number>('countUp', 1, 5)) {
      results.push(value);
    }

    expect(results).toEqual([1, 2, 3, 4, 5]);

    disposer.release();
    sender.release();
    receiver.release();
  });

  it('empty async generator', async () => {
    const sender = createSublimityRpcController({
      onSendMessage: message => { receiver.insertMessage(message); }
    });

    const receiver = createSublimityRpcController({
      onSendMessage: message => { sender.insertMessage(message); }
    });

    const disposer = receiver.registerGenerator(
      'emptyGenerator',
      async function* () {
        // Empty generator
      }
    );

    const results: any[] = [];
    for await (const value of sender.iterate('emptyGenerator')) {
      results.push(value);
    }

    expect(results).toEqual([]);

    disposer.release();
    sender.release();
    receiver.release();
  });

  it('async generator with delay', async () => {
    const sender = createSublimityRpcController({
      onSendMessage: message => { receiver.insertMessage(message); }
    });

    const receiver = createSublimityRpcController({
      onSendMessage: message => { sender.insertMessage(message); }
    });

    const disposer = receiver.registerGenerator(
      'delayedGenerator',
      async function* (count: number) {
        for (let i = 0; i < count; i++) {
          await delay(10);
          yield `item-${i}`;
        }
      }
    );

    const results: string[] = [];
    for await (const value of sender.iterate<string>('delayedGenerator', 3)) {
      results.push(value);
    }

    expect(results).toEqual(['item-0', 'item-1', 'item-2']);

    disposer.release();
    sender.release();
    receiver.release();
  });

  it('async generator with error', async () => {
    const sender = createSublimityRpcController({
      onSendMessage: message => { receiver.insertMessage(message); },
      produceStackTrace: true
    });

    const receiver = createSublimityRpcController({
      onSendMessage: message => { sender.insertMessage(message); },
      produceStackTrace: true
    });

    const disposer = receiver.registerGenerator(
      'errorGenerator',
      async function* (throwAt: number) {
        for (let i = 0; i < 5; i++) {
          if (i === throwAt) {
            throw new Error('Generator error');
          }
          yield i;
        }
      }
    );

    const results: number[] = [];
    try {
      for await (const value of sender.iterate<number>('errorGenerator', 2)) {
        results.push(value);
      }
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      expect(error.name).toBe('Error');
      expect(error.message).toBe('Generator error');
    }

    expect(results).toEqual([0, 1]); // Should have received values before error

    disposer.release();
    sender.release();
    receiver.release();
  });

  it('async generator with complex data types', async () => {
    const sender = createSublimityRpcController({
      onSendMessage: message => { receiver.insertMessage(message); }
    });

    const receiver = createSublimityRpcController({
      onSendMessage: message => { sender.insertMessage(message); }
    });

    interface TestData {
      id: number;
      name: string;
      active: boolean;
    }

    const disposer = receiver.registerGenerator(
      'dataGenerator',
      async function* (count: number) {
        for (let i = 0; i < count; i++) {
          yield {
            id: i,
            name: `item-${i}`,
            active: i % 2 === 0
          } as TestData;
        }
      }
    );

    const results: TestData[] = [];
    for await (const value of sender.iterate<TestData>('dataGenerator', 3)) {
      results.push(value);
    }

    expect(results).toEqual([
      { id: 0, name: 'item-0', active: true },
      { id: 1, name: 'item-1', active: false },
      { id: 2, name: 'item-2', active: true }
    ]);

    disposer.release();
    sender.release();
    receiver.release();
  });

  it('async generator with function parameters', async () => {
    const sender = createSublimityRpcController({
      onSendMessage: message => { receiver.insertMessage(message); }
    });

    const receiver = createSublimityRpcController({
      onSendMessage: message => { sender.insertMessage(message); }
    });

    const disposer = receiver.registerGenerator(
      'transformGenerator',
      async function* (count: number, transform: (value: number) => Promise<string>) {
        for (let i = 0; i < count; i++) {
          yield await transform(i);
        }
      }
    );

    const results: string[] = [];
    for await (const value of sender.iterate<string>(
      'transformGenerator',
      3,
      async (n: number) => `transformed-${n * 2}`
    )) {
      results.push(value);
    }

    expect(results).toEqual(['transformed-0', 'transformed-2', 'transformed-4']);

    disposer.release();
    sender.release();
    receiver.release();
  });

  it('multiple concurrent async generators', async () => {
    const sender = createSublimityRpcController({
      onSendMessage: message => { receiver.insertMessage(message); }
    });

    const receiver = createSublimityRpcController({
      onSendMessage: message => { sender.insertMessage(message); }
    });

    const disposer1 = receiver.registerGenerator(
      'generator1',
      async function* (prefix: string) {
        for (let i = 0; i < 3; i++) {
          yield `${prefix}-${i}`;
        }
      }
    );

    const disposer2 = receiver.registerGenerator(
      'generator2',
      async function* (count: number) {
        for (let i = 0; i < count; i++) {
          yield i * 10;
        }
      }
    );

    const results1: string[] = [];
    const results2: number[] = [];

    await Promise.all([
      (async () => {
        for await (const value of sender.iterate<string>('generator1', 'test')) {
          results1.push(value);
        }
      })(),
      (async () => {
        for await (const value of sender.iterate<number>('generator2', 2)) {
          results2.push(value);
        }
      })()
    ]);

    expect(results1).toEqual(['test-0', 'test-1', 'test-2']);
    expect(results2).toEqual([0, 10]);

    disposer1.release();
    disposer2.release();
    sender.release();
    receiver.release();
  });

  it('async generator with AbortSignal', async () => {
    const sender = createSublimityRpcController({
      onSendMessage: message => { receiver.insertMessage(message); }
    });

    const receiver = createSublimityRpcController({
      onSendMessage: message => { sender.insertMessage(message); }
    });

    const disposer = receiver.registerGenerator(
      'abortableGenerator',
      async function* (count: number, signal?: AbortSignal) {
        for (let i = 0; i < count; i++) {
          if (signal?.aborted) {
            throw new Error('Operation aborted');
          }
          await delay(10);
          yield i;
        }
      }
    );

    const abortController = new AbortController();
    const results: number[] = [];

    // Start the generator
    const generatorPromise = (async () => {
      try {
        for await (const value of sender.iterate<number>('abortableGenerator', 10, abortController.signal)) {
          results.push(value);
          if (results.length === 2) {
            abortController.abort();
          }
        }
      } catch (error) {
        expect(error.name).toBe('Error');
      }
    })();

    await generatorPromise;

    expect(results.length).toBeLessThanOrEqual(3); // Should have been aborted

    disposer.release();
    sender.release();
    receiver.release();
  });

  it('async generator function not found', async () => {
    const sender = createSublimityRpcController({
      onSendMessage: message => { receiver.insertMessage(message); }
    });

    const receiver = createSublimityRpcController({
      onSendMessage: message => { sender.insertMessage(message); }
    });

    try {
      const iterator = sender.iterate('nonexistentGenerator');
      await iterator.next();
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      expect(error.name).toBe('Error');
      expect(error.message).toBe("Function 'nonexistentGenerator' is not found");
    }

    sender.release();
    receiver.release();
  });
});