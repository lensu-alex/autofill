#!/bin/sh
# Builds dist/AutoFill.app (needs the Xcode command line tools). Run `node build.mjs` first.
set -e
cd "$(dirname "$0")/.."
if [ -d dist/AutoFill.app ]; then mv dist/AutoFill.app "dist/.old-$(date +%s).app"; fi
mkdir -p dist/AutoFill.app/Contents/MacOS dist/AutoFill.app/Contents/Resources
swiftc -O app/main.swift -o dist/AutoFill.app/Contents/MacOS/AutoFill -framework AppKit -framework WebKit
cp autofill.html dist/AutoFill.app/Contents/Resources/
if [ -f autofill-smart.js ]; then cp autofill-smart.js dist/AutoFill.app/Contents/Resources/; fi
cp app/Info.plist dist/AutoFill.app/Contents/Info.plist
codesign --force --deep -s - dist/AutoFill.app
echo "built dist/AutoFill.app"
