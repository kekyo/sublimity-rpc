// Ameba pure RPC engine - Simply core implementation of pure RPC engine.
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

using System.Threading;

namespace Ameba.Rpc;

internal static class Internal
{
    /**
     * Extract CancellationToken from arguments.
     * @param args - The arguments to extract CancellationToken from.
     * @returns The CancellationToken if found, otherwise undefined.
     */
    public static bool TryExtractCancellationToken(object?[] args, out CancellationToken ct)
    {
        // Extract AbortSignal from arguments
        for (var argIndex = args.Length - 1; argIndex >= 0; argIndex--)
        {
            var arg = args[argIndex];
            if (arg is CancellationToken ct2)
            {
                ct = ct2;
                return true;
            }
        }
        return false;
    }
}
