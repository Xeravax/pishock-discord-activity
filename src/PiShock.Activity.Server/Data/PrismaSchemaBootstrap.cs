using Microsoft.EntityFrameworkCore;

namespace PiShock.Activity.Server.Data;

/// <summary>
/// Applies <c>prisma/migrations/*/migration.sql</c> on a fresh database, then EF's empty
/// baseline only records history. Existing databases that already have DiscordUser are left alone.
/// </summary>
internal static class PrismaSchemaBootstrap
{
    public static async Task ApplyIfNeededAsync(AppDbContext db, ILogger logger, CancellationToken cancellationToken = default)
    {
        var connection = db.Database.GetDbConnection();
        await connection.OpenAsync(cancellationToken);
        try
        {
            await using var check = connection.CreateCommand();
            check.CommandText = """SELECT to_regclass('public."DiscordUser"')""";
            var existing = await check.ExecuteScalarAsync(cancellationToken);
            if (existing is string name && name.Contains("DiscordUser", StringComparison.Ordinal))
            {
                logger.LogInformation("Postgres schema present (DiscordUser) — leaving Prisma history intact.");
                return;
            }

            var directory = FindMigrationsDirectory();
            if (directory is null)
            {
                throw new InvalidOperationException(
                    "No DiscordUser table, and prisma/migrations was not found next to the app or in a parent directory.");
            }

            var files = Directory.GetDirectories(directory)
                .OrderBy(Path.GetFileName, StringComparer.Ordinal)
                .Select(dir => Path.Combine(dir, "migration.sql"))
                .Where(File.Exists)
                .ToList();
            if (files.Count == 0)
            {
                throw new InvalidOperationException($"No migration.sql files under {directory}.");
            }

            logger.LogInformation("No DiscordUser table — applying {Count} Prisma SQL files from {Directory}", files.Count, directory);
            foreach (var file in files)
            {
                var sql = await File.ReadAllTextAsync(file, cancellationToken);
                await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = sql;
                await command.ExecuteNonQueryAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                logger.LogInformation("Applied {File}", Path.GetFileName(Path.GetDirectoryName(file)));
            }
        }
        finally
        {
            await connection.CloseAsync();
        }
    }

    private static string? FindMigrationsDirectory()
    {
        foreach (var start in new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() })
        {
            var dir = new DirectoryInfo(start);
            for (var depth = 0; depth < 8 && dir is not null; depth++, dir = dir.Parent)
            {
                var candidate = Path.Combine(dir.FullName, "prisma", "migrations");
                if (Directory.Exists(candidate))
                {
                    return candidate;
                }
            }
        }

        return null;
    }
}
