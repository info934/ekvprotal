# Edge Case Test Scenarios

## 1. Financial Integrity
- **Scenario**: User enters a negative price for a project.
  - **Expected**: Frontend blocks submission. Database throws CHECK violation if bypassed.
- **Scenario**: User enters 150% budget percentage.
  - **Expected**: Frontend blocks submission. Database throws CHECK violation.
- **Scenario**: Creating a payout with 0 amount.
  - **Expected**: Validation error "Amount must be positive".

## 2. Referential Integrity
- **Scenario**: Deleting a Member who has active Projects.
  - **Expected**: Database prevents delete (Restrict) OR Cascades (depending on config). *Recommendation: Soft delete or Restrict.*
- **Scenario**: Deleting a Project that has active Payouts.
  - **Expected**: Payout Items should be removed (Cascade) or set to NULL, preserving the Payout record itself.

## 3. Workflow Logic
- **Scenario**: Setting "Completion Date" before "Start Date".
  - **Expected**: Zod `refine` check fails with "End date must be after start date".
- **Scenario**: Approving a Payout without any items.
  - **Expected**: Logic should prevent creating empty payouts.

## 4. Concurrency
- **Scenario**: Two admins editing the same project simultaneously.
  - **Expected**: Last write wins, but real-time subscription updates UI.