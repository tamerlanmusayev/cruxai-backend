import { createHmac, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, join, resolve } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

type Driver = 's3' | 'local';

/**
 * Object storage with two interchangeable drivers selected by STORAGE_DRIVER:
 *   - "s3":    any S3-compatible store (AWS S3, Cloudflare R2, MinIO, B2).
 *              Browsers upload straight to the store via presigned PUT URLs.
 *   - "local": dev fallback that presigns a PUT to our own API and writes to
 *              disk, so the same upload flow works with no cloud credentials.
 *
 * The frontend contract is identical either way: request a presigned URL,
 * PUT the file bytes to it, then create the document referencing the key.
 */
@Injectable()
export class StorageService {
  private readonly log = new Logger(StorageService.name);
  private readonly driver: Driver =
    process.env.STORAGE_DRIVER === 's3' ? 's3' : 'local';
  private readonly putExpirySec = 600; // 10 min to finish the upload

  // s3 driver
  private readonly bucket = process.env.S3_BUCKET ?? '';
  private readonly s3 =
    this.driver === 's3'
      ? new S3Client({
          region: process.env.S3_REGION ?? 'auto',
          endpoint: process.env.S3_ENDPOINT || undefined,
          forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
          credentials:
            process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY
              ? {
                  accessKeyId: process.env.S3_ACCESS_KEY,
                  secretAccessKey: process.env.S3_SECRET_KEY,
                }
              : undefined,
        })
      : null;

  // local driver
  private readonly localDir = resolve(
    process.env.LOCAL_STORAGE_DIR ?? join(process.cwd(), '.uploads'),
  );
  private readonly publicApiUrl =
    process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
  private readonly hmacSecret = process.env.JWT_SECRET ?? 'dev-secret';

  constructor() {
    this.log.log(`Storage driver: ${this.driver}`);
  }

  /** A unique, path-safe object key for an uploaded file. */
  newKey(name: string): string {
    const safe = name.replace(/[^\w.\-]+/g, '_').slice(-80) || 'file';
    return `uploads/${randomUUID()}/${safe}`;
  }

  /** A presigned URL the browser can PUT the raw file bytes to. */
  async presignPut(key: string, contentType: string): Promise<string> {
    if (this.driver === 's3') {
      return getSignedUrl(
        this.s3!,
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ContentType: contentType || 'application/octet-stream',
        }),
        { expiresIn: this.putExpirySec },
      );
    }
    // local: signed URL back to our own PUT endpoint
    const sig = this.sign(key);
    return `${this.publicApiUrl}/storage/local/${encodeURIComponent(key)}?sig=${sig}`;
  }

  /** Fetch an object's bytes (used by the background worker). */
  async get(key: string): Promise<Buffer> {
    if (this.driver === 's3') {
      const out = await this.s3!.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const chunks: Buffer[] = [];
      for await (const c of out.Body as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(c));
      }
      return Buffer.concat(chunks);
    }
    return fs.readFile(this.localPath(key));
  }

  // ---- local driver internals (no-ops under s3) ----

  /** HMAC over the key so only our own presigned PUTs are accepted. */
  sign(key: string): string {
    return createHmac('sha256', this.hmacSecret).update(key).digest('hex').slice(0, 32);
  }

  verify(key: string, sig: string): boolean {
    return !!sig && this.sign(key) === sig;
  }

  async putLocal(key: string, buffer: Buffer): Promise<void> {
    const path = this.localPath(key);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, buffer);
  }

  /** Resolve a key under the storage dir, blocking path traversal. */
  private localPath(key: string): string {
    const path = resolve(this.localDir, key);
    if (!path.startsWith(this.localDir)) throw new Error('Invalid key');
    return path;
  }
}
