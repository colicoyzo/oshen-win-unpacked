#!/usr/bin/env bash
# 发布 GitHub Release 并上传附件
# 用法：GH_TOKEN=ghp_xxx bash publish-release.sh
set -euo pipefail

OWNER="colicoyzo"
REPO="oshen-win-unpacked"
TAG="v1.0.0"
NAME="o神套装-文件名修改器 v1.0.0"
ASSET="dist/oshen-renamer-1.0.0-win-x64.zip"
NOTES="docs/release-notes-v1.0.0.md"
API="https://api.github.com/repos/${OWNER}/${REPO}"

: "${GH_TOKEN:?请先设置 GH_TOKEN 环境变量（需 contents:write 权限）}"

if [ ! -f "$ASSET" ]; then
  echo "找不到附件：$ASSET" >&2
  exit 1
fi

echo "==> 1/3 检查是否已存在同名 release"
EXIST_ID=$(curl -sS -H "Authorization: Bearer ${GH_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "${API}/releases/tags/${TAG}" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try{const j=JSON.parse(s);process.stdout.write(j.id?String(j.id):'')}catch(e){}
});")

if [ -n "$EXIST_ID" ]; then
  echo "    release 已存在 (id=${EXIST_ID})，将复用它并补充附件"
  REL_ID="$EXIST_ID"
else
  echo "==> 2/3 创建 release ${TAG}"
  # 注意：Node 不识别 Git Bash 的 /tmp，统一用当前目录下的临时文件
  PAYLOAD="./.rel-payload.json"
  node -e "
    const fs=require('fs');
    const body=fs.readFileSync('${NOTES}','utf8');
    fs.writeFileSync('${PAYLOAD}', JSON.stringify({
      tag_name:'${TAG}',
      name:'${NAME}',
      body,
      draft:false,
      prerelease:false
    }));
  "
  RESP=$(curl -sS -X POST \
    -H "Authorization: Bearer ${GH_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "Content-Type: application/json" \
    --data-binary @"${PAYLOAD}" \
    "${API}/releases")
  rm -f "$PAYLOAD"
  REL_ID=$(printf '%s' "$RESP" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try{const j=JSON.parse(s);if(!j.id){console.error(s);process.exit(1)}process.stdout.write(String(j.id))}
  catch(e){console.error(s);process.exit(1)}
});")
  echo "    创建成功 id=${REL_ID}"
fi

echo "==> 3/3 上传附件 $(basename "$ASSET")（约 110MB，请稍候）"
UPLOAD="https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${REL_ID}/assets?name=$(basename "$ASSET")"
OUT=$(curl -sS -X POST \
  -H "Authorization: Bearer ${GH_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/zip" \
  --data-binary @"$ASSET" \
  "$UPLOAD")

printf '%s' "$OUT" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  let j;try{j=JSON.parse(s)}catch(e){console.error('响应解析失败:',s.slice(0,400));process.exit(1)}
  if(j.browser_download_url){
    console.log('    上传成功');
    console.log('    大小:', (j.size/1048576).toFixed(1)+' MB');
    console.log('    下载:', j.browser_download_url);
  } else {
    console.error('    上传失败:', j.message||s.slice(0,400));
    process.exit(1);
  }
});"

echo ""
echo "Release 页面: https://github.com/${OWNER}/${REPO}/releases/tag/${TAG}"
