using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;

namespace NcSender.Server.Infrastructure;

/// <summary>
/// Every GitHub API read goes through here. Anonymous calls are limited to
/// 60 an hour per IP, shared by every machine on the network, and a day of
/// opening the update dialog or the plugin list used to run out of them.
///
/// - Answers are cached for <see cref="Ttl"/>; <c>force</c> skips that (the
///   update dialog's Check Again).
/// - Every refresh sends the ETag it has: a "not modified" (304) reply does
///   not count against the limit, so re-checking an unchanged release is free.
/// - When GitHub refuses (rate limit, offline) and an older answer exists,
///   that answer is returned marked <see cref="GitHubResult.Stale"/> instead
///   of failing.
///
/// The cache is in memory: restarting ncSender clears it.
/// </summary>
public static class GitHubApi
{
    public static readonly TimeSpan Ttl = TimeSpan.FromMinutes(15);

    private sealed record Entry(string Json, string? ETag, DateTime FetchedAt);

    private static readonly ConcurrentDictionary<string, Entry> Cache = new();
    private static readonly HttpClient Http = CreateClient();

    private static HttpClient CreateClient()
    {
        var http = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("ncSender");
        http.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return http;
    }

    public static async Task<GitHubResult> GetAsync(string url, bool force = false, CancellationToken ct = default)
    {
        Cache.TryGetValue(url, out var cached);
        if (!force && cached is not null && DateTime.UtcNow - cached.FetchedAt < Ttl)
            return new GitHubResult(cached.Json, false, null);

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            if (cached?.ETag is { } etag)
                request.Headers.IfNoneMatch.Add(EntityTagHeaderValue.Parse(etag));

            using var response = await Http.SendAsync(request, ct).ConfigureAwait(false);
            if (response.StatusCode == HttpStatusCode.NotModified && cached is not null)
            {
                Cache[url] = cached with { FetchedAt = DateTime.UtcNow };
                return new GitHubResult(cached.Json, false, null);
            }

            if (!response.IsSuccessStatusCode)
            {
                var reason = response.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.TooManyRequests
                    ? "GitHub rate limit reached"
                    : $"GitHub returned {(int)response.StatusCode}";
                if (cached is not null) return new GitHubResult(cached.Json, true, reason);
                throw new HttpRequestException($"{reason}. Try again later.", null, response.StatusCode);
            }

            var json = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            Cache[url] = new Entry(json, response.Headers.ETag?.ToString(), DateTime.UtcNow);
            return new GitHubResult(json, false, null);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            if (cached is not null && ex is not HttpRequestException { StatusCode: not null })
                return new GitHubResult(cached.Json, true, "Couldn't reach GitHub");
            throw;
        }
    }

    /// <summary>Just the JSON, for callers that don't surface staleness.</summary>
    public static async Task<string> GetJsonAsync(string url, bool force = false, CancellationToken ct = default)
        => (await GetAsync(url, force, ct).ConfigureAwait(false)).Json;
}

/// <param name="Stale">True when GitHub couldn't be reached and this is the last good answer.</param>
/// <param name="StaleReason">Why it couldn't refresh (shown as a small note).</param>
public sealed record GitHubResult(string Json, bool Stale, string? StaleReason);
