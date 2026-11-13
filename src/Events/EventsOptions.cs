using Npgsql;

namespace Events;

[Flags]
public enum EventsRole
{
    Public = 1,
    Admin = 2,
    All = Public | Admin,
}

public sealed record EventsOptions(
    EventsRole Role,
    string ConnectionString,
    string PublicOrigin,
    string QrLinkBase,
    string[] CorsOrigins)
{
    public bool ServesPublic => Role.HasFlag(EventsRole.Public);
    public bool ServesAdmin => Role.HasFlag(EventsRole.Admin);

    public string MediaUrl(Guid id) => $"{PublicOrigin}/media/{id:N}";
    public string EventLink(string code) => QrLinkBase + Uri.EscapeDataString(code);
    public string KioskUrl(string code, string token) => $"{PublicOrigin}/kiosk/{Uri.EscapeDataString(code)}#t={token}";

    public static EventsOptions From(IConfiguration config)
    {
        var role = (config["EVENTS_ROLE"] ?? "public").Trim().ToLowerInvariant() switch
        {
            "admin" => EventsRole.Admin,
            "all" => EventsRole.All,
            _ => EventsRole.Public,
        };
        var database = config["DATABASE_URL"] ?? config.GetConnectionString("Events")
            ?? throw new InvalidOperationException("DATABASE_URL is not set");
        var origins = (config["CORS_ORIGINS"] ?? "https://app.helloii.chat")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return new EventsOptions(
            role,
            ToNpgsql(database),
            (config["PUBLIC_ORIGIN"] ?? "https://events.idp.tripleenable.com").TrimEnd('/'),
            config["QR_LINK_BASE"] ?? "https://app.helloii.chat/e?id=",
            origins);
    }

    // Coolify hands out postgres:// URLs; Npgsql wants key=value pairs.
    public static string ToNpgsql(string value)
    {
        // Pasted values often keep surrounding spaces or quotes.
        value = value.Trim().Trim('"', '\'').Trim();
        if (!value.Contains("://", StringComparison.Ordinal) && !value.Contains('=', StringComparison.Ordinal))
        {
            throw new InvalidOperationException("DATABASE_URL must be a postgres:// URL or a key=value connection string");
        }
        if (!value.StartsWith("postgres://", StringComparison.Ordinal) &&
            !value.StartsWith("postgresql://", StringComparison.Ordinal))
        {
            return value;
        }
        var uri = new Uri(value);
        var user = uri.UserInfo.Split(':', 2);
        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.Port > 0 ? uri.Port : 5432,
            Username = Uri.UnescapeDataString(user[0]),
            Password = user.Length > 1 ? Uri.UnescapeDataString(user[1]) : null,
            Database = Uri.UnescapeDataString(uri.AbsolutePath.Trim('/')),
        };
        foreach (var pair in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = pair.Split('=', 2);
            if (parts.Length == 2) builder[Uri.UnescapeDataString(parts[0])] = Uri.UnescapeDataString(parts[1]);
        }
        return builder.ConnectionString;
    }
}
