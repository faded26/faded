using Faded.Models;
using Supabase.Gotrue;
namespace Faded.Services;
public class AuthService
{
    private readonly SupabaseService _supabase;
    private readonly BookingService _bookingService;
    public AuthService(SupabaseService supabase, BookingService bookingService)
    {
        _supabase = supabase;
        _bookingService = bookingService;
    }
    public Guid? CurrentUserId => _supabase.Client.Auth.CurrentUser is { } u && Guid.TryParse(u.Id, out var id) ? id : null;

    // ---------- Subscriber auth (unchanged) ----------
    public async Task<(string? Error, Subscriber? Subscriber)> SignUpSubscriber(
        string email, string password, Guid barberId, Guid planId,
        string fullName, string? phone, string? preferredContactMethod, List<DateTime>? preferredCutDates)
    {
        var payload = new
        {
            email,
            password,
            barber_id = barberId,
            plan_id = planId,
            full_name = fullName,
            phone,
            preferred_contact_method = preferredContactMethod,
            preferred_cut_dates = preferredCutDates?.Select(d => d.ToString("yyyy-MM-dd")).ToList()
        };

        try
        {
            using var http = new HttpClient();
            var functionUrl = $"{_supabase.Url.TrimEnd('/')}/functions/v1/create-subscriber";

            var request = new HttpRequestMessage(HttpMethod.Post, functionUrl)
            {
                Content = new StringContent(
                    System.Text.Json.JsonSerializer.Serialize(payload),
                    System.Text.Encoding.UTF8,
                    "application/json")
            };
            request.Headers.Add("Authorization", $"Bearer {_supabase.AnonKey}");
            request.Headers.Add("apikey", _supabase.AnonKey);

            var response = await http.SendAsync(request);
            var responseJson = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                using var doc = System.Text.Json.JsonDocument.Parse(responseJson);
                var err = doc.RootElement.TryGetProperty("error", out var e) ? e.GetString() : "Could not sign up.";
                return (err, null);
            }

            // Created server-side (bypassing RLS) — now sign in normally to establish a client session
            var session = await _supabase.Client.Auth.SignIn(email, password);
            if (session?.User is null)
                return ("Account created, but automatic login failed — please log in.", null);

            var userId = Guid.Parse(session.User.Id!);
            var subscriber = await _bookingService.GetSubscriber(userId);
            return (null, subscriber);
        }
        catch (Exception ex)
        {
            return (ex.Message, null);
        }
    }

    public async Task<(string? Error, Subscriber? Subscriber)> LogInSubscriber(string email, string password)
    {
        try
        {
            var session = await _supabase.Client.Auth.SignIn(email, password);
            if (session?.User is null)
                return ("Invalid email or password.", null);
            var userId = Guid.Parse(session.User.Id!);
            var subscriber = await _bookingService.GetSubscriber(userId);
            if (subscriber is null)
                return ("No subscription found for this account.", null);
            subscriber = await _bookingService.RefreshCycleStatus(subscriber);
            return (null, subscriber);
        }
        catch (Exception ex)
        {
            return (ex.Message, null);
        }
    }

    // ---------- Barber auth ----------
    public async Task<(string? Error, Barber? Barber)> LogInBarber(string email, string password)
    {
        try
        {
            var session = await _supabase.Client.Auth.SignIn(email, password);
            if (session?.User is null)
                return ("Invalid email or password.", null);
            var userId = Guid.Parse(session.User.Id!);
            var barber = await _bookingService.GetBarberByAuthId(userId);
            if (barber is null)
            {
                await _supabase.Client.Auth.SignOut();
                return ("This account isn't linked to a barber profile.", null);
            }
            return (null, barber);
        }
        catch (Exception ex)
        {
            return (ex.Message, null);
        }
    }

    // Restores the logged-in barber on page refresh/navigation, using the
    // persisted Supabase session — no need to log in again every time.
    public async Task<Barber?> GetCurrentBarber()
    {
        var userId = CurrentUserId;
        if (userId is null) return null;
        return await _bookingService.GetBarberByAuthId(userId.Value);
    }

    public async Task LogOut() => await _supabase.Client.Auth.SignOut();
}
