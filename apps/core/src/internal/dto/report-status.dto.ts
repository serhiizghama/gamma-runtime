export class ReportStatusDto {
  agentId!: string;
  taskId?: string;
  status!: string;
  blockers?: string;
}
