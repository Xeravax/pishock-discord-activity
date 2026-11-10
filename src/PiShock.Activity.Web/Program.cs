using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using Microsoft.Kiota.Abstractions.Authentication;
using PiShock.Activity.ApiClient;
using PiShock.Activity.Web;
using PiShock.Activity.Web.Discord;
using PiShock.Activity.Web.Realtime;
using PiShock.Activity.Web.Services;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");

builder.Services.AddScoped(sp => new HttpClient
{
    BaseAddress = new Uri(builder.HostEnvironment.BaseAddress),
});
builder.Services.AddScoped<AccessTokenStore>();
builder.Services.AddScoped<IAccessTokenProvider>(sp =>
{
    var store = sp.GetRequiredService<AccessTokenStore>();
    return new DiscordBearerTokenProvider(() => Task.FromResult(store.Token));
});
builder.Services.AddScoped(sp =>
{
    var http = sp.GetRequiredService<HttpClient>();
    var tokens = sp.GetRequiredService<IAccessTokenProvider>();
    return new ActivityApiClient(http, tokens);
});
builder.Services.AddScoped<ActivityApiService>();
builder.Services.AddScoped<DiscordActivity>();
builder.Services.AddScoped<ActivitySocket>();
builder.Services.AddScoped<AppHealthService>();
builder.Services.AddScoped<ActivitySession>();

await builder.Build().RunAsync();
