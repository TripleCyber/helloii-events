using System.Globalization;
using System.Text;
using Events.Db;
using Events.Domain;
using Microsoft.Extensions.FileProviders;

namespace Events.Api;

public static class AdminApi
{
    // Basic auth rides along on any request the browser makes; a custom header is what a foreign page cannot send.
    public const string CsrfHeader = "X-Events-Admin";
    private static readonly Dictionary<string, int> MaxUpload = new() { ["poster"] = 2 * 1024 * 1024, ["logo"] = 512 * 1024 };

    public static void MapAdminApi(this WebApplication app)
    {
        var root = Path.Combine(app.Environment.WebRootPath, "admin");
        app.UseStaticFiles(new StaticFileOptions { FileProvider = new PhysicalFileProvider(root), RequestPath = "/assets", OnPrepareResponse = Program.Revalidate });
        app.MapGet("/", () => Results.File(Path.Combine(root, "index.html"), "text/html; charset=utf-8"));

        var admin = app.MapGroup("/api/admin").AddEndpointFilter(async (ctx, next) =>
        {
            var req = ctx.HttpContext.Request;
            if (!HttpMethods.IsGet(req.Method) && req.Headers[CsrfHeader] != "1")
            {
                return Results.StatusCode(StatusCodes.Status403Forbidden);
            }
            return await next(ctx);
        });

        admin.MapGet("/events", async (EventStore store, CancellationToken ct) =>
        {
            var now = DateTime.UtcNow;
            var rows = await store.ListAsync(ct);
            return rows.Select(r => new
            {
                r.Code,
                r.Title,
                r.StartsAt,
                r.EndsAt,
                r.Cancelled,
                r.Debug,
                r.AttendeeCount,
                state = EventRules.StateOf(new EventRow
                {
                    Cancelled = r.Cancelled,
                    CheckInOpensAt = r.CheckInOpensAt,
                    CheckInClosesAt = r.CheckInClosesAt,
                }, now, false),
            });
        });

        admin.MapPost("/events", async (EventInput input, EventStore store, EventViews views, CancellationToken ct) =>
        {
            var code = string.IsNullOrWhiteSpace(input.Code) ? EventRules.NewCode() : input.Code.Trim();
            if (!EventRules.IsCode(code)) return Results.BadRequest(new { errors = new[] { "code must be 10 to 16 letters or digits" } });
            if (await store.GetAsync(code, ct) is not null) return Results.Conflict(new { errors = new[] { "code already in use" } });
            var errors = EventRules.Validate(input, out var draft);
            errors.AddRange(await MediaErrorsAsync(input, store, ct));
            if (errors.Count > 0) return Results.BadRequest(new { errors });
            var e = await store.CreateAsync(code, draft!, ct);
            return Results.Ok(await views.AdminAsync(e, ct));
        });

        admin.MapGet("/events/{code}", async (string code, EventStore store, EventViews views, CancellationToken ct) =>
            await store.GetAsync(code, ct) is { } e ? Results.Ok(await views.AdminAsync(e, ct)) : Results.NotFound());

        admin.MapPut("/events/{code}", async (string code, EventInput input, EventStore store, EventViews views, CancellationToken ct) =>
        {
            var errors = EventRules.Validate(input, out var draft);
            errors.AddRange(await MediaErrorsAsync(input, store, ct));
            if (errors.Count > 0) return Results.BadRequest(new { errors });
            var e = await store.UpdateAsync(code, draft!, ct);
            return e is null ? Results.NotFound() : Results.Ok(await views.AdminAsync(e, ct));
        });

        admin.MapDelete("/events/{code}", async (string code, EventStore store, CancellationToken ct) =>
            await store.DeleteAsync(code, ct) ? Results.NoContent() : Results.NotFound());

        admin.MapGet("/events/{code}/qr.svg", async (string code, EventStore store, EventsOptions options, CancellationToken ct) =>
            await store.GetAsync(code, ct) is null
                ? Results.NotFound()
                : Results.File(System.Text.Encoding.UTF8.GetBytes(PublicApi.QrSvg(options.EventLink(code))), "image/svg+xml", $"qr-{code}.svg"));

        admin.MapPost("/events/{code}/kiosk-token", async (string code, EventStore store, EventsOptions options, CancellationToken ct) =>
            await store.RotateKioskTokenAsync(code, ct) is { } token
                ? Results.Ok(new { kioskUrl = options.KioskUrl(code, token) })
                : Results.NotFound());

        // The image itself is the body: no multipart, nothing to parse but the bytes.
        admin.MapPost("/media", async (HttpRequest req, string kind, EventStore store, EventsOptions options, CancellationToken ct) =>
        {
            if (!MaxUpload.TryGetValue(kind, out var max)) return Results.BadRequest(new { errors = new[] { "kind must be poster or logo" } });
            if (req.ContentLength is > 0 && req.ContentLength > max) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
            using var buffer = new MemoryStream();
            await req.Body.CopyToAsync(buffer, ct);
            if (buffer.Length > max) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
            var bytes = buffer.ToArray();
            var type = Images.Sniff(bytes);
            if (type is null) return Results.BadRequest(new { errors = new[] { "only JPG, PNG or WebP" } });
            var id = await store.AddMediaAsync(kind, type, bytes, ct);
            return Results.Ok(new { mediaId = id, url = options.MediaUrl(id) });
        });

        admin.MapGet("/events/{code}/attendance", async (string code, EventStore store, CancellationToken ct) =>
        {
            if (await store.GetAsync(code, ct) is not { } e) return Results.NotFound();
            var rows = await store.CheckInsAsync(e.Id, null, ct);
            return Results.Ok(rows.Select(r => new
            {
                r.Id,
                username = r.UserJid,
                r.FirstName,
                r.DisplayName,
                hasPhoto = r.Photo is not null,
                r.CheckedInAt,
            }));
        });

        admin.MapGet("/events/{code}/attendance.csv", async (string code, EventStore store, CancellationToken ct) =>
        {
            if (await store.GetAsync(code, ct) is not { } e) return Results.NotFound();
            var rows = await store.CheckInsAsync(e.Id, null, ct);
            var csv = new StringBuilder("checked_in_at_utc,username,first_name,display_name\n");
            foreach (var r in rows.OrderBy(r => r.CheckedInAt))
            {
                csv.Append(r.CheckedInAt.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture)).Append(',')
                    .Append(Cell(r.UserJid)).Append(',').Append(Cell(r.FirstName)).Append(',').Append(Cell(r.DisplayName)).Append('\n');
            }
            return Results.File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(csv.ToString())).ToArray(),
                "text/csv; charset=utf-8", $"asistencia-{code}.csv");
        });

        // Lets a test phone check in again; the kiosk count follows.
        admin.MapDelete("/events/{code}/attendees/{id:long}", async (string code, long id, EventStore store, CancellationToken ct) =>
            await store.GetAsync(code, ct) is { } e && await store.RemoveCheckInAsync(e.Id, code, id, ct)
                ? Results.NoContent()
                : Results.NotFound());

        admin.MapGet("/events/{code}/attendees/{id:long}/photo", async (string code, long id, EventStore store, CancellationToken ct) =>
        {
            if (await store.GetAsync(code, ct) is not { } e) return Results.NotFound();
            var row = await store.CheckInAsync(e.Id, id, ct);
            if (row?.Photo is not Guid photo || await store.MediaAsync(photo, ct) is not { } media) return Results.NotFound();
            return Results.File(media.Bytes, media.ContentType);
        });
    }

    private static async Task<List<string>> MediaErrorsAsync(EventInput input, EventStore store, CancellationToken ct)
    {
        var errors = new List<string>();
        if (input.Organizer?.LogoMediaId is Guid logo && !await store.MediaIsAsync(logo, "logo", ct)) errors.Add("unknown logo");
        foreach (var poster in input.Posters ?? [])
        {
            if (!await store.MediaIsAsync(poster.MediaId, "poster", ct)) errors.Add("unknown poster");
        }
        return errors;
    }

    // Spreadsheets run cells that start like a formula.
    private static string Cell(string value)
    {
        var text = value.Length > 0 && "=+-@\t\r".Contains(value[0]) ? "'" + value : value;
        return text.Contains(',') || text.Contains('"') || text.Contains('\n') ? $"\"{text.Replace("\"", "\"\"")}\"" : text;
    }
}
