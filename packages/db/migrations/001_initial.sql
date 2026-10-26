CREATE TABLE users (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE CHECK (username = lower(username) AND username ~ '^[a-z0-9_]{3,30}$'),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  password_hash text NOT NULL,
  bio text NOT NULL DEFAULT '' CHECK (length(bio) <= 500),
  private_profile boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE catalog_titles (
  id text PRIMARY KEY,
  media_type text NOT NULL CHECK (media_type IN ('movie', 'tv')),
  external_id integer NOT NULL CHECK (external_id > 0),
  title text NOT NULL,
  poster_path text,
  backdrop_path text,
  overview text NOT NULL DEFAULT '',
  release_date text,
  runtime integer CHECK (runtime IS NULL OR runtime >= 0),
  genres jsonb NOT NULL DEFAULT '[]'::jsonb,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (media_type, external_id),
  CHECK (id = media_type || ':' || external_id::text)
);

CREATE TABLE catalog_episodes (
  id text PRIMARY KEY,
  title_id text NOT NULL REFERENCES catalog_titles(id) ON DELETE CASCADE,
  season_number integer NOT NULL CHECK (season_number >= 0),
  episode_number integer NOT NULL CHECK (episode_number > 0),
  title text NOT NULL,
  runtime integer CHECK (runtime IS NULL OR runtime >= 0),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (title_id, season_number, episode_number),
  CHECK (id = title_id || ':' || season_number::text || ':' || episode_number::text),
  CHECK (title_id LIKE 'tv:%')
);

CREATE TABLE catalog_cache (
  cache_key text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE library (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id text NOT NULL REFERENCES catalog_titles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'watchlist' CHECK (status IN ('watchlist', 'watching', 'completed', 'dropped')),
  favorite boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, title_id)
);
CREATE INDEX library_updated_idx ON library(user_id, updated_at DESC);

CREATE TABLE episode_watches (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id text NOT NULL REFERENCES catalog_episodes(id) ON DELETE CASCADE,
  watched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, episode_id)
);
CREATE INDEX episode_watches_time_idx ON episode_watches(user_id, watched_at DESC);

CREATE TABLE diary (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id text NOT NULL REFERENCES catalog_titles(id) ON DELETE CASCADE,
  watched_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL,
  UNIQUE (user_id, idempotency_key),
  CHECK (title_id LIKE 'movie:%')
);
CREATE INDEX diary_time_idx ON diary(user_id, watched_at DESC);

CREATE TABLE ratings (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('title', 'episode')),
  title_target_id text GENERATED ALWAYS AS (CASE WHEN target_type = 'title' THEN target_id ELSE NULL END) STORED REFERENCES catalog_titles(id) ON DELETE CASCADE,
  episode_target_id text GENERATED ALWAYS AS (CASE WHEN target_type = 'episode' THEN target_id ELSE NULL END) STORED,
  score numeric NOT NULL CHECK (score >= 0 AND score <= 10 AND mod(score, 0.5) = 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, target_id),
  FOREIGN KEY (user_id, episode_target_id) REFERENCES episode_watches(user_id, episode_id) ON DELETE CASCADE
);
CREATE INDEX ratings_target_idx ON ratings(target_id);

CREATE TABLE comments (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('title', 'episode')),
  title_target_id text GENERATED ALWAYS AS (CASE WHEN target_type = 'title' THEN target_id ELSE NULL END) STORED REFERENCES catalog_titles(id) ON DELETE CASCADE,
  episode_target_id text GENERATED ALWAYS AS (CASE WHEN target_type = 'episode' THEN target_id ELSE NULL END) STORED REFERENCES catalog_episodes(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 5000),
  spoiler boolean NOT NULL DEFAULT true,
  parent_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, target_id, target_type),
  FOREIGN KEY (parent_id, target_id, target_type) REFERENCES comments(id, target_id, target_type) ON DELETE CASCADE
);
CREATE INDEX comments_target_idx ON comments(target_id, created_at DESC);
CREATE INDEX comments_parent_idx ON comments(parent_id);

CREATE TABLE comment_likes (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_id text NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, comment_id)
);

CREATE TABLE follows (
  follower_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);
CREATE INDEX follows_following_idx ON follows(following_id);

CREATE TABLE character_votes (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id text NOT NULL REFERENCES catalog_episodes(id) ON DELETE CASCADE,
  person_id integer NOT NULL CHECK (person_id > 0),
  character text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, episode_id),
  FOREIGN KEY (user_id, episode_id) REFERENCES episode_watches(user_id, episode_id) ON DELETE CASCADE
);
CREATE INDEX character_votes_episode_idx ON character_votes(episode_id, person_id);

CREATE TABLE notifications (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  message text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC);

CREATE TABLE earned_achievements (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code text NOT NULL,
  earned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code)
);

CREATE TABLE custom_lists (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  private boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX custom_lists_owner_idx ON custom_lists(user_id);

CREATE TABLE list_items (
  list_id text NOT NULL REFERENCES custom_lists(id) ON DELETE CASCADE,
  title_id text NOT NULL REFERENCES catalog_titles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, title_id)
);

CREATE TABLE moderation_reports (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_id text NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 5 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, comment_id)
);
