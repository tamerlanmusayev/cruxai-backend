import { IsInt, Max, Min } from 'class-validator';

export class ReviewDto {
  @IsInt()
  @Min(0)
  @Max(5)
  grade: number;
}
