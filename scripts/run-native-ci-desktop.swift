import CoreGraphics
import Foundation

// This wrapper changes only a disposable GitHub-hosted virtual desktop, keeps
// the temporary mode alive during the existing guarded native test command,
// then restores the original mode. It never configures an owner's display.
let environment = ProcessInfo.processInfo.environment
guard environment["CI"] == "true", environment["GITHUB_ACTIONS"] == "true",
  environment["RUNNER_ENVIRONMENT"] == "github-hosted"
else {
  fatalError("Native CI desktop sizing requires the isolated GitHub-hosted runner.")
}
let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments == ["pnpm", "test:native:ui", "--", "--foreground", "--desktop-idle"] else {
  fatalError("This wrapper accepts only the repository's guarded native interaction command.")
}
let display = CGMainDisplayID()
guard let original = CGDisplayCopyDisplayMode(display),
  let modes = CGDisplayCopyAllDisplayModes(display, nil) as? [CGDisplayMode]
else { fatalError("The isolated runner has no readable virtual display modes.") }
print(
  "Native CI display modes: \(modes.map { "\($0.width)x\($0.height)" }.joined(separator: ", "))")
guard
  let target = modes.filter({ $0.width >= 1600 && $0.height >= 900 })
    .min(by: { $0.width * $0.height < $1.width * $1.height })
else {
  fatalError("The isolated runner cannot fit the required 980/1180/1380-point actual windows.")
}
let result = CGDisplaySetDisplayMode(display, target, nil)
guard result == .success else {
  fatalError("Temporary native CI display mode failed: \(result.rawValue)")
}
defer { _ = CGDisplaySetDisplayMode(display, original, nil) }
print(
  "Native CI temporary display: \(CGDisplayBounds(display).width)x\(CGDisplayBounds(display).height)"
)
let command = Process()
command.executableURL = URL(fileURLWithPath: "/usr/bin/env")
command.arguments = arguments
try command.run()
command.waitUntilExit()
let status = command.terminationStatus
_ = CGDisplaySetDisplayMode(display, original, nil)
exit(status)
