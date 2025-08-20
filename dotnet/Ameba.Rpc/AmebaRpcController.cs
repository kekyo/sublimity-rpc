// Ameba pure RPC engine - Simply core implementation of pure RPC engine.
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace Ameba.Rpc;

public sealed class AmebaRpcControllerOptions(
    Func<IAmebaRpcMessage, ValueTask<IAmebaRpcMessage?>> onSendMessage)
{
    public Guid ControllerId = Guid.NewGuid();
    public ILogger Logger = new ConsoleLogger();
    public readonly Func<IAmebaRpcMessage, ValueTask<IAmebaRpcMessage?>> OnSendMessage = onSendMessage;
    public bool ProduceStackTrace = false;
}

public sealed class AmebaRpcController : IAmebaRpcController
{
    private readonly Dictionary<string, WeakReference<object>> objectMap = new();
    private readonly Dictionary<Guid, TaskCompletionSource<object?>> invocations = new();

    // Function registry
    private readonly Dictionary<string, Func<object?[], ValueTask<object?>>> functionRegistry = new();

    // Function finalization registry
    private readonly LooseFinalizationRegistry<Delegate, string> fr;

    public AmebaRpcController(AmebaRpcControllerOptions options)
    {
        this.fr = new(functionId =>
        {
            // Remove function from object map
            this.objectMap.Remove(functionId);
            try
            {
                // Send purge message to peer controller
                options.OnSendMessage(new AmebaRpcMessagePurge(Guid.NewGuid(), functionId));
            }
            catch (Exception ex)
            {
                options.Logger.Warning($"Failed to send purge message: functionId={functionId}, error={ex.Message}");
            }
            options.Logger.Debug($"Function purged: functionId={functionId}");
        });
    }

    public IDisposable Register<TResult>(string functionId, Func<object?[], ValueTask<TResult>> f)
    {
        if (this.fr.ContainsKey(f)) {
            throw new InvalidOperationException($"Function {functionId} already registered.");
        }

        // Register function in registry, save from GC
        var fobj = new Func<object?[], ValueTask<object?>>(async args => await f(args));
        this.functionRegistry.Add(functionId, fobj);

        // Register function in object map
        this.objectMap.Add(functionId, new(f));
        this.fr.Register(f, functionId);

        // Return releasable object
        return new Disposer(this, functionId, fobj);
    }

    private void InternalRelease(string functionId, Func<object?[], ValueTask<object?>> fobj)
    {
        this.functionRegistry.Remove(functionId);
        this.fr.Unregister(fobj);
    }

    public ValueTask<TResult> Invoke<TResult>(string functionId, params object?[] args)
    {
        throw new NotImplementedException();
    }

    public void InvokeOneWay(string functionId, params object?[] args)
    {
        throw new NotImplementedException();
    }

    public void InsertMessage(IAmebaRpcMessage message)
    {
        throw new NotImplementedException();
    }

    public ValueTask<IAmebaRpcMessage> InsertMessageWaitable(IAmebaRpcMessage message)
    {
        throw new NotImplementedException();
    }

    private sealed class Disposer(
        AmebaRpcController parent, string functionId, Func<object?[], ValueTask<object?>> fobj) : IDisposable
    {
        public void Dispose() =>
            parent.InternalRelease(functionId, fobj);
    }
}
