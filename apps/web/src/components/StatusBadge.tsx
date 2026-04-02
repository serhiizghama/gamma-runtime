const colors: Record<string, string> = {
  active: 'bg-green-500/20 text-green-400',
  idle: 'bg-gray-500/20 text-gray-400',
  running: 'bg-blue-500/20 text-blue-400',
  error: 'bg-red-500/20 text-red-400',
  archived: 'bg-yellow-500/20 text-yellow-400',
};

export function StatusBadge({ status }: { status: string }) {
  const cls = colors[status] ?? colors.idle;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}
