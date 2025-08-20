// Ameba pure RPC engine - Simply core implementation of pure RPC engine.
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

using System;

namespace Ameba.Rpc;

/// <summary>
/// Invoke message interface.
/// </summary>
/// <param name="messageId">Message ID</param>
/// <param name="functionId">Function ID</param>
/// <param name="args">Arguments</param>
/// <param name="oneWay">Is this message one-way invoking?</param>
public sealed class AmebaRpcMessageInvoke(
    Guid messageId,
    string functionId,
    object?[] args,
    bool? oneWay) : IAmebaRpcMessage
{
    public Guid MessageId => messageId;

    public string FunctionId => functionId;
    public object?[] Args => args;
    public bool? OneWay => oneWay;
}

/// <summary>
/// Result message interface.
/// </summary>
/// <param name="messageId">Message ID</param>
/// <param name="result">Result</param>
public sealed class AmebaRpcMessageResult(
    Guid messageId,
    object? result) : IAmebaRpcMessage
{
    public Guid MessageId => messageId;

    public object? Result => result;
}

/// <summary>
/// Error detail.
/// </summary>
/// <param name="name">Error name</param>
/// <param name="message">Error message</param>
/// <param name="stackTrace">Stack trace (optional)</param>
public sealed class AmebaRpcMessageErrorDetail(
    string name,
    string message,
    string? stackTrace)
{
    public string Name => name;
    public string Message => message;
    public string? StackTrace => stackTrace;
}

/// <summary>
/// Error message interface.
/// </summary>
/// <param name="messageId">Message ID</param>
/// <param name="error">Error detail object</param>
public sealed class AmebaRpcMessageError(
    Guid messageId,
    AmebaRpcMessageErrorDetail error) : IAmebaRpcMessage
{
    public Guid MessageId => messageId;
    
    public AmebaRpcMessageErrorDetail Error => error;
}

/// <summary>
/// Purge message interface.
/// </summary>
/// <param name="messageId">Message ID</param>
/// <param name="functionId">Function ID</param>
public sealed class AmebaRpcMessagePurge(
    Guid messageId,
    string functionId) : IAmebaRpcMessage
{
    public Guid MessageId => messageId;
    
    public string FunctionId => functionId;
}

/// <summary>
/// Nothing operator interface.
/// </summary>
/// <param name="messageId">Message ID</param>
public sealed class AmebaRpcMessageNone(
    Guid messageId) : IAmebaRpcMessage
{
    public Guid MessageId => messageId;
}
