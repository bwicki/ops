-- Fahrtbriefing — D1-Schema (SQLite). Anwenden: wrangler d1 execute briefing --file=schema.sql [--remote]
CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS secrets (
  name TEXT PRIMARY KEY,
  iv TEXT NOT NULL,
  ct TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS briefings (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  final_no INTEGER NOT NULL DEFAULT 0,
  start_ms INTEGER,
  tz TEXT,
  site TEXT,
  icao TEXT,
  elev REAL,
  reg TEXT,
  balloon TEXT,
  kind TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  owner_id TEXT NOT NULL DEFAULT 'bwicki',
  material_owner TEXT,
  no TEXT,                -- 0.11: Ordnungsnummer JJJJ-NNN (bestehende DB: Worker ergänzt die Spalte per ALTER TABLE)
  progress INTEGER,       -- 0.11: Fortschritt in % (gefüllte Panels)
  end_ms INTEGER,         -- 0.11: Fahrtende für die Sperre
  edition INTEGER         -- 0.11.2: Bearbeitungsstand «vN» (zählt Bearbeitungssitzungen, nicht Speichervorgänge)
);
CREATE INDEX IF NOT EXISTS briefings_start ON briefings(start_ms);
CREATE INDEX IF NOT EXISTS briefings_owner ON briefings(owner_id, start_ms);
CREATE TABLE IF NOT EXISTS access_links (
  token TEXT PRIMARY KEY,
  briefing_id TEXT NOT NULL,
  person TEXT NOT NULL,
  role TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_opened_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS access_briefing ON access_links(briefing_id);
CREATE TABLE IF NOT EXISTS files (
  key TEXT PRIMARY KEY,
  briefing_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_ip ON login_attempts(ip, ts);

-- Mehrbenutzer (0.5.0)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,            -- Kurzname, Anmeldename (klein)
  name TEXT NOT NULL,             -- Anzeigename
  role TEXT NOT NULL DEFAULT 'master',   -- super | master
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  flags TEXT NOT NULL DEFAULT '{}',      -- JSON: { ai: true, notam: true, pdf: true }
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  from_user TEXT NOT NULL,
  to_user TEXT NOT NULL,
  categories TEXT NOT NULL,       -- JSON-Liste: balloons, persons, sites, meetings, operators
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shares_to ON shares(to_user);
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,             -- login, briefing_create, briefing_save, release, wx_<kind>, ai, pdf, file, link_create, link_open
  detail TEXT,                    -- z. B. Briefing-ID, Kennung, Modell
  n INTEGER NOT NULL DEFAULT 1    -- Zähler: Tokens, Bytes, Anzahl
);
CREATE INDEX IF NOT EXISTS usage_user_ts ON usage(user_id, ts);
CREATE TABLE IF NOT EXISTS material_links (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,          -- Ersteller (Materialeigner)
  person TEXT NOT NULL,           -- externer Empfänger (Name)
  regs TEXT NOT NULL,             -- JSON-Liste Kennungen, z. B. ["HB-QWZ"]
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_opened_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS material_user ON material_links(user_id);

-- 0.14.0: Ist-Trajektorie je Briefing aus analyze.wicki.aero (Zusammenfassung hier, GeoJSON in R2 unter <briefing>/trajectory.geojson);
-- der Worker legt die Tabelle auch selbst an (ensureTrajectories)
CREATE TABLE IF NOT EXISTS trajectories (
  briefing_id TEXT PRIMARY KEY,
  json TEXT NOT NULL,             -- {source, flight{id,title,url}, stats, meta, events, points, receivedAt}
  geo_key TEXT NOT NULL,          -- R2-Schlüssel des GeoJSON
  points INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  flight_id TEXT,
  received_at INTEGER NOT NULL
);
