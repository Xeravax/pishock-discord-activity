namespace PiShock.Activity.Server.Shared;

public static class Constants
{
    public const string AgentName = "Discord PiShock Activity";
    public const string PiShockApi = "https://api.pishock.com";
    public const string PiShockAuth = "https://auth.pishock.com";
    public const string PiShockDo = "https://do.pishock.com";
    public const string PiShockRelay = "wss://relay.pishock.com";
    public const string PiShockBroker = "wss://broker.pishock.com/v2";
    public const string PiShockLogin = "https://login.pishock.com";
    public const string PiShockDashboardApi = "https://dashboard.api.k8s.pishock.com";
    public static string PiShockAnnouncementsLive => $"{PiShockDashboardApi}/Announcements/Live";
    public static readonly TimeSpan RelayLoginTimeout = TimeSpan.FromMinutes(5);
}

public enum ShockerOp
{
    Shock = 0,
    Vibrate = 1,
    Beep = 2,
}
