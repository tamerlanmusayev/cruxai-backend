import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RecommendDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  topic: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  lang?: string;
}
