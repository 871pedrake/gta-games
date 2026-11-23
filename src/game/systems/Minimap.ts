import { MINIMAP_SCALE } from '../config';
import { EngineContext, GameSystem } from '../core/SystemLifecycle';
import { MissionStatus } from '../types';
import {
  CANAL_BRIDGES,
  CANAL_SPEC,
  CORE_POIS,
  getCoastlineX,
  OFFSHORE_ISLANDS,
  STREETS,
  TUNEL_SPEC,
  VIADUTO_SPEC,
  WORLD_POIS,
  WorldRegistry,
} from '../world/WorldRegistry';

const MISSION_POINTS = WorldRegistry.missionPoints;
const GUN_SHOP_POI = CORE_POIS.find((p) => p.category === 'shop_gun') ?? null;

export class Minimap implements GameSystem {
  public readonly name = 'Minimap';

  private ctx: EngineContext | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private getMissionStatus: () => MissionStatus;

  constructor(getMissionStatus: () => MissionStatus) {
    this.getMissionStatus = getMissionStatus;
  }

  public init(ctx: EngineContext): void {
    this.ctx = ctx;
  }

  public setCanvas(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
  }

  public update(_dt: number): void {
    if (!this.canvas) return;
    const ctx2d = this.canvas.getContext('2d');
    if (ctx2d) {
      this.draw(ctx2d, this.canvas.width, this.canvas.height);
    }
  }

