using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

public interface ITipsService
{
    /// <summary>Built-in tips merged with the cached remote index. With
    /// <paramref name="refresh"/> the remote index is re-fetched first
    /// (rate-limited); offline, the cache is served as is.</summary>
    Task<TipsResponse> GetTipsAsync(bool refresh, CancellationToken ct = default);

    /// <summary>Local path of a tip's media (or poster), downloading and
    /// caching it on first use. Null when the tip has none or it cannot be
    /// fetched right now.</summary>
    Task<string?> GetMediaPathAsync(int tipId, bool poster, CancellationToken ct = default);
}
