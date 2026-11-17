using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Jint;
using Jint.Native;
using Jint.Native.Json;
using Jint.Native.Object;
using Jint.Runtime.Interop;
using NcSender.Core.Interfaces;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Plugins;

/// <summary>
/// The parts of pluginContext that reach outside the machine: web requests,
/// the G-code file library, private storage, and requests from the plugin's
/// own window. Web requests and files need "network" / "files" in the
/// manifest's permissions.
///
/// Every web call is asynchronous. Plugin code runs under the engine lock,
/// which every command also takes, so a call that waited on the network would
/// stall the machine; the request runs off the lock and only its callback
/// takes it.
/// </summary>
public partial class JsPluginEngine
{
    public const string NetworkPermission = "network";
    public const string FilesPermission = "files";

    // Text bodies come back to the plugin as a string; files go through
    // download/upload, which stream.
    private const int MaxBodyBytes = 8 * 1024 * 1024;
    private const int MaxListedFiles = 20_000;

    private static readonly HttpClient PluginHttp = new(new SocketsHttpHandler
    {
        PooledConnectionLifetime = TimeSpan.FromMinutes(5),
        ConnectTimeout = TimeSpan.FromSeconds(10),
        AutomaticDecompression = System.Net.DecompressionMethods.All,
    })
    { Timeout = Timeout.InfiniteTimeSpan };

    private readonly Dictionary<string, HashSet<string>> _permissions = new();

    /// <summary>Marks an ncSenderOS kiosk; every kiosk image creates it.</summary>
    internal static bool IsKiosk => KioskOverride ?? Directory.Exists("/etc/ncsender");

    /// <summary>For tests.</summary>
    internal static bool? KioskOverride { get; set; }

    public void SetPermissions(string pluginId, IReadOnlyCollection<string> permissions)
    {
        lock (_lock) _permissions[pluginId] = new HashSet<string>(permissions, StringComparer.OrdinalIgnoreCase);
    }

    private bool Allowed(string pluginId, string permission)
    {
        lock (_lock) return _permissions.TryGetValue(pluginId, out var p) && p.Contains(permission);
    }

    /// <summary>
    /// A request from the plugin's window (POST /api/plugins/{id}/request):
    /// calls the plugin's onRequest(payload) and returns its answer as JSON.
    /// Null when the plugin isn't loaded or has no onRequest.
    /// </summary>
    public string? HandleRequest(string pluginId, string payloadJson)
    {
        lock (_lock)
        {
            if (!_plugins.TryGetValue(pluginId, out var state)) return null;
            var engine = state.JintEngine;
            try
            {
                engine.SetValue("__requestJson", payloadJson);
                var result = engine.Evaluate(
                    "typeof onRequest === 'function' ? JSON.stringify(onRequest(JSON.parse(__requestJson)) ?? null) : undefined");
                return result.IsString() ? result.AsString() : null;
            }
            finally
            {
                engine.SetValue("__requestJson", JsValue.Undefined);
            }
        }
    }

    private void AddHostApi(JsObject ctx, Engine engine, string pluginId)
    {
        ctx.Set("isKiosk", IsKiosk ? JsBoolean.True : JsBoolean.False);
        ctx.Set("storage", BuildStorage(engine, pluginId));
        if (Allowed(pluginId, NetworkPermission)) ctx.Set("http", BuildHttp(engine, pluginId));
        if (Allowed(pluginId, FilesPermission)) ctx.Set("files", BuildFiles(engine, pluginId));
    }

    // ---------- storage ----------

    internal static string PrivatePath(string pluginId) =>
        Path.Combine(PathUtils.GetPluginConfigDir(), pluginId, "private.json");

