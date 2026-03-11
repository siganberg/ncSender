using NcSender.Server;
using Serilog;

try
{
    var app = ServerBuilder.Build(args);
    app.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, "Application terminated unexpectedly");
}
finally
{
    Log.CloseAndFlush();
}
