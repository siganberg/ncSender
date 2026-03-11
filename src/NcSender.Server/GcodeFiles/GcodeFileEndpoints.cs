using System.Diagnostics.CodeAnalysis;
using NcSender.Core.Interfaces;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.GcodeFiles;

[UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
[UnconditionalSuppressMessage("AOT", "IL3050:RequiresDynamicCode", Justification = "Request Delegate Generator handles endpoint AOT compatibility")]
public static class GcodeFileEndpoints
{
    public static void Map(WebApplication app)
    {
        // Upload file
        app.MapPost("/api/gcode-files", async (HttpContext context, IGcodeFileService svc) =>
        {
            var form = await context.Request.ReadFormAsync();
            var file = form.Files.GetFile("file");
            if (file is null || file.Length == 0)
                return Results.BadRequest("No file provided");

            var filename = file.FileName;
            var folder = form["folder"].FirstOrDefault();
            var path = string.IsNullOrEmpty(folder) ? filename : $"{folder}/{filename}";

            await using var stream = file.OpenReadStream();
            await svc.UploadFileAsync(path, stream);

            // Load the uploaded file so it becomes the active G-code
            // (updates server state + broadcasts gcode-updated via WebSocket)
            await svc.LoadFileAsync(path);

            return Results.Ok(new UploadSuccessResponse(true, path));
        });

        // List files tree
        app.MapGet("/api/gcode-files", async (IGcodeFileService svc) =>
        {
            var tree = await svc.ListFilesAsync();
            return Results.Ok(tree);
        });

        // Load from storage
        app.MapPost("/api/gcode-files/load", async (HttpContext context, IGcodeFileService svc) =>
        {
            var body = await context.Request.ReadFromJsonAsync<LoadFileRequest>();
            if (body?.Path is null)
                return Results.BadRequest("Path is required");

            try
            {
                await svc.LoadFileAsync(body.Path);
                return Results.Ok(new ApiSuccess(true));
            }
            catch (FileNotFoundException ex)
            {
                return Results.NotFound(new ApiError(ex.Message));
            }
        });

        // Load temp content
        app.MapPost("/api/gcode-files/load-temp", async (HttpContext context, IGcodeFileService svc) =>
        {
            var body = await context.Request.ReadFromJsonAsync<LoadTempRequest>();
            if (body?.Content is null || body.Filename is null)
                return Results.BadRequest("Content and filename are required");

            await svc.LoadTempContentAsync(body.Content, body.Filename, body.SourceFile);
            return Results.Ok(new ApiSuccess(true));
        });

        // Download cached file
        app.MapGet("/api/gcode-files/current/download", async (IGcodeFileService svc) =>
        {
            var stream = await svc.GetCurrentDownloadStreamAsync();
            if (stream is null)
                return Results.NotFound("No file loaded");

            return Results.File(stream, "text/plain", "current.gcode");
        });

        // Get file content
        app.MapGet("/api/gcode-files/file", async (string path, IGcodeFileService svc) =>
        {
            var content = await svc.GetFileAsync(path);
            if (content is null)
                return Results.NotFound("File not found");

            return Results.Ok(new ContentResponse(content));
        });

        // Save file content
        app.MapPost("/api/gcode-files/file/save", async (HttpContext context, IGcodeFileService svc) =>
        {
            var body = await context.Request.ReadFromJsonAsync<SaveFileRequest>();
            if (body?.Path is null || body.Content is null)
                return Results.BadRequest("Path and content are required");

            await svc.SaveFileAsync(body.Path, body.Content);
            return Results.Ok(new ApiSuccess(true));
        });

        // Delete file
        app.MapPost("/api/gcode-files/file/delete", async (HttpContext context, IGcodeFileService svc) =>
        {
            var body = await context.Request.ReadFromJsonAsync<GcodePathRequest>();
            if (body?.Path is null)
                return Results.BadRequest("Path is required");

            await svc.DeleteFileAsync(body.Path);
            return Results.Ok(new ApiSuccess(true));
        });

        // Create folder
        app.MapPost("/api/gcode-files/folders", async (HttpContext context, IGcodeFileService svc) =>
        {
            var body = await context.Request.ReadFromJsonAsync<GcodePathRequest>();
            if (body?.Path is null)
                return Results.BadRequest("Path is required");

            await svc.CreateFolderAsync(body.Path);
            return Results.Ok(new ApiSuccess(true));
        });

        // Delete folder
        app.MapPost("/api/gcode-files/folders/delete", async (HttpContext context, IGcodeFileService svc) =>
        {
            var body = await context.Request.ReadFromJsonAsync<GcodePathRequest>();
            if (body?.Path is null)
                return Results.BadRequest("Path is required");

            await svc.DeleteFolderAsync(body.Path);
            return Results.Ok(new ApiSuccess(true));
        });

        // Move file/folder
        app.MapPost("/api/gcode-files/move", async (HttpContext context, IGcodeFileService svc) =>
        {
            var body = await context.Request.ReadFromJsonAsync<GcodeMoveRequest>();
            if (body?.Source is null || body.Destination is null)
                return Results.BadRequest("Source and destination are required");

            await svc.MoveAsync(body.Source, body.Destination);
            return Results.Ok(new ApiSuccess(true));
        });

        // Rename file/folder
        app.MapPost("/api/gcode-files/rename", async (HttpContext context, IGcodeFileService svc) =>
        {
            var body = await context.Request.ReadFromJsonAsync<GcodeRenameRequest>();
            if (body?.Path is null || body.NewName is null)
                return Results.BadRequest("Path and newName are required");

            await svc.RenameAsync(body.Path, body.NewName);
            return Results.Ok(new ApiSuccess(true));
        });

        // Clear loaded G-code
        app.MapPost("/api/gcode-preview/clear", async (IGcodeFileService svc) =>
        {
            await svc.ClearLoadedAsync();
            return Results.Ok(new ApiSuccess(true));
        });
    }

}
