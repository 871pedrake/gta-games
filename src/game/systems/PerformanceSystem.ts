import {
  DYNAMIC_RES_DOWN_COOLDOWN,
  DYNAMIC_RES_STEP,
  DYNAMIC_RES_UP_COOLDOWN,
  QUALITY_SETTINGS,
  QualityPreset,
  TARGET_FPS_LOW_THRESHOLD,
  TARGET_FPS_RECOVER_THRESHOLD,
} from '../config';
import { EngineContext, GameSystem } from '../core/SystemLifecycle';

/**
 * Monitora FPS/frametime e ajusta dinamicamente o pixelRatio do WebGLRenderer
 * para manter 60 FPS no preset Médio, além de coletar renderer.info para o painel F3.
 */
export class PerformanceSystem implements GameSystem {
  public readonly name = 'PerformanceSystem';

  private ctx: EngineContext | null = null;
  private preset: QualityPreset = 'medium';
  private activePixelRatio = 1.0;
  private emaFps = 60;
  private downCooldown = 0;
  private upCooldown = 0;

  public init(ctx: EngineContext): void {
    this.ctx = ctx;
    this.syncPresetBounds(this.preset);
  }

  public setQualityPreset(preset: QualityPreset): void {
    this.preset = preset;
    this.syncPresetBounds(preset);
  }

  private syncPresetBounds(preset: QualityPreset): void {
    if (!this.ctx) return;
    const cfg = QUALITY_SETTINGS[preset];
    if (this.ctx.isSoftwareGl) {
      this.activePixelRatio = 1.0;
    } else {
      const deviceCap = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      this.activePixelRatio = Math.min(deviceCap, cfg.maxPixelRatio);
      this.ctx.renderer.setPixelRatio(this.activePixelRatio);
    }
    this.downCooldown = 0;
    this.upCooldown = 0;
    this.captureRendererInfo();
  }

  public update(dt: number): void {
    if (!this.ctx) return;
    const instFps = 1 / Math.max(0.001, dt);
    this.emaFps = this.emaFps * 0.9 + instFps * 0.1;

    if (!this.ctx.isSoftwareGl && !this.ctx.state.paused) {
      const cfg = QUALITY_SETTINGS[this.preset];
      const deviceCap = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const maxDpr = Math.min(deviceCap, cfg.maxPixelRatio);
      const minDpr = Math.min(maxDpr, cfg.minPixelRatio);

      this.downCooldown = Math.max(0, this.downCooldown - dt);
      this.upCooldown = Math.max(0, this.upCooldown - dt);

      if (this.emaFps < TARGET_FPS_LOW_THRESHOLD && this.downCooldown <= 0 && this.activePixelRatio > minDpr + 0.01) {
        const next = Math.max(minDpr, Number((this.activePixelRatio - DYNAMIC_RES_STEP).toFixed(2)));
        if (next !== this.activePixelRatio) {
          this.activePixelRatio = next;
          this.ctx.renderer.setPixelRatio(next);
          this.downCooldown = DYNAMIC_RES_DOWN_COOLDOWN;
          this.upCooldown = DYNAMIC_RES_UP_COOLDOWN;
          this.ctx.events.emit('performanceScaled', { pixelRatio: next, fps: Math.round(this.emaFps) });
        }
      } else if (
        this.emaFps >= TARGET_FPS_RECOVER_THRESHOLD &&
        this.upCooldown <= 0 &&
        this.activePixelRatio < maxDpr - 0.01
      ) {
        const next = Math.min(maxDpr, Number((this.activePixelRatio + DYNAMIC_RES_STEP * 0.65).toFixed(2)));
        if (next !== this.activePixelRatio) {
          this.activePixelRatio = next;
          this.ctx.renderer.setPixelRatio(next);
          this.upCooldown = DYNAMIC_RES_UP_COOLDOWN;
          this.ctx.events.emit('performanceScaled', { pixelRatio: next, fps: Math.round(this.emaFps) });
        }
      }
    }

    this.captureRendererInfo();
  }

  public captureRendererInfo(): void {
    if (!this.ctx) return;
    const { renderer, state } = this.ctx;
    const cfg = QUALITY_SETTINGS[this.preset];
    const deviceCap = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const baseCap = this.ctx.isSoftwareGl ? 1 : Math.min(deviceCap, cfg.maxPixelRatio);

    state.renderTelemetry.calls = renderer.info.render.calls;
    state.renderTelemetry.triangles = renderer.info.render.triangles;
    state.renderTelemetry.geometries = renderer.info.memory.geometries;
    state.renderTelemetry.textures = renderer.info.memory.textures;
    state.renderTelemetry.programs = renderer.info.programs?.length ?? 0;
    state.renderTelemetry.pixelRatio = Number(this.activePixelRatio.toFixed(2));
    state.renderTelemetry.dynamicScalePct = Math.round((this.activePixelRatio / Math.max(0.1, baseCap)) * 100);
    state.renderTelemetry.drawDistance = cfg.drawDistance;
  }

  public dispose(): void {
    this.ctx = null;
  }
}
