using PiShock.Activity.Server.Shared;

namespace PiShock.Activity.Server.PiShock;

public static class BrokerPublishExtensions
{
    public static Task<bool> PublishAsync(
        this BrokerService broker,
        PiShockCreds creds,
        string clientId,
        int shockerId,
        object operation,
        int intensity = 0,
        int durationMs = 0,
        bool hold = false,
        bool warning = false,
        string? shareCode = null,
        bool end = false,
        string? agentName = null)
    {
        ShockerOp op = ShockerOp.Beep;
        if (operation is ShockerOp so) op = so;
        else if (operation is int i) op = (ShockerOp)i;
        else if (operation is string s)
        {
            end = end || s == "e";
            op = s switch
            {
                "s" or "shock" => ShockerOp.Shock,
                "v" or "vibrate" => ShockerOp.Vibrate,
                _ => ShockerOp.Beep,
            };
        }

        return broker.PublishOperateAsync(creds, new PublishOperateInput
        {
            ClientId = clientId,
            ShockerId = shockerId,
            Operation = op,
            Intensity = intensity,
            DurationMs = durationMs,
            Hold = hold,
            Warning = warning,
            ShareCode = shareCode,
            End = end,
            AgentName = agentName,
        });
    }
}
