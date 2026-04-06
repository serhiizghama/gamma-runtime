-- Gamma Runtime v2 — Initial Schema
-- All 7 tables from spec §4 + §14

-- Teams
CREATE TABLE teams (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  status      TEXT DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);

-- Agents
CREATE TABLE agents (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  role_id         TEXT NOT NULL,
  specialization  TEXT DEFAULT '',
  description     TEXT DEFAULT '',
  avatar_emoji    TEXT DEFAULT '🤖',
  status          TEXT DEFAULT 'idle'
    CHECK (status IN ('idle', 'running', 'error', 'archived')),
  team_id         TEXT REFERENCES teams(id) ON DELETE SET NULL,
  is_leader       INTEGER DEFAULT 0,
  session_id      TEXT,
  workspace_path  TEXT,
  claude_md_hash  TEXT,
  context_tokens  INTEGER DEFAULT 0,
  context_window  INTEGER DEFAULT 1000000,
  total_turns     INTEGER DEFAULT 0,
  last_active_at  BIGINT,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);

-- Projects
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  team_id     TEXT NOT NULL REFERENCES teams(id),
  status      TEXT DEFAULT 'planning'
    CHECK (status IN ('planning', 'active', 'completed', 'failed')),
  plan        TEXT,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);

-- Tasks
CREATE TABLE tasks (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT DEFAULT '',
  project_id      TEXT REFERENCES projects(id),
  team_id         TEXT NOT NULL REFERENCES teams(id),
  stage           TEXT DEFAULT 'backlog'
    CHECK (stage IN ('backlog', 'planning', 'in_progress', 'review', 'done', 'failed')),
  kind            TEXT DEFAULT 'generic'
    CHECK (kind IN ('generic', 'backend', 'frontend', 'qa', 'design', 'devops')),
  assigned_to     TEXT REFERENCES agents(id),
  created_by      TEXT REFERENCES agents(id),
  priority        INTEGER DEFAULT 0,
  result          TEXT,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);

-- Trace Events
CREATE TABLE trace_events (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES agents(id),
  team_id     TEXT REFERENCES teams(id),
  task_id     TEXT REFERENCES tasks(id),
  kind        TEXT NOT NULL,
  content     TEXT,
  created_at  BIGINT NOT NULL
);

CREATE INDEX idx_trace_agent ON trace_events(agent_id, created_at);
CREATE INDEX idx_trace_team  ON trace_events(team_id, created_at);
CREATE INDEX idx_trace_task  ON trace_events(task_id, created_at);

-- Chat Messages (user <-> team)
CREATE TABLE chat_messages (
  id          TEXT PRIMARY KEY,
  team_id     TEXT NOT NULL REFERENCES teams(id),
  role        TEXT NOT NULL
    CHECK (role IN ('user', 'assistant', 'system')),
  agent_id    TEXT REFERENCES agents(id),
  content     TEXT NOT NULL,
  created_at  BIGINT NOT NULL
);

CREATE INDEX idx_chat_team ON chat_messages(team_id, created_at);

-- Agent Messages (inter-agent inbox)
CREATE TABLE agent_messages (
  id          TEXT PRIMARY KEY,
  team_id     TEXT NOT NULL REFERENCES teams(id),
  from_agent  TEXT REFERENCES agents(id),
  to_agent    TEXT NOT NULL REFERENCES agents(id),
  content     TEXT NOT NULL,
  read        INTEGER DEFAULT 0,
  created_at  BIGINT NOT NULL
);

CREATE INDEX idx_amsg_to ON agent_messages(to_agent, read, created_at);
