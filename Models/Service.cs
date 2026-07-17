using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace Faded.Models;

[Table("services")]
public class Service : BaseModel
{
    [PrimaryKey("id", false)]
    public Guid Id { get; set; }

    [Column("name")]
    public string Name { get; set; } = string.Empty;

    [Column("price")]
    public decimal Price { get; set; }

    [Column("duration_minutes")]
    public int DurationMinutes { get; set; } = 30;

    [Column("active")]
    public bool Active { get; set; } = true;
}
