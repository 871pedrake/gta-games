import * as THREE from 'three';
import { VEHICLE_COLLISION_RADIUS, VEHICLE_WHEEL_RADIUS } from '../config';
import { EngineContext, GameSystem } from '../core/SystemLifecycle';
import { createVehicleEntity } from '../models';
import { VehicleEntity } from '../types';
import { getCoastalRoadX, WORLD_BOUNDS } from '../world/WorldRegistry';

const _tmpCopPos = new THREE.Vector3();

interface PolicePatrolRoute {
  axis: 'x' | 'z';
  laneCoord: number;
  dir: 1 | -1;
  coastal?: boolean;
}

export class PoliceSystem implements GameSystem {
  public readonly name = 'PoliceSystem';

  private ctx: EngineContext | null = null;
  private readonly shadowTex: THREE.CanvasTexture;
  private wantedStars = 0;
  private unsubWanted: (() => void) | null = null;
  private readonly patrolRoutes = new Map<VehicleEntity, PolicePatrolRoute>();

  constructor(shadowTex: THREE.CanvasTexture) {
    this.shadowTex = shadowTex;
  }

  public init(ctx: EngineContext): void {
    this.ctx = ctx;

    const policeSpawns: Array<{ x: number; z: number; h: number; route: PolicePatrolRoute }> = [
      {
        x: -14.2,
        z: -168,
        h: Math.PI,
        route: { axis: 'z', laneCoord: -14.2, dir: -1 },
      },
      {
        x: -134.2,
        z: 92,
        h: 0,
        route: { axis: 'z', laneCoord: -134.2, dir: 1 },
      },
      {
        x: getCoastalRoadX(60) - 3.0,
        z: 60,
        h: Math.PI,
        route: { axis: 'z', laneCoord: 0, dir: -1, coastal: true },
      },
    ];

    policeSpawns.forEach((sp, idx) => {
      const cop = createVehicleEntity(
        `police_${idx}`,
        'police',
        0x161926,
        sp.x,
        sp.z,
        sp.h,
        this.shadowTex,
        ctx.isSoftwareGl
      );
      cop.driver = 'police';
      cop.npcAxis = sp.route.axis;
      cop.npcDir = sp.route.dir;
      cop.npcTargetSpeed = 12;
      ctx.scene.add(cop.mesh);
      ctx.vehicles.push(cop);
      this.patrolRoutes.set(cop, sp.route);
    });

    this.unsubWanted = ctx.events.on('wantedChanged', ({ stars }) => {
      this.wantedStars = stars;
    });
  }

