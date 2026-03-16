# Running the app in Xcode with Capacitor

This project is wrapped with **Capacitor** so you can build and run the web app inside a native iOS shell and open it in Xcode.

## Prerequisites

- Node.js and npm
- Xcode (with iOS Simulator or a connected device)
- **CocoaPods** (required for `cap add ios`). Install with:
  ```bash
  sudo gem install cocoapods
  ```
  Or see [Capacitor environment setup](https://capacitorjs.com/docs/getting-started/environment-setup#homebrew).

## One-time setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Build the web app** (Expo exports to `dist/`)
   ```bash
   npm run build:web
   ```

3. **Add the iOS platform** (only needed once)
   ```bash
   npx cap add ios
   ```

4. **Sync web build into the native project**
   ```bash
   npm run cap:sync
   ```
   Or: `npx cap sync`

5. **Open in Xcode**
   ```bash
   npm run cap:ios
   ```
   Or: `npx cap open ios`

   Then in Xcode: pick a simulator or device and run (▶).

## After making changes

1. Rebuild the web app:
   ```bash
   npm run build:web
   ```

2. Sync into the iOS project:
   ```bash
   npm run cap:sync
   ```

3. Run again from Xcode (or run `npm run cap:ios` to reopen the project).

## Notes

- **LocalStorage** is used for persisting projects and options; it works in the browser and inside the Capacitor WebView, so data survives refresh and app restarts.
- The app runs the same web bundle in the iOS WebView; no native code changes are required for JS/UI updates, only a new web build and `cap sync`.
