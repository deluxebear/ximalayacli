import { createHash, createHmac } from "node:crypto";

// This is the public signing constant distributed in the site's upload SDK,
// not an account credential or an upload token.
const SDK_KEY = Buffer.from("L2hRdnBpQzJT", "base64");
const SIGNED_HEADERS = [
  "x-xfm-app-key",
  "x-xfm-timestamp",
  "x-xfm-upload-type",
];
const TYPE_ALIASES = {
  audio: "tingAudio",
  video: "tingVideo",
  enterpriseNoLogoVideo: "enterpriseNoLogoVideo",
};

export function canonicalUploadQuery(query = {}) {
  const lower = {};
  for (const key of Object.keys(query)) lower[key.toLowerCase()] = query[key];
  return Object.keys(lower)
    .sort()
    .map((key) => `${key}=${lower[key]}`)
    .join("&");
}

export function signUploadRequest({
  fileName,
  uploadType = "tingWebAudio",
  appKey = "tingWeb",
  serverIp = "",
  query,
  body,
  timestamp = Date.now(),
}) {
  const headers = {
    "x-xfm-timestamp": String(timestamp),
    "x-xfm-app-key": appKey,
    "x-xfm-upload-type": TYPE_ALIASES[uploadType] || uploadType,
    "x-xfm-upload-file-name": encodeURIComponent(fileName),
    "x-xfm-signature-headers": SIGNED_HEADERS.join(","),
    "x-xfm-upload-single": "false",
    "x-xfm-upload-server-ip": serverIp,
  };
  const digest = body
    ? createHash("md5").update(JSON.stringify(body)).digest("base64")
    : "";
  const canonical = `POST|${digest}|${SIGNED_HEADERS.map((key) => `${key}=${headers[key]}`).join("&")}|${canonicalUploadQuery(query)}`;
  headers["x-xfm-signature"] = createHmac("sha256", SDK_KEY)
    .update(canonical)
    .digest("base64");
  return headers;
}
