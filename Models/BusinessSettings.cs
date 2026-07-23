using Postgrest.Attributes;
using Postgrest.Models;

namespace Faded.Models;

[Table("business_settings")]
public class BusinessSettings : BaseModel
{
    [PrimaryKey("id", false)]
    public int Id { get; set; }

    [Column("bank_name")]
    public string? BankName { get; set; }

    [Column("account_holder")]
    public string? AccountHolder { get; set; }

    [Column("account_number")]
    public string? AccountNumber { get; set; }

    [Column("branch_code")]
    public string? BranchCode { get; set; }

    [Column("account_type")]
    public string? AccountType { get; set; }

    [Column("payment_reference_note")]
    public string? PaymentReferenceNote { get; set; }
}
