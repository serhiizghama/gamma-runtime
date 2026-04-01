export class CreateAgentDto {
  name!: string;
  roleId!: string;
  teamId!: string;
  specialization?: string;
  description?: string;
  isLeader?: boolean;
}