  public update(dt: number): void {
    if (!this.ctx) return;
    const {
      vehicles,
      state,
      weatherEffects,
      transit,
      crowd,
      groundHeightAt,
      resolveWorldCollisions,
    } = this.ctx;

    const activePoliceCount = this.wantedStars;
    let policeChasingIndex = 0;

    for (const v of vehicles) {
      if (v === state.currentVehicle || v.driver !== 'police') continue;

      const isChasing = policeChasingIndex < activePoliceCount;
      policeChasingIndex++;

      if (v.lightBarRed && v.lightBarBlue) {
        const rMat = v.lightBarRed.material as THREE.MeshStandardMaterial;
        const bMat = v.lightBarBlue.material as THREE.MeshStandardMaterial;
        if (isChasing) {
          const flash = Math.sin(state.elapsedSec * 16) > 0;
          rMat.emissiveIntensity = flash ? 3.2 : 0.25;
          bMat.emissiveIntensity = flash ? 0.25 : 3.2;
        } else {
          rMat.emissiveIntensity = 0.6;
          bMat.emissiveIntensity = 0.6;
        }
      }

      if (isChasing) {
        const dx = state.playerPos.x - v.x;
        const dz = state.playerPos.z - v.z;
        const dist = Math.hypot(dx, dz);
        const desiredHeading = Math.atan2(dx, dz);
        let diff = desiredHeading - v.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        const maxTurn = 2.6 * (0.78 + 0.22 * weatherEffects.grip) * dt;
        v.heading += THREE.MathUtils.clamp(diff, -maxTurn, maxTurn);
        const targetSpd =
          (dist > 16 ? 21 + this.wantedStars * 2.5 : dist > 5 ? 14 : 6) *
          (0.82 + 0.18 * weatherEffects.npcTrafficSpeedMult);
        v.speed = THREE.MathUtils.damp(v.speed, targetSpd, 4.5, dt);

        v.x += Math.sin(v.heading) * v.speed * dt;
        v.z += Math.cos(v.heading) * v.speed * dt;
        _tmpCopPos.set(v.x, v.mesh.position.y, v.z);
        if (resolveWorldCollisions(_tmpCopPos, VEHICLE_COLLISION_RADIUS)) {
          v.heading += 1.4 * dt;
        }
        v.x = _tmpCopPos.x;
        v.z = _tmpCopPos.z;

        if (dist < 3.4 && state.currentVehicle) {
          state.currentVehicle.speed *= 0.94;
        }

        const gy = groundHeightAt(v.x, v.z, v.mesh.position.y);
        v.mesh.position.set(v.x, gy, v.z);
        v.mesh.rotation.y = v.heading;
        v.wheels.forEach((w) => (w.rotation.x += (v.speed * dt) / VEHICLE_WHEEL_RADIUS));
      } else {
        const route = this.patrolRoutes.get(v) ?? {
          axis: v.npcAxis ?? 'z',
          laneCoord: v.x,
          dir: v.npcDir ?? 1,
        };
        const axis = route.axis;
        const dir = route.dir;
        const baseDesired = (v.npcTargetSpeed ?? 12) * weatherEffects.npcTrafficSpeedMult;
        const targetSpd = transit.computeSignalAndQueueSpeed(
          v,
          axis,
          dir,
          baseDesired,
          crowd.graph,
          vehicles
        );
        v.speed = THREE.MathUtils.damp(v.speed, targetSpd, 4.5, dt);

        v.taillights.forEach((tl) => {
          (tl.material as THREE.MeshStandardMaterial).emissiveIntensity =
            targetSpd < 1.2 ? 2.7 : 1.1;
        });

        const minSpanZ = WORLD_BOUNDS.minZ + 32;
        const maxSpanZ = WORLD_BOUNDS.maxZ - 32;
        if (axis === 'z') {
          v.z += dir * v.speed * dt;
          if (v.z > maxSpanZ) v.z = minSpanZ;
          if (v.z < minSpanZ) v.z = maxSpanZ;

          if (route.coastal) {
            const targetX = getCoastalRoadX(v.z) + (dir === 1 ? 3.1 : -3.1);
            const lookAheadZ = v.z + dir * 10;
            const lookAheadX = getCoastalRoadX(lookAheadZ) + (dir === 1 ? 3.1 : -3.1);
            v.x += (targetX - v.x) * Math.min(1, dt * 6);
            v.heading = Math.atan2(lookAheadX - v.x, lookAheadZ - v.z);
          } else {
            v.heading = dir === 1 ? 0 : Math.PI;
          }
        } else {
          v.heading = dir === 1 ? Math.PI / 2 : -Math.PI / 2;
          v.x += dir * v.speed * dt;
          if (v.x > getCoastalRoadX(v.z) - 4) v.x = WORLD_BOUNDS.minX + 30;
          if (v.x < WORLD_BOUNDS.minX + 30) v.x = getCoastalRoadX(v.z) - 4;
        }

        const gy = groundHeightAt(v.x, v.z, v.mesh.position.y);
        v.mesh.position.set(v.x, gy, v.z);
        v.mesh.rotation.y = v.heading;
        v.wheels.forEach((w) => (w.rotation.x += (v.speed * dt) / VEHICLE_WHEEL_RADIUS));
      }
    }
  }

  public dispose(): void {
    this.unsubWanted?.();
    this.unsubWanted = null;
    this.patrolRoutes.clear();
    this.ctx = null;
  }
}
