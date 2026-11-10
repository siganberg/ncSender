using System.Net;
using System.Text;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;
using NcSender.Server.Plugins;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace NcSender.Server.Tests;

// pluginContext.http / files / storage and the window → plugin request
// channel, which the Vaultix sync plugin is built on.
public class PluginHostApiTests : IDisposable
{
    private readonly JsPluginEngine _engine;
    private readonly DirectoryInfo _dir = Directory.CreateTempSubdirectory();
    private readonly string _library = PathUtils.GetGcodeFilesDir();
    private readonly string _id = $"host{Guid.NewGuid():N}";

    public PluginHostApiTests()
    {
        var serverContext = new Mock<IServerContext>();
        serverContext.Setup(c => c.State).Returns(new ServerState());
        _engine = new JsPluginEngine(
            NullLogger<JsPluginEngine>.Instance,
            new PluginDialogDispatcher(new Mock<IBroadcaster>().Object, NullLogger<PluginDialogDispatcher>.Instance),
            new Mock<IGateService>().Object, new Mock<IToolService>().Object, new Mock<IDongleDeviceService>().Object,
            new Mock<NcSender.Server.Tools.IPendingToolTloWriteback>().Object, serverContext.Object,
            new Mock<IFirmwareService>().Object, new Mock<ICncController>().Object, new Mock<IServiceProvider>().Object);
        Directory.CreateDirectory(_library);
    }

    public void Dispose()
    {
        _engine.UnloadPlugin(_id);
        _dir.Delete(true);
        var folder = Path.Combine(_library, _id);
        if (Directory.Exists(folder)) Directory.Delete(folder, true);
        var config = Path.GetDirectoryName(JsPluginEngine.PrivatePath(_id))!;
        if (Directory.Exists(config)) Directory.Delete(config, true);
    }

    private void Load(string script, params string[] permissions)
    {
        var file = Path.Combine(_dir.FullName, "commands.js");
        File.WriteAllText(file, "function buildInitialConfig(raw) { return raw; }\n" + script);
        _engine.SetPermissions(_id, permissions);
        _engine.LoadPlugin(_id, file, new());
    }

    private string? Ask(string json) => _engine.HandleRequest(_id, json);

    private async Task<string> WaitFor(string json, Func<string, bool> done)
    {
        for (var i = 0; i < 100; i++)
        {
            var answer = Ask(json) ?? "";
            if (done(answer)) return answer;
            await Task.Delay(50);
        }
        return Ask(json) ?? "";
    }

    [Fact]
    public void Request_reaches_onRequest_and_returns_its_answer()
    {
        Load("function onRequest(p) { return { echo: p.word, twice: p.n * 2 }; }");
        Assert.Equal("{\"echo\":\"hi\",\"twice\":4}", Ask("{\"word\":\"hi\",\"n\":2}"));
        Assert.Null(_engine.HandleRequest("not-loaded", "{}"));
    }

    [Fact]
    public void Network_and_files_need_their_permission()
    {
        Load("function onRequest() { return { http: typeof pluginContext.http, files: typeof pluginContext.files, storage: typeof pluginContext.storage, kiosk: typeof pluginContext.isKiosk }; }");
        Assert.Equal("{\"http\":\"undefined\",\"files\":\"undefined\",\"storage\":\"object\",\"kiosk\":\"boolean\"}", Ask("{}"));

        Load("function onRequest() { return { http: typeof pluginContext.http.request, download: typeof pluginContext.http.download, files: typeof pluginContext.files }; }", "network");
        Assert.Equal("{\"http\":\"function\",\"download\":\"undefined\",\"files\":\"undefined\"}", Ask("{}"));
    }

    [Fact]
    public void Storage_keeps_a_value_outside_the_settings_file()
    {
        Load("""
            function onRequest(p) {
              if (p.set) pluginContext.storage.set({ token: p.set });
              var s = pluginContext.storage.get();
              return s ? s.token : null;
            }
            """);
        Assert.Equal("null", Ask("{}"));
        Assert.Equal("\"vx_abc\"", Ask("{\"set\":\"vx_abc\"}"));
        Assert.EndsWith("private.json", JsPluginEngine.PrivatePath(_id));
        Assert.Contains("vx_abc", File.ReadAllText(JsPluginEngine.PrivatePath(_id)));
    }

    [Fact]
    public void Library_paths_cannot_leave_the_library()
    {
        var root = _dir.FullName;
        Assert.Equal(Path.Combine(root, "a", "b.nc"), JsPluginEngine.LibraryPath("a/b.nc", root));
        Assert.Equal(Path.Combine(root, "a.nc"), JsPluginEngine.LibraryPath("/a.nc", root));
        Assert.Null(JsPluginEngine.LibraryPath("../outside.nc", root));
        Assert.Null(JsPluginEngine.LibraryPath("a/../../outside.nc", root));
        Assert.Null(JsPluginEngine.LibraryPath("", root));
    }

