using System.Text.Json.Serialization;
using Postgrest.Attributes;
using Postgrest.Models;

namespace Faded.Models;

[Table("barbers")]
public class Barber : BaseModel
{
    [PrimaryKey("id", false)]
    public Guid Id { get; set; }

    [Column("name")]
    public string Name { get; set; } = string.Empty;

    [Column("email")]
    public string Email { get; set; } = string.Empty;

    [Column("phone")]
    public string? Phone { get; set; }

    [Column("active")]
    public bool Active { get; set; } = true;
}
