# Data Integrity & Validation Documentation

## Overview
We employ a multi-layered approach to ensure data integrity:
1.  **Frontend Validation (Zod)**: Immediate feedback to users.
2.  **API Validation**: Interception of requests before they reach the DB.
3.  **Database Constraints**: The final source of truth (CHECK, FOREIGN KEY, UNIQUE).
4.  **RLS Policies**: Security and data scoping.

## Validation Schemas
All entities have corresponding Zod schemas in `src/lib/validationSchemas.js`.
- **Projects**: Validates budget/overhead percentages (0-100) and dates.
- **Realizations**: Ensures costs are non-negative.
- **Payouts**: Requires at least one item and positive amounts.

## Error Handling
We use a centralized helper `src/lib/apiValidation.js` to parse PostgreSQL error codes into user-friendly strings.
- **23505 (Unique Violation)** -> "Duplicate record found."
- **23503 (Foreign Key Violation)** -> "Referenced record missing or in use."
- **23514 (Check Violation)** -> "Invalid value range."

## Data Cleanup
Use `src/lib/dataCleanup.js` utilities to normalize data that violates business rules (e.g., budgets > 100%).

## Running Checks
Import `runAllChecks` from `src/lib/dataIntegrityCheck.js` and execute it in the browser console or an admin dashboard to scan for issues.