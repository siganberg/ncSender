using System.Collections.Concurrent;
using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Plugins;

/// <summary>
/// Dispatches modal dialogs from plugins to clients and awaits user responses.
/// JS plugins call <c>pluginContext.showDialog(...)</c>; that synchronously blocks
/// until the client posts back a response via the <c>plugin-dialog-response</c>
/// WebSocket message, at which point the TCS resolves and the JS engine continues.
/// </summary>
public class PluginDialogDispatcher
{
    private readonly IBroadcaster _broadcaster;
    private readonly ILogger<PluginDialogDispatcher> _logger;
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> _pending = new();

    public PluginDialogDispatcher(IBroadcaster broadcaster, ILogger<PluginDialogDispatcher> logger)
    {
        _broadcaster = broadcaster;
        _logger = logger;
    }

    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromMinutes(10);

    public JsonElement ShowDialog(string pluginId, string title, string content, WsDialogOptions? options)
    {
        var dialogId = Guid.NewGuid().ToString("N");
        var tcs = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[dialogId] = tcs;

        _logger.LogInformation("Dispatching plugin dialog {DialogId} from {PluginId}", dialogId, pluginId);

        _ = _broadcaster.Broadcast(
            "plugin:show-dialog",
            new WsShowDialog(pluginId, title, content, dialogId, options),
            NcSenderJsonContext.Default.WsShowDialog);

        try
        {
            // Block the JS engine thread until the client responds. The plugin engine
            // global lock is held during this wait, so concurrent plugin operations
            // queue up — acceptable since dialogs are rare and user-driven. A safety
            // timeout prevents an indefinite hang if no client ever responds.
            if (tcs.Task.Wait(DefaultTimeout))
                return tcs.Task.Result;

            _logger.LogWarning("Plugin dialog {DialogId} timed out after {Timeout}", dialogId, DefaultTimeout);
            return default;
        }
        finally
        {
            _pending.TryRemove(dialogId, out _);
        }
    }

    public bool Resolve(string dialogId, JsonElement response)
    {
        if (_pending.TryRemove(dialogId, out var tcs))
        {
            tcs.TrySetResult(response);
            return true;
        }
        return false;
    }
}
