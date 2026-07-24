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

    public async Task<List<Barber>> GetAllBarbers()
    {
        var result = await _supabase.Client.From<Barber>().Get();
        return result.Models;
    }

    public async Task<List<Service>> GetActiveServices()
    {
        var result = await _supabase.Client.From<Service>()
            .Where(s => s.Active == true)
            .Get();
        return result.Models;
    }

    public async Task<List<Service>> GetAllServices()
    {
        var result = await _supabase.Client.From<Service>().Get();
        return result.Models;
    }

    public async Task<List<SubscriptionPlan>> GetActivePlans()
    {
        var result = await _supabase.Client.From<SubscriptionPlan>()
            .Where(p => p.Active == true)
            .Get();
        return result.Models;
    }

    public async Task<BusinessSettings?> GetBusinessSettings()
    {
        var result = await _supabase.Client.From<BusinessSettings>()
            .Where(s => s.Id == 1)
            .Single();
        return result;
    }

    public async Task<(string? Error, bool Success)> UpdateBusinessSettings(
        string bankName, string accountHolder, string accountNumber,
        string branchCode, string accountType, string referenceNote)
    {
        try
        {
            var existing = await _supabase.Client.From<BusinessSettings>()
                .Where(s => s.Id == 1)
                .Single();

            if (existing is null)
                return ("Settings row not found.", false);

            existing.BankName = bankName;
            existing.AccountHolder = accountHolder;
            existing.AccountNumber = accountNumber;
            existing.BranchCode = branchCode;
            existing.AccountType = accountType;
            existing.PaymentReferenceNote = referenceNote;

            await _supabase.Client.From<BusinessSettings>().Update(existing);
            return (null, true);
        }
        catch (Exception ex)
        {
            return (ex.Message, false);
        }
    }

    public async Task<Subscriber?> GetSubscriber(Guid userId)
    {
        var result = await _supabase.Client.From<Subscriber>()
            .Where(s => s.Id == userId)
            .Single();
        return result;
    }

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
        return path;
    }

    public class BookingResult
    {
        public Guid? Id { get; set; }
        public string? Status { get; set; }
        public string? Error { get; set; }
    }

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

    // ---------- Barber dashboard ----------

    public async Task<Barber?> GetBarberByAuthId(Guid authUserId)
    {
        var result = await _supabase.Client.From<Barber>()
            .Where(b => b.AuthUserId == authUserId)
            .Single();
        return result;
    }

    public async Task<List<Booking>> GetDashboardBookings()
    {
        var result = await _supabase.Client.From<Booking>()
            .Order("booking_date", Postgrest.Constants.Ordering.Descending)
            .Order("booking_time", Postgrest.Constants.Ordering.Descending)
            .Get();
        return result.Models;
    }

    public class ManualBookingResult
    {
        public Guid? Id { get; set; }
        public string? Status { get; set; }
        public string? Error { get; set; }
    }

    public async Task<ManualBookingResult> CreateManualBooking(
        Guid barberId, Guid serviceId, string customerName, string? customerPhone, string? customerEmail,
        DateTime date, TimeSpan time, string paymentMethod)
    {
        var payload = new
        {
            barber_id = barberId,
            service_id = serviceId,
            customer_name = customerName,
            customer_phone = customerPhone,
            customer_email = customerEmail,
            booking_date = date.ToString("yyyy-MM-dd"),
            booking_time = time.ToString(@"hh\:mm"),
            payment_method = paymentMethod
        };

        try
        {
            using var http = new HttpClient();
            var functionUrl = $"{_supabase.Url.TrimEnd('/')}/functions/v1/create-manual-booking";

            var request = new HttpRequestMessage(HttpMethod.Post, functionUrl)
            {
                Content = new StringContent(
                    System.Text.Json.JsonSerializer.Serialize(payload),
                    System.Text.Encoding.UTF8,
                    "application/json")
            };

            var accessToken = _supabase.Client.Auth.CurrentSession?.AccessToken ?? _supabase.AnonKey;
            request.Headers.Add("Authorization", $"Bearer {accessToken}");
            request.Headers.Add("apikey", _supabase.AnonKey);

            var response = await http.SendAsync(request);
            var responseJson = await response.Content.ReadAsStringAsync();

            var result = System.Text.Json.JsonSerializer.Deserialize<ManualBookingResult>(
                responseJson, new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            return result ?? new ManualBookingResult { Error = "Unexpected empty response." };
        }
        catch (Exception ex)
        {
            return new ManualBookingResult { Error = ex.Message };
        }
    }

    public async Task<(bool Success, string? Error)> UpdateBookingStatus(Guid bookingId, string status)
    {
        try
        {
            var existing = await _supabase.Client.From<Booking>()
                .Where(b => b.Id == bookingId)
                .Single();

            if (existing is null)
                return (false, "Booking not found.");

            existing.Status = status;
            await _supabase.Client.From<Booking>().Update(existing);
            return (true, null);
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    public async Task<(string? Error, bool Success)> AddBarber(string name, string email, string? phone, string password)
    {
        var payload = new { name, email, phone, password };
        try
        {
            using var http = new HttpClient();
            var functionUrl = $"{_supabase.Url.TrimEnd('/')}/functions/v1/add-barber";

            var request = new HttpRequestMessage(HttpMethod.Post, functionUrl)
            {
                Content = new StringContent(
                    System.Text.Json.JsonSerializer.Serialize(payload),
                    System.Text.Encoding.UTF8,
                    "application/json")
            };

            var accessToken = _supabase.Client.Auth.CurrentSession?.AccessToken ?? _supabase.AnonKey;
            request.Headers.Add("Authorization", $"Bearer {accessToken}");
            request.Headers.Add("apikey", _supabase.AnonKey);

            var response = await http.SendAsync(request);
            var responseJson = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                using var doc = System.Text.Json.JsonDocument.Parse(responseJson);
                var hasError = doc.RootElement.TryGetProperty("error", out var errProp);
                var err = hasError ? errProp.GetString() : "Could not add barber.";
                return (err, false);
            }

            return (null, true);
        }
        catch (Exception ex)
        {
            return (ex.Message, false);
        }
    }

    // ---------- Owner: service management ----------

    public async Task<(string? Error, bool Success)> CreateService(string name, decimal price, int durationMinutes)
    {
        try
        {
            await _supabase.Client.From<Service>().Insert(new Service
            {
                Name = name,
                Price = price,
                DurationMinutes = durationMinutes,
                Active = true
            });
            return (null, true);
        }
        catch (Exception ex)
        {
            return (ex.Message, false);
        }
    }

    public async Task<(string? Error, bool Success)> UpdateService(Guid id, string name, decimal price, int durationMinutes)
    {
        try
        {
            var existing = await _supabase.Client.From<Service>()
                .Where(s => s.Id == id)
                .Single();

            if (existing is null)
                return ("Service not found.", false);

            existing.Name = name;
            existing.Price = price;
            existing.DurationMinutes = durationMinutes;
            await _supabase.Client.From<Service>().Update(existing);
            return (null, true);
        }
        catch (Exception ex)
        {
            return (ex.Message, false);
        }
    }

    public async Task<(string? Error, bool Success)> SetServiceActive(Guid id, bool active)
    {
        try
        {
            var existing = await _supabase.Client.From<Service>()
                .Where(s => s.Id == id)
                .Single();

            if (existing is null)
                return ("Service not found.", false);

            existing.Active = active;
            await _supabase.Client.From<Service>().Update(existing);
            return (null, true);
        }
        catch (Exception ex)
        {
            return (ex.Message, false);
        }
    }
}
