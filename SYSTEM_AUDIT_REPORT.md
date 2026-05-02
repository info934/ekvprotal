# SYSTEM AUDIT REPORT - ANALYSIS & RECOMMENDATIONS

## 1. CURRENT STATE ANALYSIS

### Module Review

#### Projects Module
The Projects module serves as the core operational unit. It tracks project metadata, status (Nabídka, Aktivní, Hotovo, Uzavřeno), and financial parameters.
- **Management**: Handled via `ProjectForm.jsx` and `ProjectDetail.jsx`.
- **Financials**: Calculates budget based on `price`, `budget_percentage`, and `overhead_percentage`.
- **Team**: Members are assigned via `ProjectMembers` with reward schemes (fixed vs. percentage).
- **Current State**: The module is functional but `ProjectDetail.jsx` is becoming monolithic (handling tasks, engineering, finance, team, documents in one file).

#### Realizations Module
A distinct module for execution phase tracking, recently updated to a new financial model.
- **Structure**: Separate from Projects but can be linked (`linked_project_id`).
- **Financial Model**: Recently updated to `Team Budget = Contract - Profit - Overhead - Costs`.
- **Profit Sharing**: Logic exists in `RealizaceProfitSharing.jsx` to distribute the `Team Budget`.
- **Status Workflow**: Defined statuses (Připravuje se, Probíhá, Dokončeno) drive the lifecycle.

#### Payouts Module
Manages the distribution of funds to members.
- **Workflow**: `PayoutDialog.jsx` allows creation of requests. Logic exists to check available balances against project/realization budgets.
- **Integration**: Fetches balances via RPC calls (`get_projects_with_balance`, `get_realizations_with_balance`).
- **Issues**: Heavily relies on client-side validation for amounts.

#### Attendance Module
Tracks time spent on projects and realizations.
- **Data Entry**: `AttendanceDialog.jsx` supports batch and single entry.
- **Cost Impact**: Hours * Hourly Rate = Cost, which directly reduces the Team Budget in the Realization module.
- **Validation**: Client-side validation for 24h limit.

#### Engineering Module
Tracks specific administrative and technical activities.
- **Data**: Stored in `engineering_activities`.
- **UI**: `Engineering.jsx` provides a Kanban/List view.

### Data Flow & Calculations

1.  **Project Budget**:
    `Gross Budget = Price * (Budget % / 100)`
    `Net Budget = Gross Budget - (Gross Budget * Overhead % / 100) - Subcontractors`
2.  **Realization Budget (New)**:
    `Team Budget = Contract - (Contract * Margin %) - (Contract * Overhead %) - (Manual Costs + Hourly Costs + Extra Costs)`
3.  **Member Rewards**:
    - **Fixed**: Static amount.
    - **Percentage**: Share of the Net Budget (Projects) or Team Budget (Realizations).

### Data Consistency & Logic
- **Status Transitions**: Currently managed via UI dropdowns. No strict state machine enforcement in the database (e.g., preventing "Closed" -> "Active" without admin rights).
- **Financial Integrity**: The system allows updating historical costs, which recalculates current budgets dynamically. This is flexible but risky for closed accounting periods.

---

## 2. IDENTIFIED PROBLEMS & ISSUES

### Critical Issues (Security & Data Integrity)

1.  **Client-Side Financial Logic**: Critical financial formulas (like the new Team Budget calculation) exist in `RealizaceFinancialCalculations.jsx`. While good for UI, if the backend (RPC functions like `get_realizations_with_balance`) doesn't mirror this exactly, payouts might be authorized based on incorrect balances.
2.  **Missing Database Constraints**:
    - Percentage fields (`profit_margin_percent`, etc.) lack `CHECK (value >= 0 AND value <= 100)`.
    - Financial amounts lack `CHECK (value >= 0)` (unless negative costs are intended for corrections).
3.  **RLS Complexity**: The `payouts` table allows `enable update for own payout records`. This needs careful review to ensure a user cannot change the `amount` or `status` of their own payout after approval.

### High Priority Issues (Core Functionality)

1.  **Orphaned Records on Deletion**: `ProjectDetail.jsx` has a `handleDeleteGeneric` function. If a user deletes a member or subcontractor, there is no visual warning about cascading effects on financial calculations (e.g., historical payouts linked to that member).
2.  **Negative Budget Handling**: While the UI turns red (`RealizaceOverview.jsx`), the database does not prevent adding costs that drive the budget below zero, nor does it prevent payout requests against a negative budget (though the UI tries to validation).
3.  **Realization/Project Linkage**: The linkage is loose (`linked_project_id`). Attendance can be recorded on a Project OR a Realization, but the system relies on the user to select the correct context.

