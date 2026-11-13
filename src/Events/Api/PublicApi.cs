using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Events.Db;
using Events.Domain;
using Events.Live;
using QRCoder;

namespace Events.Api;

public static class PublicApi
{
    public const string CorsPolicy = "event-page";
    public const string CheckInLimit = "check-in";
    private const string KioskHeader = "X-Kiosk-Token";

    public static void MapPublicApi(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1/events/{code}");

        // Until sign-in exists the page says who it is; the user is the JID the app gave it.
        api.MapGet("", async (string code, string? user, EventStore store, EventViews views, CancellationToken ct) =>
        {
            if (!EventRules.IsCode(code)) return Results.NotFound(new { error = "event_not_found" });
            var e = await store.GetAsync(code, ct);
            if (e is null) return Results.NotFound(new { error = "event_not_found" });
            var jid = user?.Trim().ToLowerInvariant();
            var mine = string.IsNullOrEmpty(jid) ? null : await store.CheckInOfAsync(e.Id, jid, ct);
            return Results.Ok(await views.PublicAsync(e, mine, ct));
        }).RequireCors(CorsPolicy);

        api.MapPost("/check-ins", async (string code, CheckInInput input, EventStore store, CancellationToken ct) =>
        {
            if (!EventRules.IsCode(code)) return Results.NotFound(new { error = "event_not_found" });
            var e = await store.GetAsync(code, ct);
            if (e is null) return Results.NotFound(new { error = "event_not_found" });
            var who = EventRules.ReadAttendee(input.User, out var error);
            if (who is null) return Results.BadRequest(new { error = "invalid_user", detail = error });

            var mine = await store.CheckInOfAsync(e.Id, who.Jid, ct);
            if (mine is not null) return Results.Ok(new { state = EventRules.Done, doneAt = mine.CheckedInAt, firstTime = false });
            var state = EventRules.StateOf(e, DateTime.UtcNow, false);
            if (state != EventRules.Open) return Results.Conflict(new { state });

            var (row, firstTime) = await store.AddCheckInAsync(e, who, ct);
            return Results.Ok(new { state = EventRules.Done, doneAt = row.CheckedInAt, firstTime, firstName = row.FirstName });
        }).RequireCors(CorsPolicy).RequireRateLimiting(CheckInLimit);

        api.MapGet("/qr.svg", async (string code, EventStore store, EventsOptions options, CancellationToken ct) =>
        {
            if (!EventRules.IsCode(code) || await store.GetAsync(code, ct) is null) return Results.NotFound();
            using var generator = new QRCodeGenerator();
            using var data = generator.CreateQrCode(options.EventLink(code), QRCodeGenerator.ECCLevel.M);
            var svg = new SvgQRCode(data).GetGraphic(10, "#06090F", "#FFFFFF", drawQuietZones: true);
            return Results.Text(svg, "image/svg+xml");
        });

        api.MapGet("/attendees/{id:long}/photo", async (HttpRequest req, string code, long id, EventStore store, CancellationToken ct) =>
        {
            var e = EventRules.IsCode(code) ? await store.GetAsync(code, ct) : null;
            if (e is null || !TokenMatches(e.KioskToken, req.Headers[KioskHeader])) return Results.NotFound();
            var row = await store.CheckInAsync(e.Id, id, ct);
            if (row?.Photo is not Guid photo || await store.MediaAsync(photo, ct) is not { } media) return Results.NotFound();
            return Results.File(media.Bytes, media.ContentType);
        });

        api.Map("/live", LiveAsync);

        app.MapGet("/media/{id:guid}", async (HttpResponse res, Guid id, EventStore store, CancellationToken ct) =>
        {
            var media = await store.MediaAsync(id, ct);
            // Attendee photos are never public.
            if (media is null || media.Kind == "photo") return Results.NotFound();
            res.Headers.CacheControl = "public, max-age=31536000, immutable";
            res.Headers.AccessControlAllowOrigin = "*";
            return Results.File(media.Bytes, media.ContentType);
        });

        var kioskPage = Path.Combine(app.Environment.WebRootPath, "kiosk", "index.html");
        app.MapGet("/kiosk/{code}", (string code) =>
            EventRules.IsCode(code) ? Results.File(kioskPage, "text/html; charset=utf-8") : Results.NotFound());
    }

    private static async Task LiveAsync(HttpContext ctx, string code, EventStore store, EventViews views, LiveHub hub)
    {
        if (!ctx.WebSockets.IsWebSocketRequest)
        {
            ctx.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }
        var e = EventRules.IsCode(code) ? await store.GetAsync(code, ctx.RequestAborted) : null;
        if (e is null)
        {
            ctx.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }
        using var socket = await ctx.WebSockets.AcceptWebSocketAsync();

        // The kiosk token travels in the first message, never in the URL.
        var hello = await ReceiveTextAsync(socket, TimeSpan.FromSeconds(10));
        string? token = null;
        try
        {
            token = hello is null ? null : JsonDocument.Parse(hello).RootElement.GetProperty("token").GetString();
        }
        catch (Exception ex) when (ex is JsonException or KeyNotFoundException or InvalidOperationException)
        {
        }
        if (!TokenMatches(e.KioskToken, token))
        {
            await socket.CloseAsync(WebSocketCloseStatus.PolicyViolation, "bad kiosk token", CancellationToken.None);
            return;
        }

        var client = new LiveClient(socket);
        using (hub.Join(code, client))
        {
            var recent = await store.CheckInsAsync(e.Id, 12, ctx.RequestAborted);
            await client.SendAsync(new
            {
                type = "hello",
                @event = await views.PublicAsync(e, null, ctx.RequestAborted),
                recent = recent.Select(EventViews.Attendee),
            });
            var buffer = new byte[1024];
            try
            {
                while (socket.State == WebSocketState.Open)
                {
                    var result = await socket.ReceiveAsync(buffer, ctx.RequestAborted);
                    if (result.MessageType == WebSocketMessageType.Close) break;
                }
            }
            catch (Exception ex) when (ex is WebSocketException or OperationCanceledException)
            {
            }
            await client.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye");
        }
    }

    private static async Task<string?> ReceiveTextAsync(WebSocket socket, TimeSpan timeout)
    {
        using var cts = new CancellationTokenSource(timeout);
        var buffer = new byte[2048];
        var count = 0;
        try
        {
            while (true)
            {
                var result = await socket.ReceiveAsync(buffer.AsMemory(count), cts.Token);
                if (result.MessageType != WebSocketMessageType.Text) return null;
                count += result.Count;
                if (result.EndOfMessage) return Encoding.UTF8.GetString(buffer, 0, count);
                if (count >= buffer.Length) return null;
            }
        }
        catch (Exception ex) when (ex is OperationCanceledException or WebSocketException)
        {
            return null;
        }
    }

    private static bool TokenMatches(string expected, string? given) =>
        given is not null && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(given));
}
