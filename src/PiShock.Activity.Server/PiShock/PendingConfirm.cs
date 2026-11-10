using System.Collections.Concurrent;

namespace PiShock.Activity.Server.PiShock;

public sealed class PendingPiShockConfirm
{
    public required int UserId { get; init; }
    public required string Token { get; init; }
    public required long CreatedAt { get; init; }
    public required IReadOnlyList<string> HubNames { get; init; }
}

public static class PendingConfirmStore
{
    public static readonly TimeSpan ConfirmTtl = TimeSpan.FromMinutes(10);
    private static readonly ConcurrentDictionary<string, PendingPiShockConfirm> Store = new();

    // Testable clock
    public static Func<long> NowMs { get; set; } = () => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    public static void SetPendingConfirm(string discordUserId, int userId, string token, IReadOnlyList<string>? hubNames = null)
    {
        Store[discordUserId] = new PendingPiShockConfirm
        {
            UserId = userId,
            Token = token,
            CreatedAt = NowMs(),
            HubNames = hubNames ?? [],
        };
    }

    public static PendingPiShockConfirm? GetPendingConfirm(string discordUserId)
    {
        if (!Store.TryGetValue(discordUserId, out var row)) return null;
        if (NowMs() - row.CreatedAt > (long)ConfirmTtl.TotalMilliseconds)
        {
            Store.TryRemove(discordUserId, out _);
            return null;
        }
        return row;
    }

    public static PendingPiShockConfirm? TakePendingConfirm(string discordUserId)
    {
        var row = GetPendingConfirm(discordUserId);
        if (row is null) return null;
        Store.TryRemove(discordUserId, out _);
        return row;
    }

    public static void ClearPendingConfirm(string discordUserId) =>
        Store.TryRemove(discordUserId, out _);
}
