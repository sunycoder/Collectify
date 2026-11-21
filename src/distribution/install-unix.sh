#!/bin/sh
# 参数均通过 argv 传递，禁止 eval。失败时保留/恢复旧程序并重新打开。
set -eu
kind=$1; parent=$2; installer=$3; target=$4; executable=$5; digest=$6; size=$7; job=$8; result=$9
shift 9
version=$1
committed=0
mount="$job/mount"
staging="${target}.collectify-new-$$"
backup="${target}.collectify-previous"
save_result() { printf '{"version":"%s","status":"%s","job":"%s"}\n' "$version" "$1" "${job##*/}" > "$result"; }
finish() {
    code=$?
    trap - EXIT HUP INT TERM
    if [ "$code" -ne 0 ]; then
        # 仅恢复本次明确命名的备份，绝不删除用户数据目录。
        if [ -e "$backup" ] && [ ! -e "$target" ]; then mv "$backup" "$target" || true; fi
        save_result error
    fi
    if [ "$kind" = dmg ] && [ -d "$mount" ]; then /usr/bin/hdiutil detach "$mount" -quiet || true; fi
    if [ "$committed" -eq 1 ]; then
        if [ "$kind" = dmg ]; then /usr/bin/open "$target" || true
        else "$target" >/dev/null 2>&1 &
        fi
    fi
    exit "$code"
}
trap finish EXIT
trap 'exit 1' HUP INT TERM
: > "$job/ready"
attempt=0
while [ "$attempt" -lt 120 ]; do
    [ ! -f "$job/cancel" ] || exit 0
    if ! kill -0 "$parent" 2>/dev/null && [ -f "$job/commit" ]; then committed=1; break; fi
    sleep 1
    attempt=$((attempt + 1))
done
[ "$committed" -eq 1 ] || exit 1
[ "$(wc -c < "$installer" | tr -d ' ')" = "$size" ]
if [ "$kind" = dmg ]; then actual=$(/usr/bin/shasum -a 256 "$installer" | cut -d ' ' -f 1)
else actual=$(sha256sum "$installer" | cut -d ' ' -f 1)
fi
[ "$actual" = "$digest" ]
case "$kind" in
    dmg)
        mkdir "$mount"
        /usr/bin/hdiutil attach "$installer" -readonly -nobrowse -mountpoint "$mount" -quiet
        source="$mount/Collectify.app"
        [ -d "$source" ]
        # 只接受同一应用、目标版本。保留隔离属性，继续由 Gatekeeper 执行系统检查。
        [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$source/Contents/Info.plist")" = com.collectify.desktop ]
        [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$source/Contents/Info.plist")" = "$version" ]
        [ -w "$(dirname "$target")" ]
        /usr/bin/ditto "$source" "$staging"
        # 固定保留一份上个版本；该路径只能由实际应用路径加固定后缀得到。
        if [ -d "$backup" ]; then /bin/rm -rf "$backup"; fi
        mv "$target" "$backup"
        if ! mv "$staging" "$target"; then mv "$backup" "$target"; exit 1; fi
        ;;
    AppImage)
        [ -f "$target" ] && [ -w "$target" ] && [ -w "$(dirname "$target")" ]
        cp "$installer" "$staging"
        chmod 755 "$staging"
        if [ -f "$backup" ]; then rm -f "$backup"; fi
        mv "$target" "$backup"
        if ! mv "$staging" "$target"; then mv "$backup" "$target"; exit 1; fi
        ;;
    deb)
        # 包管理器持有文件；不直接覆盖 /opt，不绕过 Linux 的系统授权。
        command -v pkexec >/dev/null
        pkexec /usr/bin/dpkg -i "$installer"
        ;;
    *) exit 1 ;;
esac
save_result success
