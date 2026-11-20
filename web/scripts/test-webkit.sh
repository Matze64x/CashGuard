#!/bin/sh
# Runs the `iphone` Playwright project (WebKit, Safari's engine) in Microsoft's Playwright image:
# Playwright's WebKit build needs Ubuntu's libraries (ICU 74, …), which e.g. Arch doesn't have.
# The image matches the installed Playwright version. Extra arguments go to `playwright test`.
set -eu
cd "$(dirname "$0")/.."
version=$(node -p "require('@playwright/test/package.json').version")
exec docker run --rm --init --ipc=host \
	--user "$(id -u):$(id -g)" --env HOME=/tmp --env CI \
	--volume "$PWD:/work" --workdir /work \
	"mcr.microsoft.com/playwright:v$version-noble" \
	npx playwright test --project=iphone "$@"
