import * as THREE from 'three';
import { CrowdManager } from './CrowdManager';
import { createParamedicRig, PlayerRig } from './models';
import { NavGraph } from './NavGraph';
import { ActiveRagdoll, RagdollPool } from './RagdollPool';
import { VehicleEntity } from './types';
import {
  getCoastlineX,
  getCoastalRoadX,
  INTERSECTIONS,
  STREETS,
  WORLD_BOUNDS,
  WORLD_POIS,
} from './world/WorldRegistry';

interface BusLeg {
  axis: 'x' | 'z';
  dir: 1 | -1;
  laneCoord: number;
  targetX: number;
  targetZ: number;
  stopIdx: number | null;
  coastal?: boolean;
}

interface BusRuntime {
  vehicle: VehicleEntity;
  legIndex: number;
  stopTimer: number;
  servicedStopThisLeg: boolean;
  passengers: number[];
}

interface RoadWaypoint {
  x: number;
  z: number;
}

interface ParamedicAgent {
  rig: PlayerRig;
  x: number;
  y: number;
  z: number;
  yaw: number;
  walkPhase: number;
  targetSlotIdx: number;
  treatTimer: number;
  returning: boolean;
}

export type AmbulanceState = 'idle' | 'en_route' | 'treating' | 'returning';

const BUS_CAPACITY = 20;

const COAST_STOP_Z = 28;
const COAST_STOP_LANE_X = getCoastalRoadX(COAST_STOP_Z) + 3.2;

const BUS_LOOP_LEGS: BusLeg[] = [
  // Norte (Av. Atlântica Norte z = -120, +X -> faixa z = -114.2): passa na Parada 3
  { axis: 'x', dir: 1, laneCoord: -114.2, targetX: -14.2, targetZ: -114.2, stopIdx: 3 },
  // Centro (Alameda do Sol x = -20, +Z -> faixa x = -14.2): passa na Parada 1
  { axis: 'z', dir: 1, laneCoord: -14.2, targetX: -14.2, targetZ: -4.2, stopIdx: 1 },
  // Transversal Central (Av. Central Solara z = 0, +X -> faixa z = -4.2)
  { axis: 'x', dir: 1, laneCoord: -4.2, targetX: COAST_STOP_LANE_X, targetZ: -4.2, stopIdx: null },
  // Orla Curva (Av. Beira-Mar Solara, +Z): passa na Parada 0 (Orla Maré)
  { axis: 'z', dir: 1, laneCoord: COAST_STOP_LANE_X, targetX: getCoastalRoadX(124) + 3.2, targetZ: 124.2, stopIdx: 0, coastal: true },
  // Sul (Av. do Porto Sul z = 130, -X -> faixa z = 126.8)
  { axis: 'x', dir: -1, laneCoord: 126.8, targetX: -145.8, targetZ: 126.8, stopIdx: null },
  // Oeste (Av. das Palmeiras x = -140, -Z -> faixa x = -145.8): passa na Parada 2
  { axis: 'z', dir: -1, laneCoord: -145.8, targetX: -145.8, targetZ: -114.2, stopIdx: 2 },
];

/**
 * Gerencia:
 * 1) Respeito aos semáforos das interseções do WorldRegistry e fila de veículos antes das faixas;
 * 2) Ônibus urbanos pela nova malha incluindo a avenida costeira curva;
 * 3) Despacho da Ambulância SAMU pelo grafo de interseções (WorldRegistry.intersections) + 2 Paramédicos NPC.
 */
export class TransitAndRescueSystem {
  private readonly buses: BusRuntime[] = [];
  private ambulance: VehicleEntity | null = null;
  private ambulanceState: AmbulanceState = 'idle';
  private ambulancePath: RoadWaypoint[] = [];
  private ambulancePathIdx = 0;
  private ambulancePatrolLeg = 3;
  private ambulanceCooldown = 0;
  private readonly paramedics: ParamedicAgent[] = [];
  private rescueBannerCooldown = 0;

  public totalRescuedCount = 0;

  constructor(scene: THREE.Scene, shadowTex: THREE.CanvasTexture) {
    for (let i = 0; i < 2; i++) {
      const rig = createParamedicRig(shadowTex);
      rig.root.visible = false;
      scene.add(rig.root);
      this.paramedics.push({
        rig,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        walkPhase: i * 1.4,
        targetSlotIdx: -1,
        treatTimer: 0,
        returning: false,
      });
    }
  }

  public registerBus(vehicle: VehicleEntity, startLegIndex: number): void {
    this.buses.push({
      vehicle,
      legIndex: startLegIndex % BUS_LOOP_LEGS.length,
      stopTimer: 0,
      servicedStopThisLeg: false,
      passengers: [],
    });
  }

  public registerAmbulance(vehicle: VehicleEntity): void {
    this.ambulance = vehicle;
  }

