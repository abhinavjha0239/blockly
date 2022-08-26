/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Class that controls updates to connections during drags.
 *
 * @class
 */
import * as goog from '../closure/goog/goog.js';
goog.declareModuleId('Blockly.InsertionMarkerManager');

import * as blockAnimations from './block_animations.js';
import type {BlockSvg} from './block_svg.js';
import * as common from './common.js';
import {ComponentManager} from './component_manager.js';
import {config} from './config.js';
import {ConnectionType} from './connection_type.js';
import * as constants from './constants.js';
import * as eventUtils from './events/utils.js';
import type {IDeleteArea} from './interfaces/i_delete_area.js';
import type {IDragTarget} from './interfaces/i_drag_target.js';
import type {RenderedConnection} from './rendered_connection.js';
import type {Coordinate} from './utils/coordinate.js';
import type {WorkspaceSvg} from './workspace_svg.js';


/** Represents a nearby valid connection. */
interface CandidateConnection {
  closest: RenderedConnection|null;
  local: RenderedConnection|null;
  radius: number;
}

/**
 * An error message to throw if the block created by createMarkerBlock_ is
 * missing any components.
 */
const DUPLICATE_BLOCK_ERROR = 'The insertion marker ' +
    'manager tried to create a marker but the result is missing %1. If ' +
    'you are using a mutator, make sure your domToMutation method is ' +
    'properly defined.';

/**
 * Class that controls updates to connections during drags.  It is primarily
 * responsible for finding the closest eligible connection and highlighting or
 * unhighlighting it as needed during a drag.
 *
 * @alias Blockly.InsertionMarkerManager
 */
export class InsertionMarkerManager {
  private readonly topBlock_: BlockSvg;
  private readonly workspace_: WorkspaceSvg;

  /**
   * The last connection on the stack, if it's not the last connection on the
   * first block.
   * Set in initAvailableConnections, if at all.
   */
  // AnyDuringMigration because:  Type 'null' is not assignable to type
  // 'RenderedConnection'.
  private lastOnStack_: RenderedConnection = null as AnyDuringMigration;

  /**
   * The insertion marker corresponding to the last block in the stack, if
   * that's not the same as the first block in the stack.
   * Set in initAvailableConnections, if at all
   */
  // AnyDuringMigration because:  Type 'null' is not assignable to type
  // 'BlockSvg'.
  private lastMarker_: BlockSvg = null as AnyDuringMigration;
  private firstMarker_: BlockSvg;

  /**
   * The connection that this block would connect to if released immediately.
   * Updated on every mouse move.
   * This is not on any of the blocks that are being dragged.
   */
  // AnyDuringMigration because:  Type 'null' is not assignable to type
  // 'RenderedConnection'.
  private closestConnection_: RenderedConnection = null as AnyDuringMigration;

  /**
   * The connection that would connect to this.closestConnection_ if this
   * block were released immediately. Updated on every mouse move. This is on
   * the top block that is being dragged or the last block in the dragging
   * stack.
   */
  // AnyDuringMigration because:  Type 'null' is not assignable to type
  // 'RenderedConnection'.
  private localConnection_: RenderedConnection = null as AnyDuringMigration;

  /**
   * Whether the block would be deleted if it were dropped immediately.
   * Updated on every mouse move.
   */
  private wouldDeleteBlock_ = false;

  /**
   * Connection on the insertion marker block that corresponds to
   * this.localConnection_ on the currently dragged block.
   */
  // AnyDuringMigration because:  Type 'null' is not assignable to type
  // 'RenderedConnection'.
  private markerConnection_: RenderedConnection = null as AnyDuringMigration;

  /** The block that currently has an input being highlighted, or null. */
  // AnyDuringMigration because:  Type 'null' is not assignable to type
  // 'BlockSvg'.
  private highlightedBlock_: BlockSvg = null as AnyDuringMigration;

