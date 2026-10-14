import fs from 'node:fs';
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.js';

const { bucket, accountId, accessKeyId, secretAccessKey } = config.r2;

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

export async function uploadFile(key, filePath, onProgress) {
  const upload = new Upload({
    client: s3,
    params: { Bucket: bucket, Key: key, Body: fs.createReadStream(filePath) },
    partSize: 8 * 1024 * 1024,
    queueSize: 2,
  });
  if (onProgress) upload.on('httpUploadProgress', (p) => onProgress(p.loaded ?? 0));
  await upload.done();
}

export async function listFiles() {
  const out = [];
  let token;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
    );
    for (const o of r.Contents || []) {
      out.push({ key: o.Key, size: o.Size, modified: o.LastModified });
    }
    token = r.NextContinuationToken;
  } while (token);
  return out;
}

export function downloadUrl(key) {
  const name = key.split('/').pop();
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    }),
    { expiresIn: 3600 },
  );
}

// Deletes a single key, or every key under `prefix/` when folder is true.
export async function deleteKeys(keys) {
  for (let i = 0; i < keys.length; i += 1000) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })) },
      }),
    );
  }
}
