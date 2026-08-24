#!/bin/bash
# Tabby 二次开发环境搭建（含国内网络绕行）
# 用法: bash setup-dev.sh
set -e
cd "$(dirname "$0")"

MIRROR="https://registry.npmmirror.com"

# ── 1. GitHub 绕行：把 git 拉取重写到 gh-proxy 镜像 ──────────────────
# 仅通过环境变量生效，不写入 ~/.gitconfig，退出即失效。
# 必需原因：yarn 解析 node-gyp 时会 `git ls-remote https://github.com/electron/node-gyp`
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0='url.https://gh-proxy.com/https://github.com/.insteadOf'
export GIT_CONFIG_VALUE_0='https://github.com/'

echo "==> git URL 重写已启用: github.com -> gh-proxy.com"

# ── 2. scripts/vars.mjs 需要 git describe --tags ────────────────────
# zip 解压的目录没有 .git，vars.mjs 会 fatal，导致 yarn build 失败
if [ ! -d .git ]; then
    echo "==> 未检测到 .git，初始化并打 tag（vars.mjs 依赖 git describe --tags）"
    git init -q
    git add -A >/dev/null 2>&1 || true
    git -c user.email=dev@local -c user.name=dev commit -qm "baseline" >/dev/null 2>&1 || true
    git tag v1.0.231
else
    if ! git describe --tags >/dev/null 2>&1; then
        echo "==> 有 .git 但没有可用 tag，补一个 v1.0.231"
        git tag v1.0.231
    fi
fi
echo "==> git describe --tags = $(git describe --tags)"

# ── 3. 安装依赖（含原生模块编译：node-pty / keytar / russh / serialport）──
echo "==> yarn install（根目录，会编译原生模块，耗时较长）"
yarn install --registry="$MIRROR" --network-timeout 600000

# ── 4. 构建 typings + 全部插件 ──────────────────────────────────────
echo "==> yarn build"
yarn build

echo
echo "===================================================="
echo " 完成。启动 Tabby："
echo "   yarn start          # 开发模式（TABBY_DEV=1，带 DevTools）"
echo
echo " 改前端代码时开两个终端："
echo "   yarn watch          # 终端 A：webpack 监听重编译"
echo "   yarn start          # 终端 B：启动 app，改完 Cmd+R 刷新"
echo "===================================================="
