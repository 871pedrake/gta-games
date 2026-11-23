import * as THREE from 'three';
import { MAX_NPCS } from '../CrowdManager';
import { EngineContext } from './SystemLifecycle';

export class DebugTools {
  private overlayCanvas: HTMLCanvasElement | null = null;
  private waypointGroup: THREE.Group | null = null;
  private staticColliderGroup: THREE.Group | null = null;
  private dynamicColliderGroup: THREE.Group | null = null;

  public setOverlayCanvas(canvas: HTMLCanvasElement | null): void {
    this.overlayCanvas = canvas;
  }

  public toggleWaypoints(ctx: EngineContext): boolean {
    ctx.state.showWaypoints = !ctx.state.showWaypoints;
    if (!this.waypointGroup) {
      this.waypointGroup = ctx.crowd.graph.getDebugVisualGroup();
      ctx.scene.add(this.waypointGroup);
    }
    this.waypointGroup.visible = ctx.state.showWaypoints;
    return ctx.state.showWaypoints;
  }

  public toggleColliders(ctx: EngineContext): boolean {
    ctx.state.showColliders = !ctx.state.showColliders;
    if (!this.staticColliderGroup || !this.dynamicColliderGroup) {
      const groups = ctx.registry.getDebugColliderGroups(ctx.world.buildings, ctx.vehicles, MAX_NPCS);
      this.staticColliderGroup = groups.staticGroup;
      this.dynamicColliderGroup = groups.dynamicGroup;
      ctx.scene.add(this.staticColliderGroup, this.dynamicColliderGroup);
    }
    this.staticColliderGroup.visible = ctx.state.showColliders;
    this.dynamicColliderGroup.visible = ctx.state.showColliders;
    return ctx.state.showColliders;
  }

  public toggleRoutineLabels(ctx: EngineContext): boolean {
    ctx.state.showRoutineLabels = !ctx.state.showRoutineLabels;
    if (!ctx.state.showRoutineLabels && this.overlayCanvas) {
      this.overlayCanvas.getContext('2d')?.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    }
    return ctx.state.showRoutineLabels;
  }

  public toggleDebugPanel(ctx: EngineContext): boolean {
    ctx.state.showDebugPanel = !ctx.state.showDebugPanel;
    return ctx.state.showDebugPanel;
  }

  public updateOverlay(ctx: EngineContext): void {
    if (!ctx.state.showRoutineLabels || !this.overlayCanvas) return;
    const cw = ctx.container.clientWidth || window.innerWidth;
    const ch = ctx.container.clientHeight || window.innerHeight;
    if (this.overlayCanvas.width !== cw || this.overlayCanvas.height !== ch) {
      this.overlayCanvas.width = cw;
      this.overlayCanvas.height = ch;
    }
    const octx = this.overlayCanvas.getContext('2d');
    if (octx) {
      ctx.crowd.drawRoutineDebugLabels(octx, ctx.camera, cw, ch, ctx.state.playerPos.x, ctx.state.playerPos.z);
    }
  }

  public dispose(): void {
    this.overlayCanvas = null;
    this.waypointGroup = null;
    this.staticColliderGroup = null;
    this.dynamicColliderGroup = null;
  }
}
