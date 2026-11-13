namespace Events.Domain;

public sealed class EventRow
{
    public Guid Id { get; set; }
    public string Code { get; set; } = "";
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string Venue { get; set; } = "";
    public string OrganizerName { get; set; } = "";
    public string OrganizerColor { get; set; } = "";
    public Guid? OrganizerLogo { get; set; }
    public DateTime StartsAt { get; set; }
    public DateTime EndsAt { get; set; }
    public DateTime CheckInOpensAt { get; set; }
    public DateTime CheckInClosesAt { get; set; }
    public bool Cancelled { get; set; }
    public string Theme { get; set; } = "{}";
    public string KioskToken { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class PosterRow
{
    public int Position { get; set; }
    public Guid MediaId { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
}

public sealed class CheckInRow
{
    public long Id { get; set; }
    public string UserJid { get; set; } = "";
    public string FirstName { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public Guid? Photo { get; set; }
    public DateTime CheckedInAt { get; set; }
}

public sealed class EventSummaryRow
{
    public string Code { get; set; } = "";
    public string Title { get; set; } = "";
    public DateTime StartsAt { get; set; }
    public DateTime EndsAt { get; set; }
    public DateTime CheckInOpensAt { get; set; }
    public DateTime CheckInClosesAt { get; set; }
    public bool Cancelled { get; set; }
    public long AttendeeCount { get; set; }
}

public sealed record MediaRow(string Kind, string ContentType, byte[] Bytes);

public sealed record EventInput(
    string? Code,
    string? Title,
    string? Description,
    string? Venue,
    OrganizerInput? Organizer,
    DateTimeOffset? StartsAt,
    DateTimeOffset? EndsAt,
    DateTimeOffset? CheckInOpensAt,
    DateTimeOffset? CheckInClosesAt,
    bool Cancelled,
    ThemeInput? Theme,
    List<PosterInput>? Posters);

public sealed record OrganizerInput(string? Name, string? Color, Guid? LogoMediaId);

public sealed record ThemeInput(string? Background, string? Accent, string? Glow, string[]? Button, string? ButtonText);

public sealed record PosterInput(Guid MediaId, int Width, int Height);

public sealed record ThemeValue(string Background, string Accent, string Glow, string[] Button, string ButtonText)
{
    public static readonly ThemeValue Default =
        new("#06090F", "#86EE60", "#2E6E65", ["#B9F7A0", "#6FE38A", "#1FB255"], "#04210F");
}

/// <summary>An event as the admin saves it, already validated and normalized.</summary>
public sealed record EventDraft(
    string Title,
    string Description,
    string Venue,
    string OrganizerName,
    string OrganizerColor,
    Guid? OrganizerLogo,
    DateTime StartsAt,
    DateTime EndsAt,
    DateTime CheckInOpensAt,
    DateTime CheckInClosesAt,
    bool Cancelled,
    ThemeValue Theme,
    IReadOnlyList<PosterInput> Posters);

public sealed record CheckInInput(CheckInUser? User);

public sealed record CheckInUser(string? Username, string? FirstName, string? DisplayName, string? Photo);

public sealed record Attendee(string Jid, string FirstName, string DisplayName, byte[]? Photo, string? PhotoType);
