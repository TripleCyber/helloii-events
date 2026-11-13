using System.Text.Json;
using Dapper;
using Events.Domain;
using Npgsql;

namespace Events.Db;

public sealed class EventStore(Database db)
{
    public const string LiveChannel = "events_live";

    private const string EventColumns = """
        id, code, title, description, venue, organizer_name, organizer_color, organizer_logo,
        starts_at, ends_at, check_in_opens_at, check_in_closes_at, cancelled, theme::text as theme,
        kiosk_token, created_at, updated_at
        """;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<EventRow?> GetAsync(string code, CancellationToken ct = default)
    {
        await using var conn = await db.OpenAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<EventRow>(
            $"select {EventColumns} from events where code = @code", new { code });
    }

    public async Task<IReadOnlyList<PosterRow>> PostersAsync(Guid eventId, CancellationToken ct = default)
    {
        await using var conn = await db.OpenAsync(ct);
        return (await conn.QueryAsync<PosterRow>(
            "select position, media_id, width, height from event_posters where event_id = @eventId order by position",
            new { eventId })).AsList();
    }

    public async Task<long> CountAsync(Guid eventId, CancellationToken ct = default)
    {
        await using var conn = await db.OpenAsync(ct);
        return await conn.ExecuteScalarAsync<long>("select count(*) from check_ins where event_id = @eventId", new { eventId });
    }

    public async Task<CheckInRow?> CheckInOfAsync(Guid eventId, string jid, CancellationToken ct = default)
    {
        await using var conn = await db.OpenAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<CheckInRow>(
            "select id, user_jid, first_name, display_name, photo, checked_in_at from check_ins where event_id = @eventId and user_jid = @jid",
            new { eventId, jid });
    }

    public async Task<CheckInRow?> CheckInAsync(Guid eventId, long id, CancellationToken ct = default)
    {
        await using var conn = await db.OpenAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<CheckInRow>(
            "select id, user_jid, first_name, display_name, photo, checked_in_at from check_ins where event_id = @eventId and id = @id",
            new { eventId, id });
    }

    public async Task<IReadOnlyList<CheckInRow>> CheckInsAsync(Guid eventId, int? limit = null, CancellationToken ct = default)
    {
        await using var conn = await db.OpenAsync(ct);
        return (await conn.QueryAsync<CheckInRow>(
            """
            select id, user_jid, first_name, display_name, photo, checked_in_at from check_ins
            where event_id = @eventId order by checked_in_at desc limit @limit
            """,
            new { eventId, limit = limit ?? int.MaxValue })).AsList();
    }

    /// <summary>One per user and event; a repeat returns the first one. The kiosk hears it on commit.</summary>
    public async Task<(CheckInRow Row, bool FirstTime)> AddCheckInAsync(EventRow e, Attendee who, CancellationToken ct = default)
    {
        await using var conn = await db.OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        Guid? photo = null;
        if (who.Photo is not null)
        {
            photo = await conn.ExecuteScalarAsync<Guid>(
                "insert into media (kind, content_type, bytes) values ('photo', @type, @bytes) returning id",
                new { type = who.PhotoType, bytes = who.Photo }, tx);
        }
        var row = await conn.QuerySingleOrDefaultAsync<CheckInRow>(
            """
            insert into check_ins (event_id, user_jid, first_name, display_name, photo)
            values (@eventId, @jid, @first, @display, @photo)
            on conflict (event_id, user_jid) do nothing
            returning id, user_jid, first_name, display_name, photo, checked_in_at
            """,
            new { eventId = e.Id, jid = who.Jid, first = who.FirstName, display = who.DisplayName, photo }, tx);
        if (row is null)
        {
            await tx.RollbackAsync(ct);
            var existing = await conn.QuerySingleAsync<CheckInRow>(
                "select id, user_jid, first_name, display_name, photo, checked_in_at from check_ins where event_id = @eventId and user_jid = @jid",
                new { eventId = e.Id, jid = who.Jid });
            return (existing, false);
        }
        await NotifyAsync(conn, tx, e.Code, "checkin", row.Id);
        await tx.CommitAsync(ct);
        return (row, true);
    }

    public async Task<MediaRow?> MediaAsync(Guid id, CancellationToken ct = default)
    {
        await using var conn = await db.OpenAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<MediaRow>(
            "select kind, content_type, bytes from media where id = @id", new { id });
    }

    public async Task<Guid> AddMediaAsync(string kind, string contentType, byte[] bytes, CancellationToken ct = default)
    {
        await using var conn = await db.OpenAsync(ct);
        return await conn.ExecuteScalarAsync<Guid>(
            "insert into media (kind, content_type, bytes) values (@kind, @contentType, @bytes) returning id",
            new { kind, contentType, bytes });
    }

    public async Task<IReadOnlyList<EventSummaryRow>> ListAsync(CancellationToken ct = default)
    {
        await using var conn = await db.OpenAsync(ct);
        return (await conn.QueryAsync<EventSummaryRow>(
            """
            select e.code, e.title, e.starts_at, e.ends_at, e.check_in_opens_at, e.check_in_closes_at, e.cancelled,
                   (select count(*) from check_ins c where c.event_id = e.id) as attendee_count
            from events e order by e.starts_at desc
            """)).AsList();
    }

