using System.Threading.RateLimiting;
using Dapper;
using Events;
using Events.Api;
using Events.Db;
using Events.Live;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);
var options = EventsOptions.From(builder.Configuration);

builder.Services.AddSingleton(options);
builder.Services.AddSingleton<Database>();
builder.Services.AddSingleton<EventStore>();
builder.Services.AddSingleton<EventViews>();
builder.Services.AddSingleton<LiveHub>();
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    // Only Traefik reaches the container.
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownIPNetworks.Clear();
    o.KnownProxies.Clear();
});
if (options.ServesPublic)
{
    builder.Services.AddHostedService<LiveListener>();
    builder.Services.AddCors(o => o.AddPolicy(PublicApi.CorsPolicy, p =>
        p.WithOrigins(options.CorsOrigins).WithMethods("GET", "POST").WithHeaders("Content-Type")));
    // A whole venue may share one IP, so this only stops floods.
    builder.Services.AddRateLimiter(o =>
    {
        o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
        o.AddPolicy(PublicApi.CheckInLimit, ctx => RateLimitPartition.GetFixedWindowLimiter(
            ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions { PermitLimit = 600, Window = TimeSpan.FromMinutes(1) }));
    });
}

var app = builder.Build();
app.UseForwardedHeaders();

var wsOrigin = options.PublicOrigin.Replace("https://", "wss://").Replace("http://", "ws://");
var csp = $"default-src 'self'; img-src 'self' data: blob: {options.PublicOrigin}; connect-src 'self' {wsOrigin}; " +
          "style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
app.Use(async (ctx, next) =>
{
    ctx.Response.OnStarting(() =>
    {
        var headers = ctx.Response.Headers;
        headers.XContentTypeOptions = "nosniff";
        headers["Referrer-Policy"] = "no-referrer";
        if (ctx.Response.ContentType?.StartsWith("text/html", StringComparison.Ordinal) == true)
        {
            headers.ContentSecurityPolicy = csp;
        }
        return Task.CompletedTask;
    });
    await next();
});

await app.Services.GetRequiredService<Database>().MigrateAsync();

app.MapGet("/healthz", async (Database db, CancellationToken ct) =>
{
    await using var conn = await db.OpenAsync(ct);
    await conn.ExecuteScalarAsync<int>("select 1");
    return Results.Text("ok");
});

if (options.ServesPublic)
{
    app.UseCors();
    app.UseRateLimiter();
    app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(25) });
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(Path.Combine(app.Environment.WebRootPath, "kiosk")),
        RequestPath = "/kiosk/assets",
        OnPrepareResponse = Revalidate,
    });
    app.MapPublicApi();
}

if (options.ServesAdmin) app.MapAdminApi();

app.Run();

public partial class Program
{
    // Kiosk screens stay open for hours; a deploy must reach them on the next load.
    internal static void Revalidate(Microsoft.AspNetCore.StaticFiles.StaticFileResponseContext ctx) =>
        ctx.Context.Response.Headers.CacheControl = "no-cache";
}
