import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash, randomUUID } from 'crypto';

export type ImageKind = 'avatar' | 'cover';

const FOLDER: Record<ImageKind, string> = { avatar: 'u', cover: 'b' };
/** The client re-encodes everything to WebP at a small size before uploading, so this is generous. */
export const MAX_IMAGE_BYTES = 512 * 1024;
const CONTENT_TYPE = 'image/webp';
const UPLOAD_TTL_SECONDS = 300;
const KEY_NAME = /^[0-9a-f-]{36}\.webp$/;

/** Every key of one owner lives under this prefix, which is how a key is proven to be theirs. */
export function imagePrefix(kind: ImageKind, ownerId: string) {
  return `${FOLDER[kind]}/${createHash('sha256').update(ownerId).digest('hex').slice(0, 16)}/`;
}

/**
 * Avatars and board covers live in a Cloudflare R2 bucket served publicly through a CDN domain: the browser
 * PUTs the image straight to R2 with a presigned URL, so the API never carries image bytes and only stores the key.
 */
@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);
  private s3?: { client: S3Client; bucket: string };

  private storage() {
    if (this.s3) return this.s3;
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
      throw new ServiceUnavailableException('Image uploads are not configured');
    }
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
      // Without this the SDK signs the CRC32 of an empty body into the URL, and R2 then rejects the real upload with 403.
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
    return (this.s3 = { client, bucket: R2_BUCKET });
  }

  /** A short-lived URL the browser PUTs the WebP to (with `Content-Type: image/webp`), plus the key to confirm it with. */
  async uploadUrl(kind: ImageKind, ownerId: string) {
    const { client, bucket } = this.storage();
    const key = `${imagePrefix(kind, ownerId)}${randomUUID()}.webp`;
    const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: CONTENT_TYPE });
    const uploadUrl = await getSignedUrl(client, command, { expiresIn: UPLOAD_TTL_SECONDS });
    return { uploadUrl, key };
  }

  /**
   * Checks the uploaded object is this owner's, WebP and small enough (an oversized or wrong-type upload is deleted),
   * runs `save` to store the new key (null clears it), then deletes the previous object.
   */
  async swap<T>(
    kind: ImageKind,
    ownerId: string,
    key: string | null,
    previousKey: string | null,
    save: () => Promise<T>
  ): Promise<T> {
    if (key !== null) await this.verify(kind, ownerId, key);
    const saved = await save();
    if (previousKey && previousKey !== key) await this.remove(previousKey);
    return saved;
  }

  private async verify(kind: ImageKind, ownerId: string, key: unknown) {
    const prefix = imagePrefix(kind, ownerId);
    if (typeof key !== 'string' || !key.startsWith(prefix) || !KEY_NAME.test(key.slice(prefix.length))) {
      throw new BadRequestException('Invalid image key.');
    }
    const { client, bucket } = this.storage();
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })).catch(() => null);
    if (!head) throw new BadRequestException('The image was not uploaded.');
    if (head.ContentType !== CONTENT_TYPE || (head.ContentLength ?? 0) > MAX_IMAGE_BYTES) {
      await this.remove(key);
      throw new BadRequestException(`Images must be WebP and at most ${MAX_IMAGE_BYTES / 1024} KB.`);
    }
  }

  /** Best effort: a leftover object is a few KB of storage, not worth failing the request for. */
  private async remove(key: string) {
    try {
      const { client, bucket } = this.storage();
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (err) {
      this.logger.warn(`Could not delete image ${key}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
