using Serilog.Core;
using Serilog.Events;

namespace NcSender.Server.Infrastructure;

public class ShortSourceContextEnricher : ILogEventEnricher
{
    public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
    {
        if (!logEvent.Properties.TryGetValue("SourceContext", out var sourceContext))
            return;

        var full = sourceContext.ToString().Trim('"');
        var lastDot = full.LastIndexOf('.');
        if (lastDot < 0)
            return;

        var shortName = full[(lastDot + 1)..];
        logEvent.AddOrUpdateProperty(propertyFactory.CreateProperty("SourceContext", shortName));
    }
}
