using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace PiShock.Activity.Server.Data;

/// <summary>
/// EF Core mapping of the existing Prisma/PostgreSQL schema (prisma/schema.prisma +
/// prisma/migrations/*.sql). Table names are the PascalCase model names and every column is a
/// quoted camelCase identifier (e.g. "globalName", "discordUserId", "emergencyStopShockerIds" integer[]).
///
/// MIGRATIONS / BASELINE (README):
///   The database is created and evolved by the SQL in prisma/migrations (the Prisma history table is
///   "_prisma_migrations"). This context deliberately maps onto that existing schema instead of owning
///   it, so there is no generated InitialCreate migration in the repo. To adopt EF migrations later:
///     1. dotnet ef migrations add Baseline --project src/PiShock.Activity.Server
///     2. Empty the Up()/Down() bodies of the generated Baseline migration (the tables already exist).
///     3. Run the app / `dotnet ef database update`; this creates only "__EFMigrationsHistory" and records
///        the Baseline row, leaving all Prisma-created tables untouched.
///   Fresh databases must first have prisma/migrations/*/migration.sql applied (in folder order).
///
/// Prisma semantics replicated here: <c>@default(cuid())</c> ids (see <see cref="Cuid"/>),
/// <c>@default(now())</c> createdAt and <c>@updatedAt</c> updatedAt (both maintained in SaveChanges, since
/// updatedAt has no database default), TIMESTAMP(3) without time zone columns (values are treated as UTC).
/// </summary>
public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    private const string TimestampType = "timestamp(3) without time zone";

    public DbSet<DiscordUser> DiscordUsers => Set<DiscordUser>();
    public DbSet<PiShockSession> PiShockSessions => Set<PiShockSession>();
    public DbSet<ActivityShare> ActivityShares => Set<ActivityShare>();
    public DbSet<ActivityBan> ActivityBans => Set<ActivityBan>();
    public DbSet<CommandLog> CommandLogs => Set<CommandLog>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<DiscordUser>(e =>
        {
            e.ToTable("DiscordUser");
            e.HasKey(x => x.Id).HasName("DiscordUser_pkey");
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.ActivityMaxIntensity).HasDefaultValue(100).ValueGeneratedNever();
            e.Property(x => x.ActivityMaxDurationMs).HasDefaultValue(15000).ValueGeneratedNever();
            e.Property(x => x.EmergencyStopShockerIds)
                .HasColumnType("integer[]")
                .IsRequired(false)
                .HasDefaultValueSql("ARRAY[]::INTEGER[]")
                .ValueGeneratedNever();
            CreatedAtDefault(e.Property(x => x.CreatedAt));
        });

        modelBuilder.Entity<PiShockSession>(e =>
        {
            e.ToTable("PiShockSession");
            e.HasKey(x => x.Id).HasName("PiShockSession_pkey");
            e.Property(x => x.Id).ValueGeneratedNever();
            e.HasIndex(x => x.DiscordUserId).IsUnique().HasDatabaseName("PiShockSession_discordUserId_key");
            e.HasOne(x => x.DiscordUser)
                .WithOne(u => u.PishockSession)
                .HasForeignKey<PiShockSession>(x => x.DiscordUserId)
                .HasConstraintName("PiShockSession_discordUserId_fkey")
                .OnDelete(DeleteBehavior.Cascade);
            CreatedAtDefault(e.Property(x => x.CreatedAt));
        });

        modelBuilder.Entity<ActivityShare>(e =>
        {
            e.ToTable("ActivityShare");
            e.HasKey(x => x.Id).HasName("ActivityShare_pkey");
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.DeviceMaxIntensity).HasDefaultValue(100).ValueGeneratedNever();
            e.Property(x => x.DeviceMaxDurationMs).HasDefaultValue(15000).ValueGeneratedNever();
            e.Property(x => x.Enabled).HasDefaultValue(true).ValueGeneratedNever();
            e.Property(x => x.Paused).HasDefaultValue(false).ValueGeneratedNever();
            e.Property(x => x.MaxIntensity).HasDefaultValue(100).ValueGeneratedNever();
            e.Property(x => x.MaxDurationMs).HasDefaultValue(15000).ValueGeneratedNever();
            e.Property(x => x.CanShock).HasDefaultValue(true).ValueGeneratedNever();
            e.Property(x => x.CanVibrate).HasDefaultValue(true).ValueGeneratedNever();
            e.Property(x => x.CanBeep).HasDefaultValue(true).ValueGeneratedNever();
            e.Property(x => x.CanHold).HasDefaultValue(true).ValueGeneratedNever();
            CreatedAtDefault(e.Property(x => x.CreatedAt));
            e.HasIndex(x => new { x.DiscordUserId, x.ShockerId })
                .IsUnique()
                .HasDatabaseName("ActivityShare_discordUserId_shockerId_key");
            e.HasIndex(x => new { x.DiscordUserId, x.Enabled, x.Paused })
                .HasDatabaseName("ActivityShare_discordUserId_enabled_paused_idx");
            e.HasOne(x => x.DiscordUser)
                .WithMany(u => u.ActivityShares)
                .HasForeignKey(x => x.DiscordUserId)
                .HasConstraintName("ActivityShare_discordUserId_fkey")
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ActivityBan>(e =>
        {
            e.ToTable("ActivityBan");
            e.HasKey(x => x.Id).HasName("ActivityBan_pkey");
            e.Property(x => x.Id).ValueGeneratedNever();
            CreatedAtDefault(e.Property(x => x.CreatedAt));
            e.HasIndex(x => new { x.OwnerDiscordUserId, x.BannedDiscordUserId })
                .IsUnique()
                .HasDatabaseName("ActivityBan_ownerDiscordUserId_bannedDiscordUserId_key");
            e.HasIndex(x => x.OwnerDiscordUserId).HasDatabaseName("ActivityBan_ownerDiscordUserId_idx");
            e.HasOne(x => x.Owner)
                .WithMany(u => u.ActivityBans)
                .HasForeignKey(x => x.OwnerDiscordUserId)
                .HasConstraintName("ActivityBan_ownerDiscordUserId_fkey")
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Banned)
                .WithMany(u => u.BannedBy)
                .HasForeignKey(x => x.BannedDiscordUserId)
                .HasConstraintName("ActivityBan_bannedDiscordUserId_fkey")
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<CommandLog>(e =>
        {
            e.ToTable("CommandLog");
            e.HasKey(x => x.Id).HasName("CommandLog_pkey");
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.Source).HasDefaultValue("discord").ValueGeneratedNever();
            CreatedAtDefault(e.Property(x => x.CreatedAt));
            e.HasIndex(x => x.ExternalLogKey).IsUnique().HasDatabaseName("CommandLog_externalLogKey_key");
            e.HasIndex(x => new { x.DiscordUserId, x.CreatedAt })
                .HasDatabaseName("CommandLog_discordUserId_createdAt_idx");
            e.HasIndex(x => new { x.TargetDiscordUserId, x.CreatedAt })
                .HasDatabaseName("CommandLog_targetDiscordUserId_createdAt_idx");
            e.HasIndex(x => x.CreatedAt).HasDatabaseName("CommandLog_createdAt_idx");
            e.HasIndex(x => new { x.Source, x.CreatedAt }).HasDatabaseName("CommandLog_source_createdAt_idx");
            e.HasOne(x => x.DiscordUser)
                .WithMany(u => u.CommandLogs)
                .HasForeignKey(x => x.DiscordUserId)
                .HasConstraintName("CommandLog_discordUserId_fkey")
                .OnDelete(DeleteBehavior.Cascade);
        });

        ApplyPrismaConventions(modelBuilder);
    }

    private static void CreatedAtDefault(PropertyBuilder<DateTime> property) =>
        property.HasDefaultValueSql("CURRENT_TIMESTAMP").ValueGeneratedNever();

    /// <summary>Quoted camelCase column names and Prisma's TIMESTAMP(3) (UTC, no time zone) mapping.</summary>
    private static void ApplyPrismaConventions(ModelBuilder modelBuilder)
    {
        var dateTimeConverter = new ValueConverter<DateTime, DateTime>(
            v => UtcClock.ToStored(v),
            v => UtcClock.FromStored(v));
        var nullableDateTimeConverter = new ValueConverter<DateTime?, DateTime?>(
            v => UtcClock.ToStoredNullable(v),
            v => UtcClock.FromStoredNullable(v));

        foreach (var entityType in modelBuilder.Model.GetEntityTypes())
        {
            foreach (var property in entityType.GetProperties())
            {
                property.SetColumnName(ToCamelCase(property.Name));

                if (property.ClrType == typeof(DateTime))
                {
                    property.SetColumnType(TimestampType);
                    property.SetValueConverter(dateTimeConverter);
                }
                else if (property.ClrType == typeof(DateTime?))
                {
                    property.SetColumnType(TimestampType);
                    property.SetValueConverter(nullableDateTimeConverter);
                }
            }
        }
    }

    private static string ToCamelCase(string name) =>
        string.IsNullOrEmpty(name) ? name : char.ToLowerInvariant(name[0]) + name[1..];

    // Prisma @default(now()) / @updatedAt are client-side; the updatedAt columns have no DB default.
    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        ApplyTimestamps();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(
        bool acceptAllChangesOnSuccess,
        CancellationToken cancellationToken = default)
    {
        ApplyTimestamps();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    private void ApplyTimestamps()
    {
        var now = DateTime.UtcNow;
        foreach (var entry in ChangeTracker.Entries())
        {
            if (entry.State is not (EntityState.Added or EntityState.Modified)) continue;

            switch (entry.Entity)
            {
                case DiscordUser u:
                    Stamp(entry.State, u, now, x => x.CreatedAt, (x, v) => x.CreatedAt = v,
                        (x, v) => x.UpdatedAt = v);
                    break;
                case PiShockSession s:
                    Stamp(entry.State, s, now, x => x.CreatedAt, (x, v) => x.CreatedAt = v,
                        (x, v) => x.UpdatedAt = v);
                    break;
                case ActivityShare a:
                    Stamp(entry.State, a, now, x => x.CreatedAt, (x, v) => x.CreatedAt = v,
                        (x, v) => x.UpdatedAt = v);
                    break;
                case ActivityBan b:
                    if (entry.State == EntityState.Added && b.CreatedAt == default) b.CreatedAt = now;
                    break;
                case CommandLog c:
                    if (entry.State == EntityState.Added && c.CreatedAt == default) c.CreatedAt = now;
                    break;
            }
        }
    }

    private static void Stamp<T>(
        EntityState state,
        T entity,
        DateTime now,
        Func<T, DateTime> getCreated,
        Action<T, DateTime> setCreated,
        Action<T, DateTime> setUpdated)
    {
        if (state == EntityState.Added && getCreated(entity) == default) setCreated(entity, now);
        setUpdated(entity, now);
    }
}

internal static class UtcClock
{
    // Npgsql refuses to write Kind=Utc/Local values into "timestamp without time zone".
    public static DateTime ToStored(DateTime value)
    {
        var utc = value.Kind == DateTimeKind.Local ? value.ToUniversalTime() : value;
        return DateTime.SpecifyKind(utc, DateTimeKind.Unspecified);
    }

    public static DateTime FromStored(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);

    public static DateTime? ToStoredNullable(DateTime? value) => value is null ? null : ToStored(value.Value);

    public static DateTime? FromStoredNullable(DateTime? value) => value is null ? null : FromStored(value.Value);
}
