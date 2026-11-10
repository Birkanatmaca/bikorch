import { BIKORCH_IPHONE_NAME } from './devices'

/**
 * Told to Claude Code sessions Bikorch starts on a Mac, so "run it in the
 * simulator" lands in Bikorch's iOS panel instead of opening Simulator.app or
 * Xcode on top of everything. Bikorch notices the install and opens the panel.
 */
export const IOS_AGENT_GUIDE = `You are running inside Bikorch, a desktop app that shows the iOS Simulator in its own side panel, with no Simulator.app window.
When the user asks to run, open, install or test an iOS app (or a game) in the simulator:
- Device: use the booted iPhone (\`xcrun simctl list devices booted\`). If none is booted, boot the one named "${BIKORCH_IPHONE_NAME}" (or any available iPhone) with \`xcrun simctl boot <udid>\`. Keep using that one device.
- Build from the command line for that device, e.g. \`xcodebuild -workspace/-project … -scheme … -configuration Debug -destination "id=<udid>" -derivedDataPath <dir> build\`.
- Install and launch it yourself: \`xcrun simctl install <udid> <path/App.app>\` then \`xcrun simctl launch <udid> <bundle id>\`. Bikorch opens its iOS panel on that device by itself.
- Do not run \`open -a Simulator\` and do not open Xcode.app or Simulator.app unless the user explicitly asks for that window. \`npx expo run:ios\` and \`npx react-native run-ios\` open Simulator.app on their own: build with xcodebuild instead (after \`npx expo prebuild\` / \`pod install\` if needed) and start Metro separately (\`npx expo start --dev-client\` or \`npx react-native start\`).
- To see the screen, use \`xcrun simctl io <udid> screenshot <file.png>\`. Leave the simulator running when you are done; Bikorch manages it.`