  public getActiveBusesCount(): number {
    let count = 0;
    for (const b of this.buses) {
      if (b.vehicle.driver === 'bus') count++;
    }
    return count;
  }

  public getTotalBusPassengers(): number {
    let total = 0;
    for (const b of this.buses) {
      if (b.vehicle.driver === 'bus') total += b.passengers.length;
    }
    return total;
  }

  public getAmbulanceStatusLabel(): string {
    if (!this.ambulance || this.ambulance.driver !== 'ambulance') return 'Indisponível';
    if (this.ambulanceState === 'en_route') return 'A caminho';
    if (this.ambulanceState === 'treating') return 'Atendendo';
    if (this.ambulanceState === 'returning') return 'Retornando';
    return 'Pronta';
  }

  public releaseBusPassengersOnHijack(
    vehicle: VehicleEntity,
    crowd: CrowdManager,
    groundHeightFn: (x: number, z: number, currentY?: number) => number
  ): void {
    const bus = this.buses.find((b) => b.vehicle === vehicle);
    if (!bus) return;
    while (bus.passengers.length > 0) {
      const npcIdx = bus.passengers.pop()!;
      const agent = crowd.agents[npcIdx];
      if (!agent) continue;
      agent.state = 'FLEE';
      agent.boardedBusId = null;
      agent.waitingBusStopIdx = -1;
      agent.busDisembarkCooldown = 15;
      agent.x = vehicle.x + Math.cos(vehicle.heading) * 2.4 + (Math.random() - 0.5);
      agent.z = vehicle.z - Math.sin(vehicle.heading) * 2.4 + (Math.random() - 0.5);
      agent.y = groundHeightFn(agent.x, agent.z);
      agent.inSimRange = true;
      agent.visuallyActive = true;
      agent.triggerFlee(vehicle.x, vehicle.z, 1.0);
    }
    vehicle.busPassengerCount = 0;
  }

  /**
   * Calcula velocidade segura considerando semáforos das interseções de WorldRegistry.intersections
   * e distância para o veículo à frente na mesma faixa.
   */
  public computeSignalAndQueueSpeed(
    v: VehicleEntity,
    axis: 'x' | 'z',
    dir: 1 | -1,
    desiredSpeed: number,
    navGraph: NavGraph,
    allVehicles: VehicleEntity[]
  ): number {
    let allowedSpeed = desiredSpeed;

    if (!navGraph.isVehicleAxisGreen(axis)) {
      const posCoord = axis === 'z' ? v.z : v.x;
      const latCoord = axis === 'z' ? v.x : v.z;

      for (let i = 0; i < INTERSECTIONS.length; i++) {
        const inter = INTERSECTIONS[i];
        if (!inter.hasSignal || inter.isRoundabout) continue;
        const interLat = axis === 'z' ? inter.x : inter.z;
        if (Math.abs(interLat - latCoord) > inter.radius + 4.5) continue;

        const interCoord = axis === 'z' ? inter.z : inter.x;
        const stopBackoff = inter.radius + 3.4 + v.halfLength;
        const stopPos = interCoord - dir * stopBackoff;
        const distToStopLine = (stopPos - posCoord) * dir;

        if (distToStopLine >= -0.8 && distToStopLine <= 21.0) {
          if (distToStopLine <= 0.9) {
            allowedSpeed = 0;
          } else {
            const brakeSpd = Math.max(0, (distToStopLine - 0.6) * 1.15);
            allowedSpeed = Math.min(allowedSpeed, brakeSpd);
          }
          break;
        }
      }
    }

    const sinH = Math.sin(v.heading);
    const cosH = Math.cos(v.heading);

    for (let i = 0; i < allVehicles.length; i++) {
      const other = allVehicles[i];
      if (other === v) continue;

      const dx = other.x - v.x;
      const dz = other.z - v.z;
      const forwardDist = dx * sinH + dz * cosH;
      if (forwardDist <= 0 || forwardDist > 22) continue;

      const lateralDist = Math.abs(dx * cosH - dz * sinH);
      if (lateralDist > v.halfWidth + other.halfWidth + 0.55) continue;

      const gap = forwardDist - v.halfLength - other.halfLength;
      if (gap <= 2.5) {
        allowedSpeed = 0;
        break;
      } else if (gap < 11.5) {
        const followSpd = Math.max(0, (gap - 2.3) * 1.55);
        allowedSpeed = Math.min(allowedSpeed, followSpd);
      }
    }

    return allowedSpeed;
  }

