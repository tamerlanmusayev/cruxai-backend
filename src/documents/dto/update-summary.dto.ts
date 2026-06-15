import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSummaryDto {
  @IsOptional()
  @IsString()
  @MaxLength(60_000)
  contentMd?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(400, { each: true })
  keyPoints?: string[];
}
