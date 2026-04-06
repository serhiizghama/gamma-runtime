-- Migration 001: Add claude_md_hash column to agents table
-- Tracks the SHA-256 hash (first 16 chars) of each agent's CLAUDE.md file
-- Used to detect when CLAUDE.md changes mid-session (UI shows restart warning)

ALTER TABLE agents ADD COLUMN IF NOT EXISTS claude_md_hash TEXT;
