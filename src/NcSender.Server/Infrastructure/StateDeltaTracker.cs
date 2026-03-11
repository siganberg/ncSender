using System.Text.Json;
using System.Text.Json.Nodes;
using NcSender.Core.Models;

namespace NcSender.Server.Infrastructure;

/// <summary>
/// Tracks previous state and computes delta (changed properties only).
/// Matches V1's MessageStateTracker: shallow diff one level deep for nested objects.
/// </summary>
public class StateDeltaTracker
{
    private JsonObject? _previousState;

    /// <summary>
    /// Compute delta between previous state and current state.
    /// Returns a JsonElement with only changed properties, or null if nothing changed.
    /// For nested objects (like machineState), only changed inner properties are included.
    /// </summary>
    public JsonElement? GetDelta(ServerState currentState)
    {
        var currentJson = JsonSerializer.Serialize(currentState, NcSenderJsonContext.Default.ServerState);
        var current = JsonNode.Parse(currentJson)?.AsObject();
        if (current is null)
            return null;

        if (_previousState is null)
        {
            _previousState = JsonNode.Parse(currentJson)?.AsObject();
            using var firstDoc = JsonDocument.Parse(currentJson);
            return firstDoc.RootElement.Clone();
        }

        var changes = new JsonObject();
        var hasChanges = false;

        foreach (var (key, value) in current)
        {
            var prev = _previousState[key];

            // Both null — no change
            if (value is null && prev is null)
                continue;

            // One null, other not — changed
            if (value is null || prev is null)
            {
                changes[key] = value?.DeepClone();
                hasChanges = true;
                continue;
            }

            // Both are objects — do nested shallow diff
            if (value is JsonObject currObj && prev is JsonObject prevObj)
            {
                var nestedChanges = new JsonObject();
                var hasNestedChanges = false;

                foreach (var (nk, nv) in currObj)
                {
                    var pv = prevObj[nk];
                    if (!JsonNodeEquals(nv, pv))
                    {
                        nestedChanges[nk] = nv?.DeepClone();
                        hasNestedChanges = true;
                    }
                }

                // Check removed keys
                foreach (var (nk, _) in prevObj)
                {
                    if (currObj[nk] is null && prevObj[nk] is not null)
                    {
                        nestedChanges[nk] = null;
                        hasNestedChanges = true;
                    }
                }

                if (hasNestedChanges)
                {
                    changes[key] = nestedChanges;
                    hasChanges = true;
                }
            }
            else if (!JsonNodeEquals(value, prev))
            {
                changes[key] = value.DeepClone();
                hasChanges = true;
            }
        }

        // Check removed top-level keys
        foreach (var (key, _) in _previousState)
        {
            if (current[key] is null && _previousState[key] is not null)
            {
                changes[key] = null;
                hasChanges = true;
            }
        }

        // Save snapshot
        _previousState = JsonNode.Parse(currentJson)?.AsObject();

        if (!hasChanges)
            return null;

        using var doc = JsonDocument.Parse(changes.ToJsonString());
        return doc.RootElement.Clone();
    }

    private static bool JsonNodeEquals(JsonNode? a, JsonNode? b)
    {
        if (a is null && b is null) return true;
        if (a is null || b is null) return false;
        return a.ToJsonString() == b.ToJsonString();
    }
}