  /** The block being faded to indicate replacement, or null. */
  // AnyDuringMigration because:  Type 'null' is not assignable to type
  // 'BlockSvg'.
  private fadedBlock_: BlockSvg = null as AnyDuringMigration;
  private availableConnections_: RenderedConnection[];

  /** @param block The top block in the stack being dragged. */
  constructor(block: BlockSvg) {
    common.setSelected(block);

    /**
     * The top block in the stack being dragged.
     * Does not change during a drag.
     */
    this.topBlock_ = block;

    /**
     * The workspace on which these connections are being dragged.
     * Does not change during a drag.
     */
    this.workspace_ = block.workspace;

    /**
     * The insertion marker that shows up between blocks to show where a block
     * would go if dropped immediately.
     */
    this.firstMarker_ = this.createMarkerBlock_(this.topBlock_);

    /**
     * The connections on the dragging blocks that are available to connect to
     * other blocks.  This includes all open connections on the top block, as
     * well as the last connection on the block stack. Does not change during a
     * drag.
     */
    this.availableConnections_ = this.initAvailableConnections_();
  }

  /**
   * Sever all links from this object.
   *
   * @internal
   */
  dispose() {
    this.availableConnections_.length = 0;

    eventUtils.disable();
    try {
      if (this.firstMarker_) {
        this.firstMarker_.dispose();
      }
      if (this.lastMarker_) {
        this.lastMarker_.dispose();
      }
    } finally {
      eventUtils.enable();
    }
  }

  /**
   * Update the available connections for the top block. These connections can
   * change if a block is unplugged and the stack is healed.
   *
   * @internal
   */
  updateAvailableConnections() {
    this.availableConnections_ = this.initAvailableConnections_();
  }

  /**
   * Return whether the block would be deleted if dropped immediately, based on
   * information from the most recent move event.
   *
   * @returns True if the block would be deleted if dropped immediately.
   * @internal
   */
  wouldDeleteBlock(): boolean {
    return this.wouldDeleteBlock_;
  }

  /**
   * Return whether the block would be connected if dropped immediately, based
   * on information from the most recent move event.
   *
   * @returns True if the block would be connected if dropped immediately.
   * @internal
   */
  wouldConnectBlock(): boolean {
    return !!this.closestConnection_;
  }

  /**
   * Connect to the closest connection and render the results.
   * This should be called at the end of a drag.
   *
   * @internal
   */
  applyConnections() {
    if (this.closestConnection_) {
      // Don't fire events for insertion markers.
      eventUtils.disable();
      this.hidePreview_();
      eventUtils.enable();
      // Connect two blocks together.
      // AnyDuringMigration because:  Argument of type 'RenderedConnection' is
      // not assignable to parameter of type 'Connection'.
      this.localConnection_.connect(
          this.closestConnection_ as AnyDuringMigration);
      if (this.topBlock_.rendered) {
        // Trigger a connection animation.
        // Determine which connection is inferior (lower in the source stack).
        const inferiorConnection = this.localConnection_.isSuperior() ?
            this.closestConnection_ :
            this.localConnection_;
        blockAnimations.connectionUiEffect(inferiorConnection.getSourceBlock());
        // Bring the just-edited stack to the front.
        const rootBlock = this.topBlock_.getRootBlock();
        rootBlock.bringToFront();
      }
    }
  }

  /**
   * Update connections based on the most recent move location.
   *
   * @param dxy Position relative to drag start, in workspace units.
   * @param dragTarget The drag target that the block is currently over.
   * @internal
   */
  update(dxy: Coordinate, dragTarget: IDragTarget|null) {
    const candidate = this.getCandidate_(dxy);

    this.wouldDeleteBlock_ = this.shouldDelete_(candidate, dragTarget);

    const shouldUpdate =
        this.wouldDeleteBlock_ || this.shouldUpdatePreviews_(candidate, dxy);

    if (shouldUpdate) {
      // Don't fire events for insertion marker creation or movement.
      eventUtils.disable();
      this.maybeHidePreview_(candidate);
      this.maybeShowPreview_(candidate);
      eventUtils.enable();
    }
  }

