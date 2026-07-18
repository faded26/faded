using Microsoft.Extensions.Configuration;
using Supabase;

namespace Faded.Services;

public class SupabaseService
{
    public Client Client { get; }
    public string Url { get; }
    public string AnonKey { get; }

    public SupabaseService(IConfiguration config)
    {
        var url = config["Supabase:Url"]
            ?? throw new InvalidOperationException("Supabase:Url missing from appsettings.json");
        var anonKey = config["Supabase:AnonKey"]
            ?? throw new InvalidOperationException("Supabase:AnonKey missing from appsettings.json");

        Url = url;
        AnonKey = anonKey;

        var options = new SupabaseOptions
        {
            AutoRefreshToken = true,
            AutoConnectRealtime = false
        };

        Client = new Client(url, anonKey, options);
    }

    public async Task InitializeAsync() => await Client.InitializeAsync();
}
