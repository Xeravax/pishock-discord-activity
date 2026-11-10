using System.Security.Cryptography;
using System.Text;

namespace PiShock.Activity.Server.Data;

/// <summary>
/// Generates collision-resistant ids shaped like Prisma's <c>cuid()</c> (cuid v1):
/// <c>c</c> + timestamp(base36) + counter(base36, 4) + fingerprint(base36, 4) + random(base36, 8) = 25 chars.
/// </summary>
public static class Cuid
{
    private const int Base = 36;
    private const int BlockSize = 4;
    private static readonly int DiscreteValues = (int)Math.Pow(Base, BlockSize); // 36^4 = 1,679,616

    private static readonly string Fingerprint = BuildFingerprint();
    private static readonly object CounterLock = new();
    private static int _counter;

    public static string NewCuid()
    {
        var timestamp = ToBase36((ulong)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        var counter = Pad(ToBase36((ulong)NextCounter()), BlockSize);
        var random = Pad(ToBase36(RandomBlock()), BlockSize) + Pad(ToBase36(RandomBlock()), BlockSize);
        return "c" + timestamp + counter + Fingerprint + random;
    }

    private static int NextCounter()
    {
        lock (CounterLock)
        {
            _counter = _counter < DiscreteValues ? _counter : 0;
            return _counter++;
        }
    }

    private static ulong RandomBlock() => (ulong)RandomNumberGenerator.GetInt32(DiscreteValues);

    private static string BuildFingerprint()
    {
        var pid = Environment.ProcessId;
        var host = Environment.MachineName;
        var hostSum = host.Length + Base;
        foreach (var ch in host) hostSum += ch;
        var pidPart = Pad(ToBase36((ulong)pid), 2);
        var hostPart = Pad(ToBase36((ulong)hostSum), 2);
        return pidPart + hostPart;
    }

    private static string Pad(string value, int size)
    {
        if (value.Length >= size) return value[^size..];
        return new string('0', size - value.Length) + value;
    }

    private static string ToBase36(ulong value)
    {
        const string digits = "0123456789abcdefghijklmnopqrstuvwxyz";
        if (value == 0) return "0";
        var sb = new StringBuilder();
        while (value > 0)
        {
            sb.Insert(0, digits[(int)(value % Base)]);
            value /= Base;
        }
        return sb.ToString();
    }
}
