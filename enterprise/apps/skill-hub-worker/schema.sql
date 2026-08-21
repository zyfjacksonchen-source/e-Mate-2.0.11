PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS skill_hub_skills (
  slug TEXT PRIMARY KEY,
  latest_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS skill_hub_versions (
  slug TEXT NOT NULL REFERENCES skill_hub_skills(slug),
  version TEXT NOT NULL,
  version_sort TEXT NOT NULL,
  package_sha256 TEXT NOT NULL,
  archive_sha256 TEXT NOT NULL,
  package_size_bytes INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('third_party','content_creation','office_productivity')),
  tags_json TEXT NOT NULL,
  uploader_nickname TEXT NOT NULL,
  author_ref TEXT NOT NULL,
  original_platform TEXT,
  original_url TEXT,
  published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(slug, version),
  UNIQUE(package_sha256)
);

CREATE TRIGGER IF NOT EXISTS skill_hub_versions_no_update
BEFORE UPDATE ON skill_hub_versions BEGIN
  SELECT RAISE(ABORT, 'Skill Hub versions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS skill_hub_versions_no_delete
BEFORE DELETE ON skill_hub_versions BEGIN
  SELECT RAISE(ABORT, 'Skill Hub versions are immutable');
END;

CREATE TABLE IF NOT EXISTS skill_hub_publication_tombstones (
  slug TEXT NOT NULL,
  version TEXT NOT NULL,
  package_sha256 TEXT NOT NULL,
  author_ref TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(slug, version),
  UNIQUE(author_ref, client_request_id),
  FOREIGN KEY(slug, version) REFERENCES skill_hub_versions(slug, version)
);

CREATE TRIGGER IF NOT EXISTS skill_hub_publication_tombstones_no_update
BEFORE UPDATE ON skill_hub_publication_tombstones BEGIN
  SELECT RAISE(ABORT, 'Skill Hub publication tombstones are immutable');
END;

CREATE TRIGGER IF NOT EXISTS skill_hub_publication_tombstones_no_delete
BEFORE DELETE ON skill_hub_publication_tombstones BEGIN
  SELECT RAISE(ABORT, 'Skill Hub publication tombstones are immutable');
END;

CREATE TABLE IF NOT EXISTS skill_hub_mutation_requests (
  account_ref TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('publish','delete')),
  slug TEXT NOT NULL,
  version TEXT NOT NULL,
  package_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('published','deleted')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(account_ref, client_request_id)
);

CREATE TRIGGER IF NOT EXISTS skill_hub_mutation_requests_no_update
BEFORE UPDATE ON skill_hub_mutation_requests BEGIN
  SELECT RAISE(ABORT, 'Skill Hub mutation receipts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS skill_hub_mutation_requests_no_delete
BEFORE DELETE ON skill_hub_mutation_requests BEGIN
  SELECT RAISE(ABORT, 'Skill Hub mutation receipts are immutable');
END;

CREATE TABLE IF NOT EXISTS skill_hub_install_intents (
  intent_id TEXT PRIMARY KEY,
  account_ref TEXT NOT NULL,
  slug TEXT NOT NULL,
  version TEXT NOT NULL,
  package_sha256 TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  install_token_sha256 TEXT NOT NULL UNIQUE,
  completion_token_sha256 TEXT UNIQUE,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('created','claimed','installed','failed')),
  claimed_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS skill_hub_install_logs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_id TEXT NOT NULL,
  account_ref TEXT NOT NULL,
  slug TEXT NOT NULL,
  version TEXT NOT NULL,
  package_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('created','claimed','installed','failed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER IF NOT EXISTS skill_hub_install_logs_no_update
BEFORE UPDATE ON skill_hub_install_logs BEGIN
  SELECT RAISE(ABORT, 'Skill Hub install logs are immutable');
END;

CREATE TRIGGER IF NOT EXISTS skill_hub_install_logs_no_delete
BEFORE DELETE ON skill_hub_install_logs BEGIN
  SELECT RAISE(ABORT, 'Skill Hub install logs are immutable');
END;

CREATE INDEX IF NOT EXISTS skill_hub_versions_slug_sort
ON skill_hub_versions(slug, version_sort DESC);

CREATE INDEX IF NOT EXISTS skill_hub_versions_author
ON skill_hub_versions(author_ref, slug, version_sort DESC);