  /**
   * Create an insertion marker that represents the given block.
   *
   * @param sourceBlock The block that the insertion marker will represent.
   * @returns The insertion marker that represents the given block.
   */
  private createMarkerBlock_(sourceBlock: BlockSvg): BlockSvg {
    const imType = sourceBlock.type;

    eventUtils.disable();
    let result: BlockSvg;
    try {
      result = this.workspace_.newBlock(imType);
      result.setInsertionMarker(true);
      if (sourceBlock.saveExtraState) {
        const state = sourceBlock.saveExtraState();
        if (state && result.loadExtraState) {
          result.loadExtraState(state);
        }
      } else if (sourceBlock.mutationToDom) {
        const oldMutationDom = sourceBlock.mutationToDom();
        if (oldMutationDom && result.domToMutation) {
          result.domToMutation(oldMutationDom);
        }
      }
      // Copy field values from the other block.  These values may impact the
      // rendered size of the insertion marker.  Note that we do not care about
      // child blocks here.
      for (let i = 0; i < sourceBlock.inputList.length; i++) {
        const sourceInput = sourceBlock.inputList[i];
        if (sourceInput.name === constants.COLLAPSED_INPUT_NAME) {
          continue;  // Ignore the collapsed input.
        }
        const resultInput = result.inputList[i];
        if (!resultInput) {
          throw new Error(DUPLICATE_BLOCK_ERROR.replace('%1', 'an input'));
        }
        for (let j = 0; j < sourceInput.fieldRow.length; j++) {
          const sourceField = sourceInput.fieldRow[j];
          const resultField = resultInput.fieldRow[j];
          if (!resultField) {
            throw new Error(DUPLICATE_BLOCK_ERROR.replace('%1', 'a field'));
          }
          resultField.setValue(sourceField.getValue());
        }
      }

      result.setCollapsed(sourceBlock.isCollapsed());
      result.setInputsInline(sourceBlock.getInputsInline());

      result.initSvg();
      result.getSvgRoot().setAttribute('visibility', 'hidden');
    } finally {
      eventUtils.enable();
    }

    return result;
  }

  /**
   * Populate the list of available connections on this block stack.  This
   * should only be called once, at the beginning of a drag. If the stack has
   * more than one block, this function will populate lastOnStack_ and create
   * the corresponding insertion marker.
   *
   * @returns A list of available connections.
   */
  private initAvailableConnections_(): RenderedConnection[] {
    const available = this.topBlock_.getConnections_(false);
    // Also check the last connection on this stack
    const lastOnStack = this.topBlock_.lastConnectionInStack(true);
    if (lastOnStack && lastOnStack !== this.topBlock_.nextConnection) {
      available.push(lastOnStack);
      this.lastOnStack_ = lastOnStack;
      if (this.lastMarker_) {
        eventUtils.disable();
        try {
          this.lastMarker_.dispose();
        } finally {
          eventUtils.enable();
        }
      }
      this.lastMarker_ = this.createMarkerBlock_(lastOnStack.getSourceBlock());
    }
    return available;
  }

