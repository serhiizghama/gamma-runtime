import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { API_BASE } from '../../constants/api';
import { systemAuthHeaders } from '../../lib/auth';

interface Blueprint {
  id: string;
  name: string;
  description: string;
  members: { role: string; agentId: string }[];
}

interface BlueprintSpawnerProps {
  onSpawned: () => void;
}

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
};

const titleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'var(--font-system)',
  color: 'var(--color-text-secondary)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
};

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  padding: 'var(--space-3)',
  background: 'var(--color-surface-elevated)',
  borderRadius: 8,
  border: '1px solid var(--color-border-subtle)',
};

const nameStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'var(--font-system)',
  color: 'var(--color-text-primary)',
};

const descStyle: CSSProperties = {
  fontSize: 11,
  fontFamily: 'var(--font-system)',
  color: 'var(--color-text-secondary)',
  lineHeight: 1.4,
};

const rolesStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
};

const roleBadgeStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  fontFamily: 'var(--font-system)',
  color: 'var(--color-text-secondary)',
  background: 'var(--color-bg-primary)',
  padding: '2px 6px',
  borderRadius: 4,
  border: '1px solid var(--color-border-subtle)',
};

const btnStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'var(--font-system)',
  color: '#fff',
  background: 'var(--color-accent-primary)',
  border: 'none',
  borderRadius: 6,
  padding: '5px 12px',
  cursor: 'pointer',
  alignSelf: 'flex-end',
};

const btnDisabledStyle: CSSProperties = {
  ...btnStyle,
  opacity: 0.5,
  cursor: 'not-allowed',
};

const emptyStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text-secondary)',
  fontFamily: 'var(--font-system)',
  textAlign: 'center',
  padding: 'var(--space-3)',
};

export function BlueprintSpawner({ onSpawned }: BlueprintSpawnerProps) {
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [spawning, setSpawning] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();

    fetch(`${API_BASE}/api/teams/blueprints`, {
      headers: systemAuthHeaders(),
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: Blueprint[]) => {
        if (mountedRef.current) setBlueprints(data);
      })
      .catch(() => {})
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });

    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, []);

  const handleSpawn = async (blueprintId: string) => {
    setSpawning(blueprintId);
    try {
      const res = await fetch(`${API_BASE}/api/teams/spawn-blueprint`, {
        method: 'POST',
        headers: {
          ...systemAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ blueprintId }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      if (mountedRef.current) {
        onSpawned();
      }
    } catch {
      // Spawn failed — user can retry
    } finally {
      if (mountedRef.current) setSpawning(null);
    }
  };

  return (
    <div style={containerStyle}>
      <span style={titleStyle}>Team Blueprints</span>

      {loading ? (
        <span style={emptyStyle}>Loading blueprints...</span>
      ) : blueprints.length === 0 ? (
        <span style={emptyStyle}>No blueprints available</span>
      ) : (
        blueprints.map((bp) => (
          <div key={bp.id} style={cardStyle}>
            <span style={nameStyle}>{bp.name}</span>
            <span style={descStyle}>{bp.description}</span>
            <div style={rolesStyle}>
              {bp.members.map((m, i) => (
                <span key={i} style={roleBadgeStyle}>
                  {m.role}
                </span>
              ))}
            </div>
            <button
              style={spawning === bp.id ? btnDisabledStyle : btnStyle}
              onClick={() => handleSpawn(bp.id)}
              disabled={spawning !== null}
            >
              {spawning === bp.id ? 'Spawning...' : 'Spawn Team'}
            </button>
          </div>
        ))
      )}
    </div>
  );
}