  public update(
    dt: number,
    elapsedSec: number,
    navGraph: NavGraph,
    crowd: CrowdManager,
    ragdolls: RagdollPool,
    allVehicles: VehicleEntity[],
    weatherSpeedMult: number,
    groundHeightFn: (x: number, z: number, currentY?: number) => number,
    onBanner?: (msg: string, duration?: number) => void
  ): void {
    if (this.rescueBannerCooldown > 0) {
      this.rescueBannerCooldown = Math.max(0, this.rescueBannerCooldown - dt);
    }
    this.updateBuses(dt, navGraph, crowd, allVehicles, weatherSpeedMult, groundHeightFn);
    this.updateAmbulanceAndParamedics(
      dt,
      elapsedSec,
      navGraph,
      crowd,
      ragdolls,
      allVehicles,
      weatherSpeedMult,
      groundHeightFn,
      onBanner
    );
  }

  private updateBuses(
    dt: number,
    navGraph: NavGraph,
    crowd: CrowdManager,
    allVehicles: VehicleEntity[],
    weatherSpeedMult: number,
    groundHeightFn: (x: number, z: number, currentY?: number) => number
  ): void {
    for (const bus of this.buses) {
      const v = bus.vehicle;
      if (v.driver !== 'bus') continue;

      const leg = BUS_LOOP_LEGS[bus.legIndex];
      v.npcAxis = leg.axis;
      v.npcDir = leg.dir;

      for (let p = 0; p < bus.passengers.length; p++) {
        const agent = crowd.agents[bus.passengers[p]];
        if (agent) {
          agent.x = v.x;
          agent.z = v.z;
          agent.y = v.mesh.position.y;
        }
      }

      if (bus.stopTimer > 0) {
        bus.stopTimer -= dt;
        v.speed = THREE.MathUtils.damp(v.speed, 0, 8, dt);
        v.taillights.forEach((tl) => {
          (tl.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.6;
        });
        if (bus.stopTimer <= 0) {
          this.exchangePassengersAtStop(bus, leg.stopIdx!, crowd, groundHeightFn);
        }
        const gy = groundHeightFn(v.x, v.z, v.mesh.position.y);
        v.mesh.position.set(v.x, gy, v.z);
        v.mesh.rotation.y = v.heading;
        continue;
      }

      let stopOverrideSpeed: number | null = null;
      if (leg.stopIdx !== null && !bus.servicedStopThisLeg) {
        const stop = WORLD_POIS.busStops[leg.stopIdx];
        const distToStop =
          leg.axis === 'z'
            ? (stop.roadStopZ - v.z) * leg.dir
            : (stop.roadStopX - v.x) * leg.dir;

        const hasWaitingOrAlight = this.hasStopDemand(bus, leg.stopIdx, crowd);
        if (hasWaitingOrAlight && distToStop >= -0.8 && distToStop <= 22) {
          if (distToStop <= 1.2) {
            bus.stopTimer = 2.6;
            bus.servicedStopThisLeg = true;
            v.speed = 0;
            stopOverrideSpeed = 0;
          } else {
            stopOverrideSpeed = Math.max(2.2, distToStop * 0.9);
          }
        }
      }

      const desiredBase = (v.npcTargetSpeed ?? 12.5) * weatherSpeedMult;
      const trafficTarget = this.computeSignalAndQueueSpeed(
        v,
        leg.axis,
        leg.dir,
        stopOverrideSpeed !== null ? Math.min(desiredBase, stopOverrideSpeed) : desiredBase,
        navGraph,
        allVehicles
      );

      v.speed = THREE.MathUtils.damp(v.speed, trafficTarget, 4.2, dt);
      v.taillights.forEach((tl) => {
        (tl.material as THREE.MeshStandardMaterial).emissiveIntensity =
          trafficTarget < 1.5 ? 2.6 : 1.1;
      });

      const targetLaneX = leg.coastal ? getCoastalRoadX(v.z) + 3.2 : leg.laneCoord;
      let desiredHeading =
        leg.axis === 'z'
          ? leg.dir === 1
            ? 0
            : Math.PI
          : leg.dir === 1
          ? Math.PI / 2
          : -Math.PI / 2;

      if (leg.coastal) {
        const nextZ = v.z + leg.dir * 8;
        const nextX = getCoastalRoadX(nextZ) + 3.2;
        desiredHeading = Math.atan2(nextX - v.x, nextZ - v.z);
      }

      let diff = desiredHeading - v.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      v.heading += diff * Math.min(1, dt * 7.5);
      v.frontWheelPivots.forEach((p) => (p.rotation.y = THREE.MathUtils.clamp(diff * 0.5, -0.35, 0.35)));

      if (leg.axis === 'z') {
        v.x += (targetLaneX - v.x) * Math.min(1, dt * 6);
        v.z += leg.dir * v.speed * dt;
        if ((v.z - leg.targetZ) * leg.dir >= 0) {
          v.z = leg.targetZ;
          bus.legIndex = (bus.legIndex + 1) % BUS_LOOP_LEGS.length;
          bus.servicedStopThisLeg = false;
        }
      } else {
        v.z += (leg.laneCoord - v.z) * Math.min(1, dt * 6);
        v.x += leg.dir * v.speed * dt;
        const dynamicTargetX =
          leg.axis === 'x' && leg.dir === 1 && leg.stopIdx === null
            ? getCoastalRoadX(v.z) + 3.2
            : leg.targetX;
        if ((v.x - dynamicTargetX) * leg.dir >= 0) {
          v.x = dynamicTargetX;
          bus.legIndex = (bus.legIndex + 1) % BUS_LOOP_LEGS.length;
          bus.servicedStopThisLeg = false;
        }
      }

      const gy = groundHeightFn(v.x, v.z, v.mesh.position.y);
      v.mesh.position.set(v.x, gy, v.z);
      v.mesh.rotation.y = v.heading;
      v.wheels.forEach((w) => (w.rotation.x += (v.speed * dt) / 0.45));
      v.busPassengerCount = bus.passengers.length;
    }
  }

  private hasStopDemand(bus: BusRuntime, stopIdx: number, crowd: CrowdManager): boolean {
    const stop = WORLD_POIS.busStops[stopIdx];
    for (const npcIdx of bus.passengers) {
      const a = crowd.agents[npcIdx];
      if (!a) continue;
      if (this.findClosestBusStopToPlace(a.commuteTargetPlace?.entryX ?? stop.waitX, a.commuteTargetPlace?.entryZ ?? stop.waitZ) === stopIdx) {
        return true;
      }
    }
    if (bus.passengers.length < BUS_CAPACITY) {
      for (const a of crowd.agents) {
        if (!a.active || a.ragdollActive || a.insideBuilding || a.state !== 'BUS_WAIT') continue;
        if (
          a.waitingBusStopIdx === stopIdx ||
          (a.x - stop.waitX) ** 2 + (a.z - stop.waitZ) ** 2 < 42
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private exchangePassengersAtStop(
    bus: BusRuntime,
    stopIdx: number,
    crowd: CrowdManager,
    groundHeightFn: (x: number, z: number, currentY?: number) => number
  ): void {
    const stop = WORLD_POIS.busStops[stopIdx];

    const remaining: number[] = [];
    for (const npcIdx of bus.passengers) {
      const a = crowd.agents[npcIdx];
      if (!a) continue;
      const bestDestStop = a.commuteTargetPlace
        ? this.findClosestBusStopToPlace(a.commuteTargetPlace.entryX, a.commuteTargetPlace.entryZ)
        : stopIdx;

      if (bestDestStop === stopIdx) {
        a.state = 'WALK';
        a.boardedBusId = null;
        a.waitingBusStopIdx = -1;
        a.busDisembarkCooldown = 28;
        a.x = stop.waitX + (Math.random() - 0.5) * 2.2;
        a.z = stop.waitZ + (Math.random() - 0.5) * 2.2;
        a.y = groundHeightFn(a.x, a.z);
        a.inSimRange = true;
        a.visuallyActive = true;
        a.fadeAlpha = 1.0;
        a.routineLabel = 'Desembarcou (Ônibus)';
        const nearNode = crowd.graph.findClosestNode(a.x, a.z);
        a.currentNodeId = nearNode.id;
        a.targetNodeId = nearNode.edges[0]?.to ?? nearNode.id;
      } else {
        remaining.push(npcIdx);
      }
    }
    bus.passengers = remaining;

    for (const a of crowd.agents) {
      if (bus.passengers.length >= BUS_CAPACITY) break;
      if (!a.active || a.ragdollActive || a.insideBuilding || a.state !== 'BUS_WAIT') continue;
      const nearThisStop =
        a.waitingBusStopIdx === stopIdx ||
        (a.x - stop.waitX) ** 2 + (a.z - stop.waitZ) ** 2 < 48;
      if (!nearThisStop) continue;

      a.state = 'ON_BUS';
      a.boardedBusId = bus.vehicle.id;
      a.waitingBusStopIdx = -1;
      a.routineLabel = 'No Ônibus';
      a.x = bus.vehicle.x;
      a.z = bus.vehicle.z;
      bus.passengers.push(a.index);
    }

    bus.vehicle.busPassengerCount = bus.passengers.length;
  }

  private findClosestBusStopToPlace(px: number, pz: number): number {
    let best = 0;
    let bestD2 = Infinity;
    for (let i = 0; i < WORLD_POIS.busStops.length; i++) {
      const bs = WORLD_POIS.busStops[i];
      const d2 = (bs.waitX - px) ** 2 + (bs.waitZ - pz) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    return best;
  }

  // ==================== AMBULÂNCIA & PARAMÉDICOS NPC ====================

  private updateAmbulanceAndParamedics(
    dt: number,
    elapsedSec: number,
    navGraph: NavGraph,
    crowd: CrowdManager,
    ragdolls: RagdollPool,
    allVehicles: VehicleEntity[],
    weatherSpeedMult: number,
    groundHeightFn: (x: number, z: number, currentY?: number) => number,
    onBanner?: (msg: string, duration?: number) => void
  ): void {
    const amb = this.ambulance;
    if (!amb) return;

    if (amb.driver !== 'ambulance') {
      this.hideParamedics();
      this.ambulanceState = 'idle';
      return;
    }

    if (this.ambulanceCooldown > 0) {
      this.ambulanceCooldown = Math.max(0, this.ambulanceCooldown - dt);
    }

    if (amb.lightBarRed && amb.lightBarBlue) {
      const rMat = amb.lightBarRed.material as THREE.MeshStandardMaterial;
      const bMat = amb.lightBarBlue.material as THREE.MeshStandardMaterial;
      if (this.ambulanceState === 'en_route' || this.ambulanceState === 'treating') {
        const flash = Math.sin(elapsedSec * 18) > 0;
        rMat.emissiveIntensity = flash ? 3.5 : 0.25;
        bMat.emissiveIntensity = flash ? 0.25 : 3.5;
      } else {
        rMat.emissiveIntensity = 0.35;
        bMat.emissiveIntensity = 0.35;
      }
    }

    if (this.ambulanceState === 'idle' && this.ambulanceCooldown <= 0) {
      const targetVictim = this.findPriorityVictim(ragdolls);
      if (targetVictim) {
        this.dispatchAmbulanceToVictim(amb, targetVictim, ragdolls);
        if (this.rescueBannerCooldown <= 0) {
          onBanner?.('Ambulância SAMU despachada para atender feridos na via!', 3.2);
          this.rescueBannerCooldown = 8.0;
        }
      }
    }

    if (this.ambulanceState === 'idle') {
      this.hideParamedics();
      const leg = BUS_LOOP_LEGS[this.ambulancePatrolLeg];
      amb.npcAxis = leg.axis;
      amb.npcDir = leg.dir;
      const desiredSpd = 10.5 * weatherSpeedMult;
      const trafficSpd = this.computeSignalAndQueueSpeed(
        amb,
        leg.axis,
        leg.dir,
        desiredSpd,
        navGraph,
        allVehicles
      );
      amb.speed = THREE.MathUtils.damp(amb.speed, trafficSpd, 4, dt);

      const targetLaneX = leg.coastal ? getCoastalRoadX(amb.z) + 3.2 : leg.laneCoord;
      let desiredH =
        leg.axis === 'z'
          ? leg.dir === 1
            ? 0
            : Math.PI
          : leg.dir === 1
          ? Math.PI / 2
          : -Math.PI / 2;

      if (leg.coastal) {
        const nextZ = amb.z + leg.dir * 8;
        desiredH = Math.atan2(getCoastalRoadX(nextZ) + 3.2 - amb.x, nextZ - amb.z);
      }

      let diff = desiredH - amb.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      amb.heading += diff * Math.min(1, dt * 7);

      if (leg.axis === 'z') {
        amb.x += (targetLaneX - amb.x) * Math.min(1, dt * 5);
        amb.z += leg.dir * amb.speed * dt;
        if ((amb.z - leg.targetZ) * leg.dir >= 0) {
          amb.z = leg.targetZ;
          this.ambulancePatrolLeg = (this.ambulancePatrolLeg + 1) % BUS_LOOP_LEGS.length;
        }
      } else {
        amb.z += (leg.laneCoord - amb.z) * Math.min(1, dt * 5);
        amb.x += leg.dir * amb.speed * dt;
        const dynamicTargetX =
          leg.axis === 'x' && leg.dir === 1 && leg.stopIdx === null
            ? getCoastalRoadX(amb.z) + 3.2
            : leg.targetX;
        if ((amb.x - dynamicTargetX) * leg.dir >= 0) {
          amb.x = dynamicTargetX;
          this.ambulancePatrolLeg = (this.ambulancePatrolLeg + 1) % BUS_LOOP_LEGS.length;
        }
      }
    } else if (this.ambulanceState === 'en_route') {
      this.flagNearbyVictimsRescued(ragdolls);
      const wp = this.ambulancePath[this.ambulancePathIdx];
      if (!wp) {
        this.beginOnSiteTreatment(amb, ragdolls, groundHeightFn);
      } else {
        const dx = wp.x - amb.x;
        const dz = wp.z - amb.z;
        const dist = Math.hypot(dx, dz);
        const isLast = this.ambulancePathIdx >= this.ambulancePath.length - 1;

        if (dist < (isLast ? 5.2 : 4.2)) {
          this.ambulancePathIdx++;
          if (this.ambulancePathIdx >= this.ambulancePath.length) {
            this.beginOnSiteTreatment(amb, ragdolls, groundHeightFn);
          }
        } else {
          const desiredHeading = Math.atan2(dx, dz);
          let diff = desiredHeading - amb.heading;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          amb.heading += THREE.MathUtils.clamp(diff, -3.4 * dt, 3.4 * dt);

          const turnFactor = Math.abs(diff) > 0.55 ? 0.52 : 1.0;
          let emergencySpd =
            (isLast && dist < 12 ? Math.max(5, dist * 1.1) : 17.5 * turnFactor) *
            (0.84 + 0.16 * weatherSpeedMult);

          const sinH = Math.sin(amb.heading);
          const cosH = Math.cos(amb.heading);
          for (const other of allVehicles) {
            if (other === amb) continue;
            const odx = other.x - amb.x;
            const odz = other.z - amb.z;
            const fwd = odx * sinH + odz * cosH;
            if (fwd > 0 && fwd < 10) {
              const lat = Math.abs(odx * cosH - odz * sinH);
              if (lat < 2.2) {
                emergencySpd = Math.min(emergencySpd, 4.5);
                amb.heading += (odx * cosH - odz * sinH >= 0 ? -1.4 : 1.4) * dt;
              }
            }
          }

          amb.speed = THREE.MathUtils.damp(amb.speed, emergencySpd, 5, dt);
          amb.x += Math.sin(amb.heading) * amb.speed * dt;
          amb.z += Math.cos(amb.heading) * amb.speed * dt;
        }
      }
    } else if (this.ambulanceState === 'treating') {
      amb.speed = THREE.MathUtils.damp(amb.speed, 0, 8, dt);
      this.flagNearbyVictimsRescued(ragdolls);
      this.stepParamedics(dt, amb, crowd, ragdolls, groundHeightFn, onBanner);
    } else if (this.ambulanceState === 'returning') {
      amb.speed = THREE.MathUtils.damp(amb.speed, 0, 6, dt);
      this.ambulanceCooldown = 2.0;
      this.ambulancePatrolLeg = this.findNearestPatrolLeg(amb.x, amb.z);
      this.ambulanceState = 'idle';
    }

    const gy = groundHeightFn(amb.x, amb.z, amb.mesh.position.y);
    amb.mesh.position.set(amb.x, gy, amb.z);
    amb.mesh.rotation.y = amb.heading;
    amb.wheels.forEach((w) => (w.rotation.x += (amb.speed * dt) / 0.38));
  }

  private findPriorityVictim(ragdolls: RagdollPool): ActiveRagdoll | null {
    let best: ActiveRagdoll | null = null;
    let bestScore = Infinity;
    for (const r of ragdolls.slots) {
      if (!r.active) continue;
      if (r.outcome !== 'unconscious' && r.outcome !== 'out') continue;
      const distAmb = this.ambulance
        ? Math.hypot(r.x - this.ambulance.x, r.z - this.ambulance.z)
        : 0;
      if (distAmb < bestScore) {
        bestScore = distAmb;
        best = r;
      }
    }
    return best;
  }

  private flagNearbyVictimsRescued(ragdolls: RagdollPool): void {
    for (const r of ragdolls.slots) {
      if (!r.active) continue;
      if (r.outcome === 'unconscious' || r.outcome === 'out') {
        r.beingRescued = true;
      }
    }
  }

  /**
   * Calcula o menor caminho no grafo viário (WorldRegistry.intersections) até a via mais próxima da vítima.
   */
  private dispatchAmbulanceToVictim(
    amb: VehicleEntity,
    victim: ActiveRagdoll,
    ragdolls: RagdollPool
  ): void {
    this.flagNearbyVictimsRescued(ragdolls);

    const startIdx = this.findNearestIntersectionIndex(amb.x, amb.z);
    const goalRoad = this.projectToNearestRoad(victim.x, victim.z);
    const goalIdx = this.findNearestIntersectionIndex(goalRoad.x, goalRoad.z);

    const pathIndices = this.bfsIntersectionPath(startIdx, goalIdx);
    this.ambulancePath = pathIndices.map((idx) => ({
      x: INTERSECTIONS[idx].x,
      z: INTERSECTIONS[idx].z,
    }));

    const last = this.ambulancePath[this.ambulancePath.length - 1];
    if (!last || Math.hypot(last.x - goalRoad.x, last.z - goalRoad.z) > 4) {
      this.ambulancePath.push({ x: goalRoad.x, z: goalRoad.z });
    }

    this.ambulancePathIdx = 0;
    this.ambulanceState = 'en_route';
  }

  private findNearestIntersectionIndex(x: number, z: number): number {
    let bestIdx = 0;
    let bestD2 = Infinity;
    for (let i = 0; i < INTERSECTIONS.length; i++) {
      const it = INTERSECTIONS[i];
      const d2 = (it.x - x) ** 2 + (it.z - z) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  private projectToNearestRoad(vx: number, vz: number): { x: number; z: number } {
    let bestX = vx;
    let bestZ = vz;
    let bestD2 = Infinity;

    for (const s of STREETS) {
      if (s.kind === 'roundabout') continue;
      for (const seg of s.segments) {
        const dx = seg.x2 - seg.x1;
        const dz = seg.z2 - seg.z1;
        const len2 = dx * dx + dz * dz;
        if (len2 < 1e-4) continue;
        const t = Math.max(0, Math.min(1, ((vx - seg.x1) * dx + (vz - seg.z1) * dz) / len2));
        const px = seg.x1 + t * dx;
        const pz = seg.z1 + t * dz;
        const d2 = (px - vx) ** 2 + (pz - vz) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestX = px + seg.dirZ * 2.8;
          bestZ = pz - seg.dirX * 2.8;
        }
      }
    }
    return { x: bestX, z: bestZ };
  }

  private bfsIntersectionPath(startIdx: number, goalIdx: number): number[] {
    if (startIdx === goalIdx) return [startIdx];
    const queue: number[] = [startIdx];
    const parent = new Map<number, number>();
    const visited = new Set<number>([startIdx]);

    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === goalIdx) break;
      const inter = INTERSECTIONS[cur];
      if (!inter) continue;
      for (const next of inter.neighborIds) {
        if (visited.has(next)) continue;
        visited.add(next);
        parent.set(next, cur);
        queue.push(next);
      }
    }

    if (!visited.has(goalIdx)) return [startIdx, goalIdx];
    const res: number[] = [];
    let cur: number | undefined = goalIdx;
    while (cur !== undefined) {
      res.push(cur);
      cur = parent.get(cur);
    }
    res.reverse();
    return res;
  }

  private beginOnSiteTreatment(
    amb: VehicleEntity,
    ragdolls: RagdollPool,
    groundHeightFn: (x: number, z: number, currentY?: number) => number
  ): void {
    this.ambulanceState = 'treating';
    const backX = amb.x - Math.sin(amb.heading) * 3.4;
    const backZ = amb.z - Math.cos(amb.heading) * 3.4;
    const sideX = Math.cos(amb.heading);
    const sideZ = -Math.sin(amb.heading);

    this.paramedics.forEach((p, idx) => {
      const offset = idx === 0 ? -0.9 : 0.9;
      p.x = backX + sideX * offset;
      p.z = backZ + sideZ * offset;
      p.y = groundHeightFn(p.x, p.z);
      p.yaw = amb.heading + Math.PI;
      p.targetSlotIdx = -1;
      p.treatTimer = 0;
      p.returning = false;
      p.rig.root.visible = true;
      p.rig.root.position.set(p.x, p.y, p.z);
    });

    this.assignParamedicTargets(amb, ragdolls);
  }

  private assignParamedicTargets(amb: VehicleEntity, ragdolls: RagdollPool): void {
    const claimed = new Set<number>();
    for (const p of this.paramedics) {
      if (p.targetSlotIdx >= 0 && ragdolls.slots[p.targetSlotIdx]?.active) {
        claimed.add(p.targetSlotIdx);
      }
    }

    for (const p of this.paramedics) {
      if (p.targetSlotIdx >= 0 && ragdolls.slots[p.targetSlotIdx]?.active) continue;

      let bestIdx = -1;
      let bestD2 = 75 * 75;
      for (let i = 0; i < ragdolls.slots.length; i++) {
        const r = ragdolls.slots[i];
        if (!r.active || claimed.has(i)) continue;
        if (r.outcome !== 'unconscious' && r.outcome !== 'out') continue;
        const d2 = (r.x - amb.x) ** 2 + (r.z - amb.z) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestIdx = i;
        }
      }

      if (bestIdx !== -1) {
        p.targetSlotIdx = bestIdx;
        p.treatTimer = 0;
        p.returning = false;
        claimed.add(bestIdx);
      } else {
        p.targetSlotIdx = -1;
        p.returning = true;
      }
    }
  }

  private stepParamedics(
    dt: number,
    amb: VehicleEntity,
    crowd: CrowdManager,
    ragdolls: RagdollPool,
    groundHeightFn: (x: number, z: number, currentY?: number) => number,
    onBanner?: (msg: string, duration?: number) => void
  ): void {
    this.assignParamedicTargets(amb, ragdolls);

    const doorX = amb.x - Math.sin(amb.heading) * 3.3;
    const doorZ = amb.z - Math.cos(amb.heading) * 3.3;
    let allReturned = true;

    for (const p of this.paramedics) {
      if (!p.rig.root.visible) continue;

      if (!p.returning && p.targetSlotIdx >= 0) {
        const slot = ragdolls.slots[p.targetSlotIdx];
        if (!slot || !slot.active) {
          p.targetSlotIdx = -1;
          p.treatTimer = 0;
          continue;
        }
        allReturned = false;

        const dx = slot.x - p.x;
        const dz = slot.z - p.z;
        const dist = Math.hypot(dx, dz);

        if (dist > 1.25) {
          const spd = 4.6;
          p.x += (dx / dist) * spd * dt;
          p.z += (dz / dist) * spd * dt;
          p.yaw = Math.atan2(dx, dz);
          p.walkPhase += dt * 11;
          const swing = Math.sin(p.walkPhase) * 0.65;
          p.rig.leftLegPivot.rotation.x = swing;
          p.rig.rightLegPivot.rotation.x = -swing;
          p.rig.leftArmPivot.rotation.x = -swing * 0.7;
          p.rig.rightArmPivot.rotation.x = swing * 0.5;
          p.rig.torsoGroup.rotation.x = 0.08;
        } else {
          p.yaw = Math.atan2(dx, dz);
          p.treatTimer += dt;
          p.walkPhase += dt * 9;
          p.rig.leftLegPivot.rotation.x = -0.35;
          p.rig.rightLegPivot.rotation.x = 0.35;
          p.rig.torsoGroup.rotation.x = 0.45;
          p.rig.leftArmPivot.rotation.x = -1.1 + Math.sin(p.walkPhase) * 0.35;
          p.rig.rightArmPivot.rotation.x = -1.1 - Math.sin(p.walkPhase) * 0.35;

          if (p.treatTimer >= 2.0) {
            const npc = crowd.agents[slot.npcIndex];
            const wasUnconscious = slot.outcome === 'unconscious';
            const rx = slot.x;
            const rz = slot.z;

            ragdolls.rescueSlot(p.targetSlotIdx);
            this.totalRescuedCount++;

            if (npc) {
              npc.ragdollActive = false;
              if (wasUnconscious) {
                npc.health = Math.round(npc.maxHealth * 0.55);
                npc.injuryStatus = 'injured';
                const cz = Math.max(WORLD_BOUNDS.minZ + 4, Math.min(WORLD_BOUNDS.maxZ - 4, rz));
                npc.x = Math.max(WORLD_BOUNDS.minX + 4, Math.min(getCoastlineX(cz) + 18, rx));
                npc.z = cz;
                npc.y = groundHeightFn(npc.x, npc.z);
                npc.inSimRange = true;
                npc.visuallyActive = true;
                npc.fadeAlpha = 1.0;
                npc.state = 'LIMP';
                npc.stateTimer = 4.0;
                npc.routineLabel = 'Socorrido (SAMU)';
              } else {
                npc.injuryStatus = 'out';
                npc.visuallyActive = false;
              }
            }

            if (this.rescueBannerCooldown <= 0) {
              onBanner?.(
                wasUnconscious
                  ? 'Paramédicos reanimaram cidadão ferido no local!'
                  : 'Paramédicos estabilizaram e removeram vítima da via.',
                2.8
              );
              this.rescueBannerCooldown = 5.0;
            }

            p.targetSlotIdx = -1;
            p.treatTimer = 0;
          }
        }
      } else {
        const dx = doorX - p.x;
        const dz = doorZ - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 1.45) {
          allReturned = false;
          const spd = 4.2;
          p.x += (dx / dist) * spd * dt;
          p.z += (dz / dist) * spd * dt;
          p.yaw = Math.atan2(dx, dz);
          p.walkPhase += dt * 10;
          const swing = Math.sin(p.walkPhase) * 0.55;
          p.rig.leftLegPivot.rotation.x = swing;
          p.rig.rightLegPivot.rotation.x = -swing;
          p.rig.leftArmPivot.rotation.x = -swing * 0.6;
          p.rig.rightArmPivot.rotation.x = swing * 0.5;
          p.rig.torsoGroup.rotation.x = 0.05;
        } else {
          p.rig.root.visible = false;
        }
      }

      p.y = groundHeightFn(p.x, p.z, p.y);
      p.rig.root.position.set(p.x, p.y, p.z);
      p.rig.root.rotation.y = p.yaw;
    }

    if (allReturned) {
      this.hideParamedics();
      this.ambulanceState = 'returning';
    }
  }

  private hideParamedics(): void {
    for (const p of this.paramedics) {
      p.rig.root.visible = false;
      p.targetSlotIdx = -1;
      p.treatTimer = 0;
      p.returning = false;
    }
  }

  private findNearestPatrolLeg(x: number, z: number): number {
    let best = 0;
    let bestD2 = Infinity;
    for (let i = 0; i < BUS_LOOP_LEGS.length; i++) {
      const leg = BUS_LOOP_LEGS[i];
      const d2 = (leg.targetX - x) ** 2 + (leg.targetZ - z) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    return best;
  }
}