  /**
   * Whether the previews (insertion marker and replacement marker) should be
   * updated based on the closest candidate and the current drag distance.
   *
   * @param candidate An object containing a local connection, a closest
   *     connection, and a radius.  Returned by getCandidate_.
   * @param dxy Position relative to drag start, in workspace units.
   * @returns Whether the preview should be updated.
   */
  private shouldUpdatePreviews_(
      candidate: CandidateConnection, dxy: Coordinate): boolean {
    const candidateLocal = candidate.local;
    const candidateClosest = candidate.closest;
    const radius = candidate.radius;

    // Found a connection!
    if (candidateLocal && candidateClosest) {
      // We're already showing an insertion marker.
      // Decide whether the new connection has higher priority.
      if (this.localConnection_ && this.closestConnection_) {
        // The connection was the same as the current connection.
        if (this.closestConnection_ === candidateClosest &&
            this.localConnection_ === candidateLocal) {
          return false;
        }
        const xDiff =
            this.localConnection_.x + dxy.x - this.closestConnection_.x;
        const yDiff =
            this.localConnection_.y + dxy.y - this.closestConnection_.y;
        const curDistance = Math.sqrt(xDiff * xDiff + yDiff * yDiff);
        // Slightly prefer the existing preview over a new preview.
        return !(
            candidateClosest &&
            radius > curDistance - config.currentConnectionPreference);
      } else if (!this.localConnection_ && !this.closestConnection_) {
        // We weren't showing a preview before, but we should now.
        return true;
      } else {
        console.error(
            'Only one of localConnection_ and closestConnection_ was set.');
      }
    } else {  // No connection found.
      // Only need to update if we were showing a preview before.
      return !!(this.localConnection_ && this.closestConnection_);
    }

    console.error(
        'Returning true from shouldUpdatePreviews, but it\'s not clear why.');
    return true;
  }

  /**
   * Find the nearest valid connection, which may be the same as the current
   * closest connection.
   *
   * @param dxy Position relative to drag start, in workspace units.
   * @returns An object containing a local connection, a closest connection, and
   *     a radius.
   */
  private getCandidate_(dxy: Coordinate): CandidateConnection {
    let radius = this.getStartRadius_();
    let candidateClosest = null;
    let candidateLocal = null;

    // It's possible that a block has added or removed connections during a
    // drag, (e.g. in a drag/move event handler), so let's update the available
    // connections. Note that this will be called on every move while dragging,
    // so it might cause slowness, especially if the block stack is large.  If
    // so, maybe it could be made more efficient. Also note that we won't update
    // the connections if we've already connected the insertion marker to a
    // block.
    if (!this.markerConnection_ || !this.markerConnection_.isConnected()) {
      this.updateAvailableConnections();
    }

    for (let i = 0; i < this.availableConnections_.length; i++) {
      const myConnection = this.availableConnections_[i];
      const neighbour = myConnection.closest(radius, dxy);
      if (neighbour.connection) {
        candidateClosest = neighbour.connection;
        candidateLocal = myConnection;
        radius = neighbour.radius;
      }
    }
    return {closest: candidateClosest, local: candidateLocal, radius};
  }

  /**
   * Decide the radius at which to start searching for the closest connection.
   *
   * @returns The radius at which to start the search for the closest
   *     connection.
   */
  private getStartRadius_(): number {
    // If there is already a connection highlighted,
    // increase the radius we check for making new connections.
    // Why? When a connection is highlighted, blocks move around when the
    // insertion marker is created, which could cause the connection became out
    // of range. By increasing radiusConnection when a connection already
    // exists, we never "lose" the connection from the offset.
    if (this.closestConnection_ && this.localConnection_) {
      return config.connectingSnapRadius;
    }
    return config.snapRadius;
  }

  /**
   * Whether ending the drag would delete the block.
   *
   * @param candidate An object containing a local connection, a closest
   *     connection, and a radius.
   * @param dragTarget The drag target that the block is currently over.
   * @returns Whether dropping the block immediately would delete the block.
   */
  private shouldDelete_(
      candidate: CandidateConnection, dragTarget: IDragTarget|null): boolean {
    if (dragTarget) {
      const componentManager = this.workspace_.getComponentManager();
      const isDeleteArea = componentManager.hasCapability(
          dragTarget.id, ComponentManager.Capability.DELETE_AREA);
      if (isDeleteArea) {
        return (dragTarget as IDeleteArea)
            .wouldDelete(this.topBlock_, candidate && !!candidate.closest);
      }
    }
    return false;
  }

