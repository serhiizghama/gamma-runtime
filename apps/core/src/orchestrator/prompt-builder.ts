import { Injectable } from '@nestjs/common';
import { Agent, Team, Task } from '../common/types';
import { ClaudeMdGenerator } from '../agents/claude-md.generator';
import { RolesService } from '../agents/roles.service';

@Injectable()
export class PromptBuilder {
  constructor(
    private readonly claudeMd: ClaudeMdGenerator,
    private readonly roles: RolesService,
  ) {}

  async buildLeaderPrompt(
    leader: Agent,
    team: Team,
    members: Agent[],
  ): Promise<string> {
    const rolePrompt = await this.roles.getRolePrompt(leader.role_id);
    const base = this.claudeMd.generate({
      agent: leader,
      team,
      teamMembers: members,
      rolePrompt,
      isLeader: true,
    });

    const toolsDocs = this.gammaToolsDocs(team.id, leader.id);
    const appInstructions = this.teamAppInstructions();
    return `${base}\n\n${toolsDocs}\n\n${appInstructions}`;
  }

  async buildAgentPrompt(
    agent: Agent,
    team: Team,
    members: Agent[],
    task: Task,
  ): Promise<string> {
    const rolePrompt = await this.roles.getRolePrompt(agent.role_id);
    const base = this.claudeMd.generate({
      agent,
      team,
      teamMembers: members,
      rolePrompt,
      isLeader: false,
    });

    const taskSection = this.taskSection(task);
    const toolsDocs = this.agentToolsDocs(team.id, agent.id, task.id);
    return `${base}\n\n${taskSection}\n\n${toolsDocs}`;
  }

  private taskSection(task: Task): string {
    return `## Your Current Task

- **Task ID**: ${task.id}
- **Title**: ${task.title}
- **Kind**: ${task.kind}
- **Priority**: ${task.priority}

### Description

${task.description || 'No detailed description provided.'}

### Instructions

1. Read existing code in the project directory before making changes
2. Implement the task as described above
3. When finished, call the update-task endpoint to report completion
4. If blocked, call report-status with details about the blocker`;
  }

  private gammaToolsDocs(teamId: string, agentId: string): string {
    return `## System Tools (gamma-tools)

You can interact with the Gamma orchestration system using curl commands to http://localhost:3001/api/internal.
Use these tools to manage tasks, communicate with team members, and track progress.

### Assign a task to a team member:
\`\`\`bash
curl -s -X POST http://localhost:3001/api/internal/assign-task \\
  -H "Content-Type: application/json" \\
  -d '{"teamId":"${teamId}","to":"Agent Name","title":"Task title","description":"Detailed description...","kind":"backend","priority":1}'
\`\`\`

### Update a task status:
\`\`\`bash
curl -s -X POST http://localhost:3001/api/internal/update-task \\
  -H "Content-Type: application/json" \\
  -d '{"taskId":"TASK_ID","status":"done","summary":"What was accomplished","filesChanged":["file1.ts"]}'
\`\`\`

### List tasks:
\`\`\`bash
curl -s "http://localhost:3001/api/internal/list-tasks?teamId=${teamId}"
curl -s "http://localhost:3001/api/internal/list-tasks?teamId=${teamId}&status=in_progress"
\`\`\`

### Get task details:
\`\`\`bash
curl -s "http://localhost:3001/api/internal/get-task/TASK_ID"
\`\`\`

### Send a message to another agent:
\`\`\`bash
curl -s -X POST http://localhost:3001/api/internal/send-message \\
  -H "Content-Type: application/json" \\
  -d '{"from":"${agentId}","to":"Agent Name","message":"Your message here"}'
\`\`\`

### Check your messages:
\`\`\`bash
curl -s "http://localhost:3001/api/internal/read-messages?agentId=${agentId}"
\`\`\`

### Broadcast a message to all team members:
\`\`\`bash
curl -s -X POST http://localhost:3001/api/internal/broadcast \\
  -H "Content-Type: application/json" \\
  -d '{"from":"${agentId}","teamId":"${teamId}","message":"Your message"}'
\`\`\`

### List team members:
\`\`\`bash
curl -s "http://localhost:3001/api/internal/list-agents?teamId=${teamId}"
\`\`\`

### Get project context and prior task results:
\`\`\`bash
curl -s "http://localhost:3001/api/internal/read-context?teamId=${teamId}"
\`\`\`

### Request review from leader:
\`\`\`bash
curl -s -X POST http://localhost:3001/api/internal/request-review \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"${agentId}","taskId":"TASK_ID","message":"Ready for review"}'
\`\`\`

### Report status or blockers:
\`\`\`bash
curl -s -X POST http://localhost:3001/api/internal/report-status \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"${agentId}","status":"Working on X","blockers":"Need Y"}'
\`\`\`

### Mark project as done (leader only):
\`\`\`bash
curl -s -X POST http://localhost:3001/api/internal/mark-done \\
  -H "Content-Type: application/json" \\
  -d '{"teamId":"${teamId}","summary":"Project summary"}'
\`\`\``;
  }