    [Fact]
    public void List_skips_dot_files_and_reports_sizes()
    {
        var root = _dir.FullName;
        Directory.CreateDirectory(Path.Combine(root, "sub"));
        File.WriteAllText(Path.Combine(root, "a.nc"), "G0");
        File.WriteAllText(Path.Combine(root, "sub", "b.nc"), "G0 X1");
        File.WriteAllText(Path.Combine(root, "sub", ".b.nc.part"), "half");
        var files = JsPluginEngine.ListLibrary(null, root).OrderBy(f => f.Path).ToList();
        Assert.Equal(["a.nc", "sub/b.nc"], files.Select(f => f.Path));
        Assert.Equal(5, files[1].Size);
        Assert.Equal(["sub/b.nc"], JsPluginEngine.ListLibrary("sub", root).Select(f => f.Path));
    }

    [Fact]
    public async Task Http_request_download_and_upload_round_trip()
    {
        var port = FreePort();
        using var listener = new HttpListener();
        listener.Prefixes.Add($"http://127.0.0.1:{port}/");
        listener.Start();
        string? uploaded = null, auth = null;
        var serving = Task.Run(async () =>
        {
            for (var i = 0; i < 3; i++)
            {
                var ctx = await listener.GetContextAsync();
                var path = ctx.Request.Url!.AbsolutePath;
                if (path == "/hello")
                {
                    auth = ctx.Request.Headers["Authorization"];
                    using var reader = new StreamReader(ctx.Request.InputStream);
                    var body = await reader.ReadToEndAsync();
                    ctx.Response.StatusCode = 207;
                    ctx.Response.Headers["ETag"] = "\"e1\"";
                    await ctx.Response.OutputStream.WriteAsync(Encoding.UTF8.GetBytes($"{ctx.Request.HttpMethod}:{body}"));
                }
                else if (path == "/file.nc" && ctx.Request.HttpMethod == "GET")
                    await ctx.Response.OutputStream.WriteAsync(Encoding.UTF8.GetBytes("G1 X10"));
                else if (ctx.Request.HttpMethod == "PUT")
                {
                    using var reader = new StreamReader(ctx.Request.InputStream);
                    uploaded = await reader.ReadToEndAsync();
                    ctx.Response.StatusCode = 201;
                }
                ctx.Response.Close();
            }
        });

        Load($$"""
            var out = { steps: [] };
            var base = 'http://127.0.0.1:{{port}}';
            function onRequest(p) {
              if (p.go) {
                pluginContext.http.request({ method: 'PROPFIND', url: base + '/hello', headers: { Authorization: 'Bearer t', Depth: '1' }, body: '<x/>' }, function (r) {
                  out.request = { ok: r.ok, status: r.status, body: r.body, etag: r.headers.etag };
                  pluginContext.http.download({ url: base + '/file.nc' }, '{{_id}}/in/file.nc', function (d) {
                    out.download = { ok: d.ok, size: d.size };
                    pluginContext.http.upload('{{_id}}/in/file.nc', { url: base + '/up.nc' }, function (u) {
                      out.upload = { ok: u.ok, status: u.status };
                      out.listed = pluginContext.files.list('{{_id}}').map(function (f) { return f.path; });
                      out.done = true;
                    });
                  });
                });
              }
              return out;
            }
            """, "network", "files");
        Ask("{\"go\":true}");
        var answer = await WaitFor("{}", a => a.Contains("\"done\":true"));
        await serving.WaitAsync(TimeSpan.FromSeconds(5));

        Assert.Contains("\"request\":{\"ok\":true,\"status\":207,\"body\":\"PROPFIND:<x/>\",\"etag\":\"\\\"e1\\\"\"}", answer);
        Assert.Equal("Bearer t", auth);
        Assert.Contains("\"download\":{\"ok\":true,\"size\":6}", answer);
        Assert.Contains("\"upload\":{\"ok\":true,\"status\":201}", answer);
        Assert.Contains($"\"listed\":[\"{_id}/in/file.nc\"]", answer);
        Assert.Equal("G1 X10", uploaded);
        Assert.Equal("G1 X10", File.ReadAllText(Path.Combine(_library, _id, "in", "file.nc")));
    }

    [Fact]
    public async Task A_failed_request_reports_an_error_instead_of_throwing()
    {
        Load($$"""
            var out = {};
            function onRequest(p) {
              if (p.go) pluginContext.http.request({ url: 'http://127.0.0.1:{{FreePort()}}/nothing', timeoutMs: 3000 }, function (r) { out = { ok: r.ok, status: r.status, failed: !!r.error }; });
              return out;
            }
            """, "network");
        Ask("{\"go\":true}");
        Assert.Equal("{\"ok\":false,\"status\":0,\"failed\":true}", await WaitFor("{}", a => a.Contains("failed")));
    }

    private static int FreePort()
    {
        var l = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
        l.Start();
        var port = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return port;
    }
}
