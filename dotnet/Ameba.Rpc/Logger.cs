// Ameba pure RPC engine - Simply core implementation of pure RPC engine.
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

using System;

namespace Ameba.Rpc;

/// <summary>
/// Console logger.
/// </summary>
public sealed class ConsoleLogger : ILogger
{
    public void Debug(string message) =>
        Console.Out.WriteLine(message);
    public void Information(string message) =>
        Console.Out.WriteLine(message);
    public void Warning(string message) =>
        Console.Error.WriteLine(message);
    public void Error(string message) =>
        Console.Error.WriteLine(message);
}
