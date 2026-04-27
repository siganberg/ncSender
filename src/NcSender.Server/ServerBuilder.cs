using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Nodes;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Alarms;
using NcSender.Server.Errors;
using NcSender.Server.SystemApi;
using NcSender.Server.CommandHistory;
using NcSender.Server.CommandProcessor;
using NcSender.Server.Config;
using NcSender.Server.Configuration;
using NcSender.Server.Connection;
using NcSender.Server.Protocols.GrblHal;
using NcSender.Server.Protocols.FluidNc;
using NcSender.Server.Firmware;
using NcSender.Server.GcodeFiles;
using NcSender.Server.Infrastructure;
using NcSender.Server.Job;
using NcSender.Server.Jogging;
using NcSender.Server.Logs;
using NcSender.Server.Macros;
using NcSender.Server.Models;
using NcSender.Server.ControllerFiles;
using NcSender.Server.GcodeAnalysis;
using NcSender.Server.Pendant;
using NcSender.Server.Plugins;
using NcSender.Server.Probing;
using NcSender.Server.Tools;
using NcSender.Server.Updates;
using NcSender.Server.WebSocket;
using Serilog;
using Serilog.Events;

namespace NcSender.Server;

[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class ServerBuilder
{
    public static WebApplication Build(string[] args, Action<WebApplicationBuilder>? configure = null)
    {
        var settingsManager = new SettingsManager();
        var serverPort = settingsManager.GetSetting<int>("connection.serverPort", 8090);
        var port = int.TryParse(Environment.GetEnvironmentVariable("PORT"), out var envPort)
            ? envPort
            : serverPort;

        // V1-compatible log format: [2026-02-21T15:30:45.123Z] [INFO] [ModuleName] message
        const string outputTemplate = "[{Timestamp:yyyy-MM-ddTHH:mm:ss.fffZ}] [{Level:u4}] [{SourceContext}] {Message:lj}{NewLine}{Exception}";

        var logsDir = PathUtils.GetLogsDir();
        Directory.CreateDirectory(logsDir);

        var logConfig = new LoggerConfiguration()
            .MinimumLevel.Information()
            .MinimumLevel.Override("Microsoft.AspNetCore", LogEventLevel.Warning)
            .MinimumLevel.Override("Microsoft.Hosting", LogEventLevel.Warning)
            .Enrich.FromLogContext()
            .Enrich.With(new ShortSourceContextEnricher());

        // Only enable Console sink when not running under Electron.
        // In packaged mode, stdout goes to /dev/null and Console output causes
        // unnecessary overhead that correlates with server crashes during G-code streaming.
        if (Environment.GetEnvironmentVariable("NCSENDER_PACKAGED") is null)
        {
            logConfig = logConfig.WriteTo.Console(
                outputTemplate: outputTemplate,
                theme: Serilog.Sinks.SystemConsole.Themes.AnsiConsoleTheme.Literate);
        }

        Log.Logger = logConfig
            .WriteTo.File(
                Path.Combine(logsDir, ".log"),
                outputTemplate: outputTemplate,
                rollingInterval: RollingInterval.Day,
                retainedFileCountLimit: 30,
                shared: true)
            .CreateLogger();

        var builder = WebApplication.CreateBuilder(args);

        builder.Host.UseSerilog();

        // Fast shutdown — don't wait 30s for WebSocket connections to close
        builder.Services.Configure<HostOptions>(opts => opts.ShutdownTimeout = TimeSpan.FromMilliseconds(100));

        // Kestrel: listen on all interfaces, allow 200MB uploads
        builder.WebHost.UseUrls($"http://0.0.0.0:{port}");
        builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 200 * 1024 * 1024);
        builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(options => options.MultipartBodyLengthLimit = 200 * 1024 * 1024);

        // Phase 1 DI registrations
        builder.Services.AddSingleton<ISettingsManager>(settingsManager);
        builder.Services.AddSingleton<WebSocketLayer>();
        builder.Services.AddSingleton<IBroadcaster>(sp => sp.GetRequiredService<WebSocketLayer>());

        // Phase 2 DI registrations
        builder.Services.AddSingleton<IServerContext, ServerContext>();
        builder.Services.AddSingleton<IProtocolHandler, GrblHalProtocol>();
        builder.Services.AddSingleton<IProtocolHandler, FluidNcProtocol>();
        builder.Services.AddSingleton<ICncController, CncController>();
        builder.Services.AddSingleton<CncEventBridge>();
        builder.Services.AddSingleton<AutoConnectService>();
        builder.Services.AddHostedService(sp => sp.GetRequiredService<AutoConnectService>());

        // Phase 3 DI registrations
        builder.Services.AddSingleton<NcSender.Server.CommandProcessor.CommandProcessor>();
        builder.Services.AddSingleton<IGcodeFileService, GcodeFileService>();
        builder.Services.AddSingleton<IJobManager, JobManager>();

        // Phase 4 DI registrations
        builder.Services.AddSingleton<ICommandHistoryService, CommandHistoryService>();
        builder.Services.AddSingleton<IMacroService, MacroService>();
        builder.Services.AddSingleton<IToolService, ToolService>();
        builder.Services.AddSingleton<IFirmwareService, FirmwareService>();
        builder.Services.AddSingleton<IConfigService, ConfigService>();
        builder.Services.AddSingleton<IAlarmService, AlarmService>();
        builder.Services.AddSingleton<IErrorService, ErrorService>();
        builder.Services.AddSingleton<ILogService, LogService>();
        builder.Services.AddSingleton<IProbeService, ProbeService>();
        builder.Services.AddSingleton<IJogManager, JogManager>();

        // Phase 5 DI registrations
        builder.Services.AddSingleton<NcSender.Server.Plugins.PluginDialogDispatcher>();
        builder.Services.AddSingleton<IJsPluginEngine, JsPluginEngine>();
        builder.Services.AddSingleton<ICommandProcessor>(sp =>
            new NcSender.Server.CommandProcessor.PluginCommandProcessor(
                sp.GetRequiredService<NcSender.Server.CommandProcessor.CommandProcessor>(),
                sp.GetRequiredService<IJsPluginEngine>(),
                sp.GetRequiredService<IToolService>(),
                sp.GetRequiredService<IServerContext>(),
                sp.GetRequiredService<IBroadcaster>(),
                sp.GetRequiredService<ISettingsManager>(),
                sp.GetRequiredService<ILogger<NcSender.Server.CommandProcessor.PluginCommandProcessor>>()
            ));
        builder.Services.AddSingleton<IPluginManager, PluginManager>();
        builder.Services.AddSingleton<IGcodeAnalyzer, GcodeStateAnalyzer>();
        builder.Services.AddSingleton<IControllerFileService, ControllerFileService>();
        builder.Services.AddSingleton<IPendantManager, PendantManager>();
        builder.Services.AddSingleton<IUpdateService, UpdateService>();

        // Register source-gen JSON context for AOT-compatible serialization.
        // In dev (JIT) mode the default reflection resolver is already present;
        // in AOT builds (/p:PublishAot=true) only source-gen types work.
        builder.Services.ConfigureHttpJsonOptions(options =>
        {
            options.SerializerOptions.TypeInfoResolverChain.Insert(0, NcSenderJsonContext.Default);
        });

        builder.Services.AddCors(options =>
        {
            options.AddDefaultPolicy(policy =>
            {
                policy.AllowAnyOrigin()
                      .AllowAnyMethod()
                      .AllowAnyHeader();
            });
        });

        configure?.Invoke(builder);

        var app = builder.Build();

        var version = BuildVersion.Value.Contains("-dev", StringComparison.Ordinal) ? "dev" : BuildVersion.Value;
        Log.Information("ncSender v{Version} on {OS}",
            version, $"{System.Runtime.InteropServices.RuntimeInformation.OSDescription} ({System.Runtime.InteropServices.RuntimeInformation.OSArchitecture})");
        Log.Information("Listening on port {Port}", port);
        Log.Information("Data directory: {DataDir}", PathUtils.GetUserDataDir());

        // Ensure data directories exist
        PathUtils.EnsureDirectories();

        // Eagerly create CncEventBridge to wire controller events → WebSocket broadcasts
        _ = app.Services.GetRequiredService<CncEventBridge>();

        // Inject controller and job manager into WebSocketLayer for message routing
        var wsLayer = app.Services.GetRequiredService<WebSocketLayer>();
        var controller = app.Services.GetRequiredService<ICncController>();
        wsLayer.SetController(controller);
        var jobManager = app.Services.GetRequiredService<IJobManager>();
        wsLayer.SetJobManager(jobManager);
        var jogManager = app.Services.GetRequiredService<IJogManager>();
        wsLayer.SetJogManager(jogManager);
        var commandProcessor = app.Services.GetRequiredService<ICommandProcessor>();
        wsLayer.SetCommandProcessor(commandProcessor);
        var dialogDispatcher = app.Services.GetRequiredService<NcSender.Server.Plugins.PluginDialogDispatcher>();
        wsLayer.SetDialogDispatcher(dialogDispatcher);

        // Eagerly create PluginManager to load enabled command plugins into JsPluginEngine
        _ = app.Services.GetRequiredService<IPluginManager>();

        app.UseCors();
        app.Use(async (context, next) =>
        {
            if (context.Request.Path.StartsWithSegments("/api")
                && !context.Request.Path.StartsWithSegments("/api/pendant/status"))
            {
                var logger = context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("ApiRequest");

                // Capture request body for mutation methods (skip binary uploads)
                string? body = null;
                var method = context.Request.Method;
                var contentType = context.Request.ContentType ?? "";
                var isBinary = contentType.Contains("octet-stream") || contentType.Contains("multipart/form-data");
                var isLargePayload = context.Request.ContentLength > 1024
                    || context.Request.Path.StartsWithSegments("/api/gcode-files");
                if (method is "POST" or "PATCH" or "PUT" && context.Request.ContentLength > 0 && !isBinary && !isLargePayload)
                {
                    context.Request.EnableBuffering();
                    using var reader = new StreamReader(context.Request.Body, leaveOpen: true);
                    body = await reader.ReadToEndAsync();
                    context.Request.Body.Position = 0;
                }

                var sw = System.Diagnostics.Stopwatch.StartNew();
                await next();
                sw.Stop();

                if (body is not null)
                    logger.LogInformation("API {Method} {Path} {Body} responded {StatusCode} in {Elapsed}ms",
                        method, context.Request.Path, body, context.Response.StatusCode, sw.ElapsedMilliseconds);
                else
                    logger.LogInformation("API {Method} {Path} responded {StatusCode} in {Elapsed}ms",
                        method, context.Request.Path, context.Response.StatusCode, sw.ElapsedMilliseconds);
            }
            else
            {
                await next();
            }
        });
        app.UseWebSockets();

        // WebSocket endpoint at root path
        app.Map("/", async (HttpContext context, WebSocketLayer ws) =>
        {
            if (context.WebSockets.IsWebSocketRequest)
            {
                await ws.HandleConnection(context);
                return;
            }

            // SPA fallback: serve index.html for non-API, non-file requests
            var clientDist = FindClientDist();
            if (clientDist is not null)
            {
                var indexPath = Path.Combine(clientDist, "index.html");
                if (File.Exists(indexPath))
                {
                    context.Response.ContentType = "text/html";
                    context.Response.Headers.CacheControl = "no-cache, no-store, must-revalidate";
                    await context.Response.SendFileAsync(indexPath);
                    return;
                }
            }

            await context.Response.WriteAsync("ncSender Server v2 running. No client dist found.");
        });

        // Static files from client/dist
        var clientDistPath = FindClientDist();
        if (clientDistPath is not null)
        {
            app.UseStaticFiles(new StaticFileOptions
            {
                FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(clientDistPath),
                RequestPath = "",
                ServeUnknownFileTypes = true,
                OnPrepareResponse = ctx =>
                {
                    ctx.Context.Response.Headers.CacheControl = "no-cache, no-store, must-revalidate";
                }
            });
        }

        // SPA fallback for deep-linked routes (non-API, non-file paths)
        app.MapFallback(async context =>
        {
            if (context.Request.Path.StartsWithSegments("/api"))
            {
                context.Response.StatusCode = 404;
                return;
            }

            var dist = FindClientDist();
            if (dist is not null)
            {
                var indexPath = Path.Combine(dist, "index.html");
                if (File.Exists(indexPath))
                {
                    context.Response.ContentType = "text/html";
                    context.Response.Headers.CacheControl = "no-cache, no-store, must-revalidate";
                    await context.Response.SendFileAsync(indexPath);
                    return;
                }
            }

            context.Response.StatusCode = 404;
        });

        // API endpoints
        MapApiEndpoints(app);

        // Phase 3 endpoints
        GcodeFileEndpoints.Map(app);
        JobEndpoints.Map(app);

        // Phase 4 endpoints
        CommandHistoryEndpoints.Map(app);
        MacroEndpoints.Map(app);
        ToolEndpoints.Map(app);
        FirmwareEndpoints.Map(app);
        ConfigEndpoints.Map(app);
        AlarmEndpoints.Map(app);
        LogEndpoints.Map(app);
        ProbeEndpoints.Map(app);

        // Phase 5 endpoints
        PluginEndpoints.Map(app);
        GcodeAnalysisEndpoints.Map(app);
        ControllerFileEndpoints.Map(app);
        PendantEndpoints.Map(app);
        UpdateEndpoints.Map(app);
        SystemApi.SystemEndpoints.Map(app);

        // Eagerly resolve PendantManager so its constructor subscribes to
        // CncController.ConnectionStatusChanged before the controller connects.
        // Auto-connect will fire automatically when the CNC connection is established.
        app.Services.GetRequiredService<IPendantManager>();

        // Restore last loaded program from previous session
        RestoreLastLoadedFile(app.Services);

        return app;
    }

    private static void RestoreLastLoadedFile(IServiceProvider services)
    {
        var settingsManager = services.GetRequiredService<ISettingsManager>();
        var lastLoadedFile = settingsManager.GetSetting<string>("lastLoadedFile");
        if (string.IsNullOrEmpty(lastLoadedFile))
            return;

        var gcodeService = services.GetRequiredService<IGcodeFileService>();
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("ServerBuilder");

        try
        {
            // Skip plugin transforms on startup-restore: no clients are connected yet,
            // so a plugin that calls showDialog would block the server boot indefinitely.
            gcodeService.LoadFileAsync(lastLoadedFile, applyPluginTransforms: false).GetAwaiter().GetResult();
            logger.LogInformation("Restored last loaded file: {Path}", lastLoadedFile);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to restore last loaded file: {Path}", lastLoadedFile);
            settingsManager.SaveSettings(new System.Text.Json.Nodes.JsonObject { ["lastLoadedFile"] = null })
                .GetAwaiter().GetResult();
        }
    }

    private static void MapApiEndpoints(WebApplication app)
    {
        app.MapGet("/api/health", () => Results.Ok(new HealthResponse("ok", DateTime.UtcNow.ToString("o"))));

        app.MapGet("/api/server-state", (IServerContext ctx) =>
        {
            ctx.UpdateSenderStatus();
            return Results.Ok(ctx.State);
        });

        // V1 client bootstrap endpoint — returns all init data in one call
        app.MapGet("/api/init", async (
            HttpContext context,
            IServerContext ctx,
            ISettingsManager sm,
            ICommandHistoryService cmdHistory,
            IMacroService macros,
            IToolService tools,
            IFirmwareService firmware,
            IPluginManager pluginManager) =>
        {
            ctx.UpdateSenderStatus();
            var toolList = await tools.GetAllAsync();
            var firmwareData = await firmware.GetCachedAsync();
            var loadedPlugins = pluginManager.ListLoaded();
            var isKiosk = File.Exists("/etc/ncsender/rotation");
            var rotationFile = "/etc/ncsender/rotation";
            var rotation = File.Exists(rotationFile) ? (await File.ReadAllTextAsync(rotationFile)).Trim() : "normal";
            var remoteIp = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            var isLocal = remoteIp is "127.0.0.1" or "::1" or "::ffff:127.0.0.1" or "localhost";

            return Results.Ok(new InitResponse(
                sm.ReadAll(),
                macros.ListMacros(),
                firmwareData,
                loadedPlugins,
                cmdHistory.GetHistory(),
                toolList,
                ctx.State,
                isKiosk,
                rotation,
                isLocal));
        });

        app.MapGet("/api/serial-ports", () =>
        {
            try
            {
                var ports = System.IO.Ports.SerialPort.GetPortNames()
                    .Where(p => !p.Contains("Bluetooth", StringComparison.OrdinalIgnoreCase)
                             && !p.Contains("WLAN", StringComparison.OrdinalIgnoreCase)
                             && !p.Contains("WiFi", StringComparison.OrdinalIgnoreCase)
                             && !p.Contains("debug-console", StringComparison.OrdinalIgnoreCase))
                    .Where(p => !OperatingSystem.IsMacOS() || !p.StartsWith("/dev/tty.", StringComparison.Ordinal))
                    .Select(p => new SerialPortItem(p, SystemEndpoints.GetSerialPortManufacturer(p)))
                    .ToArray();
                return Results.Ok(ports);
            }
            catch
            {
                return Results.Ok(Array.Empty<string>());
            }
        });

        app.MapGet("/api/settings", (ISettingsManager sm) =>
        {
            return Results.Ok(sm.ReadAll());
        });

        app.MapPost("/api/settings", async (HttpContext context, ISettingsManager sm, IBroadcaster broadcaster) =>
        {
            var body = await context.Request.ReadFromJsonAsync<System.Text.Json.Nodes.JsonObject>();
            if (body is null) return Results.BadRequest("Invalid JSON");
            await sm.SaveSettings(body);
            if (body.ContainsKey("remoteControl"))
                await broadcaster.Broadcast("remote-control-state",
                    new WsRemoteControlState(sm.GetSetting<bool>("remoteControl.enabled", false)),
                    NcSenderJsonContext.Default.WsRemoteControlState);
            return Results.Ok(new SettingsSaveResponse(true, "Settings saved successfully", sm.ReadAll()));
        });

        app.MapGet("/api/settings/{name}", (string name, ISettingsManager sm) =>
        {
            var value = sm.GetSetting(name);
            return value is not null
                ? Results.Ok(new SettingResponse(name, value))
                : Results.NotFound(new ApiError($"Setting '{name}' not found"));
        });

        app.MapPatch("/api/settings", async (HttpContext context, ISettingsManager sm, IBroadcaster broadcaster, IPendantManager pendant) =>
        {
            var body = await context.Request.ReadFromJsonAsync<System.Text.Json.Nodes.JsonObject>();
            if (body is null) return Results.BadRequest("Invalid JSON");

            await sm.SaveSettings(body);
            using var settingsDoc = System.Text.Json.JsonDocument.Parse(body.ToJsonString());
            await broadcaster.Broadcast("settings-changed", settingsDoc.RootElement.Clone());
            if (body.ContainsKey("remoteControl"))
                await broadcaster.Broadcast("remote-control-state",
                    new WsRemoteControlState(sm.GetSetting<bool>("remoteControl.enabled", false)),
                    NcSenderJsonContext.Default.WsRemoteControlState);
            pendant.NotifySettingsChanged();

            return Results.Ok(new SettingsSaveResponse(true, "Settings updated successfully", sm.ReadAll()));
        });

        // Phase 2: CNC endpoints
        app.MapGet("/api/cnc/status", (ICncController cnc) =>
        {
            return Results.Ok(new CncStatusResponse(cnc.IsConnected, cnc.ConnectionStatus));
        });

        app.MapPost("/api/cnc/connect", async (ICncController cnc, ISettingsManager sm) =>
        {
            var settings = new ConnectionSettings
            {
                Type = sm.GetSetting<string>("connection.type") ?? "usb",
                UsbPort = sm.GetSetting<string>("connection.usbPort") ?? "",
                BaudRate = sm.GetSetting<int>("connection.baudRate", 115200),
                Ip = sm.GetSetting<string>("connection.ip") ?? "192.168.5.1",
                Port = sm.GetSetting<int>("connection.port", 23),
                Protocol = sm.GetSetting<string>("connection.protocol") ?? "telnet",
            };

            try
            {
                await cnc.ConnectAsync(settings);
                return Results.Ok(new ConnectSuccessResponse(true, cnc.ConnectionStatus));
            }
            catch (Exception ex)
            {
                return Results.Ok(new ConnectFailResponse(false, ex.Message));
            }
        });

        app.MapPost("/api/cnc/disconnect", (ICncController cnc) =>
        {
            cnc.Disconnect();
            return Results.Ok(new ApiSuccess(true));
        });

        app.MapPost("/api/send-command", async (HttpContext context,
            ICncController cnc, ICommandProcessor processor, IServerContext serverContext) =>
        {
            var request = await context.Request.ReadFromJsonAsync<SendCommandRequest>();
            if (request is null || string.IsNullOrWhiteSpace(request.Command))
                return Results.BadRequest("Command is required");

            try
            {
                // Support both flat sourceId and nested meta.sourceId (V1 client sends nested)
                var sourceId = request.Meta?.SourceId ?? request.SourceId;
                var meta = sourceId is not null
                    ? new CommandMeta
                    {
                        SourceId = sourceId,
                        Silent = request.Meta?.Silent ?? false,
                        Continuous = request.Meta?.Continuous ?? false
                    }
                    : null;

                // Translate hex byte input (0xHH or \xHH) to actual byte — V1: translateCommandInput
                var command = request.Command.Trim();
                string? hexDisplay = null;
                if (command.Length == 4
                    && (command.StartsWith("0x", StringComparison.OrdinalIgnoreCase)
                        || command.StartsWith("\\x", StringComparison.OrdinalIgnoreCase)))
                {
                    var hexPart = command[2..];
                    if (byte.TryParse(hexPart, System.Globalization.NumberStyles.HexNumber, null, out var b))
                    {
                        hexDisplay = $"0x{hexPart.ToUpperInvariant()}";
                        command = ((char)b).ToString();
                    }
                }

                var processorContext = new CommandProcessorContext
                {
                    CommandId = request.CommandId,
                    Meta = meta,
                    MachineState = serverContext.State.MachineState,
                    LineNumber = 0
                };

                var result = await processor.ProcessAsync(command, processorContext);

                if (!result.ShouldContinue)
                    return Results.Ok(new SendSkippedResponse("skipped", result.SkipReason));

                // Send each processed command — V1 parity: unique ID per command,
                // display falls back to actual command text, not the original request
                CommandResult? lastResult = null;
                foreach (var cmd in result.Commands)
                {
                    var cmdId = $"{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{Guid.NewGuid():N}"[..24];
                    var cmdDisplay = cmd.DisplayCommand ?? hexDisplay ?? cmd.Command;
                    var options = new CommandOptions
                    {
                        CommandId = cmdId,
                        DisplayCommand = cmdDisplay,
                        Meta = cmd.Meta ?? meta
                    };
                    lastResult = await cnc.SendCommandAsync(cmd.Command, options);
                }
                return Results.Ok(lastResult);
            }
            catch (Exception ex)
            {
                return Results.Ok(new SendErrorResponse("error", ex.Message));
            }
        });
    }

    /// <summary>
    /// Revert spindle to the default defined in firmware setting $395.
    /// Queries $spindlesh to map the firmware spindle id to the M104Q spindle index.
    /// </summary>
    /// <summary>
    /// Send a command to the CNC controller and broadcast it to all clients so it appears in the terminal.
    /// </summary>
    private static async Task SendAndBroadcastCommand(ICncController cnc, IBroadcaster broadcaster, string cmd)
    {
        var id = Guid.NewGuid().ToString();
        var ts = DateTime.UtcNow.ToString("o");

        await broadcaster.Broadcast("cnc-command", new WsCncCommandStatus(
            id, cmd, cmd, "pending", ts, "system"
        ), NcSenderJsonContext.Default.WsCncCommandStatus);

        await cnc.SendCommandAsync(cmd, new CommandOptions { Meta = new CommandMeta { SourceId = "system" } });

        await broadcaster.Broadcast("cnc-command-result", new WsCncCommandStatus(
            id, cmd, cmd, "success", DateTime.UtcNow.ToString("o"), "system"
        ), NcSenderJsonContext.Default.WsCncCommandStatus);
    }

    private static string? FindClientDist()
    {
        // Look for client/dist relative to the application root
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "client", "dist"),
            Path.Combine(AppContext.BaseDirectory, "..", "client", "dist"),
            Path.Combine(AppContext.BaseDirectory, "resources", "client", "dist"), // Electron packaged
            Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "client", "dist"),
            Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "NcSender.Server", "client", "dist"),
            Path.Combine(Directory.GetCurrentDirectory(), "client", "dist")
        };

        return candidates.FirstOrDefault(Directory.Exists);
    }
}
