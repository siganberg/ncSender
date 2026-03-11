using System.Diagnostics.CodeAnalysis;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Tools;

[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class ToolEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/tools", async (IToolService svc) =>
        {
            var tools = await svc.GetAllAsync();
            return Results.Ok(tools);
        });

        app.MapGet("/api/tools/info", () =>
        {
            return Results.Ok(new ToolStorageResponse(PathUtils.GetToolsPath()));
        });

        app.MapGet("/api/tools/{id:int}", async (int id, IToolService svc) =>
        {
            var tool = await svc.GetByIdAsync(id);
            return tool is not null ? Results.Ok(tool) : Results.NotFound();
        });

        app.MapPost("/api/tools", async (ToolInfo tool, IToolService svc) =>
        {
            try
            {
                var created = await svc.AddAsync(tool);
                return Results.Created($"/api/tools/{created.Id}", created);
            }
            catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });

        app.MapPut("/api/tools/{id:int}", async (int id, ToolInfo tool, IToolService svc) =>
        {
            try
            {
                var updated = await svc.UpdateAsync(id, tool);
                return updated is not null ? Results.Ok(updated) : Results.NotFound();
            }
            catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });

        app.MapDelete("/api/tools/{id:int}", async (int id, IToolService svc) =>
        {
            var deleted = await svc.DeleteAsync(id);
            return deleted ? Results.Ok(new ApiSuccess(true)) : Results.NotFound();
        });

        app.MapPut("/api/tools", async (List<ToolInfo> tools, IToolService svc) =>
        {
            try
            {
                await svc.BulkUpdateAsync(tools);
                return Results.Ok(new ApiSuccess(true));
            }
            catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });
    }
}
