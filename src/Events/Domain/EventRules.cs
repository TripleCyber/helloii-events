using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace Events.Domain;

public static partial class EventRules
{
    public const string Open = "open";
    public const string Done = "done";
    public const string NotYet = "notYet";
    public const string Closed = "closed";
    public const string Cancelled = "cancelled";

    public const int MaxPosters = 8;
    public static readonly string[] KioskOrientations = ["auto", "landscape", "portrait", "portrait-left"];
    public const int MaxPhotoBytes = 600 * 1024;
    public static readonly TimeSpan DefaultCheckInLead = TimeSpan.FromHours(1);

    private const string Base62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    [GeneratedRegex("^[A-Za-z0-9]{10,16}$")]
    public static partial Regex CodePattern();

    [GeneratedRegex("^#[0-9A-Fa-f]{6}$")]
    private static partial Regex HexPattern();

    [GeneratedRegex(@"^[^@\s/]{1,64}@[A-Za-z0-9.-]{1,253}$")]
    private static partial Regex JidPattern();

    /// <summary>What a user sees: the server's clock decides, and nothing is allowed outside the window.</summary>
    public static string StateOf(EventRow e, DateTime nowUtc, bool done) =>
        e.Cancelled ? Cancelled
        : done ? Done
        : nowUtc < e.CheckInOpensAt ? NotYet
        : nowUtc >= e.CheckInClosesAt ? Closed
        : Open;

    public static bool IsCode(string? code) => code is not null && CodePattern().IsMatch(code);

    public static string NewCode() => RandomNumberGenerator.GetString(Base62, 12);

    public static string NewKioskToken() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(24)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static List<string> Validate(EventInput input, out EventDraft? draft)
    {
        var errors = new List<string>();
        draft = null;

        var title = Text(input.Title, 120, "title", errors, required: true);
        var description = Text(input.Description, 2000, "description", errors);
        var venue = Text(input.Venue, 200, "venue", errors);
        var organizerName = Text(input.Organizer?.Name, 80, "organizer.name", errors);
        var organizerColor = Hex(input.Organizer?.Color, "#0F1E29", "organizer.color", errors);

        if (input.StartsAt is null) errors.Add("startsAt is required");
        if (input.EndsAt is null) errors.Add("endsAt is required");
        var starts = input.StartsAt?.UtcDateTime ?? default;
        var ends = input.EndsAt?.UtcDateTime ?? default;
        var opens = input.CheckInOpensAt?.UtcDateTime ?? starts - DefaultCheckInLead;
        var closes = input.CheckInClosesAt?.UtcDateTime ?? ends;
        if (input.StartsAt is not null && input.EndsAt is not null)
        {
            if (ends <= starts) errors.Add("endsAt must be after startsAt");
            if (closes <= opens) errors.Add("checkInClosesAt must be after checkInOpensAt");
            if (closes > ends) errors.Add("checkInClosesAt cannot be after endsAt");
        }

        var theme = input.Theme;
        var defaults = ThemeValue.Default;
        var button = theme?.Button is { Length: 3 } b
            ? b.Select((c, i) => Hex(c, defaults.Button[i], $"theme.button[{i}]", errors)).ToArray()
            : defaults.Button;
        if (theme?.Button is { Length: not 3 }) errors.Add("theme.button needs three colors");
        var themeValue = new ThemeValue(
            Hex(theme?.Background, defaults.Background, "theme.background", errors),
            Hex(theme?.Accent, defaults.Accent, "theme.accent", errors),
            Hex(theme?.Glow, defaults.Glow, "theme.glow", errors),
            button,
            Hex(theme?.ButtonText, defaults.ButtonText, "theme.buttonText", errors));

        var posters = input.Posters ?? [];
        if (posters.Count > MaxPosters) errors.Add($"at most {MaxPosters} posters");
        foreach (var poster in posters)
        {
            if (poster.Width is < 1 or > 8192 || poster.Height is < 1 or > 8192) errors.Add("poster size out of range");
        }

        var orientation = string.IsNullOrWhiteSpace(input.KioskOrientation) ? "auto" : input.KioskOrientation.Trim();
        if (!KioskOrientations.Contains(orientation)) errors.Add("kioskOrientation must be auto, landscape, portrait or portrait-left");

        if (errors.Count == 0)
        {
            draft = new EventDraft(title, description, venue, organizerName, organizerColor, input.Organizer?.LogoMediaId,
                starts, ends, opens, closes, input.Cancelled, themeValue, posters, input.Debug, orientation);
        }
        return errors;
    }

    public static Attendee? ReadAttendee(CheckInUser? user, out string? error)
    {
        error = null;
        var jid = user?.Username?.Trim().ToLowerInvariant();
        if (jid is null || !JidPattern().IsMatch(jid))
        {
            error = "user.username must be a bare JID";
            return null;
        }
        var display = Clean(user!.DisplayName, 80);
        var first = Clean(user.FirstName, 40);
        if (first.Length == 0) first = display.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "";
        if (first.Length == 0) first = jid[..jid.IndexOf('@')];
        if (display.Length == 0) display = first;

        byte[]? photo = null;
        string? type = null;
        if (!string.IsNullOrEmpty(user.Photo) && !Images.TryReadDataUrl(user.Photo, MaxPhotoBytes, out photo, out type))
        {
            photo = null;
            type = null;
        }
        return new Attendee(jid, first, display, photo, type);
    }

    private static string Clean(string? value, int max)
    {
        var text = new string((value ?? "").Where(c => !char.IsControl(c)).ToArray()).Trim();
        return text.Length > max ? text[..max] : text;
    }

    private static string Text(string? value, int max, string field, List<string> errors, bool required = false)
    {
        var text = (value ?? "").Trim();
        if (required && text.Length == 0) errors.Add($"{field} is required");
        if (text.Length > max) errors.Add($"{field} is longer than {max}");
        return text;
    }

    private static string Hex(string? value, string fallback, string field, List<string> errors)
    {
        if (string.IsNullOrWhiteSpace(value)) return fallback;
        if (!HexPattern().IsMatch(value.Trim()))
        {
            errors.Add($"{field} must be #RRGGBB");
            return fallback;
        }
        return value.Trim().ToUpperInvariant();
    }
}