### Medium Priority Issues (Optimization & UX)

1.  **Monolithic Components**: `ProjectDetail.jsx` and `RealizaceDetail.jsx` are becoming too large, handling too many concerns (fetching data, UI tabs, dialog management, delete logic). This makes maintenance difficult.
2.  **Performance**: `PayoutDialog.jsx` fetches all projects and realizations for a member. As data grows, this will become slow. It needs pagination or server-side filtering.
3.  **UX Inconsistencies**: Different modules use slightly different patterns for tables and dialogs (e.g., `AttendanceDialog` vs `ProjectCostDialog`).

### Low Priority Issues (Polish)

1.  **Hardcoded Strings**: Many labels and messages are hardcoded Czech strings, making future localization difficult.
2.  **Mobile Responsiveness**: Complex tables (Financials) may break on small screens.

---

## 3. SPECIFIC RECOMMENDATIONS

### CRITICAL PRIORITY (Implement Immediately)

**3.1 Data Integrity & Validation**
- **Action**: Add SQL `CHECK` constraints to all percentage columns in `projects` and `realizations`.
- **Action**: Ensure `payouts` RLS policies strictly forbid users from updating `amount` or `status` once the record is created.

**3.2 Financial Logic Synchronization**
- **Action**: Update the PostgreSQL function `get_realizations_with_balance` to match the exact formula used in `RealizaceFinancialCalculations.jsx` (Team Budget = Contract - Profit - Overhead - Costs) to ensure payout validation matches UI display.

### HIGH PRIORITY (Implement in Next Sprint)

**3.3 Component Refactoring**
- **Action**: Split `ProjectDetail.jsx` and `RealizaceDetail.jsx`. Extract tabs (Team, Finance, Documents) into standalone components that fetch their own data.

**3.4 Workflow Improvements**
- **Action**: Implement a "Lock" mechanism for financial periods or closed projects to prevent retroactive cost editing.
- **Action**: Add confirmation dialogs that specifically warn about financial impact when deleting team members or costs.

### MEDIUM PRIORITY (Implement in Following Sprints)

**3.5 Performance**
- **Action**: Refactor `PayoutDialog` to search for projects asynchronously rather than loading all.

**3.6 Code Quality**
- **Action**: Create a shared `useFinancials` hook that can be used by both the Detail views and the Payout views to ensure calculation consistency.

---

## 4. IMPLEMENTATION ROADMAP

### Phase 1: Integrity & Safety (Weeks 1-2)
- Apply DB constraints.
- Audit and patch RLS policies for `payouts` and `attendance`.
- Sync SQL RPC functions with frontend math.

### Phase 2: Refactoring & Architecture (Weeks 3-4)
- Deconstruct `ProjectDetail.jsx`.
- Deconstruct `RealizaceDetail.jsx`.
- Standardize Dialog components.

### Phase 3: Advanced Features (Weeks 5-6)
- Implement "Financial Locking".
- Add comprehensive Audit Logging for financial changes.

---

## 5. SPECIFIC CODE ISSUES FOUND

1.  **`src/components/ProjectDetail.jsx`**:
    - Lines handling `handleDeleteGeneric` do not check for dependencies.
    - The `refreshData` function fetches too much data at once (members, subs, tasks, costs, links, payouts). This causes a waterfall effect.

2.  **`src/components/RealizaceFinancialCalculations.jsx`**:
    - Good isolation of logic, but purely client-side. This logic must be duplicated in SQL for accurate reporting and constraints.

3.  **`src/components/PayoutDialog.jsx`**:
    - `getRealizationSuggested` duplicates logic found in other components. This violates DRY (Don't Repeat Yourself) and risks inconsistent payout limits.

4.  **`src/components/AttendanceDialog.jsx`**:
    - The validation `totalHours > 24` is good, but it only checks the *current batch*. It doesn't check if the user *already* has hours logged for that day in the DB.

## 6. SUMMARY

The system is functional and feature-rich but is transitioning from a prototype/MVP phase to a production system. The recent changes to the Realization financial model are a step in the right direction for clarity, but they expose the need for tighter database-level constraints and better synchronization between frontend calculations and backend logic. The monolithic nature of the main Detail components is the biggest technical debt item that should be addressed to maintain development velocity.