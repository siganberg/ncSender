using System.Diagnostics.CodeAnalysis;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Macros;

[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class MacroEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/m98-macros", (IMacroService svc) =>
        {
            return Results.Ok(svc.ListMacros());
        });

        app.MapGet("/api/m98-macros/next-id", (IMacroService svc) =>
        {
            var (nextId, minId, maxId) = svc.GetNextAvailableId();
            return Results.Ok(new MacroNextIdResponse(nextId, minId, maxId));
        });

        app.MapGet("/api/m98-macros/{id:int}", (int id, IMacroService svc) =>
        {
            var macro = svc.GetMacro(id);
            return macro is not null ? Results.Ok(macro) : Results.NotFound();
        });

        app.MapPost("/api/m98-macros", async (MacroInfo macro, IMacroService svc) =>
        {
            try
            {
                var created = await svc.CreateMacroAsync(macro);
                return Results.Created($"/api/m98-macros/{created.Id}", created);
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
            catch (InvalidOperationException ex)
            {
                return Results.Conflict(new ApiError(ex.Message));
            }
        });

        app.MapPut("/api/m98-macros/{id:int}", async (int id, MacroInfo macro, IMacroService svc) =>
        {
            var updated = await svc.UpdateMacroAsync(id, macro);
            return updated is not null ? Results.Ok(updated) : Results.NotFound();
        });

        app.MapDelete("/api/m98-macros/{id:int}", async (int id, IMacroService svc) =>
        {
            var deleted = await svc.DeleteMacroAsync(id);
            return deleted ? Results.Ok(new ApiSuccess(true)) : Results.NotFound();
        });

        app.MapPost("/api/m98-macros/{id:int}/execute", async (int id, IMacroService svc, ICncController cnc) =>
        {
            var macro = svc.GetMacro(id);
            if (macro is null)
                return Results.NotFound(new ApiError("Macro not found"));

            if (string.IsNullOrWhiteSpace(macro.Body))
                return Results.BadRequest(new ApiError("Macro has no body"));

            var lines = macro.Body.Split('\n', StringSplitOptions.RemoveEmptyEntries);
            foreach (var line in lines)
            {
                var trimmed = line.Trim();
                if (string.IsNullOrWhiteSpace(trimmed)) continue;
                if (trimmed.StartsWith("(") && trimmed.EndsWith(")")) continue;

                await cnc.SendCommandAsync(trimmed, new CommandOptions
                {
                    Meta = new CommandMeta { SourceId = "macro" }
                });
            }

            return Results.Ok(new MacroExecuteResponse(true, lines.Length));
        });
    }
}
