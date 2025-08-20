// Ameba pure RPC engine - Simply core implementation of pure RPC engine.
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

using System;

namespace Ameba.Rpc;

/// <summary>
/// Base RPC message interface.
/// </summary>
public interface IAmebaRpcMessage
{
    /// <summary>
    /// Message ID.
    /// </summary>
    /// <remarks>This is a unique identifier for a calling transaction.</remarks>
    Guid MessageId { get; }
}
