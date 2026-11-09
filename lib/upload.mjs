import { open, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { basename, extname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { signUploadRequest } from "./upload-sign.mjs";

const UPLOAD_ORIGIN = "https://cupload.ximalaya.com";
const MIME = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".m4a": "audio/x-m4a",
  ".aac": "audio/aac",
  ".aiff": "audio/aiff",
  ".aif": "audio/aiff",
  ".wma": "audio/x-ms-wma",
  ".amr": "audio/amr",
  ".mp2": "audio/mpeg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
};

export function validateUploadOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !/^(?:cupload|upload)(?:[.-][a-z0-9-]+)*\.ximalaya\.com$/i.test(
      url.hostname,
    )
  ) {
    throw new Error("服务端返回了不受信任的上传域名");
  }
  return url.origin;
}

function uploadError(message, safeToRetry = true) {
  const error = new Error(message);
  error.safeToRetry = safeToRetry;
  return error;
}

export class NativeUploader {
  constructor({
    client,
    uid,
    chunkSize = 2 * 1024 * 1024,
    fetchImpl,
    retries = 3,
    pollInterval = 1500,
    onProgress,
  } = {}) {
    if (!client || typeof client.cookie !== "function")
      throw new Error("NativeUploader 需要已登录的 Client");
    if (!Number.isSafeInteger(Number(uid)) || Number(uid) <= 0)
      throw new Error("上传需要有效账号 UID");
    if (!Number.isSafeInteger(chunkSize) || chunkSize < 1048576)
      throw new Error("chunkSize 不得小于 1 MiB");
    this.client = client;
    this.uid = Number(uid);
    this.chunkSize = chunkSize;
    this.fetch = fetchImpl || client.fetch || fetch;
    this.retries = retries;
    this.pollInterval = pollInterval;
    this.onProgress = onProgress;
  }

