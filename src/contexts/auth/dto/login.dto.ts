import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  /** Admin username (loaded from env, never stored in DB). */
  @ApiProperty({ example: 'admin' })
  @IsString()
  @IsNotEmpty()
  username!: string;

  /** Plain-text password — compared against env var at runtime. */
  @ApiProperty({ example: 'secret' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
