using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using NcSender.Core.Interfaces;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.ControllerFiles;

[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class ControllerFileEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/controller-files", async (IControllerFileService fileService) =>
        {
            try
            {
                var files = await fileService.ListFilesAsync();
                return Results.Ok(new ControllerFileListResponse(files));
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });

        app.MapPost("/api/controller-files/run", async (HttpContext context, IControllerFileService fileService) =>
        {
            var body = await context.Request.ReadFromJsonAsync<ControllerRunRequest>();
            if (body?.Name is null)
                return Results.BadRequest(new ApiError("name required"));

            try
            {
                await fileService.RunFileAsync(body.Name);
                return Results.Ok(new ApiSuccess(true));
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });

        app.MapPost("/api/controller-files/delete", async (HttpContext context, IControllerFileService fileService) =>
        {
            var body = await context.Request.ReadFromJsonAsync<ControllerRunRequest>();
            if (body?.Name is null)
                return Results.BadRequest(new ApiError("name required"));

            try
            {
                await fileService.DeleteFileAsync(body.Name);
                return Results.Ok(new ApiSuccess(true));
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });

        app.MapGet("/api/controller-files/read", async (string name, IControllerFileService fileService) =>
        {
            try
            {
                var content = await fileService.ReadFileAsync(name);
                return Results.Ok(new ContentResponse(content));
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new ApiError(ex.Message));
            }
        });

        // SSE endpoint for upload progress
        app.MapPost("/api/controller-files/upload", async (HttpContext context, IControllerFileService fileService) =>
        {
            if (!context.Request.HasFormContentType)
                return Results.BadRequest(new ApiError("Form data required"));

            var form = await context.Request.ReadFormAsync();
            var file = form.Files.GetFile("file");
            var name = form["name"].ToString();

            if (file is null || string.IsNullOrEmpty(name))
                return Results.BadRequest(new ApiError("file and name required"));

            context.Response.ContentType = "text/event-stream";
            context.Response.Headers.CacheControl = "no-cache";

            try
            {
                using var ms = new MemoryStream();
                await file.CopyToAsync(ms);
                var data = ms.ToArray();

                await fileService.UploadFileAsync(name, data, async progress =>
                {
                    var json = JsonSerializer.Serialize(new SseProgress(progress), NcSenderJsonContext.Default.SseProgress);
                    await context.Response.WriteAsync($"data: {json}\n\n");
                    await context.Response.Body.FlushAsync();
                });

                var doneJson = JsonSerializer.Serialize(new SseDone(100.0, true), NcSenderJsonContext.Default.SseDone);
                await context.Response.WriteAsync($"data: {doneJson}\n\n");
                await context.Response.Body.FlushAsync();
            }
            catch (Exception ex)
            {
                var errorJson = JsonSerializer.Serialize(new SseError(ex.Message), NcSenderJsonContext.Default.SseError);
                await context.Response.WriteAsync($"data: {errorJson}\n\n");
                await context.Response.Body.FlushAsync();
            }

            return Results.Empty;
        });

        // SSE endpoint for save progress
        app.MapPost("/api/controller-files/save", async (HttpContext context, IControllerFileService fileService) =>
        {
            var body = await context.Request.ReadFromJsonAsync<ControllerSaveRequest>();
            if (body?.Name is null || body.Content is null)
                return Results.BadRequest(new ApiError("name and content required"));

            context.Response.ContentType = "text/event-stream";
            context.Response.Headers.CacheControl = "no-cache";

            try
            {
                await fileService.SaveFileAsync(body.Name, body.Content, async progress =>
                {
                    var json = JsonSerializer.Serialize(new SseProgress(progress), NcSenderJsonContext.Default.SseProgress);
                    await context.Response.WriteAsync($"data: {json}\n\n");
                    await context.Response.Body.FlushAsync();
                });

                var doneJson = JsonSerializer.Serialize(new SseDone(100.0, true), NcSenderJsonContext.Default.SseDone);
                await context.Response.WriteAsync($"data: {doneJson}\n\n");
                await context.Response.Body.FlushAsync();
            }
            catch (Exception ex)
            {
                var errorJson = JsonSerializer.Serialize(new SseError(ex.Message), NcSenderJsonContext.Default.SseError);
                await context.Response.WriteAsync($"data: {errorJson}\n\n");
                await context.Response.Body.FlushAsync();
            }

            return Results.Empty;
        });
    }

}
