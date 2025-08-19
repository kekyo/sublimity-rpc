# Ameba pure RPC engine

Core implementation of pure RPC engine in TypeScript.

![ameba-rpc](./images/ameba-rpc-120.png)

[![Project Status: Active – The project has reached a stable, usable state and is being actively developed.](https://www.repostatus.org/badges/latest/active.svg)](https://www.repostatus.org/#active)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/ameba-rpc.svg)](https://www.npmjs.com/package/aameba-rpc)

----

## What is this?

Are you tired of struggling with the choice of RPC to use for intercommunication between systems, or of doing the same and different implementations over and over again?
This library is a pure RPC engine based on TypeScript, extracting only the core features of RPC.

You only need to consider the following two points:

* How to serialize/deserialize RPC messages (the simplest is just to `JSON.stringfy()`/`JSON.parse()`)
* Methods for sending and receiving RPC messages (any method is acceptable, including HTTP/WebSocket/IPC/Cloud MQ service, etc.)

The RPC engine provides the following functionality:

* Identification of the calling function by identifier (string).
* Can use arbitrary values (primitive values, objects and function objects).
* All functions return `Promise<T>`, so they are fully asynchronous operation.
* Can expose asynchronous-generator `AsyncGenerator<T, void, unknown>`, it handles streaming value transfer.
* Arguments can be `AbortSignal`.

Function objects can be specified as arguments and return values. In other words, callback RPC is also supported.
RPC implementation, "Fully symmetric" and "Full-duplex" asynchronous mutual callable.

----

## Usage

To get the Ameba pure RPC engine working, you will need to perform the following two steps:

1. Create an RPC controller to send and receive RPC messages.
2. Register RPC callable functions in the RPC controller.

### Create and setup controller pair

Create Ameba RPC controller each instance domain.

In doing so, specify a handler `onSendMessage` that handles RPC messages that should be sent to the peer controller.
It also calls `insertMessage()`, which tells the controller the RPC message received from the peer controller.

```typescript
import { createAmebaRpcController } from 'ameba-rpc';

// Create Ameba RPC controller
const controller = createAmebaRpcController({
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

For more information, [see repository documents.](https://github.com/kekyo/ameba-rpc/)

----

## License

Under MIT.
