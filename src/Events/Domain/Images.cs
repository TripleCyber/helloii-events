namespace Events.Domain;

public static class Images
{
    /// <summary>The real type from the first bytes; never the one the client claims.</summary>
    public static string? Sniff(ReadOnlySpan<byte> b)
    {
        if (b.Length > 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return "image/jpeg";
        if (b.Length > 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47) return "image/png";
        if (b.Length > 12 && b[0] == 0x52 && b[1] == 0x49 && b[2] == 0x46 && b[3] == 0x46 &&
            b[8] == 0x57 && b[9] == 0x45 && b[10] == 0x42 && b[11] == 0x50) return "image/webp";
        return null;
    }

    public static bool TryReadDataUrl(string dataUrl, int maxBytes, out byte[]? bytes, out string? type)
    {
        bytes = null;
        type = null;
        const string marker = ";base64,";
        var comma = dataUrl.IndexOf(marker, StringComparison.Ordinal);
        if (!dataUrl.StartsWith("data:image/", StringComparison.Ordinal) || comma < 0) return false;
        var payload = dataUrl.AsSpan(comma + marker.Length);
        if (payload.Length > (maxBytes / 3 + 1) * 4) return false;
        var buffer = new byte[payload.Length * 3 / 4 + 3];
        if (!Convert.TryFromBase64Chars(payload, buffer, out var written) || written == 0 || written > maxBytes) return false;
        type = Sniff(buffer.AsSpan(0, written));
        if (type is null) return false;
        bytes = buffer[..written];
        return true;
    }
}