  /**
   * Show an insertion marker or replacement highlighting during a drag, if
   * needed.
   * At the beginning of this function, this.localConnection_ and
   * this.closestConnection_ should both be null.
   *
   * @param candidate An object containing a local connection, a closest
   *     connection, and a radius.
   */
  private maybeShowPreview_(candidate: CandidateConnection) {
    // Nope, don't add a marker.
    if (this.wouldDeleteBlock_) {
      return;
    }
    const closest = candidate.closest;
    const local = candidate.local;

    // Nothing to connect to.
    if (!closest) {
      return;
    }

    // Something went wrong and we're trying to connect to an invalid
    // connection.
    if (closest === this.closestConnection_ ||
        closest.getSourceBlock().isInsertionMarker()) {
      console.log('Trying to connect to an insertion marker');
      return;
    }
    // Add an insertion marker or replacement marker.
    this.closestConnection_ = closest;
    // AnyDuringMigration because:  Type 'RenderedConnection | null' is not
    // assignable to type 'RenderedConnection'.
    this.localConnection_ = local as AnyDuringMigration;
    this.showPreview_();
  }

  /**
   * A preview should be shown.  This function figures out if it should be a
   * block highlight or an insertion marker, and shows the appropriate one.
   */
  private showPreview_() {
    const closest = this.closestConnection_;
    const renderer = this.workspace_.getRenderer();
    const method = renderer.getConnectionPreviewMethod(
        (closest), (this.localConnection_), this.topBlock_);

    switch (method) {
      case InsertionMarkerManager.PREVIEW_TYPE.INPUT_OUTLINE:
        this.showInsertionInputOutline_();
        break;
      case InsertionMarkerManager.PREVIEW_TYPE.INSERTION_MARKER:
        this.showInsertionMarker_();
        break;
      case InsertionMarkerManager.PREVIEW_TYPE.REPLACEMENT_FADE:
        this.showReplacementFade_();
        break;
    }

    // Optionally highlight the actual connection, as a nod to previous
    // behaviour.
    // AnyDuringMigration because:  Argument of type 'RenderedConnection' is not
    // assignable to parameter of type 'Connection'.
    if (closest &&
        renderer.shouldHighlightConnection(closest as AnyDuringMigration)) {
      closest.highlight();
    }
  }

  /**
   * Show an insertion marker or replacement highlighting during a drag, if
   * needed.
   * At the end of this function, this.localConnection_ and
   * this.closestConnection_ should both be null.
   *
   * @param candidate An object containing a local connection, a closest
   *     connection, and a radius.
   */
  private maybeHidePreview_(candidate: CandidateConnection) {
    // If there's no new preview, remove the old one but don't bother deleting
    // it. We might need it later, and this saves disposing of it and recreating
    // it.
    if (!candidate.closest) {
      this.hidePreview_();
    } else {
      // If there's a new preview and there was an preview before, and either
      // connection has changed, remove the old preview.
      const hadPreview = this.closestConnection_ && this.localConnection_;
      const closestChanged = this.closestConnection_ !== candidate.closest;
      const localChanged = this.localConnection_ !== candidate.local;

      // Also hide if we had a preview before but now we're going to delete
      // instead.
      if (hadPreview &&
          (closestChanged || localChanged || this.wouldDeleteBlock_)) {
        this.hidePreview_();
      }
    }

    // Either way, clear out old state.
    // AnyDuringMigration because:  Type 'null' is not assignable to type
    // 'RenderedConnection'.
    this.markerConnection_ = null as AnyDuringMigration;
    // AnyDuringMigration because:  Type 'null' is not assignable to type
    // 'RenderedConnection'.
    this.closestConnection_ = null as AnyDuringMigration;
    // AnyDuringMigration because:  Type 'null' is not assignable to type
    // 'RenderedConnection'.
    this.localConnection_ = null as AnyDuringMigration;
  }

