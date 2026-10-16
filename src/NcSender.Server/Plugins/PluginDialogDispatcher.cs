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

    /// <summary>
    /// The same dialog without the wait: returns its id at once and runs
    /// <paramref name="onResponse"/> when the operator answers. For a plugin's
    /// background work (a sensor watch), where blocking would hold the plugin
    /// engine lock and stall every command until the dialog is answered. Not
    /// called when the dialog is closed with <see cref="Close"/>.
    /// </summary>
    public string ShowDialogAsync(string pluginId, string title, string content, WsDialogOptions? options, Action<JsonElement> onResponse)
    {
        var dialogId = Guid.NewGuid().ToString("N");
        var tcs = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[dialogId] = tcs;

        _logger.LogInformation("Dispatching plugin dialog {DialogId} from {PluginId} (no wait)", dialogId, pluginId);

        _ = tcs.Task.ContinueWith(t =>
        {
            _pending.TryRemove(dialogId, out _);
            if (!t.IsCompletedSuccessfully) return;
            try { onResponse(t.Result); }
            catch (Exception ex) { _logger.LogWarning(ex, "Plugin dialog {DialogId} response handler failed", dialogId); }
        }, TaskScheduler.Default);

        _ = _broadcaster.Broadcast(
            "plugin:show-dialog",
            new WsShowDialog(pluginId, title, content, dialogId, options),
            NcSenderJsonContext.Default.WsShowDialog);

        return dialogId;
    }

    /// <summary>Close a dialog on every client without an answer.</summary>
    public void Close(string dialogId)
    {
        if (_pending.TryRemove(dialogId, out var tcs)) tcs.TrySetCanceled();
        _ = _broadcaster.Broadcast(
            "plugin:close-dialog",
            new WsCloseDialog(dialogId),
            NcSenderJsonContext.Default.WsCloseDialog);
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
