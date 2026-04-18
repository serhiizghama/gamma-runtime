import { useState } from 'react';
import type { Task, TaskStage } from '../hooks/useTeamTasks';
import type { Agent } from '../store/useStore';
import { TaskCard } from './TaskCard';
import { Spinner } from './Spinner';

const sections: { key: TaskStage; label: string; color: string; dotColor: string }[] = [
  { key: 'in_progress', label: 'In Progress', color: 'text-blue-400', dotColor: 'bg-blue-400' },
  { key: 'review', label: 'Review', color: 'text-amber-400', dotColor: 'bg-amber-400' },
  { key: 'backlog', label: 'Backlog', color: 'text-gray-400', dotColor: 'bg-gray-500' },
  { key: 'done', label: 'Done', color: 'text-green-400', dotColor: 'bg-green-400' },
  { key: 'failed', label: 'Failed', color: 'text-red-400', dotColor: 'bg-red-400' },
];

// Sections that are expanded by default
const defaultExpanded = new Set<TaskStage>(['in_progress', 'review', 'failed']);

interface Props {
  tasks: Task[];
  agents: Agent[];
  loading: boolean;
  teamId: string;
  onTaskClick: (task: Task) => void;
}

export function TaskBoard({ tasks, agents, loading, teamId, onTaskClick }: Props) {
  const [expanded, setExpanded] = useState<Set<TaskStage>>(() => new Set(defaultExpanded));

  const toggle = (key: TaskStage) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const getTasksForSection = (key: TaskStage): Task[] => {
    const filtered =
      key === 'backlog'
        ? tasks.filter((t) => t.stage === 'backlog' || t.stage === 'planning')
        : tasks.filter((t) => t.stage === key);
    return [...filtered].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
  };

  return (
    <div className="flex h-full flex-col">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-500">Tasks</h3>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Spinner className="h-4 w-4" />
          Loading tasks...
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <svg className="h-10 w-10 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
          </svg>
          <p className="text-sm text-gray-500">No tasks yet</p>
          <p className="text-xs text-gray-600">Tasks will appear here when the team starts working</p>
        </div>
      ) : (
        <div className="flex-1 space-y-1 overflow-y-auto">
          {sections.map((section) => {
            const sectionTasks = getTasksForSection(section.key);
            if (sectionTasks.length === 0) return null;
            const isOpen = expanded.has(section.key);

            return (
              <div key={section.key}>
                <button
                  onClick={() => toggle(section.key)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-gray-800/60 ${
                    section.key === 'failed' ? 'bg-red-500/5' : ''
                  }`}
                >
                  <svg
                    className={`h-3 w-3 shrink-0 text-gray-500 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${section.dotColor}`} />
                  <span className={`text-xs font-medium ${section.color}`}>{section.label}</span>
                  <span className="ml-auto rounded-full bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-500">
                    {sectionTasks.length}
                  </span>
                </button>
                {isOpen && (
                  <div className="space-y-1.5 px-1 pb-2 pt-1">
                    {sectionTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        agents={agents}
                        teamId={teamId}
                        onClick={() => onTaskClick(task)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
