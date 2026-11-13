using System.Net.WebSockets;
using System.Text.Json;
using Dapper;
using Events.Api;
using Events.Db;

namespace Events.Live;

/// <summary>Turns Postgres notifications into kiosk messages, so any instance can serve any kiosk.</summary>
public sealed class LiveListener(Database db, EventStore store, EventViews views, LiveHub hub, ILogger<LiveListener> log)
    : BackgroundService
{
    private sealed record Note(string Code, string Kind, long? Id);

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await using var conn = await db.OpenAsync(ct);
                conn.Notification += (_, e) => _ = DeliverAsync(e.Payload, ct);
                await conn.ExecuteAsync($"listen {EventStore.LiveChannel}");
                log.LogInformation("Listening on {Channel}", EventStore.LiveChannel);
                while (!ct.IsCancellationRequested) await conn.WaitAsync(ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception e)
            {
                log.LogWarning(e, "Live listener dropped; retrying");
                await Task.Delay(TimeSpan.FromSeconds(2), ct);
            }
        }
    }

    private async Task DeliverAsync(string payload, CancellationToken ct)
    {
        try
        {
            var note = JsonSerializer.Deserialize<Note>(payload, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            if (note is null) return;
            var clients = hub.In(note.Code);
            if (clients.Count == 0) return;
            var e = await store.GetAsync(note.Code, ct);
            if (e is null)
            {
                foreach (var c in clients) await c.CloseAsync(WebSocketCloseStatus.EndpointUnavailable, "event deleted");
                return;
            }
            object message = note.Kind switch
            {
                "checkin" when note.Id is long id && await store.CheckInAsync(e.Id, id, ct) is { } row =>
                    new { type = "checkin", attendee = EventViews.Attendee(row), count = await store.CountAsync(e.Id, ct) },
                "kiosk" => new { type = "revoked" },
                _ => new { type = "event", @event = await views.PublicAsync(e, null, ct) },
            };
            foreach (var c in clients)
            {
                await c.SendAsync(message, ct);
                if (note.Kind == "kiosk") await c.CloseAsync(WebSocketCloseStatus.PolicyViolation, "kiosk link rotated");
            }
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            log.LogWarning(e, "Could not deliver {Payload}", payload);
        }
    }
}