    public async Task<EventRow> CreateAsync(string code, EventDraft d, CancellationToken ct = default)
    {
        await using var conn = await db.OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        var id = await conn.ExecuteScalarAsync<Guid>(
            """
            insert into events (code, title, description, venue, organizer_name, organizer_color, organizer_logo,
                starts_at, ends_at, check_in_opens_at, check_in_closes_at, cancelled, theme, kiosk_token)
            values (@code, @Title, @Description, @Venue, @OrganizerName, @OrganizerColor, @OrganizerLogo,
                @StartsAt, @EndsAt, @CheckInOpensAt, @CheckInClosesAt, @Cancelled, @theme::jsonb, @token)
            returning id
            """,
            Params(d, new { code, theme = ThemeJson(d.Theme), token = EventRules.NewKioskToken() }), tx);
        await SetPostersAsync(conn, tx, id, d.Posters, ct);
        await tx.CommitAsync(ct);
        return (await GetAsync(code, ct))!;
    }

    public async Task<EventRow?> UpdateAsync(string code, EventDraft d, CancellationToken ct = default)
    {
        await using var conn = await db.OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        var id = await conn.ExecuteScalarAsync<Guid?>(
            """
            update events set title = @Title, description = @Description, venue = @Venue,
                organizer_name = @OrganizerName, organizer_color = @OrganizerColor, organizer_logo = @OrganizerLogo,
                starts_at = @StartsAt, ends_at = @EndsAt, check_in_opens_at = @CheckInOpensAt,
                check_in_closes_at = @CheckInClosesAt, cancelled = @Cancelled, theme = @theme::jsonb, updated_at = now()
            where code = @code returning id
            """,
            Params(d, new { code, theme = ThemeJson(d.Theme) }), tx);
        if (id is null) return null;
        await SetPostersAsync(conn, tx, id.Value, d.Posters, ct);
        await NotifyAsync(conn, tx, code, "event", null);
        await tx.CommitAsync(ct);
        return await GetAsync(code, ct);
    }

    public async Task<bool> DeleteAsync(string code, CancellationToken ct = default)
    {
        await using var conn = await db.OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        var deleted = await conn.ExecuteAsync("delete from events where code = @code", new { code }, tx) > 0;
        if (deleted) await NotifyAsync(conn, tx, code, "event", null);
        await tx.CommitAsync(ct);
        return deleted;
    }

    public async Task<string?> RotateKioskTokenAsync(string code, CancellationToken ct = default)
    {
        await using var conn = await db.OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        var token = EventRules.NewKioskToken();
        var changed = await conn.ExecuteAsync(
            "update events set kiosk_token = @token, updated_at = now() where code = @code", new { code, token }, tx);
        if (changed == 0) return null;
        await NotifyAsync(conn, tx, code, "kiosk", null);
        await tx.CommitAsync(ct);
        return token;
    }

    public async Task<bool> MediaIsAsync(Guid id, string kind, CancellationToken ct = default)
    {
        await using var conn = await db.OpenAsync(ct);
        return await conn.ExecuteScalarAsync<bool>(
            "select exists (select 1 from media where id = @id and kind = @kind)", new { id, kind });
    }

    private static async Task SetPostersAsync(NpgsqlConnection conn, NpgsqlTransaction tx, Guid eventId,
        IReadOnlyList<PosterInput> posters, CancellationToken ct)
    {
        await conn.ExecuteAsync("delete from event_posters where event_id = @eventId", new { eventId }, tx);
        for (var i = 0; i < posters.Count; i++)
        {
            await conn.ExecuteAsync(
                "insert into event_posters (event_id, position, media_id, width, height) values (@eventId, @i, @MediaId, @Width, @Height)",
                new { eventId, i, posters[i].MediaId, posters[i].Width, posters[i].Height }, tx);
        }
    }

    private static Task NotifyAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string code, string kind, long? id) =>
        conn.ExecuteAsync("select pg_notify(@channel, @payload)",
            new { channel = LiveChannel, payload = JsonSerializer.Serialize(new { code, kind, id }, Json) }, tx);

    private static string ThemeJson(ThemeValue theme) => JsonSerializer.Serialize(theme, Json);

    private static DynamicParameters Params(EventDraft d, object extra)
    {
        var p = new DynamicParameters(extra);
        p.Add("Title", d.Title);
        p.Add("Description", d.Description);
        p.Add("Venue", d.Venue);
        p.Add("OrganizerName", d.OrganizerName);
        p.Add("OrganizerColor", d.OrganizerColor);
        p.Add("OrganizerLogo", d.OrganizerLogo);
        p.Add("StartsAt", d.StartsAt);
        p.Add("EndsAt", d.EndsAt);
        p.Add("CheckInOpensAt", d.CheckInOpensAt);
        p.Add("CheckInClosesAt", d.CheckInClosesAt);
        p.Add("Cancelled", d.Cancelled);
        return p;
    }
}
