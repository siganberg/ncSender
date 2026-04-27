using System.Text.Json;
using System.Text.RegularExpressions;
using Jint;
using Jint.Native;
using Jint.Native.Array;
using Jint.Native.Object;
using Jint.Runtime.Interop;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Plugins;

public class JsPluginEngine : IJsPluginEngine
{
    private readonly ILogger<JsPluginEngine> _logger;
    private readonly PluginDialogDispatcher _dialogs;
    private readonly IToolService _toolService;
    private readonly Dictionary<string, PluginState> _plugins = new();
    private readonly Lock _lock = new();

    private sealed class PluginState
    {
        public required Engine JintEngine { get; init; }
        public required JsValue CachedSettings { get; init; }
        public int Priority { get; init; }
    }

    public JsPluginEngine(ILogger<JsPluginEngine> logger, PluginDialogDispatcher dialogs, IToolService toolService)
    {
        _logger = logger;
        _dialogs = dialogs;
        _toolService = toolService;
    }

    public void LoadPlugin(string pluginId, string commandsFilePath, Dictionary<string, JsonElement> settings, int priority = 0)
    {
        lock (_lock)
        {
            // Remove existing engine if reloading
            _plugins.Remove(pluginId);

            try
            {
                var source = File.ReadAllText(commandsFilePath);

                // Strip ESM export statements — Jint doesn't support ES modules.
                // All functions are already in global scope as declarations.
                source = Regex.Replace(source, @"^export\s*\{[^}]*\}\s*;?\s*$", "", RegexOptions.Multiline);

                var engine = new Engine(options =>
                {
                    options.LimitMemory(50_000_000); // 50 MB
                    // No TimeoutInterval: showDialog blocks the engine thread waiting
                    // for the user, and Jint counts that wall-clock wait against the
                    // budget. The dialog dispatcher has its own 10-min timeout, and
                    // the memory limit catches runaway loops.
                    options.Strict(false);
                });

                // Inject pluginContext global with helpers (log, showDialog) — must be set
                // before engine.Execute so plugin module-level code can capture it.
                engine.SetValue("pluginContext", BuildPluginContext(engine, pluginId));

                engine.Execute(source);

                // Build sanitized settings via buildInitialConfig(raw)
                // const/arrow functions aren't accessible via GetValue() or Invoke(),
                // so pass raw settings as a temp global and use Evaluate().
                var rawSettings = BuildJsObject(engine, settings);
                engine.SetValue("__rawSettings", rawSettings);
                var cachedSettings = engine.Evaluate("buildInitialConfig(__rawSettings)");
                engine.SetValue("__rawSettings", JsValue.Undefined);

                _plugins[pluginId] = new PluginState
                {
                    JintEngine = engine,
                    CachedSettings = cachedSettings,
                    Priority = priority
                };

                _logger.LogInformation("JS plugin {PluginId} loaded from {Path}", pluginId, commandsFilePath);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to load JS plugin {PluginId} from {Path}", pluginId, commandsFilePath);
                throw;
            }
        }
    }

    public void UnloadPlugin(string pluginId)
    {
        lock (_lock)
        {
            if (_plugins.Remove(pluginId))
                _logger.LogInformation("JS plugin {PluginId} unloaded", pluginId);
        }
    }

    public bool HasPlugin(string pluginId)
    {
        lock (_lock)
        {
            return _plugins.ContainsKey(pluginId);
        }
    }

    public List<string> GetLoadedPluginIds()
    {
        lock (_lock)
        {
            return _plugins.OrderBy(kv => kv.Value.Priority).Select(kv => kv.Key).ToList();
        }
    }

