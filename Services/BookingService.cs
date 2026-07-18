using Faded.Models;
using Postgrest;

namespace Faded.Services;

public class BookingService
{
    private readonly SupabaseService _supabase;

    public BookingService(SupabaseService supabase)
    {
        _supabase = supabase;
    }

    public async Task<List<Barber>> GetActiveBarbers()
    {
        var result = await _supabase.Client.From<Barber>()
            .Where(b => b.Active == true)
            .Get();
        return result.Models;
    }

    public async Task<List<Service>> GetActiveServices()
    {
        var result = await _supabase.Client.From<Service>()
            .Where(s => s.Active == true)
            .Get();
        return result.Models;
    }

    public async Task<List<SubscriptionPlan>> GetActivePlans()
    {
        var result = await _supabase.Client.From<SubscriptionPlan>()
            .Where(p => p.Active == true)
            .Get();
        return result.Models;
    }

    // Looks up a subscriber by their auth user id (after login/signup)
    public async Task<Subscriber?> GetSubscriber(Guid userId)
    {
        var result = await _supabase.Client.From<Subscriber>()
            .Where(s => s.Id == userId)
            .Single();
        return result;
    }

    // Refreshes cycle status — call this whenever a subscriber logs in or books
    public async Task<Subscriber?> RefreshCycleStatus(Subscriber subscriber)
    {
        if (subscriber.IsExpired && subscriber.Status != "expired")
        {
            subscriber.Status = "expired";
            await _supabase.Client.From<Subscriber>().Update(subscriber);
        }
        return subscriber;
    }

    public async Task<string> UploadProofOfPayment(Stream fileStream, string fileName)
    {
        using var memoryStream = new MemoryStream();
        await fileStream.CopyToAsync(memoryStream);
        var bytes = memoryStream.ToArray();

        var path = $"{Guid.NewGuid()}_{fileName}";
        var bucket = _supabase.Client.Storage.From("proof-of-payments");
        await bucket.Upload(bytes, path);
        return path; // store this path in bookings.proof_of_payment_url
    }

    // The core rule: subscription bookings auto-confirm ONLY if cuts remain.
    // If the subscriber is over their limit, the caller must have already
    // switched payment_method to cash/card and attached proof if needed —
    // this method just decides status + decrements the counter when applicable.
    public async Task<Booking> SubmitBooking(Booking booking, Subscriber? subscriber)
    {
        var usingSubscriptionCut =
            booking.PaymentMethod == PaymentMethod.Subscription
            && subscriber is not null
            && !subscriber.IsExpired
            && subscriber.CutsRemaining > 0;

        booking.Status = usingSubscriptionCut
            ? BookingStatus.Approved       // auto-confirm, no barber approval needed
            : BookingStatus.PendingApproval; // cash/card, or subscriber overflow

        var result = await _supabase.Client.From<Booking>().Insert(booking);
        var inserted = result.Models.First();

        if (usingSubscriptionCut && subscriber is not null)
        {
            subscriber.CutsUsed += 1;
            await _supabase.Client.From<Subscriber>().Update(subscriber);
        }

        return inserted;
    }

    // Calls the Supabase Edge Function that sends the barber their alert email.
    // The function looks up the barber's email server-side and includes full
    // booking details: payment type, subscriber id if applicable, etc.
    public async Task NotifyBarber(Booking booking)
    {
        try
        {
            var payload = System.Text.Json.JsonSerializer.Serialize(new { booking_id = booking.Id });
            await _supabase.Client.Functions.Invoke("notify-barber", payload);
        }
        catch
        {
            // Booking is already saved — a failed notification shouldn't block the customer.
            // Worth adding real logging here later.
        }
    }
}
