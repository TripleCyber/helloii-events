using Events.Domain;

namespace Events.Tests;

public class EventRulesTests
{
    private static readonly DateTime Now = new(2026, 11, 20, 18, 30, 0, DateTimeKind.Utc);

    private static EventRow Event(bool cancelled = false) => new()
    {
        CheckInOpensAt = Now.AddHours(-1),
        CheckInClosesAt = Now.AddHours(4),
        Cancelled = cancelled,
    };

    [Fact]
    public void Nothing_is_allowed_outside_the_window()
    {
        var e = Event();
        Assert.Equal(EventRules.NotYet, EventRules.StateOf(e, e.CheckInOpensAt.AddSeconds(-1), false));
        Assert.Equal(EventRules.Open, EventRules.StateOf(e, e.CheckInOpensAt, false));
        Assert.Equal(EventRules.Open, EventRules.StateOf(e, e.CheckInClosesAt.AddSeconds(-1), false));
        Assert.Equal(EventRules.Closed, EventRules.StateOf(e, e.CheckInClosesAt, false));
    }

    [Fact]
    public void Who_checked_in_keeps_the_pass_but_a_cancellation_wins()
    {
        Assert.Equal(EventRules.Done, EventRules.StateOf(Event(), Now.AddDays(3), true));
        Assert.Equal(EventRules.Cancelled, EventRules.StateOf(Event(cancelled: true), Now, true));
    }

    [Fact]
    public void Check_in_cannot_close_after_the_event_ends()
    {
        var input = Input() with { CheckInClosesAt = new DateTimeOffset(Now.AddHours(6)) };
        var errors = EventRules.Validate(input, out var draft);
        Assert.Contains("checkInClosesAt cannot be after endsAt", errors);
        Assert.Null(draft);
    }

    [Fact]
    public void The_window_defaults_to_an_hour_before_the_start_until_the_end()
    {
        Assert.Empty(EventRules.Validate(Input(), out var draft));
        Assert.Equal(Now.AddHours(-1), draft!.CheckInOpensAt);
        Assert.Equal(Now.AddHours(5), draft.CheckInClosesAt);
        Assert.Equal(ThemeValue.Default, draft.Theme with { Button = ThemeValue.Default.Button });
    }

    [Fact]
    public void Colors_must_be_hex_and_the_button_takes_three()
    {
        var input = Input() with { Theme = new ThemeInput("red", null, null, ["#FFFFFF"], null) };
        var errors = EventRules.Validate(input, out _);
        Assert.Contains("theme.background must be #RRGGBB", errors);
        Assert.Contains("theme.button needs three colors", errors);
    }

    [Fact]
    public void Debug_is_off_and_the_kiosk_follows_the_screen_unless_the_event_says_otherwise()
    {
        Assert.Empty(EventRules.Validate(Input(), out var draft));
        Assert.False(draft!.Debug);
        Assert.Equal("auto", draft.KioskOrientation);

        Assert.Empty(EventRules.Validate(Input() with { Debug = true, KioskOrientation = "portrait-left" }, out draft));
        Assert.True(draft!.Debug);
        Assert.Equal("portrait-left", draft.KioskOrientation);

        Assert.Contains("kioskOrientation must be auto, landscape, portrait or portrait-left",
            EventRules.Validate(Input() with { KioskOrientation = "sideways" }, out _));
    }

    [Fact]
    public void Codes_are_random_and_valid()
    {
        var a = EventRules.NewCode();
        Assert.True(EventRules.IsCode(a));
        Assert.NotEqual(a, EventRules.NewCode());
        Assert.False(EventRules.IsCode("short"));
        Assert.False(EventRules.IsCode("has space 123"));
        Assert.False(EventRules.IsCode("../../etc/passwd"));
    }

    [Fact]
    public void The_attendee_comes_from_the_app_and_is_cleaned()
    {
        var who = EventRules.ReadAttendee(new CheckInUser("Juanito@Helloii.Chat", " Juanito\u0007 ", "", null), out var error);
        Assert.Null(error);
        Assert.Equal("juanito@helloii.chat", who!.Jid);
        Assert.Equal("Juanito", who.FirstName);
        Assert.Equal("Juanito", who.DisplayName);
        Assert.Null(who.Photo);

        Assert.Null(EventRules.ReadAttendee(new CheckInUser("nojid", "A", "A", null), out error));
        Assert.NotNull(error);
        Assert.Null(EventRules.ReadAttendee(null, out _));
    }

    [Fact]
    public void A_bad_photo_is_dropped_not_fatal()
    {
        var who = EventRules.ReadAttendee(new CheckInUser("ana@helloii.chat", "Ana", "Ana", "data:image/png;base64,bm90IGFuIGltYWdl"), out _);
        Assert.NotNull(who);
        Assert.Null(who!.Photo);
    }

    private static EventInput Input() => new(
        null, "Helloii Fest", null, null, null,
        new DateTimeOffset(Now), new DateTimeOffset(Now.AddHours(5)), null, null, false, null, null);
}

public class ImagesTests
{
    private static readonly byte[] Png = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC");

    [Fact]
    public void The_type_comes_from_the_bytes()
    {
        Assert.Equal("image/png", Images.Sniff(Png));
        Assert.Equal("image/jpeg", Images.Sniff([0xFF, 0xD8, 0xFF, 0xE0, 0, 0]));
        Assert.Null(Images.Sniff("<svg onload=alert(1)>"u8));
    }

    [Fact]
    public void Data_urls_are_checked_and_capped()
    {
        Assert.True(Images.TryReadDataUrl("data:image/png;base64," + Convert.ToBase64String(Png), 1024, out var bytes, out var type));
        Assert.Equal("image/png", type);
        Assert.Equal(Png, bytes);
        Assert.False(Images.TryReadDataUrl("data:image/png;base64," + Convert.ToBase64String(Png), 10, out _, out _));
        Assert.False(Images.TryReadDataUrl("https://evil.example/a.png", 1024, out _, out _));
        Assert.False(Images.TryReadDataUrl("data:text/html;base64,PHNjcmlwdD4=", 1024, out _, out _));
    }
}

public class EventsOptionsTests
{
    [Fact]
    public void Coolify_urls_become_npgsql_strings()
    {
        var cs = EventsOptions.ToNpgsql("postgres://events:p%40ss@db-host:5433/events?sslmode=disable");
        var b = new Npgsql.NpgsqlConnectionStringBuilder(cs);
        Assert.Equal("db-host", b.Host);
        Assert.Equal(5433, b.Port);
        Assert.Equal("events", b.Username);
        Assert.Equal("p@ss", b.Password);
        Assert.Equal("events", b.Database);
        Assert.Equal(Npgsql.SslMode.Disable, b.SslMode);
        Assert.Equal("Host=x", EventsOptions.ToNpgsql("Host=x"));
        Assert.Equal("db-host", new Npgsql.NpgsqlConnectionStringBuilder(
            EventsOptions.ToNpgsql("  \"postgres://u:p@db-host:5432/events\" ")).Host);
        Assert.Throws<InvalidOperationException>(() => EventsOptions.ToNpgsql("not a connection"));
    }
}