    public List<ProcessedCommand> ProcessOnBeforeCommand(
        string pluginId,
        List<ProcessedCommand> commands,
        CommandProcessorContext context,
        List<ToolInfo> tools)
    {
        lock (_lock)
        {
            if (!_plugins.TryGetValue(pluginId, out var state))
                return commands;

            try
            {
                var engine = state.JintEngine;

                // Build JS-compatible commands array
                var jsCommands = engine.Intrinsics.Array.Construct(
                    commands.Select(c => (JsValue)BuildCommandObject(engine, c)).ToArray());

                // Build context object with machineState and tools
                var jsContext = new JsObject(engine);
                var jsMachineState = new JsObject(engine);
                jsMachineState.Set("tool", JsValue.FromObject(engine, context.MachineState.Tool));
                jsContext.Set("machineState", jsMachineState);
                jsContext.Set("lineNumber", JsValue.FromObject(engine, context.LineNumber));
                jsContext.Set("safeZHeight", JsValue.FromObject(engine, context.SafeZHeight));
                jsContext.Set("sourceId", context.Meta?.SourceId is not null
                    ? JsValue.FromObject(engine, context.Meta.SourceId)
                    : JsValue.Null);

                // Build tools array
                var jsTools = engine.Intrinsics.Array.Construct(
                    tools.Select(t =>
                    {
                        var jsTool = new JsObject(engine);
                        jsTool.Set("toolNumber", JsValue.FromObject(engine, t.ToolNumber ?? 0));
                        var jsOffsets = new JsObject(engine);
                        jsOffsets.Set("x", JsValue.FromObject(engine, t.Offsets.X));
                        jsOffsets.Set("y", JsValue.FromObject(engine, t.Offsets.Y));
                        jsOffsets.Set("z", JsValue.FromObject(engine, t.Offsets.Tlo));
                        jsOffsets.Set("tlsZ", JsValue.FromObject(engine, t.Offsets.Z));
                        jsTool.Set("offsets", jsOffsets);
                        return (JsValue)jsTool;
                    }).ToArray());
                jsContext.Set("tools", jsTools);

                // Invoke onBeforeCommand(commands, context, settings)
                var onBeforeCmd = engine.GetValue("onBeforeCommand");
                var result = onBeforeCmd.Call(jsCommands, jsContext, state.CachedSettings);

                return ConvertResultToCommands(result);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "JS plugin {PluginId} onBeforeCommand failed", pluginId);
                return commands; // Fall through on error
            }
        }
    }

    private static ObjectInstance BuildCommandObject(Engine engine, ProcessedCommand cmd)
    {
        var obj = new JsObject(engine);
        obj.Set("command", cmd.Command);
        obj.Set("isOriginal", cmd.IsOriginal);
        obj.Set("displayCommand", cmd.DisplayCommand is not null
            ? JsValue.FromObject(engine, cmd.DisplayCommand)
            : JsValue.Null);

        if (cmd.Meta is not null)
        {
            var meta = new JsObject(engine);
            meta.Set("silent", cmd.Meta.Silent);
            meta.Set("sourceId", cmd.Meta.SourceId is not null
                ? JsValue.FromObject(engine, cmd.Meta.SourceId)
                : JsValue.Null);
            obj.Set("meta", meta);
        }
        else
        {
            obj.Set("meta", JsValue.Null);
        }

        return obj;
    }

    private static JsValue BuildJsObject(Engine engine, Dictionary<string, JsonElement> dict)
    {
        var obj = new JsObject(engine);
        foreach (var (key, value) in dict)
        {
            obj.Set(key, ConvertToJsValue(engine, value));
        }
        return obj;
    }

    private static JsValue ConvertToJsValue(Engine engine, JsonElement element)
    {
        return element.ValueKind switch
        {
            JsonValueKind.String => JsValue.FromObject(engine, element.GetString()!),
            JsonValueKind.Number => JsValue.FromObject(engine, element.GetDouble()),
            JsonValueKind.True => JsValue.FromObject(engine, true),
            JsonValueKind.False => JsValue.FromObject(engine, false),
            JsonValueKind.Null or JsonValueKind.Undefined => JsValue.Null,
            JsonValueKind.Object => ConvertJsonObjectToJs(engine, element),
            JsonValueKind.Array => ConvertJsonArrayToJs(engine, element),
            _ => JsValue.Undefined
        };
    }

    private static JsValue ConvertJsonObjectToJs(Engine engine, JsonElement element)
    {
        var obj = new JsObject(engine);
        foreach (var prop in element.EnumerateObject())
        {
            obj.Set(prop.Name, ConvertToJsValue(engine, prop.Value));
        }
        return obj;
    }

    private static JsValue ConvertJsonArrayToJs(Engine engine, JsonElement element)
    {
        var items = element.EnumerateArray()
            .Select(e => ConvertToJsValue(engine, e))
            .ToArray();
        return engine.Intrinsics.Array.Construct(items);
    }

    public void ProcessOnAfterJobEnd(string pluginId)
    {
        lock (_lock)
        {
            if (!_plugins.TryGetValue(pluginId, out var state))
                return;

            try
            {
                var fn = state.JintEngine.GetValue("onAfterJobEnd");
                if (fn.IsUndefined()) return;
                fn.Call();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "JS plugin {PluginId} onAfterJobEnd failed", pluginId);
            }
        }
    }

    public string ProcessOnGcodeProgramLoad(string pluginId, string content, IReadOnlyDictionary<string, object?> context)
    {
        lock (_lock)
        {
            if (!_plugins.TryGetValue(pluginId, out var state))
                return content;

            try
            {
                var fn = state.JintEngine.GetValue("onGcodeProgramLoad");
                if (fn.IsUndefined()) return content;

                var jsContext = new JsObject(state.JintEngine);
                foreach (var (k, v) in context)
                    jsContext.Set(k, v is null ? JsValue.Null : JsValue.FromObject(state.JintEngine, v));

                var result = fn.Call(JsValue.FromObject(state.JintEngine, content), jsContext, state.CachedSettings);
                return result.IsString() ? result.AsString() : content;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "JS plugin {PluginId} onGcodeProgramLoad failed", pluginId);
                return content;
            }
        }
    }

    private JsObject BuildPluginContext(Engine engine, string pluginId)
    {
        var ctx = new JsObject(engine);

        ctx.Set("log", new ClrFunction(engine, "log", (_, args) =>
        {
            var parts = args.Select(a => a.IsUndefined() || a.IsNull() ? "" : a.ToString()).ToArray();
            _logger.LogInformation("[plugin:{PluginId}] {Message}", pluginId, string.Join(" ", parts));
            return JsValue.Undefined;
        }));

        ctx.Set("showDialog", new ClrFunction(engine, "showDialog", (_, args) =>
        {
            var title = args.Length > 0 && args[0].IsString() ? args[0].AsString() : "";
            var content = args.Length > 1 && args[1].IsString() ? args[1].AsString() : "";
            var options = args.Length > 2 ? JsValueToDialogOptions(args[2]) : null;

            var response = _dialogs.ShowDialog(pluginId, title, content, options);
            return JsonElementToJsValue(engine, response);
        }));

        ctx.Set("getTools", new ClrFunction(engine, "getTools", (_, _) =>
        {
            try
            {
                var tools = _toolService.GetAllAsync().GetAwaiter().GetResult();
                var arr = engine.Intrinsics.Array.Construct(
                    tools.Select(t =>
                    {
                        var obj = new JsObject(engine);
                        obj.Set("id", JsValue.FromObject(engine, t.Id));
                        obj.Set("toolId", t.ToolId.HasValue ? JsValue.FromObject(engine, t.ToolId.Value) : JsValue.Null);
                        obj.Set("toolNumber", t.ToolNumber.HasValue ? JsValue.FromObject(engine, t.ToolNumber.Value) : JsValue.Null);
                        obj.Set("name", JsValue.FromObject(engine, t.Name));
                        obj.Set("type", JsValue.FromObject(engine, t.Type));
                        obj.Set("diameter", JsValue.FromObject(engine, t.Diameter));
                        return (JsValue)obj;
                    }).ToArray());
                return arr;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "pluginContext.getTools failed for {PluginId}", pluginId);
                return engine.Intrinsics.Array.Construct(Array.Empty<JsValue>());
            }
        }));

        return ctx;
    }

    private static WsDialogOptions? JsValueToDialogOptions(JsValue v)
    {
        if (v.IsUndefined() || v.IsNull() || v is not ObjectInstance obj) return null;
        string? size = null;
        bool? closable = null;
        var sizeProp = obj.Get("size");
        if (sizeProp.IsString()) size = sizeProp.AsString();
        var closableProp = obj.Get("closable");
        if (closableProp.IsBoolean()) closable = closableProp.AsBoolean();
        return new WsDialogOptions(size, closable);
    }

    private static JsValue JsonElementToJsValue(Engine engine, JsonElement element)
    {
        return element.ValueKind switch
        {
            JsonValueKind.String => JsValue.FromObject(engine, element.GetString()!),
            JsonValueKind.Number => JsValue.FromObject(engine, element.GetDouble()),
            JsonValueKind.True => JsValue.FromObject(engine, true),
            JsonValueKind.False => JsValue.FromObject(engine, false),
            JsonValueKind.Null or JsonValueKind.Undefined => JsValue.Null,
            JsonValueKind.Object => JsonObjectElementToJs(engine, element),
            JsonValueKind.Array => JsonArrayElementToJs(engine, element),
            _ => JsValue.Undefined
        };
    }

    private static JsValue JsonObjectElementToJs(Engine engine, JsonElement element)
    {
        var obj = new JsObject(engine);
        foreach (var prop in element.EnumerateObject())
            obj.Set(prop.Name, JsonElementToJsValue(engine, prop.Value));
        return obj;
    }

    private static JsValue JsonArrayElementToJs(Engine engine, JsonElement element)
    {
        var items = element.EnumerateArray().Select(e => JsonElementToJsValue(engine, e)).ToArray();
        return engine.Intrinsics.Array.Construct(items);
    }

    private static List<ProcessedCommand> ConvertResultToCommands(JsValue result)
    {
        var commands = new List<ProcessedCommand>();

        if (result is not ArrayInstance arr)
            return commands;

        var length = (int)arr.Get("length").AsNumber();
        for (var i = 0; i < length; i++)
        {
            var item = arr[i];
            if (item is not ObjectInstance obj)
                continue;

            var isOriginal = obj.Get("isOriginal");
            var cmd = new ProcessedCommand
            {
                Command = obj.Get("command").AsString(),
                IsOriginal = isOriginal.IsBoolean() ? isOriginal.AsBoolean() : false
            };

            var displayCommand = obj.Get("displayCommand");
            if (!displayCommand.IsNull() && !displayCommand.IsUndefined())
                cmd.DisplayCommand = displayCommand.AsString();

            var meta = obj.Get("meta");
            if (meta is ObjectInstance metaObj)
            {
                cmd.Meta = new CommandMeta();
                var silent = metaObj.Get("silent");
                if (!silent.IsUndefined())
                    cmd.Meta.Silent = silent.AsBoolean();

                var sourceId = metaObj.Get("sourceId");
                if (!sourceId.IsNull() && !sourceId.IsUndefined())
                    cmd.Meta.SourceId = sourceId.AsString();
            }

            commands.Add(cmd);
        }

        return commands;
    }
}
