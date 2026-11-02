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
import {C6ImportedCycleScenario} from "./C6ImportedCycleScenario"
import {C7ImportedFitScenario} from "./C7ImportedFitScenario"
import {C8PanelSourceScenario} from "./C8PanelSourceScenario"
import {C9MissingModelScenario} from "./C9MissingModelScenario"
import {C10NoPlaceholdersScenario} from "./C10NoPlaceholdersScenario"
import {C11WrapGreyedScenario} from "./C11WrapGreyedScenario"
import {C12BedsChairsScenario} from "./C12BedsChairsScenario"
import {C13PanelDefaultScenario} from "./C13PanelDefaultScenario"
import {C14PanelDragScenario} from "./C14PanelDragScenario"
import {C15GapLabelViewScenario} from "./C15GapLabelViewScenario"
import {C16GalleryOpenScenario} from "./C16GalleryOpenScenario"
import {C17GalleryTabsScenario} from "./C17GalleryTabsScenario"
import {C18GallerySelectScenario} from "./C18GallerySelectScenario"
import {C19GalleryThumbsScenario} from "./C19GalleryThumbsScenario"

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
    {id: "c6-imported-cycle", typename: C6ImportedCycleScenario.getTypeName()},
    {id: "c7-imported-fit", typename: C7ImportedFitScenario.getTypeName()},
    {id: "c8-panel-source", typename: C8PanelSourceScenario.getTypeName()},
    {id: "c9-missing-model", typename: C9MissingModelScenario.getTypeName()},
    {id: "c10-no-placeholders", typename: C10NoPlaceholdersScenario.getTypeName()},
    {id: "c11-wrap-greyed", typename: C11WrapGreyedScenario.getTypeName()},
    {id: "c12-beds-chairs", typename: C12BedsChairsScenario.getTypeName()},
    {id: "c13-panel-default", typename: C13PanelDefaultScenario.getTypeName()},
    {id: "c14-panel-drag", typename: C14PanelDragScenario.getTypeName()},
    {id: "c15-gap-label-view", typename: C15GapLabelViewScenario.getTypeName()},
    {id: "c16-gallery-open", typename: C16GalleryOpenScenario.getTypeName()},
    {id: "c17-gallery-tabs", typename: C17GalleryTabsScenario.getTypeName()},
    {id: "c18-gallery-select", typename: C18GallerySelectScenario.getTypeName()},
    {id: "c19-gallery-thumbs", typename: C19GalleryThumbsScenario.getTypeName()},
  ]
}
