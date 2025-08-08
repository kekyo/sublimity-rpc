# Sublimity pure RPC engine

Core implementation of pure RPC engine in TypeScript.

![sublimity-rpc](./images/sublimity-rpc-120.png)

[![Project Status: Active – The project has reached a stable, usable state and is being actively developed.](https://www.repostatus.org/badges/latest/active.svg)](https://www.repostatus.org/#active)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/sublimity-rpc.svg)](https://www.npmjs.com/package/asublimity-rpc)

----

[(日本語はこちら)](README_ja.md)

## What is this?

Are you tired of struggling with the choice of RPC to use for intercommunication between systems, or of doing the same and different implementations over and over again?
This library is a pure RPC engine based on TypeScript, extracting only the core features of RPC.

You only need to consider the following two points:

* How to serialize/deserialize RPC messages (the simplest is just to `JSON.stringfy()`/`JSON.parse()`)
* Methods for sending and receiving RPC messages (any method is acceptable, including HTTP/WebSocket/IPC/Cloud MQ service, etc.)

Here is a simple conceptual diagram:

```mermaid
graph LR
    subgraph Left["Instance domain 1"]
        Caller[Caller]
        LC[RPC Controller]
        Caller -->|"invoke()"| LC
    end
    
    subgraph Right["Instance domain 2"]
        RC[RPC Controller]
        TF[Registered function]
        RC -->|"(Invoker)"| TF
    end
    
    LC -->|"RPC Messages"| RC
    RC -->|"RPC Messages"| LC
```

The RPC engine provides the following functionality:

* Identification of the calling function by identifier (string).
* Can use arbitrary values (primitive values, objects and function objects).
* All functions return `Promise<T>`, so they are fully asynchronous operation.
* Can expose asynchronous-generator `AsyncGenerator<T, void, unknown>`, it handles streaming value transfer.
* Arguments can be `AbortSignal`.

Function objects can be specified as arguments and return values. In other words, callback RPC is also supported.
RPC implementation, "Fully symmetric" and "Full-duplex" asynchronous mutual callable.

----

## Installation

```bash
npm install sublimity-rpc
```

## Usage

To get the Sublimity pure RPC engine working, you will need to perform the following two steps:

1. Create an RPC controller to send and receive RPC messages.
2. Register RPC callable functions in the RPC controller.

### Create and setup controller pair

Create Sublimity RPC controller each instance domain.

In doing so, specify a handler `onSendMessage` that handles RPC messages that should be sent to the peer controller.
It also calls `insertMessage()`, which tells the controller the RPC message received from the peer controller.

```typescript
import { createSublimityRpcController } from 'sublimity-rpc';

// Create Sublimity RPC controller
const controller = createSublimityRpcController({
  // Handler for RPC message sending
  onSendMessage: async message => {
    // S1. Serialize RPC message to JSON
    const messageJson = JSON.stringify(message);
    // S2. Send to the peer controller
    await fetch(
      'http://example.com/rpc', {  // Example using fetch API to send message
        method: 'POST',
        headers: { "Content-Type": "application/json" },
        body: messageJson
    });
  }
});

// ...

// R1. Got peer message from HTTP/SSE/WebSocket/MQ/etc...
const messageJson = ...

// R2. Deserialize peer message from JSON
const message = JSON.parse(messageJson);
// Insert peer message to controller
controller.insertMessage(message);
```

### Register functions

The following code exposes the `add` function to the peer controller.

Note that the function to be exposed returns `Promise<T>`.
What types can be used depends on the types supported by serialization and reverse serialization.
If you are using TypeScript or JavaScript, you will find that you can specify JSON with almost the same feeling as accessing a Web API.

```typescript
// Register `add` function (asynchronous function)
const disposer = controller.register({
  // add: (a: number, b: number) => a + b
  'add',
  async (a: number, b: number): Promise<number> => {
    return a + b;
  }
);

// ...

// Remove `add` function
disposer.release();
```

Also, if you specify a function object, it will be automatically converted and replaced with the safest string possible.
So you don't have to worry about serialization.

```typescript
// Register a function with callback function
const disposer = controller.register({
  // foo: (f: (a: number) => Promise<string>) => await f(123) + 'DEF'
  'foo',
  async (f: (a: number) => Promise<string>): Promise<string> => {
    return await f(123) + 'DEF';
  }
);
```

### Invoke functions

Once you are ready, all you have to do is call the function:

```typescript
// Invoke `add` function with arguments
const result = await controller.invoke(
  // await add(1, 2)
  'add',
  1, 2);

expected(result).toBe(3);
```

### One-way invoking

Yes, you will NOT need any result for invoking:

```typescript
// Invoke one-way function, it returns void.
controller.invokeOneWay(
  // bar(1, 2, "BAZ")
  'bar',
  1, 2, "BAZ");
```

### Abort controller/signal

Yes, you can pass `AbortSignal` objects to functions:

```typescript
const controller = new AbortController();

await controller.invoke(
  // await hoge("haga", signal);
  'hoge',
  "haga", controller.signal);
```

### Async generators

Sublimity RPC supports async generators for streaming data transfer.
You can register an async generator function and consume it on the peer side.

#### Register async generator

```typescript
// Register an async generator function
const disposer = controller.registerGenerator(
  'countUp',
  async function* (start: number, end: number): AsyncGenerator<number, void, unknown> {
    for (let i = start; i <= end; i++) {
      yield i;
    }
  }
);

// ...

// Remove generator function
disposer.release();
```

#### Consume async generator

```typescript
// Consume the async generator
const results: number[] = [];
for await (const value of controller.iterate<number>('countUp', 1, 5)) {
  results.push(value);
}

// results will be [1, 2, 3, 4, 5]
```

#### Advanced async generator usage

You can also use async generators with more complex data types and async operations:

```typescript
// Register generator with delay and complex data
const disposer = controller.registerGenerator(
  'dataStream',
  async function* (count: number): AsyncGenerator<{ id: number; timestamp: Date }, void, unknown> {
    for (let i = 0; i < count; i++) {
      await new Promise(resolve => setTimeout(resolve, 100)); // Simulate async work
      yield {
        id: i,
        timestamp: new Date()
      };
    }
  }
);

// Consume with complex data
for await (const data of controller.iterate<{ id: number; timestamp: Date }>('dataStream', 3)) {
  console.log(`Received: ${data.id} at ${data.timestamp}`);
}
```

#### Error handling in async generators

```typescript
// Generator that might throw errors
const disposer = controller.registerGenerator(
  'errorGenerator',
  async function* (throwAt: number): AsyncGenerator<number, void, unknown> {
    for (let i = 0; i < 5; i++) {
      if (i === throwAt) {
        throw new Error('Generator error');
      }
      yield i;
    }
  }
);

// Handle errors when consuming
try {
  for await (const value of controller.iterate<number>('errorGenerator', 2)) {
    console.log(value); // Will log 0, 1 before throwing
  }
} catch (error) {
  console.error('Generator error:', error.message);
}
```

----

### Synchronous message sending/receiving mode

By default, Sublimity RPC sends and receives messages asynchronously, but it also supports synchronous message sending and receiving patterns.
This provides better performance when using a communication layer such as Electron IPC, which can return responses immediately using `Promise<T>`.

#### Using insertMessageWaitable()

When you need to get a response message directly, use `insertMessageWaitable()`:

```typescript
// (Traditional asynchronous mode)
controller.insertMessage(message); // fire-and-forget

// Synchronous mode - Returns a response message in `Promise<SublimityRpcMessage>`.
// Once the wait is complete, it indicates that the function call is also complete.
const response = await controller.insertMessageWaitable(message);
```

#### Configuring onSendMessage() for synchronous mode

You can configure `onSendMessage()` to return a `Promise<SublimityRpcMessage>` with the response message:

```typescript
// Synchronous message mode (e.g., for Electron IPC)
const controller = createSublimityRpcController({
  onSendMessage: async message => {
    // Send and immediately get response
    const response = await ipcRenderer.invoke('rpc-channel', message);
    // Return the response message  (`Promise<SublimityRpcMessage>`)
    // The controller will automatically use synchronous mode
    // when onSendMessage returns a Promise
    return response;
  }
});
```

----

## Misc.

This project is successor of [DupeNukem](https://github.com/kekyo/DupeNukem).
The key difference is that it is a true TypeScript independent library.
And I have refined the interface and internal structure.

## License

Under MIT.
