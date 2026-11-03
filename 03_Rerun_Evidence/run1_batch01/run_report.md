# Run report: run1_batch01

Batch folder: `01_Invoice_Batch_01`
Documents read: 15

| Result | Count |
|---|---|
| DUP | 2 |
| ENTER_ENTRATA | 1 |
| ENTER_INTACCT | 6 |
| HOLD | 6 |

## Decisions

| File | Vendor | Invoice | Amount | Result | Codes | Confidence |
|---|---|---|---|---|---|---|
| APINBOX_0001.pdf | Pinecrest Building Supply Co | PBS-604418 | 15,102.07 | HOLD | OVERPO | High |
| APINBOX_0002.pdf | LedgerLoop Software Inc | LL-2026-1184 | 4,682.25 | ENTER_INTACCT |  | High |
| APINBOX_0003.pdf | Gulfline Concrete Partners LLC | GCP-0303 | 133,650.00 | ENTER_INTACCT |  | High |
| APINBOX_0004.pdf | Brightline Landscape Design LLC | BLD-1007 | 6,500.00 | HOLD | NEWVEND, OTHER, NOPO | High |
| APINBOX_0005.pdf | Coastal Site Services LLC | CSS-88502 | 1,240.00 | ENTER_INTACCT |  | High |
| APINBOX_0006.pdf | Sterling Grounds and Pest LLC | SGP-11092 | 3,850.00 | HOLD | BANKCHG | High |
| APINBOX_0007.pdf | Copperline Plumbing Supply Inc | 55102 | 9,697.59 | DUP | DUP | High |
| APINBOX_0008.pdf | Magnolia Pool Services LLC | MPS-4471 | 1,475.00 | ENTER_ENTRATA |  | High |
| APINBOX_0009.pdf | Summit Framing Group LLC | SFG-2410-05 | 103,140.00 | HOLD | UNAPPCO, LIEN | High |
| APINBOX_0010.pdf | Ridgeway Equipment Rental Inc | RER-77310 | 7,068.60 | ENTER_INTACCT |  | High |
| APINBOX_0011.pdf | Pinecrest Building Supply Co | CM-PBS-604102 | -2,160.00 | ENTER_INTACCT |  | High |
| APINBOX_0012.pdf | Harbor Point Aggregates LLC | HPA-31877 | 16,948.80 | HOLD | NOPO | High |
| APINBOX_0013.pdf | Tri County Drywall Inc | TCD-2410-02 | 57,600.00 | HOLD | COI, LIEN | High |
| APINBOX_0014.pdf | Copperline Plumbing Supply Inc | 55388 | 8,081.71 | ENTER_INTACCT |  | High |
| APINBOX_0015.pdf | Ridgeway Equipment Rental Inc | INV-20417 | 3,240.00 | DUP | DUP | High |

## Import file pre-flight

PASS: no validation errors.

## Register

Register: `state/processed_register.csv`. Entered keys now on file: 7. Register saved.