  private agentToolsDocs(teamId: string, agentId: string, taskId: string): string {
    return `## System Tools (gamma-tools)

You can interact with the Gamma system using curl commands to http://localhost:3001/api/internal.

### Update your task status (IMPORTANT — call when done):
\`\`\`bash
curl -s -X POST http://localhost:3001/api/internal/update-task \\
  -H "Content-Type: application/json" \\
  -d '{"taskId":"${taskId}","status":"done","summary":"What was accomplished","filesChanged":["file1.ts"]}'
\`\`\`

### Send a message to another agent:
\`\`\`bash
curl -s -X POST http://localhost:3001/api/internal/send-message \\
  -H "Content-Type: application/json" \\
  -d '{"from":"${agentId}","to":"Agent Name","message":"Your message"}'
\`\`\`

### Check your messages:
\`\`\`bash
curl -s "http://localhost:3001/api/internal/read-messages?agentId=${agentId}"
\`\`\`

### List tasks:
\`\`\`bash
curl -s "http://localhost:3001/api/internal/list-tasks?teamId=${teamId}"
\`\`\`

### Get project context:
\`\`\`bash
curl -s "http://localhost:3001/api/internal/read-context?teamId=${teamId}"
\`\`\`

### Report status or blockers:
\`\`\`bash
curl -s -X POST http://localhost:3001/api/internal/report-status \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"${agentId}","status":"Working on X","blockers":"Need Y"}'
\`\`\`

### Request review from leader:
\`\`\`bash
curl -s -X POST http://localhost:3001/api/internal/request-review \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"${agentId}","taskId":"${taskId}","message":"Ready for review"}'
\`\`\``;
  }

  private teamAppInstructions(): string {
    return `## Team App — MANDATORY Deliverable

**IMPORTANT:** Every project MUST produce a visual HTML application in the \`project/app/\` directory.
The user sees this app via the "View App" tab in the Gamma UI. If \`project/app/index.html\` does not exist, the user sees "No app created yet" — this is unacceptable.

### What to build:
- The app should be the **main deliverable** of the team's work — not just a report
- If the user asked to build something (e.g., a dashboard, tool, website), build it as the app
- If the task is analytical or non-visual, create a polished work report summarizing results

### Requirements:
- \`project/app/index.html\` is the entry point — this file MUST exist
- Use inline CSS/JS or reference files in the same directory (\`style.css\`, \`script.js\`, \`data.json\`)
- Dark theme preferred, visually polished, responsive
- The app is served at \`/api/teams/{teamId}/app/\` — all asset paths must be relative

### Example structure:
\`\`\`
project/app/
├── index.html    ← entry point (REQUIRED)
├── style.css     ← styles
├── script.js     ← logic
└── data.json     ← data
\`\`\`

### When to create:
- Assign an app-building task early in the project, not as an afterthought
- You can build it yourself or delegate to a team member (e.g., Frontend Dev or Designer)
- Update the app as work progresses — the user may check "View App" at any time`;
  }
}