  async request(
    url,
    { method = "POST", headers = {}, body, signal, retries = 0 } = {},
  ) {
    const target = new URL(url);
    validateUploadOrigin(target.origin);
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await this.fetch(target, {
          method,
          headers: {
            accept: "application/json",
            origin: "https://www.ximalaya.com",
            referer:
              "https://www.ximalaya.com/reform-upload/page/webCenter/upload",
            cookie: this.client.cookie(target),
            ...headers,
          },
          body,
          redirect: "manual",
          signal: AbortSignal.any([
            signal || new AbortController().signal,
            AbortSignal.timeout(120000),
          ]),
        });
      } catch {
        if (signal?.aborted || attempt >= retries)
          throw uploadError("上传网络请求失败");
      }
      if (
        attempt < retries &&
        (!response || [429, 500, 502, 503, 504].includes(response.status))
      ) {
        await delay(Math.min(500 * 2 ** attempt, 5000), undefined, { signal });
        continue;
      }
      if (!response) throw uploadError("上传网络请求失败");
      if (!response.ok)
        throw uploadError(`上传接口返回 HTTP ${response.status}`);
      let data;
      try {
        data = await response.json();
      } catch {
        throw uploadError("上传接口未返回 JSON");
      }
      if (data.code === "100019" && attempt < retries) {
        await delay(Math.min(500 * 2 ** attempt, 5000), undefined, { signal });
        continue;
      }
      return data;
    }
  }

  async upload(file, { timeout = 600000, type = "audio" } = {}) {
    const info = await stat(file);
    if (!info.isFile() || info.size <= 0 || info.size > 1073741824)
      throw uploadError("上传文件必须为非空文件且不大于 1 GiB");
    const fileName = basename(file),
      extension = extname(file).toLowerCase();
    const uploadType = type === "image" ? "tingWebImage" : "tingWebAudio";
    if (!MIME[extension]) throw uploadError("不支持的上传文件格式");
    const signal = AbortSignal.timeout(timeout);
    const hash = createHash("md5");
    for await (const bytes of createReadStream(file, { signal }))
      hash.update(bytes);
    const fileMd5 = hash.digest("hex");
    const traceId = `${Date.now()}-${randomUUID()}&&${randomUUID()}`;
    const tokenResult = await this.request(
      `${UPLOAD_ORIGIN}/clamper-token/token`,
      {
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "x-tId": traceId,
        },
        body: new URLSearchParams({
          fileName,
          fileSize: String(info.size),
          uploadType,
          callerType: "tingWeb",
        }).toString(),
        signal,
        retries: this.retries,
      },
    );
    if (tokenResult.ret !== 0 || !tokenResult.token)
      throw uploadError(`获取上传令牌失败：${tokenResult.ret ?? "无状态码"}`);
    const origin = tokenResult.newTx
      ? validateUploadOrigin(
          String(tokenResult.uploadDomain).replace(/^http:\/\//, "https://"),
        )
      : UPLOAD_ORIGIN;
    const ctxList = [];
    let multipartId = "",
      serverIp = "";
    const chunks = Math.ceil(info.size / this.chunkSize);
    const handle = await open(file, "r");
    try {
      for (let chunk = 0; chunk < chunks; chunk++) {
        const length = Math.min(
          this.chunkSize,
          info.size - chunk * this.chunkSize,
        );
        const bytes = Buffer.allocUnsafe(length);
        let read = 0;
        while (read < length) {
          const { bytesRead } = await handle.read(
            bytes,
            read,
            length - read,
            chunk * this.chunkSize + read,
          );
          if (!bytesRead) throw uploadError("读取上传文件时内容发生变化");
          read += bytesRead;
        }
        const query = {
          id: "WU_FILE_0",
          name: fileName,
          type: MIME[extension],
          lastModifiedDate: new Date(info.mtimeMs).toString(),
          size: info.size,
          timeStart: Date.now(),
          chunks,
          chunk,
          multipartId: chunk === 0 ? "" : multipartId,
          md5: chunk === 0 ? fileMd5 : "",
          uid: this.uid,
        };
        const url = new URL("/upload/file/blk", origin);
        for (const [key, value] of Object.entries(query))
          url.searchParams.set(key, String(value));
        const headers = signUploadRequest({
          fileName,
          uploadType,
          serverIp,
          query,
        });
        const result = await this.request(url, {
          headers: {
            ...headers,
            Authorization: tokenResult.token,
            "x-tId": traceId,
            "content-type": "application/octet-stream",
          },
          body: bytes,
          signal,
          retries: this.retries,
        });
        if (result.code !== "000000" || !result.data?.ctx)
          throw uploadError(`音频分片上传失败：${result.code ?? "无状态码"}`);
        if (chunk === 0) multipartId = result.data.multipartId || "";
        serverIp = result.data.serverIp || serverIp;
        ctxList.push(result.data.ctx);
        await this.onProgress?.({
          chunk: chunk + 1,
          chunks,
          bytes: Math.min((chunk + 1) * this.chunkSize, info.size),
          total: info.size,
        });
      }
    } finally {
      await handle.close();
    }
    const body = {
      uid: this.uid,
      uploadType,
      appkey: "tingWeb",
      fileSize: info.size,
      fileExtName: extension.slice(1),
      fileName: encodeURIComponent(fileName),
      deviceType: "web",
      clientIp: "",
      ctxList,
      multipartId,
      codeOrNot: "1",
    };
    const headers = signUploadRequest({ fileName, uploadType, serverIp, body });
    let result;
    try {
      result = await this.request(`${origin}/upload/merge/mkfile`, {
        headers: {
          ...headers,
          Authorization: tokenResult.token,
          "x-tId": traceId,
          "content-type": "application/json;charset=utf-8",
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      // The server may have accepted a merge whose response was lost. The SDK
      // queries the merge signature rather than blindly submitting it again.
      result = await this.pollMerge(origin, headers["x-xfm-signature"], signal);
    }
    if (result.code === "100016")
      result = await this.pollMerge(origin, headers["x-xfm-signature"], signal);
    if (result.code !== "000000" || !result.data?.uploadId)
      throw uploadError(`文件合并失败：${result.code ?? "无状态码"}`);
    return {
      ok: true,
      uploadId: result.data.uploadId,
      fileExtName: result.data.fileExtName,
      storageId: result.data.storageId,
      duration: result.data.metaInfo?.duration,
      size: result.data.metaInfo?.size,
      transport: "native",
    };
  }

  async pollMerge(origin, signature, signal) {
    for (let attempt = 0; attempt < 200; attempt++) {
      await delay(this.pollInterval, undefined, { signal });
      const url = new URL("/upload/merge/status", origin);
      url.searchParams.set("statusKey", signature);
      const result = await this.request(url, {
        method: "GET",
        signal,
        retries: this.retries,
      });
      if (result.code !== "100016") return result;
    }
    throw uploadError("等待文件合并超时");
  }
}
