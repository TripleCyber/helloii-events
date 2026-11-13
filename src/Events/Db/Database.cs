using Dapper;
using Npgsql;

namespace Events.Db;

public sealed class Database : IAsyncDisposable
{
    private const long MigrationLock = 731_046;

    static Database() => DefaultTypeMap.MatchNamesWithUnderscores = true;

    public Database(EventsOptions options)
    {
        // No Kerberos here; without this Npgsql probes for libgssapi on every connection.
        var builder = new NpgsqlConnectionStringBuilder(options.ConnectionString) { GssEncryptionMode = GssEncryptionMode.Disable };
        Source = NpgsqlDataSource.Create(builder.ConnectionString);
    }

    public NpgsqlDataSource Source { get; }

    public ValueTask<NpgsqlConnection> OpenAsync(CancellationToken ct = default) => Source.OpenConnectionAsync(ct);

    public async Task MigrateAsync(CancellationToken ct = default)
    {
        await using var conn = await OpenAsync(ct);
        // The public and admin containers start together; only one migrates.
        await conn.ExecuteAsync("select pg_advisory_lock(@MigrationLock)", new { MigrationLock });
        try
        {
            await conn.ExecuteAsync(
                "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
            var applied = (await conn.QueryAsync<string>("select name from schema_migrations")).ToHashSet();
            var assembly = typeof(Database).Assembly;
            foreach (var resource in assembly.GetManifestResourceNames()
                         .Where(n => n.EndsWith(".sql", StringComparison.Ordinal))
                         .Order(StringComparer.Ordinal))
            {
                var name = resource[(resource.LastIndexOf(".M", StringComparison.Ordinal) + 1)..];
                if (applied.Contains(name)) continue;
                using var reader = new StreamReader(assembly.GetManifestResourceStream(resource)!);
                var sql = await reader.ReadToEndAsync(ct);
                await using var tx = await conn.BeginTransactionAsync(ct);
                await conn.ExecuteAsync(sql, transaction: tx);
                await conn.ExecuteAsync("insert into schema_migrations (name) values (@name)", new { name }, tx);
                await tx.CommitAsync(ct);
            }
        }
        finally
        {
            await conn.ExecuteAsync("select pg_advisory_unlock(@MigrationLock)", new { MigrationLock });
        }
    }

    public ValueTask DisposeAsync() => Source.DisposeAsync();
}
