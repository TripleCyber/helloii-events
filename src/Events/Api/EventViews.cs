using System.Text.Json;
using Events.Db;
using Events.Domain;

namespace Events.Api;

/// <summary>How an event leaves the server: the shape event.html reads.</summary>
public sealed class EventViews(EventStore store, EventsOptions options)
{
    public async Task<object> PublicAsync(EventRow e, CheckInRow? mine, CancellationToken ct = default)
    {
        var posters = await store.PostersAsync(e.Id, ct);
        var count = await store.CountAsync(e.Id, ct);
        return new
        {
            code = e.Code,
            title = e.Title,
            description = e.Description,
            venue = e.Venue,
            startsAt = e.StartsAt,
            endsAt = e.EndsAt,
            organizer = new
            {
                name = e.OrganizerName,
                color = e.OrganizerColor,
                logoUrl = e.OrganizerLogo is Guid logo ? options.MediaUrl(logo) : null,
            },
            posters = posters.Select(p => new { url = options.MediaUrl(p.MediaId), width = p.Width, height = p.Height }),
            theme = JsonDocument.Parse(e.Theme).RootElement,
            cancelled = e.Cancelled,
            attendeeCount = count,
            checkIn = new
            {
                state = EventRules.StateOf(e, DateTime.UtcNow, mine is not null),
                opensAt = e.CheckInOpensAt,
                closesAt = e.CheckInClosesAt,
                doneAt = mine?.CheckedInAt,
            },
        };
    }

    public static object Attendee(CheckInRow row) => new
    {
        id = row.Id,
        firstName = row.FirstName,
        displayName = row.DisplayName,
        hasPhoto = row.Photo is not null,
        at = row.CheckedInAt,
    };

    public async Task<object> AdminAsync(EventRow e, CancellationToken ct = default)
    {
        var posters = await store.PostersAsync(e.Id, ct);
        var count = await store.CountAsync(e.Id, ct);
        return new
        {
            code = e.Code,
            title = e.Title,
            description = e.Description,
            venue = e.Venue,
            startsAt = e.StartsAt,
            endsAt = e.EndsAt,
            checkInOpensAt = e.CheckInOpensAt,
            checkInClosesAt = e.CheckInClosesAt,
            cancelled = e.Cancelled,
            state = EventRules.StateOf(e, DateTime.UtcNow, false),
            organizer = new
            {
                name = e.OrganizerName,
                color = e.OrganizerColor,
                logoMediaId = e.OrganizerLogo,
                logoUrl = e.OrganizerLogo is Guid logo ? options.MediaUrl(logo) : null,
            },
            theme = JsonDocument.Parse(e.Theme).RootElement,
            posters = posters.Select(p => new { mediaId = p.MediaId, url = options.MediaUrl(p.MediaId), width = p.Width, height = p.Height }),
            attendeeCount = count,
            eventLink = options.EventLink(e.Code),
            qrUrl = $"{options.PublicOrigin}/api/v1/events/{e.Code}/qr.svg",
            kioskUrl = options.KioskUrl(e.Code, e.KioskToken),
            updatedAt = e.UpdatedAt,
        };
    }
}
