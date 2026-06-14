import { ArrayNotEmpty, IsArray, IsInt, Min } from 'class-validator';

export class SubmitAttemptDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(-1, { each: true }) // -1 = unanswered
  answers: number[];
}
