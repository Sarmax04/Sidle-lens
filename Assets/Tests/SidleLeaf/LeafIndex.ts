import {scenariosIndex} from "Leaf.lspkg/Scenarios/decorator/ScenarioIndexDecorator"
import {ScenarioMetadata} from "Leaf.lspkg/Scenarios/scenario/ScenarioMetadata"
import {C1StartStateScenario} from "./C1StartStateScenario"
import {C2MeasureLabelsScenario} from "./C2MeasureLabelsScenario"
import {C3NextPieceScenario} from "./C3NextPieceScenario"
import {C3IKPanelReachScenario} from "./C3IKPanelReachScenario"
import {C4aWallClearanceScenario} from "./C4aWallClearanceScenario"
import {C4bCoffeeTableBlockingScenario} from "./C4bCoffeeTableBlockingScenario"
import {C4cRotateScenario} from "./C4cRotateScenario"
import {C5CompareScenario} from "./C5CompareScenario"

@component
export class LeafIndex extends BaseScriptComponent {
  @scenariosIndex
  static scenariosIndex: ScenarioMetadata[] = [
    {id: "c1-start-state", typename: C1StartStateScenario.getTypeName()},
    {id: "c2-measure-labels", typename: C2MeasureLabelsScenario.getTypeName()},
    {id: "c3-next-piece", typename: C3NextPieceScenario.getTypeName()},
    {id: "c3-ik-panel-reach", typename: C3IKPanelReachScenario.getTypeName()},
    {id: "c4a-wall-clearance", typename: C4aWallClearanceScenario.getTypeName()},
    {id: "c4b-coffee-table-blocking", typename: C4bCoffeeTableBlockingScenario.getTypeName()},
    {id: "c4c-rotate", typename: C4cRotateScenario.getTypeName()},
    {id: "c5-compare", typename: C5CompareScenario.getTypeName()},
  ]
}
