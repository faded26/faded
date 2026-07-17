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

    // Signs up a NEW subscriber: creates the auth user, a profiles row, and a subscribers row
    // in one flow. Returns an error message on failure, or null on success.
    public async Task<(string? Error, Subscriber? Subscriber)> SignUpSubscriber(
        string email, string password, Guid barberId, Guid planId)
    {
        try
        {
            var session = await _supabase.Client.Auth.SignUp(email, password);
            if (session?.User is null)
                return ("Sign up failed — please try again.", null);

            var userId = Guid.Parse(session.User.Id!);

            // profiles row
            await _supabase.Client.From<Faded.Models.ProfileRow>().Insert(new Faded.Models.ProfileRow
            {
                Id = userId,
                UserType = "subscriber"
            });

            // subscribers row — 30-day rolling cycle starts now
            var subscriber = new Subscriber
            {
                Id = userId,
                Email = email,
                BarberId = barberId,
                PlanId = planId,
                CycleStart = DateTime.UtcNow,
                CycleEnd = DateTime.UtcNow.AddDays(30),
                CutsUsed = 0,
                Status = "active"
            };

            var result = await _supabase.Client.From<Subscriber>().Insert(subscriber);
            return (null, result.Models.First());
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
}
