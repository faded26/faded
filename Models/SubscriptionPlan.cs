using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace Faded.Models;

[Table("subscription_plans")]
public class SubscriptionPlan : BaseModel
{
    [PrimaryKey("id", false)]
    public Guid Id { get; set; }

    [Column("name")]
    public string Name { get; set; } = string.Empty;

    [Column("price")]
    public decimal Price { get; set; }

    [Column("cuts_included")]
    public int CutsIncluded { get; set; }

    [Column("active")]
    public bool Active { get; set; } = true;
}
