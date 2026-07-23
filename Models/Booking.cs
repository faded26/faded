using System.Text.Json.Serialization;
using Newtonsoft.Json;
using Postgrest.Attributes;
using Postgrest.Models;

namespace Faded.Models;

public static class PaymentMethod
{
    public const string Cash = "cash";
    public const string Card = "card";
    public const string Subscription = "subscription";
}

public static class BookingStatus
{
    public const string PendingApproval = "pending_approval";
    public const string Approved = "approved";
    public const string Declined = "declined";
    public const string Completed = "completed";
    public const string Cancelled = "cancelled";
    public const string NoShow = "no_show";
}

[Table("bookings")]
public class Booking : BaseModel
{
    [PrimaryKey("id", false)]
    public Guid Id { get; set; }

    [Column("customer_name")]
    public string CustomerName { get; set; } = string.Empty;

    [Column("customer_email")]
    public string CustomerEmail { get; set; } = string.Empty;

    [Column("customer_phone")]
    public string? CustomerPhone { get; set; }

    [Column("barber_id")]
    public Guid BarberId { get; set; }

    [Column("service_id")]
    public Guid ServiceId { get; set; }

    [Column("booking_date")]
    public DateTime BookingDate { get; set; }

    [Column("booking_time")]
    public TimeSpan BookingTime { get; set; }

    [Column("payment_method")]
    public string PaymentMethod { get; set; } = Faded.Models.PaymentMethod.Cash;

    // Only set when payment_method = card
    [Column("proof_of_payment_url")]
    public string? ProofOfPaymentUrl { get; set; }

    // Only set when payment_method = subscription (or a subscriber overflow booking)
    [Column("subscriber_id")]
    public Guid? SubscriberId { get; set; }

    [Column("status")]
    public string Status { get; set; } = BookingStatus.PendingApproval;

    [Column("created_at")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Auto-confirm rule lives here so it's obvious at a glance
    [Newtonsoft.Json.JsonIgnore]
    public bool RequiresApproval => PaymentMethod != Faded.Models.PaymentMethod.Subscription;
}
