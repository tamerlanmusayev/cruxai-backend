import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_FILES, MAX_TOTAL_BYTES } from '../extract.util';

export class UploadFileDto {
  @IsString()
  @MaxLength(300)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  type?: string;

  @IsInt()
  @Min(1)
  @Max(MAX_TOTAL_BYTES)
  size: number;
}

/** Request presigned upload URLs for a batch of files. */
export class RequestUploadsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_FILES)
  @ValidateNested({ each: true })
  @Type(() => UploadFileDto)
  files: UploadFileDto[];
}

export class SourceRefDto {
  // Either an uploaded object key OR a remote URL the worker downloads.
  @IsOptional()
  @IsString()
  @MaxLength(300)
  key?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  url?: string;

  @IsString()
  @MaxLength(300)
  name: string;
}

/** Create a document from already-uploaded object keys. */
export class CreateDocumentDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_FILES)
  @ValidateNested({ each: true })
  @Type(() => SourceRefDto)
  sources: SourceRefDto[];

  @IsOptional()
  @IsString()
  @MaxLength(5)
  lang?: string;
}

/** Generate an AI overview document for a book by title. */
export class OverviewDto {
  @IsString()
  @MaxLength(300)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  lang?: string;
}