  /**
   * A preview should be hidden.  This function figures out if it is a block
   *  highlight or an insertion marker, and hides the appropriate one.
   */
  private hidePreview_() {
    // AnyDuringMigration because:  Argument of type 'RenderedConnection' is not
    // assignable to parameter of type 'Connection'.
    if (this.closestConnection_ && this.closestConnection_.targetBlock() &&
        this.workspace_.getRenderer().shouldHighlightConnection(
            this.closestConnection_ as AnyDuringMigration)) {
      this.closestConnection_.unhighlight();
    }
    if (this.fadedBlock_) {
      this.hideReplacementFade_();
    } else if (this.highlightedBlock_) {
      this.hideInsertionInputOutline_();
    } else if (this.markerConnection_) {
      this.hideInsertionMarker_();
    }
  }

  /**
   * Shows an insertion marker connected to the appropriate blocks (based on
   * manager state).
   */
  private showInsertionMarker_() {
    const local = this.localConnection_;
    const closest = this.closestConnection_;

    const isLastInStack = this.lastOnStack_ && local === this.lastOnStack_;
    let imBlock = isLastInStack ? this.lastMarker_ : this.firstMarker_;
    let imConn;
    try {
      // AnyDuringMigration because:  Argument of type 'BlockSvg' is not
      // assignable to parameter of type 'Block'.
      imConn = imBlock.getMatchingConnection(
          local.getSourceBlock() as AnyDuringMigration, local);
    } catch (e) {
      // It's possible that the number of connections on the local block has
      // changed since the insertion marker was originally created.  Let's
      // recreate the insertion marker and try again. In theory we could
      // probably recreate the marker block (e.g. in getCandidate_), which is
      // called more often during the drag, but creating a block that often
      // might be too slow, so we only do it if necessary.
      this.firstMarker_ = this.createMarkerBlock_(this.topBlock_);
      imBlock = isLastInStack ? this.lastMarker_ : this.firstMarker_;
      // AnyDuringMigration because:  Argument of type 'BlockSvg' is not
      // assignable to parameter of type 'Block'.
      imConn = imBlock.getMatchingConnection(
          local.getSourceBlock() as AnyDuringMigration, local);
    }

    if (imConn === this.markerConnection_) {
      throw Error(
          'Made it to showInsertionMarker_ even though the marker isn\'t ' +
          'changing');
    }

    // Render disconnected from everything else so that we have a valid
    // connection location.
    imBlock.render();
    imBlock.rendered = true;
    imBlock.getSvgRoot().setAttribute('visibility', 'visible');

    if (imConn && closest) {
      // Position so that the existing block doesn't move.
      imBlock.positionNearConnection(imConn, closest);
    }
    if (closest) {
      // Connect() also renders the insertion marker.
      // AnyDuringMigration because:  Argument of type 'RenderedConnection' is
      // not assignable to parameter of type 'Connection'.
      imConn!.connect(closest as AnyDuringMigration);
    }

    // AnyDuringMigration because:  Type 'RenderedConnection | null' is not
    // assignable to type 'RenderedConnection'.
    this.markerConnection_ = imConn as AnyDuringMigration;
  }

