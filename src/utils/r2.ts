// ── R2 File Storage Helpers ───────────────────────────────────────────────────

export interface UploadResult {
  url:   string    // public path: /uploads/<key>
  key:   string
  bytes: number
  name:  string
  type:  string    // 'image' | 'file'
}

/** Upload binary data to R2 and return the public URL path */
export async function uploadToR2(
  bucket:      R2Bucket,
  data:        Uint8Array | ArrayBuffer,
  filename:    string,
  contentType: string,
  folder:      string = 'chat'
): Promise<UploadResult> {
  const ext  = filename.split('.').pop()?.toLowerCase() ?? 'bin'
  const key  = `${folder}/${Date.now()}_${crypto.randomUUID()}.${ext}`
  const bytes = data instanceof ArrayBuffer ? data.byteLength : data.byteLength

  await bucket.put(key, data, {
    httpMetadata: { contentType },
    customMetadata: { originalName: filename },
  })

  return {
    url:   `/uploads/${key}`,
    key,
    bytes,
    name:  filename,
    type:  contentType.startsWith('image/') ? 'image' : 'file',
  }
}

/** Stream an R2 object as a Response (for GET /uploads/* proxy) */
export async function serveR2Object(bucket: R2Bucket, key: string): Promise<Response> {
  const obj = await bucket.get(key)
  if (!obj) return new Response('Not Found', { status: 404 })

  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')

  return new Response(obj.body, { headers })
}

/** Delete a file from R2 by its URL path (/uploads/<key>) */
export async function deleteFromR2(bucket: R2Bucket, urlPath: string): Promise<void> {
  const key = urlPath.replace(/^\/uploads\//, '')
  if (key) await bucket.delete(key)
}

/** Parse multipart/form-data from a Workers Request for file upload */
export async function parseFileUpload(req: Request): Promise<{
  file:        Uint8Array
  filename:    string
  contentType: string
  fields:      Record<string, string>
} | null> {
  try {
    const formData = await req.formData()
    const fileField = formData.get('file') as File | null
    if (!fileField) return null

    const buffer   = await fileField.arrayBuffer()
    const fields: Record<string, string> = {}
    for (const [key, val] of formData.entries()) {
      if (key !== 'file' && typeof val === 'string') fields[key] = val
    }

    return {
      file:        new Uint8Array(buffer),
      filename:    fileField.name,
      contentType: fileField.type || 'application/octet-stream',
      fields,
    }
  } catch {
    return null
  }
}
