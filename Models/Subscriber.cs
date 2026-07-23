using System.Text.Json.Serialization;
using Newtonsoft.Json;
using Postgrest.Attributes;
using Postgrest.Models;

namespace Faded.Models;

// Id matches auth.users.id — password itself lives in Supabase Auth, not here
[Table("subscribers")]
public class Subscriber : BaseModel
{
    [PrimaryKey("id", false)]
    public Guid Id { get; set; }

    [Column("email")]
    public string Email { get; set; } = string.Empty;

    [Column("barber_id")]
    public Guid BarberId { get; set; }

    [Column("plan_id")]
    public Guid PlanId { get; set; }

    [Column("cycle_start")]
    public DateTime CycleStart { get; set; }

    [Column("cycle_end")]
    public DateTime CycleEnd { get; set; }

    [Column("cuts_used")]
    public int CutsUsed { get; set; } = 0;

    [Column("status")]
    public string Status { get; set; } = "active"; // active | expired

    // Computed client-side only — never sent to Supabase
    [Newtonsoft.Json.JsonIgnore]
    public bool IsExpired => DateTime.UtcNow > CycleEnd || Status == "expired";

    [Newtonsoft.Json.JsonIgnore]
    public int CutsRemaining => Math.Max(0, 4 - CutsUsed);
}
