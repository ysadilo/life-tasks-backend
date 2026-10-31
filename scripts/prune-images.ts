/** Deletes avatar/cover objects in R2 that no user or board references. Dry run unless --delete is passed. */
import { PrismaClient } from '@prisma/client';
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

const GRACE_MS = 60 * 60 * 1000; // spares uploads the user hasn't confirmed yet
const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  throw new Error('R2_* env vars are not set');
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});
const prisma = new PrismaClient();

async function main() {
  const used = new Set([
    ...(await prisma.user.findMany({ select: { avatarKey: true } })).map((u) => u.avatarKey),
    ...(await prisma.board.findMany({ select: { coverKey: true } })).map((b) => b.coverKey),
  ]);

  const orphans: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, ContinuationToken: token }));
    for (const o of page.Contents ?? []) {
      if (o.Key && !used.has(o.Key) && o.LastModified && o.LastModified.getTime() < Date.now() - GRACE_MS) {
        orphans.push(o.Key);
      }
    }
    token = page.NextContinuationToken;
  } while (token);

  console.log(`${orphans.length} orphaned objects${orphans.length ? `:\n${orphans.join('\n')}` : ''}`);
  if (!process.argv.includes('--delete')) return console.log('Dry run, pass --delete to remove them.');

  for (let i = 0; i < orphans.length; i += 1000) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: R2_BUCKET,
        Delete: { Objects: orphans.slice(i, i + 1000).map((Key) => ({ Key })) },
      })
    );
  }
  console.log('Deleted.');
}

main().finally(() => prisma.$disconnect());
