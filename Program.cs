using Microsoft.AspNetCore.Components.Web;
using Faded.Services;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using Faded;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");

builder.Services.AddScoped(sp => new HttpClient { BaseAddress = new Uri(builder.HostEnvironment.BaseAddress) });

builder.Services.AddScoped<SupabaseService>();
builder.Services.AddScoped<BookingService>();
builder.Services.AddScoped<AuthService>();

var host = builder.Build();
var supabase = host.Services.GetRequiredService<SupabaseService>();
await supabase.InitializeAsync();

await host.RunAsync();
