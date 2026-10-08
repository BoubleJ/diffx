#!/usr/bin/env bash
set -euo pipefail

bump="${1:-}"
case "$bump" in
  patch | minor | major) ;;
  *)
    echo "사용법: pnpm run release <patch|minor|major>" >&2
    exit 1
    ;;
esac

if [ "$(git branch --show-current)" != "main" ]; then
  echo "main 브랜치에서 실행해 주세요" >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "커밋하지 않은 변경사항이 있습니다" >&2
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "gh auth login 으로 GitHub에 로그인해 주세요" >&2
  exit 1
fi

pnpm version "$bump" -m "chore: v%s 버전업"
version="$(node -p "require('./package.json').version")"
tag="v$version"

if ! pnpm test || ! pnpm run build:app; then
  git tag -d "$tag"
  git reset --hard HEAD~1
  echo "테스트나 빌드가 실패해서 $tag 버전업을 되돌렸습니다" >&2
  exit 1
fi

previous="$(git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' HEAD~1 2>/dev/null || true)"
if [ -n "$previous" ]; then
  notes="$(git log "$previous..HEAD~1" --pretty='- %s')"
else
  notes="첫 릴리스"
fi

git push origin main --follow-tags

zip="release/reviewHelper-$version.zip"
if ! gh release create "$tag" "$zip" --repo BoubleJ/reviewhelper --title "$tag" --notes "$notes"; then
  echo "Release를 만들지 못했습니다. 아래 명령으로 다시 실행해 주세요" >&2
  printf 'gh release create %q %q --repo BoubleJ/reviewhelper --title %q --notes %q\n' "$tag" "$zip" "$tag" "$notes" >&2
  exit 1
fi

rm -rf release
echo "$tag 릴리스를 올렸습니다"
