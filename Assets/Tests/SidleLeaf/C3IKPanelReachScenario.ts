/**
 * Done criteria 2/3/5 (reachability) — an IK avatar physically reaches and pinches the
 * panel buttons (Next, Compare, Measure). LEAF records a diagnostic (scenario error)
 * if a button is out of reach / out of view / occluded.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {createIKInteractor} from "Leaf.lspkg/Interactors/interactor/ik/visualizer/BitmojiAvatar"
import {DiagnosticRecorder} from "Leaf.lspkg/Diagnostic/DiagnosticRecorder"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {interactable, log, resetState} from "./SidleTestHelpers"

@component
export class C3IKPanelReachScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const ik = createIKInteractor()
    await sleep(500)

    await ik.trigger(interactable("NextButton"))
    await sleep(400)
    log(`IK Next -> ${c.currentPieceKey}; diagnostics: ${DiagnosticRecorder.getInstance().toReport()}`)
    expect(c.currentPieceKey, "IK pinch on Next").toBe("Bed")

    await ik.trigger(interactable("NextButton"))
    await sleep(400)
    await ik.trigger(interactable("NextButton"))
    await sleep(400)
    expect(c.currentPieceKey, "IK Next x3 back to Sofa A").toBe("SofaA")

    await ik.trigger(interactable("CompareButton"))
    await sleep(400)
    expect(c.currentPieceKey, "IK pinch on Compare").toBe("SofaB")

    await ik.trigger(interactable("MeasureButton"))
    await sleep(400)
    expect(c.measureOn, "IK pinch on Measure").toBe(true)

    const report = DiagnosticRecorder.getInstance().toReport()
    log(`IK diagnostics report: ${report === "" ? "(none)" : report}`)
    expect(DiagnosticRecorder.getInstance().hasErrors(), `IK reach diagnostics: ${report}`).toBe(false)
    await resetState()
    log("IK done")
  }
}
