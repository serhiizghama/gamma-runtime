import { useEffect, useState, useMemo } from 'react';
import { get } from '../api/client';

interface RoleEntry {
  id: string;
  name: string;
  category: string;
  fileName: string;
  emoji?: string;
  description?: string;
  vibe?: string;
}

interface RoleCategory {
  id: string;
  name: string;
  roles: RoleEntry[];
}

interface RolePickerProps {
  defaultCategory?: string;
  value: string;
  onChange: (roleId: string, roleName: string) => void;
}

export function RolePicker({ defaultCategory = 'leadership', value, onChange }: RolePickerProps) {
  const [categories, setCategories] = useState<RoleCategory[]>([]);
  const [selectedCat, setSelectedCat] = useState(defaultCategory);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    get<{ categories: RoleCategory[] }>('/agents/roles')
      .then((data) => {
        setCategories(data.categories);
        if (!data.categories.find((c) => c.id === defaultCategory) && data.categories.length > 0) {
          setSelectedCat(data.categories[0].id);
        }
      })
      .catch(() => setCategories([]))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredRoles = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (q) {
      // Search across all categories
      const all = categories.flatMap((c) => c.roles);
      return all.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.description ?? '').toLowerCase().includes(q) ||
          (r.vibe ?? '').toLowerCase().includes(q),
      );
    }
    const cat = categories.find((c) => c.id === selectedCat);
    return cat?.roles ?? [];
  }, [categories, selectedCat, search]);

  if (loading) {
    return <div className="text-sm text-gray-500">Loading roles...</div>;
  }

  return (
    <div className="space-y-3">
      {/* Search */}
      <div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search roles..."
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Category tabs — hidden when searching */}
      {!search && (
        <div className="flex flex-wrap gap-1">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCat(cat.id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                selectedCat === cat.id
                  ? 'bg-blue-600/20 text-blue-400'
                  : 'bg-gray-800 text-gray-500 hover:text-gray-300'
              }`}
            >
              {cat.name}
              <span className="ml-1 text-[10px] opacity-60">{cat.roles.length}</span>
            </button>
          ))}
        </div>
      )}

      {/* Role list */}
      <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-gray-700 bg-gray-800/50 p-2">
        {filteredRoles.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-gray-500">
            {search ? 'No roles match your search' : 'No roles in this category'}
          </div>
        ) : (
          filteredRoles.map((role) => (
            <button
              key={role.id}
              type="button"
              onClick={() => onChange(role.id, role.name)}
              className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                value === role.id
                  ? 'bg-blue-600/20 ring-1 ring-blue-500/40'
                  : 'hover:bg-gray-700/50'
              }`}
            >
              <span className="shrink-0 pt-0.5 text-lg">{role.emoji ?? '🤖'}</span>
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-medium ${value === role.id ? 'text-blue-400' : 'text-gray-200'}`}>
                  {role.name}
                </div>
                {role.description && (
                  <div className="mt-0.5 text-xs text-gray-500 line-clamp-2">{role.description}</div>
                )}
                {role.vibe && (
                  <div className="mt-0.5 text-[11px] italic text-gray-600 line-clamp-1">{role.vibe}</div>
                )}
              </div>
            </button>
          ))
        )}
      </div>

      {search && (
        <div className="text-[10px] text-gray-600">
          {filteredRoles.length} result{filteredRoles.length !== 1 ? 's' : ''} across all categories
        </div>
      )}
    </div>
  );
}
