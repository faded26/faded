using Postgrest.Attributes;
using Postgrest.Models;

namespace Faded.Models;

[Table("profiles")]
public class ProfileRow : BaseModel
{
    [PrimaryKey("id", false)]
    public Guid Id { get; set; }

    [Column("user_type")]
    public string UserType { get; set; } = "subscriber";
}
