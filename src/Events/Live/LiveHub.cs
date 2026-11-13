using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text.Json;

namespace Events.Live;

public sealed class LiveClient(WebSocket socket)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly SemaphoreSlim _send = new(1, 1);

    public Guid Id { get; } = Guid.NewGuid();

    public async Task SendAsync(object message, CancellationToken ct = default)
    {
        if (socket.State != WebSocketState.Open) return;
        var bytes = JsonSerializer.SerializeToUtf8Bytes(message, Json);
        await _send.WaitAsync(ct);
        try
        {
            await socket.SendAsync(bytes, WebSocketMessageType.Text, true, ct);
        }
        catch (Exception e) when (e is WebSocketException or OperationCanceledException or ObjectDisposedException)
        {
            // The kiosk reconnects on its own and asks for what it missed.
        }
        finally
        {
            _send.Release();
        }
    }

    public Task CloseAsync(WebSocketCloseStatus status, string reason) =>
        socket.State == WebSocketState.Open ? socket.CloseAsync(status, reason, CancellationToken.None) : Task.CompletedTask;
}

/// <summary>The kiosks connected to this instance, by event code.</summary>
public sealed class LiveHub
{
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<Guid, LiveClient>> _rooms = new(StringComparer.Ordinal);

    public IDisposable Join(string code, LiveClient client)
    {
        _rooms.GetOrAdd(code, _ => new()).TryAdd(client.Id, client);
        return new Leave(() =>
        {
            if (_rooms.TryGetValue(code, out var room)) room.TryRemove(client.Id, out _);
        });
    }

    public IReadOnlyCollection<LiveClient> In(string code) =>
        _rooms.TryGetValue(code, out var room) ? room.Values.ToArray() : [];

    private sealed class Leave(Action action) : IDisposable
    {
        public void Dispose() => action();
    }
}
