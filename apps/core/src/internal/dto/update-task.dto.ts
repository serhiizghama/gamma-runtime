export class UpdateTaskDto {
  taskId!: string;
  status!: 'done' | 'failed' | 'in_progress' | 'review';
  summary?: string;
  filesChanged?: string[];
}
