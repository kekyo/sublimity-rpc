// Ameba pure RPC engine - Simply core implementation of pure RPC engine.
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace Ameba.Rpc;

public interface IAmebaRpcController
{
  /**
   * Register a function.
   * @param functionId - The ID of the function to register.
   * @param f - The function to register.
   * @returns A releasable object.
   * @remarks This is the method to register a function.
   */
  IDisposable Register<TResult>(
    string functionId,
    Func<object?[], ValueTask<TResult>> f);

  /**
   * Invoke a function.
   * @param functionId - The ID of the function to invoke.
   * @param args - The arguments to pass to the function.
   * @returns A promise that resolves to the result of the function.
   * @remarks This is the method to invoke a function.
   */
  ValueTask<TResult> Invoke<TResult>(
    string functionId,
    params object?[] args);

  /**
   * Invoke a one-way function.
   * @param functionId - The ID of the function to invoke.
   * @param args - The arguments to pass to the function.
   */
  void InvokeOneWay(
    string functionId,
    params object?[] args);

  /**
   * Insert a RPC message to controller (fire-and-forget).
   * @param message - The message to insert.
   * @remarks Insert a RPC message. Then the controller will handle and invocation to target function.
   */
  void InsertMessage(IAmebaRpcMessage message);
  
  /**
   * Insert a RPC message to controller and return response.
   * @param message - The message to insert.
   * @returns Promise that resolves with response message.
   * @remarks Processes RPC message and returns response for synchronous RPC pattern.
   */
  ValueTask<IAmebaRpcMessage> InsertMessageWaitable(IAmebaRpcMessage message);
}

public static class AmebaRpcControllerExtension
{
  /**
   * Register a generator function.
   * @param functionId - The ID of the function to register.
   * @param f - The generator function to register.
   * @returns A releasable object.
   * @remarks This is the method to register a function.
   */
  public static IDisposable RegisterGenerator<TResult>(
    this IAmebaRpcController controller,
    string functionId,
    Func<object?[], IAsyncEnumerable<TResult>> f)
  {
    // TODO:
    throw new NotImplementedException();
  }

  /**
   * Invoke a generator function.
   * @param functionId - The ID of the function to invoke.
   * @param args - The arguments to pass to the function.
   * @returns A promise that resolves to the result of the function.
   * @remarks This is the method to invoke a function.
   */
  public static IAsyncEnumerable<TResult> Iterate<TResult>(
    this IAmebaRpcController controller,
    string functionId,
    params object?[] args)
  {
    // TODO:
    throw new NotImplementedException();
  }
}
