using System.Text;
using System.Text.Json;

namespace NcSender.Server.Accessories;

/// <summary>
/// Talks to the activation server and hands back the raw signed licence.
///
/// Two ways in. A device that has been activated on this machine before can be
/// reactivated from its fingerprint alone — that is the normal case after a
/// reinstall, and it asks the user for nothing. Only a device the store has
/// never seen needs an Installation ID, and the 404 from the fingerprint call
/// is what tells us we have reached that case.
///
/// Pushing the licence to the device is the caller's job: the transport differs
/// per accessory (line protocol over the radio, JSON message to the pendant),
/// but the licence itself is fetched identically for all of them.
/// </summary>
public static class LicenseClient
{
    private const string ActivateUrl         = "https://franciscreation.com/api/license/activate";
    private const string ActivateByDeviceUrl = "https://franciscreation.com/api/license/activate-by-device";
    private const string ApiKey              = "ncsp-2025-fc-api-key";

    /// <param name="Json">The raw signed licence, exactly as returned. Opaque here.</param>
    /// <param name="NeedsInstallationId">
    /// The store does not know this device, so a fingerprint alone cannot
    /// activate it. The caller should ask for an Installation ID and retry.
    /// </param>
    public sealed record Result(bool Ok, string Json, bool NeedsInstallationId, string? Error);

    /// <summary>
    /// Fetch a signed licence. With no <paramref name="installationId"/> this
    /// tries the fingerprint route and reports back if the device is unknown.
    /// </summary>
    public static async Task<Result> FetchAsync(
        string? installationId, string machineHash, string product,
        HttpClient http, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(machineHash))
            return new Result(false, "", false, "Device ID not available. Please reconnect it.");

        var byDevice = string.IsNullOrWhiteSpace(installationId);
        var url  = byDevice ? ActivateByDeviceUrl : ActivateUrl;
        // Written by hand rather than serialized from a Dictionary: the
        // reflection-based overload is not AOT-safe, and registering a type for
        // three string fields would cost more than writing them.
        var body = WriteBody(byDevice ? null : installationId!.Trim(), machineHash, product);

        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        request.Headers.Add("X-Api-Key", ApiKey);

        HttpResponseMessage response;
        try { response = await http.SendAsync(request, ct).ConfigureAwait(false); }
        catch (Exception ex) { return new Result(false, "", false, $"Could not reach the activation server: {ex.Message}"); }

        var text = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (response.IsSuccessStatusCode) return new Result(true, text, false, null);

        // 404 on the fingerprint route is not a failure, it is the signal to ask
        // for an Installation ID. On the Installation ID route it is a real error.
        var unknownDevice = byDevice && response.StatusCode == System.Net.HttpStatusCode.NotFound;

        var error = "Activation failed";
        try
        {
            var doc = JsonDocument.Parse(text);
            if (doc.RootElement.TryGetProperty("error", out var e)) error = e.GetString() ?? error;
        }
        catch { /* upstream did not send JSON; keep the generic message */ }

        return new Result(false, "", unknownDevice, error);
    }

    /// <summary>
    /// Collapse a licence to a single line. The device protocols are
    /// line-delimited, so an indented JSON body would be read as many truncated
    /// commands rather than one licence.
    /// </summary>
    public static string Compact(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            using var ms = new MemoryStream();
            using (var w = new Utf8JsonWriter(ms, new JsonWriterOptions { Indented = false }))
                doc.RootElement.WriteTo(w);
            return Encoding.UTF8.GetString(ms.ToArray());
        }
        catch { return json.Replace("\n", "").Replace("\r", ""); }
    }

    /// <summary>
    /// The activation request body. Utf8JsonWriter escapes the values properly
    /// and needs no type metadata, so this stays correct under trimming and AOT.
    /// </summary>
    private static string WriteBody(string? installationId, string machineHash, string product)
    {
        using var ms = new MemoryStream();
        using (var w = new Utf8JsonWriter(ms))
        {
            w.WriteStartObject();
            if (installationId is not null) w.WriteString("installationId", installationId);
            w.WriteString("machineHash", machineHash);
            w.WriteString("product", product);
            w.WriteEndObject();
        }
        return Encoding.UTF8.GetString(ms.ToArray());
    }
}
