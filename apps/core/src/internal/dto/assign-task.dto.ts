export class AssignTaskDto {
  teamId!: string;
  to!: string;
  title!: string;
  description?: string;
  kind?: string;
  priority?: number;
}
