-- Optimize RLS policies that call auth.uid()/auth.role() per row.
-- Supabase recommends wrapping these calls in SELECT so Postgres can init-plan them.

DO $$
DECLARE
  policy_record record;
  next_qual text;
  next_with_check text;
  sql text;
BEGIN
  FOR policy_record IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        qual LIKE '%auth.uid()%'
        OR qual LIKE '%auth.role()%'
        OR with_check LIKE '%auth.uid()%'
        OR with_check LIKE '%auth.role()%'
      )
  LOOP
    next_qual := policy_record.qual;
    next_with_check := policy_record.with_check;

    IF next_qual IS NOT NULL THEN
      next_qual := replace(next_qual, 'auth.uid()', '(select auth.uid())');
      next_qual := replace(next_qual, 'auth.role()', '(select auth.role())');
    END IF;

    IF next_with_check IS NOT NULL THEN
      next_with_check := replace(next_with_check, 'auth.uid()', '(select auth.uid())');
      next_with_check := replace(next_with_check, 'auth.role()', '(select auth.role())');
    END IF;

    sql := format(
      'ALTER POLICY %I ON %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );

    IF next_qual IS NOT NULL THEN
      sql := sql || format(' USING (%s)', next_qual);
    END IF;

    IF next_with_check IS NOT NULL THEN
      sql := sql || format(' WITH CHECK (%s)', next_with_check);
    END IF;

    EXECUTE sql;
  END LOOP;
END $$;
