import XCTest
final class ScrollTopTests: XCTestCase {
 func testPasteEventAfterNativeBlankLines() {
  continueAfterFailure=false
  let app=XCUIApplication(bundleIdentifier:"com.apple.mobilesafari")
  app.activate()
  let editor=app.textViews["New prompt"].firstMatch
  XCTAssertTrue(editor.waitForExistence(timeout:30), app.debugDescription)
  editor.tap()
  app.typeText("Previously written half prompt\n\n")
  sleep(2)
  // Native keyboard entry creates the real WebKit DIV/BR caret layout. Feed a
  // controlled clipboard event to the production handler; no DOM text injection.
  // The system edit menu itself is not asserted by this regression fixture.
  app.buttons["QC clipboard paste"].tap()
  let success=app.staticTexts["PASTE_QC_SUCCESS"]
  XCTAssertTrue(success.waitForExistence(timeout:10),app.debugDescription)
  sleep(3)
  XCTAssertTrue(success.exists,"Pasted text must remain stable after draft persistence")
  let shot=XCTAttachment(screenshot:XCUIScreen.main.screenshot());shot.name="paste-event-after-native-two-newlines";shot.lifetime = .keepAlways;add(shot)
 }
}