    /// <summary>
    /// storage.get() / storage.set(value): one JSON value kept beside the
    /// plugin's settings but never served by the settings API, for things a
    /// browser on the network shouldn't be able to read (sign-in tokens).
    /// </summary>
    private JsObject BuildStorage(Engine engine, string pluginId)
    {
        var storage = new JsObject(engine);
        storage.Set("get", new ClrFunction(engine, "get", (_, _) =>
        {
            try
            {
                var path = PrivatePath(pluginId);
                return File.Exists(path) ? new JsonParser(engine).Parse(File.ReadAllText(path)) : JsValue.Null;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "pluginContext.storage.get failed for {PluginId}", pluginId);
                return JsValue.Null;
            }
        }));
        storage.Set("set", new ClrFunction(engine, "set", (_, args) =>
        {
            try
            {
                var path = PrivatePath(pluginId);
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                var json = args.Length > 0 ? new Jint.Native.Json.JsonSerializer(engine).Serialize(args[0]) : JsValue.Undefined;
                var temp = path + ".tmp";
                File.WriteAllText(temp, json.IsString() ? json.AsString() : "null");
                if (!OperatingSystem.IsWindows())
                    File.SetUnixFileMode(temp, UnixFileMode.UserRead | UnixFileMode.UserWrite);
                File.Move(temp, path, overwrite: true);
                return JsBoolean.True;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "pluginContext.storage.set failed for {PluginId}", pluginId);
                return JsBoolean.False;
            }
        }));
        return storage;
    }

    // ---------- files ----------

    /// <summary>
    /// A path inside the G-code library, or null when it points outside it.
    /// Plugin paths are relative, with forward slashes.
    /// </summary>
    internal static string? LibraryPath(string? relative, string? root = null)
    {
        if (string.IsNullOrWhiteSpace(relative)) return null;
        root = Path.GetFullPath(root ?? PathUtils.GetGcodeFilesDir());
        var full = Path.GetFullPath(Path.Combine(root, relative.Replace('\\', '/').TrimStart('/')));
        var prefix = root.EndsWith(Path.DirectorySeparatorChar) ? root : root + Path.DirectorySeparatorChar;
        return full.StartsWith(prefix, StringComparison.Ordinal) ? full : null;
    }

    internal static List<(string Path, long Size, long Modified)> ListLibrary(string? under, string? root = null)
    {
        var result = new List<(string, long, long)>();
        root = Path.GetFullPath(root ?? PathUtils.GetGcodeFilesDir());
        var start = string.IsNullOrWhiteSpace(under) ? root : LibraryPath(under, root);
        if (start is null || !Directory.Exists(start)) return result;
        var options = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true, AttributesToSkip = FileAttributes.System };
        foreach (var file in new DirectoryInfo(start).EnumerateFiles("*", options))
        {
            // Dot files are ours (half-written downloads) or the OS's.
            var relative = Path.GetRelativePath(root, file.FullName).Replace('\\', '/');
            if (relative.Split('/').Any(part => part.StartsWith('.'))) continue;
            result.Add((relative, file.Length, new DateTimeOffset(file.LastWriteTimeUtc).ToUnixTimeMilliseconds()));
            if (result.Count >= MaxListedFiles) break;
        }
        return result;
    }

    private JsObject BuildFiles(Engine engine, string pluginId)
    {
        var files = new JsObject(engine);
        files.Set("root", PathUtils.GetGcodeFilesDir());

        // list(folder?) → [{ path, size, modified }] for every file under the
        // library (or one folder of it); modified is ms since 1970.
        files.Set("list", new ClrFunction(engine, "list", (_, args) =>
        {
            var under = args.Length > 0 && args[0].IsString() ? args[0].AsString() : null;
            try
            {
                return engine.Intrinsics.Array.Construct(ListLibrary(under).Select(f =>
                {
                    var o = new JsObject(engine);
                    o.Set("path", f.Path);
                    o.Set("size", new JsNumber(f.Size));
                    o.Set("modified", new JsNumber(f.Modified));
                    return (JsValue)o;
                }).ToArray());
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "pluginContext.files.list failed for {PluginId}", pluginId);
                return engine.Intrinsics.Array.Construct([]);
            }
        }));

        files.Set("remove", new ClrFunction(engine, "remove", (_, args) =>
        {
            var path = LibraryPath(args.Length > 0 && args[0].IsString() ? args[0].AsString() : null);
            try
            {
                if (path is null || !File.Exists(path)) return JsBoolean.False;
                File.Delete(path);
                return JsBoolean.True;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "pluginContext.files.remove failed for {PluginId}", pluginId);
                return JsBoolean.False;
            }
        }));

        // changed(): tell open file managers to reload their list.
        files.Set("changed", new ClrFunction(engine, "changed", (_, _) =>
        {
            if (_serviceProvider.GetService(typeof(IBroadcaster)) is IBroadcaster broadcaster)
            {
                using var doc = JsonDocument.Parse("{}");
                _ = broadcaster.Broadcast("gcode-files:changed", doc.RootElement.Clone());
            }
            return JsValue.Undefined;
        }));
        return files;
    }

    // ---------- http ----------

    private sealed record HttpCall(HttpMethod Method, Uri Url, List<(string Name, string Value)> Headers, string? Body, TimeSpan Timeout);

    private sealed record HttpOutcome(bool Ok, int Status, Dictionary<string, string> Headers, string Body, string? Error, long Size = 0, long Modified = 0);

    private static HttpCall? ReadCall(JsValue value, string defaultMethod)
    {
        if (value is not ObjectInstance o) return null;
        var url = o.Get("url");
        if (!url.IsString() || !Uri.TryCreate(url.AsString(), UriKind.Absolute, out var uri)) return null;
        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) return null;
        var method = o.Get("method") is { } m && m.IsString() ? m.AsString().ToUpperInvariant() : defaultMethod;
        var headers = new List<(string, string)>();
        if (o.Get("headers") is ObjectInstance h)
            foreach (var key in h.GetOwnPropertyKeys())
                headers.Add((key.ToString(), h.Get(key).ToString()));
        var body = o.Get("body") is { } b && b.IsString() ? b.AsString() : null;
        var ms = o.Get("timeoutMs") is { } t && t.IsNumber() ? t.AsNumber() : 30_000;
        return new HttpCall(new HttpMethod(method), uri, headers, body, TimeSpan.FromMilliseconds(Math.Clamp(ms, 1_000, 600_000)));
    }

    private static HttpRequestMessage BuildRequest(HttpCall call, HttpContent? content)
    {
        var request = new HttpRequestMessage(call.Method, call.Url) { Content = content };
        foreach (var (name, value) in call.Headers)
        {
            if (name.Equals("Content-Type", StringComparison.OrdinalIgnoreCase))
            {
                if (request.Content is not null && MediaTypeHeaderValue.TryParse(value, out var type))
                    request.Content.Headers.ContentType = type;
                continue;
            }
            if (!request.Headers.TryAddWithoutValidation(name, value))
                request.Content?.Headers.TryAddWithoutValidation(name, value);
        }
        return request;
    }

    private static Dictionary<string, string> ReadHeaders(HttpResponseMessage response)
    {
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var h in response.Headers.Concat(response.Content.Headers))
            headers[h.Key.ToLowerInvariant()] = string.Join(", ", h.Value);
        return headers;
    }

    private static async Task<string> ReadTextAsync(HttpResponseMessage response, CancellationToken ct)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await stream.ReadAsync(chunk, ct)) > 0)
        {
            if (buffer.Length + read > MaxBodyBytes) throw new IOException("The response is too large");
            buffer.Write(chunk, 0, read);
        }
        return Encoding.UTF8.GetString(buffer.GetBuffer(), 0, (int)buffer.Length);
    }

    private static HttpOutcome Failed(Exception ex) => new(false, 0, [], "",
        ex is OperationCanceledException ? "Timed out" : ex.InnerException?.Message ?? ex.Message);

    /// <summary>Run <paramref name="work"/> off the lock, then hand its outcome to the plugin's callback under it.</summary>
    private void RunAsync(Engine engine, string pluginId, JsValue? callback, Func<Task<HttpOutcome>> work)
    {
        _ = Task.Run(async () =>
        {
            HttpOutcome outcome;
            try { outcome = await work(); }
            catch (Exception ex) { outcome = Failed(ex); }
            if (callback is null) return;
            lock (_lock)
            {
                // Reloaded or unloaded since: this engine is gone.
                if (!_plugins.TryGetValue(pluginId, out var s) || !ReferenceEquals(s.JintEngine, engine)) return;
                try
                {
                    var o = new JsObject(engine);
                    o.Set("ok", outcome.Ok ? JsBoolean.True : JsBoolean.False);
                    o.Set("status", new JsNumber(outcome.Status));
                    var headers = new JsObject(engine);
                    foreach (var (k, v) in outcome.Headers) headers.Set(k, v);
                    o.Set("headers", headers);
                    o.Set("body", outcome.Body);
                    o.Set("error", outcome.Error is null ? JsValue.Null : outcome.Error);
                    o.Set("size", new JsNumber(outcome.Size));
                    o.Set("modified", new JsNumber(outcome.Modified));
                    callback.Call(o);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "plugin {PluginId} http callback threw", pluginId);
                }
            }
        });
    }

    private JsObject BuildHttp(Engine engine, string pluginId)
    {
        var http = new JsObject(engine);
        static JsValue? Callback(JsValue[] args, int index) => args.Length > index && args[index] is ObjectInstance fn ? fn : null;

        // request({ method, url, headers, body, timeoutMs }, callback)
        //   callback({ ok, status, headers, body, error })
        http.Set("request", new ClrFunction(engine, "request", (_, args) =>
        {
            var call = args.Length > 0 ? ReadCall(args[0], "GET") : null;
            var callback = Callback(args, 1);
            if (call is null) return JsBoolean.False;
            RunAsync(engine, pluginId, callback, async () =>
            {
                using var cts = new CancellationTokenSource(call.Timeout);
                using var request = BuildRequest(call, call.Body is null ? null : new StringContent(call.Body, Encoding.UTF8));
                using var response = await PluginHttp.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cts.Token);
                var body = await ReadTextAsync(response, cts.Token);
                return new HttpOutcome(response.IsSuccessStatusCode, (int)response.StatusCode, ReadHeaders(response), body, null);
            });
            return JsBoolean.True;
        }));

        if (!Allowed(pluginId, FilesPermission)) return http;

        // download({ url, headers, timeoutMs }, libraryPath, callback): the
        // response goes straight to a file in the library, replacing it only
        // once it has arrived whole. callback({ ok, status, size, modified, error })
        http.Set("download", new ClrFunction(engine, "download", (_, args) =>
        {
            var call = args.Length > 0 ? ReadCall(args[0], "GET") : null;
            var target = LibraryPath(args.Length > 1 && args[1].IsString() ? args[1].AsString() : null);
            var callback = Callback(args, 2);
            if (call is null || target is null) return JsBoolean.False;
            RunAsync(engine, pluginId, callback, async () =>
            {
                using var cts = new CancellationTokenSource(call.Timeout);
                using var request = BuildRequest(call, null);
                using var response = await PluginHttp.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cts.Token);
                if (!response.IsSuccessStatusCode)
                    return new HttpOutcome(false, (int)response.StatusCode, ReadHeaders(response), "", null);
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                var temp = Path.Combine(Path.GetDirectoryName(target)!, $".{Path.GetFileName(target)}.part");
                try
                {
                    await using (var file = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None))
                    {
                        await response.Content.CopyToAsync(file, cts.Token);
                        await file.FlushAsync(cts.Token);
                    }
                    File.Move(temp, target, overwrite: true);
                }
                finally
                {
                    if (File.Exists(temp)) File.Delete(temp);
                }
                var info = new FileInfo(target);
                return new HttpOutcome(true, (int)response.StatusCode, ReadHeaders(response), "", null,
                    info.Length, new DateTimeOffset(info.LastWriteTimeUtc).ToUnixTimeMilliseconds());
            });
            return JsBoolean.True;
        }));

        // upload(libraryPath, { method, url, headers, timeoutMs }, callback):
        // sends a library file as the request body (PUT unless told otherwise).
        http.Set("upload", new ClrFunction(engine, "upload", (_, args) =>
        {
            var source = LibraryPath(args.Length > 0 && args[0].IsString() ? args[0].AsString() : null);
            var call = args.Length > 1 ? ReadCall(args[1], "PUT") : null;
            var callback = Callback(args, 2);
            if (call is null || source is null) return JsBoolean.False;
            RunAsync(engine, pluginId, callback, async () =>
            {
                using var cts = new CancellationTokenSource(call.Timeout);
                await using var file = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read);
                var size = file.Length;
                var modified = new DateTimeOffset(File.GetLastWriteTimeUtc(source)).ToUnixTimeMilliseconds();
                using var request = BuildRequest(call, new StreamContent(file));
                using var response = await PluginHttp.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cts.Token);
                var body = await ReadTextAsync(response, cts.Token);
                return new HttpOutcome(response.IsSuccessStatusCode, (int)response.StatusCode, ReadHeaders(response), body, null, size, modified);
            });
            return JsBoolean.True;
        }));
        return http;
    }
}