  /**
   * Disconnects and hides the current insertion marker. Should return the
   * blocks to their original state.
   */
  private hideInsertionMarker_() {
    if (!this.markerConnection_) {
      console.log('No insertion marker connection to disconnect');
      return;
    }

    const imConn = this.markerConnection_;
    const imBlock = imConn.getSourceBlock();
    const markerNext = imBlock.nextConnection;
    const markerPrev = imBlock.previousConnection;
    const markerOutput = imBlock.outputConnection;

    const isFirstInStatementStack =
        imConn === markerNext && !(markerPrev && markerPrev.targetConnection);

    const isFirstInOutputStack = imConn.type === ConnectionType.INPUT_VALUE &&
        !(markerOutput && markerOutput.targetConnection);
    // The insertion marker is the first block in a stack.  Unplug won't do
    // anything in that case.  Instead, unplug the following block.
    if (isFirstInStatementStack || isFirstInOutputStack) {
      imConn.targetBlock()!.unplug(false);
    } else if (
        imConn.type === ConnectionType.NEXT_STATEMENT &&
        imConn !== markerNext) {
      // Inside of a C-block, first statement connection.
      const innerConnection = imConn.targetConnection;
      if (innerConnection) {
        innerConnection.getSourceBlock().unplug(false);
      }

      const previousBlockNextConnection =
          markerPrev ? markerPrev.targetConnection : null;

      imBlock.unplug(true);
      if (previousBlockNextConnection) {
        // AnyDuringMigration because:  Argument of type 'RenderedConnection' is
        // not assignable to parameter of type 'Connection'.
        previousBlockNextConnection.connect(
            innerConnection as AnyDuringMigration);
      }
    } else {
      imBlock.unplug(/* healStack */
                     true);
    }

    if (imConn.targetConnection) {
      throw Error(
          'markerConnection_ still connected at the end of ' +
          'disconnectInsertionMarker');
    }

    // AnyDuringMigration because:  Type 'null' is not assignable to type
    // 'RenderedConnection'.
    this.markerConnection_ = null as AnyDuringMigration;
    const svg = imBlock.getSvgRoot();
    if (svg) {
      svg.setAttribute('visibility', 'hidden');
    }
  }

  /** Shows an outline around the input the closest connection belongs to. */
  private showInsertionInputOutline_() {
    const closest = this.closestConnection_;
    this.highlightedBlock_ = closest.getSourceBlock();
    // AnyDuringMigration because:  Argument of type 'RenderedConnection' is not
    // assignable to parameter of type 'Connection'.
    this.highlightedBlock_.highlightShapeForInput(
        closest as AnyDuringMigration, true);
  }

  /** Hides any visible input outlines. */
  private hideInsertionInputOutline_() {
    // AnyDuringMigration because:  Argument of type 'RenderedConnection' is not
    // assignable to parameter of type 'Connection'.
    this.highlightedBlock_.highlightShapeForInput(
        this.closestConnection_ as AnyDuringMigration, false);
    // AnyDuringMigration because:  Type 'null' is not assignable to type
    // 'BlockSvg'.
    this.highlightedBlock_ = null as AnyDuringMigration;
  }

  /**
   * Shows a replacement fade affect on the closest connection's target block
   * (the block that is currently connected to it).
   */
  private showReplacementFade_() {
    // AnyDuringMigration because:  Type 'BlockSvg | null' is not assignable to
    // type 'BlockSvg'.
    this.fadedBlock_ =
        this.closestConnection_.targetBlock() as AnyDuringMigration;
    this.fadedBlock_.fadeForReplacement(true);
  }

  /** Hides/Removes any visible fade affects. */
  private hideReplacementFade_() {
    this.fadedBlock_.fadeForReplacement(false);
    // AnyDuringMigration because:  Type 'null' is not assignable to type
    // 'BlockSvg'.
    this.fadedBlock_ = null as AnyDuringMigration;
  }

  /**
   * Get a list of the insertion markers that currently exist.  Drags have 0, 1,
   * or 2 insertion markers.
   *
   * @returns A possibly empty list of insertion marker blocks.
   * @internal
   */
  getInsertionMarkers(): BlockSvg[] {
    const result = [];
    if (this.firstMarker_) {
      result.push(this.firstMarker_);
    }
    if (this.lastMarker_) {
      result.push(this.lastMarker_);
    }
    return result;
  }
}

export namespace InsertionMarkerManager {
  /**
   * An enum describing different kinds of previews the InsertionMarkerManager
   * could display.
   */
  export enum PREVIEW_TYPE {
    INSERTION_MARKER = 0,
    INPUT_OUTLINE = 1,
    REPLACEMENT_FADE = 2,
  }
}

export type PreviewType = InsertionMarkerManager.PREVIEW_TYPE;
export const PreviewType = InsertionMarkerManager.PREVIEW_TYPE;