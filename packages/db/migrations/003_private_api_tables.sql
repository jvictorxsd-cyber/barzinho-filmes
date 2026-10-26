-- Supabase exposes public-schema tables through its Data API by default.
-- Barzinho authorizes access in its own server API; browser roles get no direct access.
DO $$
DECLARE table_name text; role_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'schema_migrations','users','sessions','account_tokens','catalog_titles',
    'catalog_episodes','catalog_cache','library','episode_watches','diary',
    'ratings','comments','comment_likes','follows','character_votes',
    'notifications','earned_achievements','custom_lists','list_items','moderation_reports'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',table_name);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',table_name,role_name);
      END IF;
    END LOOP;
  END LOOP;
END $$;
