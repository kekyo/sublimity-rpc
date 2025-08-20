// Ameba pure RPC engine - Simply core implementation of pure RPC engine.
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Diagnostics.CodeAnalysis;
using System.Runtime.CompilerServices;

namespace Ameba.Rpc;

internal sealed class LooseFinalizationRegistry<TKey, TValue>(
    Action<TValue> removed,
    int cleanupThreshold = 50)
    where TKey : class
{
    private readonly Dictionary<int, List<WeakReference<TKey>>> keysByHash = new();
    private readonly Dictionary<WeakReference<TKey>, TValue> objectIds = new(new WeakReferenceEqualityComparer());
    private readonly object syncLock = new();
    private int operationCount = 0;

    private sealed class WeakReferenceEqualityComparer : IEqualityComparer<WeakReference<TKey>>
    {
        public bool Equals(WeakReference<TKey>? x, WeakReference<TKey>? y)
        {
            if (ReferenceEquals(x, y))
            {
                return true;
            }
            if (x is null || y is null)
            {
                return false;
            }

            if (!x.TryGetTarget(out var targetX) ||
                !y.TryGetTarget(out var targetY))
            {
                return false;
            }
            
            return ReferenceEquals(targetX, targetY);
        }

        public int GetHashCode(WeakReference<TKey> obj) =>
            obj.TryGetTarget(out var target) ? target.GetHashCode() : 0;
    }

    private void InvokeRemoved(IReadOnlyList<TValue> removedObjectIds)
    {
        foreach (var removedObjectId in removedObjectIds)
        {
            try
            {
                removed(removedObjectId);
            }
            catch (Exception ex)
            {
                Trace.WriteLine(ex);
            }
        }
    }

    public void Register(TKey key, TValue objectId)
    {
        IReadOnlyList<TValue> removedObjectIds;
        lock (this.syncLock)
        {
            var hashCode = RuntimeHelpers.GetHashCode(key);
            var weakRef = new WeakReference<TKey>(key);

            if (!this.keysByHash.TryGetValue(hashCode, out var list))
            {
                list = new List<WeakReference<TKey>>();
                this.keysByHash[hashCode] = list;
            }

            foreach (var existingRef in list)
            {
                if (existingRef.TryGetTarget(out var target) &&
                    ReferenceEquals(target, key))
                {
                    throw new ArgumentException("An element with the same key already exists in the dictionary.", nameof(key));
                }
            }

            list.Add(weakRef);
            this.objectIds[weakRef] = objectId;

            this.operationCount++;
            if (this.operationCount >= cleanupThreshold)
            {
                removedObjectIds = this.CleanupDeadReferences();
                this.operationCount = 0;
            }
            else
            {
                removedObjectIds = [];
            }
        }
        
        this.InvokeRemoved(removedObjectIds);
    }

    public bool Unregister(TKey key)
    {
        var removedObjectIds = new List<TValue>();
        try
        {
            lock (this.syncLock)
            {
                var hashCode = RuntimeHelpers.GetHashCode(key);

                if (!this.keysByHash.TryGetValue(hashCode, out var list))
                {
                    return false;
                }

                for (int i = list.Count - 1; i >= 0; i--)
                {
                    var weakRef = list[i];
                    if (!weakRef.TryGetTarget(out var target))
                    {
                        list.RemoveAt(i);
                        var objectId = this.objectIds[weakRef];
                        removedObjectIds.Add(objectId);
                        this.objectIds.Remove(weakRef);
                    }
                    else if (ReferenceEquals(target, key))
                    {
                        list.RemoveAt(i);
                        this.objectIds.Remove(weakRef);

                        if (list.Count == 0)
                        {
                            this.keysByHash.Remove(hashCode);
                        }
                        return true;
                    }
                }

                if (list.Count == 0)
                {
                    this.keysByHash.Remove(hashCode);
                }

                return false;
            }
        }
        finally
        {
            this.InvokeRemoved(removedObjectIds);
        }
    }

    public bool ContainsKey(TKey key)
    {
        lock (this.syncLock)
        {
            return this.TryGetValue(key, out _);
        }
    }

    public bool TryGetValue(TKey key, out TValue objectId)
    {
        objectId = default!;
        lock (this.syncLock)
        {
            var hashCode = RuntimeHelpers.GetHashCode(key);

            if (!this.keysByHash.TryGetValue(hashCode, out var list))
            {
                return false;
            }

            foreach (var weakRef in list)
            {
                if (weakRef.TryGetTarget(out var target) &&
                    ReferenceEquals(target, key))
                {
                    if (this.objectIds.TryGetValue(weakRef, out objectId!))
                    {
                        return true;
                    }
                }
            }

            return false;
        }
    }

    private IReadOnlyList<TValue> CleanupDeadReferences()
    {
        var hashCodesToRemove = new List<int>();
        var removedObjectIds = new List<TValue>();

        foreach (var kvp in this.keysByHash)
        {
            var hashCode = kvp.Key;
            var list = kvp.Value;

            for (int i = list.Count - 1; i >= 0; i--)
            {
                var weakRef = list[i];
                if (!weakRef.TryGetTarget(out _))
                {
                    list.RemoveAt(i);
                    var objectId = this.objectIds[weakRef];
                    removedObjectIds.Add(objectId);
                    this.objectIds.Remove(weakRef);
                }
            }

            if (list.Count == 0)
            {
                hashCodesToRemove.Add(hashCode);
            }
        }

        foreach (var hashCode in hashCodesToRemove)
        {
            this.keysByHash.Remove(hashCode);
        }

        return removedObjectIds;
    }
}
