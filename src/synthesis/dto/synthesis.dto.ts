import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, MaxLength } from 'class-validator';

export class SynthesisDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  documentIds: string[];

  @IsString()
  @MaxLength(300)
  query: string;
}
