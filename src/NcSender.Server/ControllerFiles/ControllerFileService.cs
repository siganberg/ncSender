using System.Text;
using System.Text.RegularExpressions;
using NcSender.Core.Interfaces;
using NcSender.Core.Models;

namespace NcSender.Server.ControllerFiles;

public class ControllerFileService : IControllerFileService
{
    private readonly ICncController _controller;
    private readonly ILogger<ControllerFileService> _logger;

    public ControllerFileService(ICncController controller, ILogger<ControllerFileService> logger)
    {
        _controller = controller;
        _logger = logger;
    }

    public async Task<List<ControllerFileInfo>> ListFilesAsync()
    {
        var files = new List<ControllerFileInfo>();
        var responses = new List<string>();

        void OnData(string data, string? sourceId)
        {
            responses.Add(data);
        }

        _controller.DataReceived += OnData;
        try
        {
            await _controller.SendCommandAsync("$F", new CommandOptions
            {
                Meta = new CommandMeta { SourceId = "controller-files" }
            });

            // Allow time for responses
            await Task.Delay(500);
        }
        finally
        {
            _controller.DataReceived -= OnData;
        }

        // Parse [FILE:name|SIZE:bytes] responses
        var pattern = new Regex(@"\[FILE:(?<name>[^|]+)\|SIZE:(?<size>\d+)\]");
        foreach (var line in responses)
        {
            var match = pattern.Match(line);
            if (match.Success)
            {
                files.Add(new ControllerFileInfo
                {
                    Name = match.Groups["name"].Value,
                    Size = long.Parse(match.Groups["size"].Value)
                });
            }
        }

        return files;
    }

    public async Task RunFileAsync(string name)
    {
        await _controller.SendCommandAsync($"$F={name}", new CommandOptions
        {
            Meta = new CommandMeta { SourceId = "controller-files" }
        });
    }

    public async Task DeleteFileAsync(string name)
    {
        await _controller.SendCommandAsync($"$FD={name}", new CommandOptions
        {
            Meta = new CommandMeta { SourceId = "controller-files" }
        });
    }

    public async Task<string> ReadFileAsync(string name)
    {
        var lines = new List<string>();

        void OnData(string data, string? sourceId)
        {
            lines.Add(data);
        }

        _controller.DataReceived += OnData;
        try
        {
            await _controller.SendCommandAsync($"$F<={name}", new CommandOptions
            {
                Meta = new CommandMeta { SourceId = "controller-files" }
            });

            await Task.Delay(1000);
        }
        finally
        {
            _controller.DataReceived -= OnData;
        }

        return string.Join("\n", lines);
    }

    public async Task UploadFileAsync(string name, byte[] content, Action<double>? onProgress = null)
    {
        if (!_controller.IsConnected)
            throw new InvalidOperationException("Controller not connected");

        // Initiate Ymodem receive mode
        await _controller.SendCommandAsync("$F>", new CommandOptions
        {
            Meta = new CommandMeta { SourceId = "controller-files" }
        });

        await Task.Delay(200);

        var sender = new YmodemSender(_controller, _logger);
        await sender.SendAsync(name, content, onProgress);
    }

    public async Task SaveFileAsync(string name, string content, Action<double>? onProgress = null)
    {
        var bytes = Encoding.UTF8.GetBytes(content);
        await UploadFileAsync(name, bytes, onProgress);
    }
}
