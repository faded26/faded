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
    public class BookingResult
    {
        public Guid? Id { get; set; }
        public string? Status { get; set; }
        public string? Error { get; set; }
    }

    // Booking creation now happens entirely server-side via the create-booking
    // Edge Function (service role) — the client no longer writes to bookings
    // or subscribers directly, avoiding the RLS/PII exposure that direct
    // table access would require.
    public async Task<BookingResult> SubmitBooking(Booking booking)
    {
        var payload = new
        {
            customer_name = booking.CustomerName,
            customer_email = booking.CustomerEmail,
            customer_phone = booking.CustomerPhone,
            barber_id = booking.BarberId,
            service_id = booking.ServiceId,
            booking_date = booking.BookingDate.ToString("yyyy-MM-dd"),
            booking_time = booking.BookingTime.ToString(@"hh\:mm"),
            payment_method = booking.PaymentMethod,
            proof_of_payment_url = booking.ProofOfPaymentUrl
        };

        try
        {
            using var http = new HttpClient();
            var functionUrl = $"{_supabase.Url.TrimEnd('/')}/functions/v1/create-booking";

            var request = new HttpRequestMessage(HttpMethod.Post, functionUrl)
            {
                Content = new StringContent(
                    System.Text.Json.JsonSerializer.Serialize(payload),
                    System.Text.Encoding.UTF8,
                    "application/json")
            };

            // Forward the current session token if logged in, otherwise the anon key
            var accessToken = _supabase.Client.Auth.CurrentSession?.AccessToken ?? _supabase.AnonKey;
            request.Headers.Add("Authorization", $"Bearer {accessToken}");
            request.Headers.Add("apikey", _supabase.AnonKey);

            var response = await http.SendAsync(request);
            var responseJson = await response.Content.ReadAsStringAsync();

            var result = System.Text.Json.JsonSerializer.Deserialize<BookingResult>(
                responseJson, new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            return result ?? new BookingResult { Error = "Unexpected empty response." };
        }
        catch (Exception ex)
        {
            return new BookingResult { Error = ex.Message };
        }
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
