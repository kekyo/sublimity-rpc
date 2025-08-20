// Ameba pure RPC engine - Simply core implementation of pure RPC engine.
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

namespace Ameba.Rpc;

/// <summary>
/// Logger interface.
/// </summary>
public interface ILogger
{
    void Debug(string message);
    void Information(string message);
    void Warning(string message);
    void Error(string message);
}
