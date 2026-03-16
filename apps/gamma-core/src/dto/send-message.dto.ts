import { IsString, IsNotEmpty } from 'class-validator';

export class SendMessageBody {
  @IsString()
  @IsNotEmpty()
  message!: string;
}