  public draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.ctx) return;
    const { state, world, vehicles, crowd } = this.ctx;
    const mission = this.getMissionStatus();

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b4f78';
    ctx.fillRect(0, 0, w, h);

    const scale = MINIMAP_SCALE;
    const cx = w / 2;
    const cy = h / 2;
    const toMapX = (wx: number) => cx + (wx - state.playerPos.x) * scale;
    const toMapY = (wz: number) => cy + (wz - state.playerPos.z) * scale;

    // Terra firme e faixa curva de areia acompanhando getCoastlineX(z)
    const minWz = state.playerPos.z - cy / scale - 24;
    const maxWz = state.playerPos.z + cy / scale + 24;
    const zStep = 18;

    ctx.fillStyle = '#c89e69';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let wz = minWz; wz <= maxWz; wz += zStep) {
      ctx.lineTo(toMapX(getCoastlineX(wz) + 34), toMapY(wz));
    }
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#25213b';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let wz = minWz; wz <= maxWz; wz += zStep) {
      ctx.lineTo(toMapX(getCoastlineX(wz)), toMapY(wz));
    }
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();

    // Tons distintos por distrito no minimapa
    const fillDistrictRect = (minX: number, maxX: number, minZ: number, maxZ: number, color: string) => {
      const x1 = toMapX(minX);
      const y1 = toMapY(minZ);
      ctx.fillStyle = color;
      ctx.fillRect(x1, y1, (maxX - minX) * scale, (maxZ - minZ) * scale);
    };
    fillDistrictRect(-280, -148, -280, -214, 'rgba(155, 92, 66, 0.42)'); // Morro da Brisa
    fillDistrictRect(-148, -20, -280, -130, 'rgba(38, 92, 66, 0.5)'); // Parque Atlântico
    fillDistrictRect(-20, 62, -280, -130, 'rgba(54, 97, 86, 0.42)'); // Campus
    fillDistrictRect(-140, -80, -130, 0, 'rgba(109, 53, 122, 0.36)'); // Comercial / Shopping
    fillDistrictRect(-80, 58, 56, 125, 'rgba(141, 101, 77, 0.42)'); // Centro Histórico
    fillDistrictRect(-280, -140, 58, 208, 'rgba(72, 107, 78, 0.36)'); // Subúrbio
    fillDistrictRect(-280, -140, -214, 58, 'rgba(51, 61, 79, 0.45)'); // Industrial
    fillDistrictRect(-280, -20, 208, 280, 'rgba(55, 71, 89, 0.6)'); // Heliponto
    // Marca do Heliponto no minimapa
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.75)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(toMapX(-188), toMapY(246), 9 * scale, 0, Math.PI * 2);
    ctx.stroke();

    // Canal de Solara (cortando a cidade até o mar) + Bacia/Cais
    const canalCoastX = getCoastlineX(CANAL_SPEC.zCenter) + 28;
    ctx.fillStyle = '#0e6b9e';
    ctx.fillRect(
      toMapX(CANAL_SPEC.xMin),
      toMapY(CANAL_SPEC.zMin),
      (canalCoastX - CANAL_SPEC.xMin) * scale,
      (CANAL_SPEC.zMax - CANAL_SPEC.zMin) * scale
    );
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(
      toMapX(CANAL_SPEC.xMin),
      toMapY(CANAL_SPEC.zMin),
      (getCoastlineX(CANAL_SPEC.zCenter) - CANAL_SPEC.xMin) * scale,
      (CANAL_SPEC.zMax - CANAL_SPEC.zMin) * scale
    );

    // Ilhas Offshore visíveis na beira do minimapa
    for (const isl of OFFSHORE_ISLANDS) {
      ctx.fillStyle = '#2b5e43';
      ctx.beginPath();
      ctx.arc(toMapX(isl.x), toMapY(isl.z), isl.radius * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    // Malha viária completa a partir de WorldRegistry.streets
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of STREETS) {
      if (s.kind === 'roundabout' && s.roundabout) {
        const rb = s.roundabout;
        const rx = toMapX(rb.centerX);
        const rz = toMapY(rb.centerZ);
        const midR = ((rb.outerRadius + rb.innerRadius) * 0.5) * scale;
        ctx.strokeStyle = '#3c3e5e';
        ctx.lineWidth = s.width * scale;
        ctx.beginPath();
        ctx.arc(rx, rz, midR, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#2b4744';
        ctx.beginPath();
        ctx.arc(rx, rz, rb.innerRadius * scale, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      ctx.strokeStyle = s.kind === 'alley' ? '#2f324d' : '#3c3e5e';
      ctx.lineWidth = Math.max(2, s.width * scale);
      ctx.beginPath();
      for (const seg of s.segments) {
        ctx.moveTo(toMapX(seg.x1), toMapY(seg.z1));
        ctx.lineTo(toMapX(seg.x2), toMapY(seg.z2));
      }
      ctx.stroke();

      if (s.medianWidth > 0) {
        ctx.strokeStyle = '#1f233a';
        ctx.lineWidth = Math.max(1, s.medianWidth * scale);
        ctx.beginPath();
        for (const seg of s.segments) {
          ctx.moveTo(toMapX(seg.x1), toMapY(seg.z1));
          ctx.lineTo(toMapX(seg.x2), toMapY(seg.z2));
        }
        ctx.stroke();
      }
    }

    // Pontes sobre o Canal, Viaduto das Palmeiras e Túnel Curto do Parque
    for (const br of CANAL_BRIDGES) {
      ctx.fillStyle = br.isPedestrianOnly ? '#a16207' : '#64748b';
      ctx.fillRect(
        toMapX(br.xCenter - br.halfW),
        toMapY(CANAL_SPEC.zMin - CANAL_SPEC.rampLength),
        br.halfW * 2 * scale,
        (CANAL_SPEC.zMax - CANAL_SPEC.zMin + CANAL_SPEC.rampLength * 2) * scale
      );
    }

    // Viaduto (traçado elevado em destaque sobre a Rua Flamingo)
    ctx.fillStyle = '#7c8ba1';
    ctx.fillRect(
      toMapX(VIADUTO_SPEC.xCenter - VIADUTO_SPEC.halfW),
      toMapY(VIADUTO_SPEC.zRampStartN),
      VIADUTO_SPEC.halfW * 2 * scale,
      (VIADUTO_SPEC.zRampEndS - VIADUTO_SPEC.zRampStartN) * scale
    );

    // Túnel Curto do Parque (tracejado escuro sob a colina verde)
    ctx.fillStyle = 'rgba(38, 92, 66, 0.72)';
    ctx.fillRect(
      toMapX(TUNEL_SPEC.xCenter - TUNEL_SPEC.hillHalfW),
      toMapY(TUNEL_SPEC.zStart),
      TUNEL_SPEC.hillHalfW * 2 * scale,
      (TUNEL_SPEC.zEnd - TUNEL_SPEC.zStart) * scale
    );
    ctx.strokeStyle = '#94a3b8';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1.2;
    ctx.strokeRect(
      toMapX(TUNEL_SPEC.xCenter - TUNEL_SPEC.boreHalfW),
      toMapY(TUNEL_SPEC.zStart),
      TUNEL_SPEC.boreHalfW * 2 * scale,
      (TUNEL_SPEC.zEnd - TUNEL_SPEC.zStart) * scale
    );
    ctx.setLineDash([]);

    ctx.fillStyle = '#605288';
    for (const b of world.buildings) {
      const bx = toMapX(b.x - b.halfW);
      const bz = toMapY(b.z - b.halfD);
      ctx.fillRect(bx, bz, b.halfW * 2 * scale, b.halfD * 2 * scale);
    }

    if (mission.id === 'none') {
      ctx.fillStyle = '#ff2e93';
      ctx.beginPath();
      ctx.arc(toMapX(MISSION_POINTS.m1Trigger.x), toMapY(MISSION_POINTS.m1Trigger.z), 4.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#16f2d4';
      ctx.beginPath();
      ctx.arc(toMapX(MISSION_POINTS.m2Trigger.x), toMapY(MISSION_POINTS.m2Trigger.z), 4.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (mission.targetPos) {
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(toMapX(mission.targetPos.x), toMapY(mission.targetPos.z), 5.2, 0, Math.PI * 2);
      ctx.fill();
    }

    if (GUN_SHOP_POI) {
      const gx = toMapX(GUN_SHOP_POI.entryX);
      const gy = toMapY(GUN_SHOP_POI.entryZ);
      const pad = 7;
      const clampedX = Math.max(pad, Math.min(w - pad, gx));
      const clampedY = Math.max(pad, Math.min(h - pad, gy));
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(clampedX, clampedY, 5.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0e0a1c';
      ctx.font = 'bold 7px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('A', clampedX, clampedY + 0.5);
    }

    ctx.fillStyle = '#38bdf8';
    for (const bs of WORLD_POIS.busStops) {
      const bx = toMapX(bs.waitX);
      const bz = toMapY(bs.waitZ);
      if (bx >= 0 && bx <= w && bz >= 0 && bz <= h) {
        ctx.fillRect(bx - 2, bz - 2, 4, 4);
      }
    }

    for (const v of vehicles) {
      if (v === state.currentVehicle) continue;
      const vx = toMapX(v.x);
      const vz = toMapY(v.z);
      if (vx < -6 || vx > w + 6 || vz < -6 || vz > h + 6) continue;

      if (v.driver === 'police') {
        ctx.fillStyle = Math.sin(state.elapsedSec * 14) > 0 ? '#ff2244' : '#3b82f6';
        ctx.beginPath();
        ctx.arc(vx, vz, 3.4, 0, Math.PI * 2);
        ctx.fill();
      } else if (v.driver === 'ambulance') {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(vx, vz, 3.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(vx - 2, vz - 0.7, 4, 1.4);
        ctx.fillRect(vx - 0.7, vz - 2, 1.4, 4);
      } else if (v.driver === 'bus') {
        ctx.fillStyle = '#facc15';
        ctx.fillRect(vx - 3, vz - 3, 6, 6);
      } else {
        ctx.fillStyle = v === state.missionCar ? '#ff2e93' : '#94a3b8';
        ctx.fillRect(vx - 2, vz - 2, 4, 4);
      }
    }

    ctx.fillStyle = 'rgba(226, 232, 240, 0.55)';
    for (const a of crowd.agents) {
      if (!a.active || !a.visuallyActive || a.insideBuilding) continue;
      const ax = toMapX(a.x);
      const az = toMapY(a.z);
      if (ax >= 0 && ax <= w && az >= 0 && az <= h) {
        ctx.fillRect(ax - 1, az - 1, 2, 2);
      }
    }

    const angle = state.currentVehicle ? state.currentVehicle.heading : state.playerYaw;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-angle + Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  public dispose(): void {
    this.canvas = null;
    this.ctx = null;
  }
}
