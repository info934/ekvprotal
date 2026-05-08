-- Public buckets can serve public object URLs without a broad SELECT policy.
-- Removing this policy prevents clients from listing every avatar object.

DROP POLICY IF EXISTS "Allow public read access to avatars" ON storage.objects;
