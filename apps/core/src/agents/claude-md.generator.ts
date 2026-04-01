import { Injectable } from '@nestjs/common';
import { Agent, Team } from '../common/types';

interface GenerateOpts {
  agent: Agent;
  team: Team;
  teamMembers: Agent[];
  rolePrompt: string;
  isLeader: boolean;
}

@Injectable()
export class ClaudeMdGenerator {
  generate(opts: GenerateOpts): string {
    const { agent, team, teamMembers, rolePrompt, isLeader } = opts;
    const sections: string[] = [];

    // 1. Agent Identity
    sections.push(`# Agent Identity

You are **${agent.name}**, a **${agent.specialization || agent.role_id}** on team **"${team.name}"**.`);

    // 2. Role prompt (verbatim)
    sections.push(`## Your Role

${rolePrompt}`);

    // 3. Team context
    sections.push(`---

## Team Context

You are part of team **"${team.name}"** (${team.description || 'No description'}).

### Your position
${isLeader
  ? '- **You are the team leader.**'
  : `- **You report to**: ${this.findLeader(teamMembers)}`}

### Team members
${teamMembers.map(m => `- **${m.name}** (${m.role_id}: ${m.specialization || 'general'}) — status: ${m.status}`).join('\n')}

### Communication
You do NOT communicate directly with other agents. The orchestration system
manages all task routing. When you complete work, your output is automatically
shared with the team leader for review.

If you need something from a teammate, mention it in your summary output
and the orchestrator will handle delegation.`);

    // 4. Working directory
    sections.push(`## Working Directory

- **Project directory**: project/ — all code goes here
- **Plans directory**: plans/ — architecture docs and reviews
- **Your notes**: agents/${agent.id}/notes/`);

    // 5. Output protocol
    sections.push(`## Output Protocol

When you complete a task, end your response with a JSON summary block:

\`\`\`json
{
  "status": "completed" | "failed" | "needs_clarification",
  "summary": "Brief description of what was done",
  "files_changed": ["path/to/file1", "path/to/file2"],
  "notes": "Any concerns, blockers, or suggestions for the team"
}
\`\`\``);

    // 6. Guidelines
    sections.push(`## Guidelines
- Write clean, production-quality code
- Follow existing project conventions
- Do not modify files outside your assigned scope unless necessary
- If you encounter a blocker, report it in the summary — do NOT stop silently
- Read existing code before making changes`);

    // 7. Leader-specific additions
    if (isLeader) {
      const nonLeaders = teamMembers.filter(m => !m.is_leader);
      sections.push(`## Leadership Responsibilities

You are the **team leader**. You are responsible for:
1. Breaking down user requests into actionable tasks for your team
2. Reviewing completed work from team members
3. Ensuring quality and consistency across all deliverables

### Task Decomposition Protocol

When given a project request, create an implementation plan.
Respond with a JSON plan block:

\`\`\`json
{
  "plan": {
    "name": "Project name",
    "description": "Brief description",
    "stages": [
      {
        "name": "Stage name",
        "order": 1,
        "tasks": [
          {
            "title": "Task title",
            "description": "Detailed description with clear acceptance criteria",
            "kind": "backend|frontend|qa|design|devops|generic",
            "priority": 1
          }
        ]
      }
    ]
  }
}
\`\`\`

Match task \`kind\` to your team members' specializations:
${nonLeaders.map(m => `- ${m.name} (${m.role_id}) → best for: ${this.getTaskKinds(m.role_id)}`).join('\n')}

### Review Protocol

When reviewing team output, respond with:

\`\`\`json
{
  "review": {
    "approved": true,
    "feedback": [
      { "task_id": "...", "status": "approved|changes_requested|failed", "comment": "..." }
    ],
    "summary": "Overall assessment"
  }
}
\`\`\``);
    }

    return sections.join('\n\n');
  }

  private findLeader(members: Agent[]): string {
    const leader = members.find(m => m.is_leader);
    return leader ? `${leader.name} (${leader.role_id})` : 'None assigned';
  }

  private getTaskKinds(roleId: string): string {
    const category = roleId.split('/')[0];
    const mapping: Record<string, string> = {
      engineering: 'backend, frontend, generic',
      design: 'design, frontend',
      testing: 'qa, generic',
      'project-management': 'planning, review, generic',
      product: 'planning, generic',
    };
    return mapping[category] ?? 'generic';
  }
}
