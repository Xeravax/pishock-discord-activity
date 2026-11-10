using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PiShock.Activity.Server.Data.Migrations;

/// <summary>
/// Empty baseline for existing Prisma/Postgres volumes. Tables already exist from
/// <c>_prisma_migrations</c>; this migration only records a row in
/// <c>__EFMigrationsHistory</c>. Fresh databases must apply <c>prisma/migrations</c>
/// SQL (see Docker entrypoint) before <c>Database.MigrateAsync()</c>.
/// </summary>
public partial class Baseline : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
    }
}
