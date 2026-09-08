namespace NcSender.Core.Models;

/// <summary>Media attached to a tip: a short looping video or a still image.</summary>
public class TipMedia
{
    /// <summary>"video" or "image".</summary>
    public string Type { get; set; } = "video";
    /// <summary>URL, or a path relative to the index's BaseUrl. Rewritten to the
    /// local /api/tips/media route before it reaches the client.</summary>
    public string Src { get; set; } = "";
    public string? Poster { get; set; }
}

public class TipItem
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    /// <summary>Plain text; blank lines separate paragraphs.</summary>
    public string Body { get; set; } = "";
    public TipMedia? Media { get; set; }
    /// <summary>"all" or "pro".</summary>
    public string Edition { get; set; } = "all";
    /// <summary>Lowest app version the tip applies to; hidden on older builds.</summary>
    public string? MinVersion { get; set; }
}

/// <summary>Shape of tips.json in the siganberg/ncSender.tips repository.</summary>
public class TipsIndex
{
    public int SchemaVersion { get; set; } = 1;
    public string BaseUrl { get; set; } = "";
    public List<TipItem> Tips { get; set; } = new();
}

public class TipsResponse
{
    public string Edition { get; set; } = "";
    public string Version { get; set; } = "";
    /// <summary>True when the last fetch of the remote index succeeded.</summary>
    public bool Online { get; set; }
    public string? FetchedAt { get; set; }
    public List<TipItem> Tips { get; set; } = new();
}
