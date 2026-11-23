import { BuildingRegistry, RegisteredPlace } from './BuildingRegistry';
import { LodLevel } from './LODSystem';
import { NavEdge, NavGraph, NavNode } from './NavGraph';
import {
  NpcPersonality,
  NpcProfession,
  NpcProfile,
  ScheduleDirective,
  ScheduleSystem,
} from './ScheduleSystem';
import { WeatherType } from './types';
import { WORLD_POIS } from './world';
import { WORLD_BOUNDS, WorldRegistry } from './world/WorldRegistry';
import { ZoneDensityManager } from './ZoneDensityManager';

export type PedestrianArchetype =
  | 'tourist'
  | 'volleyball'
  | 'runner'
  | 'executive'
  | 'skater';

export type PedestrianState =
  | 'WALK'
  | 'JOG'
  | 'LIMP'
  | 'PHONE'
  | 'CHAT'
  | 'SIT'
  | 'SHOP'
  | 'SELFIE'
  | 'DANCE'
  | 'VOLLEY'
  | 'BUS_WAIT'
  | 'ON_BUS'
  | 'WAIT_CROSSWALK'
  | 'DODGE'
  | 'FLEE'
  | 'INSIDE_BUILDING';

export type NpcInjuryStatus = 'healthy' | 'injured' | 'unconscious' | 'out';

export interface PedestrianPose {
  headPitch: number;
  leftArmX: number;
  leftArmZ: number;
  rightArmX: number;
  rightArmZ: number;
  leftLegX: number;
  rightLegX: number;
  hipDropY: number;
  jumpY: number;
  torsoLeanX: number;
}

export interface WorldThreatContext {
  playerX: number;
  playerZ: number;
  fastVehicles: Array<{ x: number; z: number; vx: number; vz: number; speed: number }>;
  chasingPolice: Array<{ x: number; z: number }>;
  isNight: boolean;
  gameTime: number;
  isWeekend: boolean;
  weather: WeatherType;
}

/**
 * Controlador individual de IA para cada cidadão do pool (600 NPCs no total, 150–250 visíveis).
 * Integra rotina diária, densidade por zona, comportamento climático (40% abrigo na chuva),
 * desvio educado entre pedestres e recuperação/fade rápido de feridos.
 */
export class PedestrianAI {
  public readonly index: number;
  public active = false;
  public inSimRange = false; // true quando <= 150m do jogador
  public visuallyActive = false; // true quando promovido ao orçamento visível na tela
  public ragdollActive = false; // true enquanto arremessado pelo RagdollPool

  public profile!: NpcProfile;
  public archetype: PedestrianArchetype = 'tourist';
  public personality: NpcPersonality = 'calm';
  public state: PedestrianState = 'WALK';

  public health = 90;
  public maxHealth = 90;
  public injuryStatus: NpcInjuryStatus = 'healthy';
  public injuredByPlayer = false;
  public injuredTimer = 0;
  public fadingInjuredOut = false;

  public skinColor = 0xe0ac84;
  public shirtColor = 0xff477e;
  public pantsColor = 0x1e293b;
  public hairColor = 0x14111f;

  // Controle de entrada/saída de prédios com fade suave
  public insideBuilding: RegisteredPlace | null = null;
  public fadeAlpha = 1.0;
  public fadingOut = false;

  // Rótulos da rotina atual, transporte público e estado climático individual
  public routineLabel = 'Passeio';
  public targetHourLabel = '18:00';
  public hasUmbrella = false;
  public umbrellaOpen = false;
  public weatherSpeedScale = 1.0;
  public activeWeather: WeatherType = 'clear';
  public waitingBusStopIdx = -1;
  public boardedBusId: string | null = null;
  public busDisembarkCooldown = 0;
  public commuteTargetPlace: RegisteredPlace | null = null;
  private isRushBusCommute = false;
  private targetBusStopIdx = -1;
  private activeDirective: ScheduleDirective | null = null;
  private shelterDirective: ScheduleDirective = {
    routineLabel: 'Buscando Abrigo',
    targetHourLabel: 'Chuva',
    targetPlace: null as unknown as RegisteredPlace,
    shouldBeInside: true,
    wanderAround: false,
  };

  public x = 0;
  public z = 0;
  public y = 0;
  public yaw = 0;
  public heightScale = 1.0;
  public widthScale = 1.0;

  public stateTimer = 0;
  public animPhase = 0;
  public fearLevel = 0;

  // Navegação por grafo
  public currentNodeId = 0;
  public targetNodeId = 0;
  public pendingEdge: NavEdge | null = null;
  private fleeDirX = 0;
  private fleeDirZ = 1;
  private dodgeVelX = 0;
  private dodgeVelZ = 0;

  // Desvio educado ("desculpa") ao cruzar com outro pedestre em sentido oposto
  public courtesyTimer = 0;
  public courtesyOffsetX = 0;
  public courtesyOffsetZ = 0;

  // Desvio mútuo acumulado pela grade espacial
  public sepX = 0;
  public sepZ = 0;
  public nearbyPeerCount = 0;

  constructor(index: number) {
    this.index = index;
    this.animPhase = (index * 1.37) % (Math.PI * 2);
  }

  public initCitizen(
    profile: NpcProfile,
    heightScale: number,
    widthScale: number,
    colors: { skin: number; hair: number; shirt: number; pants: number }
  ): void {
    this.profile = profile;
    this.personality = profile.personality;
    this.archetype = this.mapProfessionToArchetype(profile.profession);
    this.maxHealth = profile.maxHealth;
    this.health = profile.maxHealth;
    this.injuryStatus = 'healthy';
    this.injuredByPlayer = false;
    this.injuredTimer = 0;
    this.fadingInjuredOut = false;
    this.heightScale = heightScale;
    this.widthScale = widthScale;
    this.skinColor = colors.skin;
    this.hairColor = colors.hair;
    this.shirtColor = colors.shirt;
    this.pantsColor = colors.pants;
    this.active = true;
    this.ragdollActive = false;
    this.insideBuilding = null;
    this.fadeAlpha = 1.0;
    this.fadingOut = false;
    this.fearLevel = 0;
    // Na chuva: 0..3 (40%) buscam abrigo interno; 4..7 (40%) abrem guarda-chuva; 8..9 (20%) andam rápido
    const rainSlot = this.index % 10;
    this.hasUmbrella = rainSlot >= 4 && rainSlot < 8;
    this.umbrellaOpen = false;
    this.waitingBusStopIdx = -1;
    this.boardedBusId = null;
    this.busDisembarkCooldown = 0;
    this.commuteTargetPlace = null;
    this.isRushBusCommute = false;
    this.targetBusStopIdx = -1;
    this.courtesyTimer = 0;
  }

  private mapProfessionToArchetype(prof: NpcProfession): PedestrianArchetype {
    if (prof === 'volleyball') return 'volleyball';
    if (prof === 'runner') return 'runner';
    if (prof === 'skater') return 'skater';
    if (prof === 'executive' || prof === 'guard') return 'executive';
    return 'tourist';
  }

  /**
   * Inicia recuperação/fade rápido quando o limite de 30 feridos simultâneos for atingido.
   */
  public triggerFastInjuredFade(): void {
    if (this.injuryStatus === 'healthy') return;
    this.fadingInjuredOut = true;
  }

  public resetToHealthy(): void {
    this.health = this.maxHealth;
    this.injuryStatus = 'healthy';
    this.injuredByPlayer = false;
    this.injuredTimer = 0;
    this.fadingInjuredOut = false;
    this.ragdollActive = false;
    this.fadeAlpha = 1.0;
    this.fadingOut = false;
    this.fearLevel = 0;
    this.state = this.archetype === 'runner' ? 'JOG' : 'WALK';
    this.stateTimer = 2.0 + Math.random() * 2.5;
  }

  /**
   * Reposiciona o NPC de acordo com sua agenda ao entrar na zona de simulação ou no pool remoto.
   */
  public syncToSchedule(
    gameTime: number,
    isWeekend: boolean,
    graph: NavGraph,
    schedule: ScheduleSystem,
    zoneDensity?: ZoneDensityManager
  ): void {
    if (this.injuryStatus === 'out' || this.ragdollActive) return;

    const snap = schedule.computeRemoteSpawnPosition(
      this.profile,
      gameTime,
      isWeekend,
      graph,
      this.index
    );

    this.routineLabel = snap.directive.routineLabel;
    this.targetHourLabel = snap.directive.targetHourLabel;
    this.activeDirective = snap.directive;

    // Libera ocupação anterior se mudou de prédio
    if (this.insideBuilding && (!snap.inside || this.insideBuilding !== snap.directive.targetPlace)) {
      this.insideBuilding.insideCount = Math.max(0, this.insideBuilding.insideCount - 1);
      this.insideBuilding = null;
    }

    if (snap.inside) {
      this.enterBuildingImmediate(snap.directive.targetPlace);
      return;
    }

    this.x = snap.x;
    this.z = snap.z;
    this.fadeAlpha = 1.0;
    this.fadingOut = false;
    this.waitingBusStopIdx = -1;
    this.boardedBusId = null;
    const nearNode = graph.findClosestNode(this.x, this.z);
    this.currentNodeId = nearNode.id;
    this.targetNodeId = nearNode.id;
    this.pickNextWaypointTowardsGoal(graph, zoneDensity);
    this.state = this.injuryStatus === 'injured' ? 'LIMP' : this.archetype === 'runner' ? 'JOG' : 'WALK';
    this.stateTimer = 2 + Math.random() * 3;
  }

  public spawnAt(node: NavNode): void {
    this.inSimRange = true;
    this.visuallyActive = true;
    this.ragdollActive = false;
    this.injuryStatus = 'healthy';
    this.injuredByPlayer = false;
    this.injuredTimer = 0;
    this.fadingInjuredOut = false;
    this.health = this.maxHealth;
    this.insideBuilding = null;
    this.fadeAlpha = 1.0;
    this.fadingOut = false;
    this.x = node.x + (Math.random() - 0.5) * 1.4;
    this.z = node.z + (Math.random() - 0.5) * 1.4;
    this.y = 0;
    this.yaw = Math.random() * Math.PI * 2;
    this.currentNodeId = node.id;
    this.targetNodeId = node.id;
    this.state = this.archetype === 'runner' ? 'JOG' : 'WALK';
    this.stateTimer = 1.5 + Math.random() * 2.5;
  }

  private enterBuildingImmediate(place: RegisteredPlace): void {
    if (this.insideBuilding !== place) {
      if (this.insideBuilding) {
        this.insideBuilding.insideCount = Math.max(0, this.insideBuilding.insideCount - 1);
      }
      this.insideBuilding = place;
      place.insideCount++;
    }
    this.x = place.entryX;
    this.z = place.entryZ;
    this.fadeAlpha = 0;
    this.fadingOut = false;
    this.state = 'INSIDE_BUILDING';
  }

  private leaveBuilding(): void {
    if (!this.insideBuilding) return;
    const door = this.insideBuilding;
    door.insideCount = Math.max(0, door.insideCount - 1);
    this.insideBuilding = null;
    this.x = door.entryX + (Math.random() - 0.5) * 0.8;
    this.z = door.entryZ + (Math.random() - 0.5) * 0.8;
    this.fadeAlpha = 0.05;
    this.fadingOut = false;
    this.state = this.injuryStatus === 'injured' ? 'LIMP' : 'WALK';
    this.stateTimer = 2.0;
  }

  public triggerCourtesySidestep(otherX: number, otherZ: number): void {
    if (this.courtesyTimer > 0 || this.state === 'FLEE' || this.state === 'DODGE') return;
    // Desvia educadamente para a direita da direção de deslocamento
    const fwdX = Math.sin(this.yaw);
    const fwdZ = Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);
    const dx = otherX - this.x;
    const dz = otherZ - this.z;
    // Se o outro está um pouco à direita, desvia à esquerda; caso contrário à direita
    const side = dx * rightX + dz * rightZ > 0 ? -1 : 1;
    this.courtesyOffsetX = (rightX * side - fwdX * 0.12) * 2.2;
    this.courtesyOffsetZ = (rightZ * side - fwdZ * 0.12) * 2.2;
    this.courtesyTimer = 0.85;
  }

  public triggerFlee(threatX: number, threatZ: number, minFear = 1.0): void {
    if (
      !this.active ||
      this.ragdollActive ||
      this.injuryStatus === 'out' ||
      this.insideBuilding ||
      this.state === 'ON_BUS'
    ) {
      return;
    }
    this.waitingBusStopIdx = -1;
    const dx = this.x - threatX;
    const dz = this.z - threatZ;
    const len = Math.hypot(dx, dz) || 1;
    this.fleeDirX = dx / len;
    this.fleeDirZ = dz / len;
    const mult = this.personality === 'fearful' ? 1.45 : this.personality === 'calm' ? 0.75 : 1.0;
    this.fearLevel = Math.max(this.fearLevel, Math.min(1, minFear));
    this.state = 'FLEE';
    this.stateTimer = (4.0 + Math.random() * 3.0) * mult;
    this.pendingEdge = null;
  }

  public triggerDodge(carX: number, carZ: number, carVx: number, carVz: number): void {
    if (
      !this.active ||
      this.ragdollActive ||
      this.insideBuilding ||
      this.state === 'ON_BUS' ||
      this.state === 'FLEE' ||
      this.state === 'DODGE'
    ) {
      return;
    }
    this.waitingBusStopIdx = -1;
    const dx = this.x - carX;
    const dz = this.z - carZ;
    const cross = dx * carVz - dz * carVx;
    const side = cross >= 0 ? 1 : -1;
    const carLen = Math.hypot(carVx, carVz) || 1;
    const perpX = (-carVz / carLen) * side;
    const perpZ = (carVx / carLen) * side;

    this.dodgeVelX = perpX * 6.5;
    this.dodgeVelZ = perpZ * 6.5;
    this.state = 'DODGE';
    this.stateTimer = 0.65;
    this.yaw = Math.atan2(-perpX, -perpZ);
  }

  /**
   * Atualiza decisões da rotina (sem timer próprio: lê sempre gameTime), clima e desvio de densidade.
   */
  public stepDecision(
    dt: number,
    graph: NavGraph,
    schedule: ScheduleSystem,
    registry: BuildingRegistry,
    ctx: WorldThreatContext,
    zoneDensity?: ZoneDensityManager
  ): void {
    if (!this.active || this.ragdollActive || this.injuryStatus === 'out') return;

    if (this.busDisembarkCooldown > 0) {
      this.busDisembarkCooldown = Math.max(0, this.busDisembarkCooldown - dt);
    }

    if (this.state === 'ON_BUS') {
      this.routineLabel = 'No Ônibus';
      return;
    }

    this.activeWeather = ctx.weather;
    let directive = schedule.evaluate(this.profile, ctx.gameTime, ctx.isWeekend, this.index);
    this.commuteTargetPlace = directive.targetPlace;

    // Horário de pico (08h-09h e 17h-19h em dias úteis): passageiros de bairros distantes pegam ônibus
    const isRushHour =
      !ctx.isWeekend &&
      ((ctx.gameTime >= 8.0 && ctx.gameTime < 9.15) || (ctx.gameTime >= 17.0 && ctx.gameTime < 19.0));
    this.isRushBusCommute = false;
    this.targetBusStopIdx = -1;

    if (
      isRushHour &&
      this.busDisembarkCooldown <= 0 &&
      this.injuryStatus === 'healthy' &&
      !directive.shouldBeInside &&
      this.state !== 'FLEE' &&
      this.archetype !== 'runner'
    ) {
      const distToGoal = Math.hypot(
        directive.targetPlace.entryX - this.x,
        directive.targetPlace.entryZ - this.z
      );
      if (distToGoal > 46) {
        let bestOrigIdx = -1;
        let bestOrigD2 = Infinity;
        let bestDestIdx = -1;
        let bestDestD2 = Infinity;
        for (let i = 0; i < WORLD_POIS.busStops.length; i++) {
          const bs = WORLD_POIS.busStops[i];
          const dOrig2 = (bs.waitX - this.x) ** 2 + (bs.waitZ - this.z) ** 2;
          if (dOrig2 < bestOrigD2) {
            bestOrigD2 = dOrig2;
            bestOrigIdx = i;
          }
          const dDest2 =
            (bs.waitX - directive.targetPlace.entryX) ** 2 +
            (bs.waitZ - directive.targetPlace.entryZ) ** 2;
          if (dDest2 < bestDestD2) {
            bestDestD2 = dDest2;
            bestDestIdx = i;
          }
        }
        if (bestOrigIdx !== -1 && bestOrigIdx !== bestDestIdx && bestOrigD2 < 52 * 52) {
          this.isRushBusCommute = true;
          this.targetBusStopIdx = bestOrigIdx;
        }
      }
    }

    // Adaptação climática coerente:
    // Chuva -> 40% (index % 10 < 4) entram em lojas/prédios com fade;
    // 40% (4..7) usam guarda-chuva; 20% (8..9) caminham apressados.
    if (ctx.weather === 'rain') {
      const rainGroup = this.index % 10;
      const seeksIndoorShop = rainGroup < 4 && this.injuryStatus === 'healthy';
      const usesUmbrella = this.hasUmbrella && this.injuryStatus === 'healthy';
      this.umbrellaOpen = usesUmbrella && !this.insideBuilding && this.state !== 'FLEE';

      if (seeksIndoorShop) {
        const shelter = registry.findNearestShelter(this.x, this.z, true);
        this.shelterDirective.routineLabel = 'Abrigo em Loja (Chuva)';
        this.shelterDirective.targetHourLabel = directive.targetHourLabel;
        this.shelterDirective.targetPlace = shelter;
        this.shelterDirective.shouldBeInside = shelter.hasInterior;
        this.shelterDirective.wanderAround = false;
        directive = this.shelterDirective;
        this.weatherSpeedScale = 1.38;
      } else if (usesUmbrella) {
        this.weatherSpeedScale = 1.08;
      } else {
        this.weatherSpeedScale = 1.42;
      }
    } else if (ctx.weather === 'fog') {
      this.umbrellaOpen = false;
      this.weatherSpeedScale = 0.84;
    } else if (ctx.weather === 'heat') {
      this.umbrellaOpen = (this.index % 4) === 0 && !this.insideBuilding && this.state !== 'FLEE';
      this.weatherSpeedScale = 0.86;
      if (!directive.shouldBeInside && !this.umbrellaOpen && this.index % 3 === 0) {
        const shade = registry.findNearestShelter(this.x, this.z, false);
        this.shelterDirective.routineLabel = 'Procurando Sombra (Calor)';
        this.shelterDirective.targetHourLabel = directive.targetHourLabel;
        this.shelterDirective.targetPlace = shade;
        this.shelterDirective.shouldBeInside = shade.hasInterior;
        this.shelterDirective.wanderAround = !shade.hasInterior;
        directive = this.shelterDirective;
      }
    } else {
      this.umbrellaOpen = false;
      this.weatherSpeedScale = 1.0;
    }

    this.activeDirective = directive;
    this.routineLabel =
      this.state === 'FLEE'
        ? 'Fugindo!'
        : this.state === 'BUS_WAIT'
        ? 'Esperando Ônibus'
        : this.isRushBusCommute
        ? 'Indo à Parada (Pico)'
        : this.injuryStatus === 'injured'
        ? 'Ferido (Mancando)'
        : ctx.weather === 'rain' && this.umbrellaOpen
        ? 'Sob Guarda-Chuva'
        : ctx.weather === 'heat' && this.umbrellaOpen
        ? 'Sombrinha no Calor'
        : directive.routineLabel;
    this.targetHourLabel = directive.targetHourLabel;

    // Se está dentro de um prédio, checa se deve sair
    if (this.insideBuilding) {
      if (!directive.shouldBeInside || directive.targetPlace !== this.insideBuilding) {
        this.leaveBuilding();
      }
      return;
    }

    // Se chegou perto da parada de ônibus alvo no horário de pico, aguarda em BUS_WAIT
    if (this.isRushBusCommute && this.targetBusStopIdx >= 0) {
      const stop = WORLD_POIS.busStops[this.targetBusStopIdx];
      const distStop = Math.hypot(stop.waitX - this.x, stop.waitZ - this.z);
      if (distStop < 3.4) {
        this.state = 'BUS_WAIT';
        this.waitingBusStopIdx = this.targetBusStopIdx;
        this.yaw = stop.yaw;
        this.stateTimer = 14.0;
        return;
      }
    } else if (this.state !== 'BUS_WAIT') {
      this.waitingBusStopIdx = -1;
    }

    // Se deve estar abrigado/dentro do prédio e já chegou na porta -> entra com fade
    if (
      directive.shouldBeInside &&
      directive.targetPlace.hasInterior &&
      this.state !== 'FLEE' &&
      this.injuryStatus !== 'injured'
    ) {
      const distDoor = Math.hypot(
        directive.targetPlace.entryX - this.x,
        directive.targetPlace.entryZ - this.z
      );
      if (distDoor < 2.6) {
        this.fadingOut = true;
        this.insideBuilding = directive.targetPlace;
        directive.targetPlace.insideCount++;
        this.umbrellaOpen = false;
        this.waitingBusStopIdx = -1;
        return;
      }
    }

    // Reação a carros velozes próximos
    for (const car of ctx.fastVehicles) {
      if (car.speed < 13.0) continue;
      const d2 = (this.x - car.x) ** 2 + (this.z - car.z) ** 2;
      if (d2 < 46) {
        this.triggerDodge(car.x, car.z, car.vx, car.vz);
        return;
      }
    }

    // Polícia em perseguição: afasta da rua
    for (const cop of ctx.chasingPolice) {
      const dx = this.x - cop.x;
      const dz = this.z - cop.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 256) {
        if (this.personality === 'fearful') {
          this.triggerFlee(cop.x, cop.z, 0.85);
        } else {
          const len = Math.sqrt(d2) || 1;
          this.sepX += (dx / len) * 3.5;
          this.sepZ += (dz / len) * 3.5;
        }
      }
    }

    // Jogador a pé muito perto
    const pDx = this.x - ctx.playerX;
    const pDz = this.z - ctx.playerZ;
    const pDist = Math.hypot(pDx, pDz);
    if (pDist < 2.4 && pDist > 0.05) {
      if (this.personality === 'curious' && (this.state === 'WALK' || this.state === 'PHONE')) {
        this.yaw = Math.atan2(-pDx, -pDz);
      } else {
        this.sepX += (pDx / pDist) * 2.5;
        this.sepZ += (pDz / pDist) * 2.5;
      }
    }

    if (this.state === 'WAIT_CROSSWALK' && this.pendingEdge) {
      if (graph.canCrossEdge(this.pendingEdge)) {
        this.targetNodeId = this.pendingEdge.to;
        this.pendingEdge = null;
        this.state = this.injuryStatus === 'injured' ? 'LIMP' : this.archetype === 'runner' ? 'JOG' : 'WALK';
      }
      return;
    }

    this.stateTimer -= dt;
    if (this.stateTimer <= 0) {
      this.transitionNextState(graph, ctx.isNight, zoneDensity);
    }
  }

  private transitionNextState(
    graph: NavGraph,
    isNight: boolean,
    zoneDensity?: ZoneDensityManager
  ): void {
    if (this.state === 'FLEE' || this.state === 'DODGE') {
      this.fearLevel = Math.max(0, this.fearLevel - 0.5);
      const nearest = graph.findClosestNode(this.x, this.z);
      this.currentNodeId = nearest.id;
      this.pickNextWaypointTowardsGoal(graph, zoneDensity);
      this.state = this.injuryStatus === 'injured' ? 'LIMP' : this.archetype === 'runner' ? 'JOG' : 'WALK';
      this.stateTimer = 3.5 + Math.random() * 4;
      return;
    }

    if (this.injuryStatus === 'injured') {
      this.pickNextWaypointTowardsGoal(graph, zoneDensity);
      this.state = 'LIMP';
      this.stateTimer = 4 + Math.random() * 4;
      return;
    }

    const node = graph.nodes[this.currentNodeId];
    const r = Math.random();
    const stopBias =
      this.personality === 'hurried'
        ? 0.14
        : this.personality === 'curious'
        ? 0.52
        : this.personality === 'calm'
        ? 0.38
        : 0.25;

    // Durante chuva forte sem guarda-chuva, anda apressado
    if (this.activeWeather === 'rain' && !this.umbrellaOpen) {
      this.pickNextWaypointTowardsGoal(graph, zoneDensity);
      if (this.state !== 'WAIT_CROSSWALK') {
        this.state = 'JOG';
        this.stateTimer = 2.5 + Math.random() * 2.5;
      }
      return;
    }

    // Ações contextuais nos POIs
    if (node?.poiKind === 'bench' && this.activeWeather !== 'rain' && r < 0.65) {
      this.state = 'SIT';
      this.yaw = node.poiYaw ?? this.yaw;
      this.stateTimer = 5 + Math.random() * 6;
      return;
    }
    if (node?.poiKind === 'stall' && r < 0.7) {
      this.state = 'SHOP';
      this.yaw = node.poiYaw ?? this.yaw;
      this.stateTimer = 4 + Math.random() * 5;
      return;
    }
    if (node?.poiKind === 'bus_stop' && r < 0.65) {
      this.state = 'BUS_WAIT';
      this.waitingBusStopIdx = this.findNearestStopIdx(node.x, node.z, 6.0);
      this.yaw = node.poiYaw ?? this.yaw;
      this.stateTimer = 5 + Math.random() * 6;
      return;
    }
    this.waitingBusStopIdx = -1;
    if (
      node?.poiKind === 'volleyball' &&
      this.activeWeather !== 'rain' &&
      this.activeWeather !== 'fog' &&
      (this.archetype === 'volleyball' || r < 0.55)
    ) {
      this.state = 'VOLLEY';
      this.yaw = node.poiYaw ?? this.yaw;
      this.stateTimer = 6 + Math.random() * 8;
      return;
    }
    if (
      node &&
      this.activeWeather !== 'rain' &&
      (node.poiKind === 'beach_dance' || (node.poiKind === 'night_bar' && isNight)) &&
      r < 0.62
    ) {
      this.state = Math.random() < 0.55 ? 'DANCE' : 'CHAT';
      this.stateTimer = 5 + Math.random() * 7;
      return;
    }

    if (this.nearbyPeerCount >= 1 && r < stopBias * 0.45 && this.archetype !== 'runner') {
      this.state = 'CHAT';
      this.stateTimer = 3.5 + Math.random() * 4;
      return;
    }

    if (r < stopBias && this.activeWeather !== 'rain' && this.archetype !== 'runner' && this.archetype !== 'skater') {
      const actionPick = Math.random();
      this.state =
        actionPick < 0.5
          ? 'PHONE'
          : actionPick < 0.8 || node?.region === 'beach'
          ? 'SELFIE'
          : 'CHAT';
      this.stateTimer = 3 + Math.random() * 3.5;
      return;
    }

    this.pickNextWaypointTowardsGoal(graph, zoneDensity);
    if (this.state !== 'WAIT_CROSSWALK') {
      const wantsJog =
        this.archetype === 'runner' ||
        (this.personality === 'hurried' && Math.random() < 0.48);
      this.state = wantsJog ? 'JOG' : 'WALK';
      this.stateTimer = 3 + Math.random() * 4.5;
    }
  }

  private findNearestStopIdx(x: number, z: number, maxDist: number): number {
    let bestIdx = -1;
    let bestD2 = maxDist * maxDist;
    for (let i = 0; i < WORLD_POIS.busStops.length; i++) {
      const bs = WORLD_POIS.busStops[i];
      const d2 = (bs.waitX - x) ** 2 + (bs.waitZ - z) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  /**
   * Escolhe o próximo waypoint priorizando o destino da agenda e desviando de células/zonas cheias.
   */
  public pickNextWaypointTowardsGoal(graph: NavGraph, zoneDensity?: ZoneDensityManager): void {
    const cur = graph.nodes[this.currentNodeId];
    if (!cur || cur.edges.length === 0) return;

    const candidates = cur.edges.filter((e) => e.to !== this.targetNodeId);
    const pool = candidates.length > 0 ? candidates : cur.edges;

    let gx: number | null = null;
    let gz: number | null = null;
    if (this.isRushBusCommute && this.targetBusStopIdx >= 0) {
      const stop = WORLD_POIS.busStops[this.targetBusStopIdx];
      gx = stop.waitX;
      gz = stop.waitZ;
    } else if (this.activeDirective && !this.activeDirective.wanderAround) {
      gx = this.activeDirective.targetPlace.entryX;
      gz = this.activeDirective.targetPlace.entryZ;
    }

    let chosen = pool[Math.floor(Math.random() * pool.length)];

    // Avalia pontuação combinando proximidade do destino + penalidade de célula/zona cheia
    let bestScore = Infinity;
    for (const e of pool) {
      const n = graph.nodes[e.to];
      let score = gx !== null && gz !== null ? Math.hypot(n.x - gx, n.z - gz) : Math.random() * 22;
      if (zoneDensity) {
        if (!zoneDensity.canAcceptNpcAt(n.x, n.z)) {
          score += 55; // redireciona para outra rota menos cheia
        } else {
          score += zoneDensity.getCellCountAt(n.x, n.z) * 18;
        }
      }
      if (score < bestScore) {
        bestScore = score;
        chosen = e;
      }
    }

    if (chosen.isCrosswalk && !graph.canCrossEdge(chosen)) {
      this.pendingEdge = chosen;
      this.state = 'WAIT_CROSSWALK';
      const dest = graph.nodes[chosen.to];
      this.yaw = Math.atan2(dest.x - this.x, dest.z - this.z);
      this.stateTimer = 7;
      return;
    }

    this.pendingEdge = null;
    this.targetNodeId = chosen.to;
  }

  public stepMotion(
    dt: number,
    graph: NavGraph,
    registry: BuildingRegistry,
    groundHeightFn: (x: number, z: number, currentY?: number) => number,
    zoneDensity?: ZoneDensityManager
  ): void {
    if (!this.active || this.ragdollActive || this.injuryStatus === 'out') return;

    // Recuperação automática ou fade rápido (0.8s) para manter <= 30 feridos simultâneos
    if (this.injuryStatus === 'injured') {
      this.injuredTimer += dt;
      if (this.fadingInjuredOut) {
        this.fadeAlpha = Math.max(0, this.fadeAlpha - dt * 1.25);
        if (this.fadeAlpha <= 0) {
          this.resetToHealthy();
          this.visuallyActive = false;
          return;
        }
      } else if (this.injuredTimer >= 14.0) {
        this.resetToHealthy();
      }
    }

    // Fade de entrada/saída na porta de prédios
    if (this.fadingOut) {
      this.fadeAlpha = Math.max(0, this.fadeAlpha - dt * 2.4);
      if (this.fadeAlpha <= 0) {
        this.fadingOut = false;
        this.state = 'INSIDE_BUILDING';
      }
      return;
    }

    if (this.insideBuilding) return;

    if (this.fadeAlpha < 1.0 && !this.fadingInjuredOut) {
      this.fadeAlpha = Math.min(1.0, this.fadeAlpha + dt * 2.4);
    }

    if (this.fearLevel > 0 && this.state !== 'FLEE') {
      this.fearLevel = Math.max(0, this.fearLevel - dt * 0.25);
    }

    if (this.courtesyTimer > 0) {
      this.courtesyTimer = Math.max(0, this.courtesyTimer - dt);
    }

    if (this.state === 'DODGE') {
      this.x += this.dodgeVelX * dt;
      this.z += this.dodgeVelZ * dt;
      this.dodgeVelX *= Math.exp(-4.5 * dt);
      this.dodgeVelZ *= Math.exp(-4.5 * dt);
      this.animPhase += dt * 10;
      this.y = groundHeightFn(this.x, this.z, this.y);
      return;
    }

    if (this.state === 'FLEE') {
      const fleeSpeed = this.injuryStatus === 'injured' ? 3.5 : this.archetype === 'skater' ? 7.6 : 6.4;
      const moveX = this.fleeDirX * fleeSpeed + this.sepX * 0.5;
      const moveZ = this.fleeDirZ * fleeSpeed + this.sepZ * 0.5;
      this.x += moveX * dt;
      this.z += moveZ * dt;
      this.z = Math.max(WORLD_BOUNDS.minZ + 6, Math.min(WORLD_BOUNDS.maxZ - 6, this.z));
      const maxCoastX = Math.min(WORLD_BOUNDS.maxX - 4, WorldRegistry.getCoastlineX(this.z) + 18);
      this.x = Math.max(WORLD_BOUNDS.minX + 6, Math.min(maxCoastX, this.x));
      this.yaw = Math.atan2(moveX, moveZ);
      this.animPhase += dt * 14;
      this.y = groundHeightFn(this.x, this.z, this.y);
      return;
    }

    if (this.state === 'WALK' || this.state === 'JOG' || this.state === 'LIMP') {
      const target = graph.nodes[this.targetNodeId];
      if (target) {
        const dx = target.x - this.x;
        const dz = target.z - this.z;
        const dist = Math.hypot(dx, dz);

        if (dist < 1.25) {
          this.currentNodeId = target.id;
          this.pickNextWaypointTowardsGoal(graph, zoneDensity);
        } else {
          const rawSpeed =
            this.state === 'LIMP'
              ? 1.15
              : this.state === 'JOG'
              ? 4.6
              : this.archetype === 'skater'
              ? 4.9
              : this.personality === 'hurried'
              ? 2.85
              : 1.95;
          const baseSpeed = rawSpeed * this.weatherSpeedScale;

          const dirX = dx / dist;
          const dirZ = dz / dist;
          const courtesyX = this.courtesyTimer > 0 ? this.courtesyOffsetX : 0;
          const courtesyZ = this.courtesyTimer > 0 ? this.courtesyOffsetZ : 0;
          const steerX = dirX * baseSpeed + this.sepX * 0.9 + courtesyX;
          const steerZ = dirZ * baseSpeed + this.sepZ * 0.9 + courtesyZ;

          this.x += steerX * dt;
          this.z += steerZ * dt;

          const targetYaw = Math.atan2(steerX, steerZ);
          let diff = targetYaw - this.yaw;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          this.yaw += diff * Math.min(1, dt * 8);

          this.animPhase += dt * (this.state === 'LIMP' ? 5.2 : this.state === 'JOG' ? 13 : 7.5);
        }
      }
    } else {
      this.animPhase += dt * (this.state === 'DANCE' || this.state === 'VOLLEY' ? 7.5 : 2.6);
    }

    // Colisão leve com objetos estáticos (postes, bancos, barracas)
    for (const obs of registry.staticObstacles) {
      const dx = this.x - obs.x;
      const dz = this.z - obs.z;
      const minD = obs.radius + 0.42;
      const d2 = dx * dx + dz * dz;
      if (d2 < minD * minD && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const push = minD - d;
        this.x += (dx / d) * push;
        this.z += (dz / d) * push;
      }
    }

    this.y = groundHeightFn(this.x, this.z, this.y);
  }

  /**
   * Calcula pose articular conforme nível de LOD:
   * - 'full' (<= 25m): animação completa de membros, cabeça e ações contextuais
   * - 'mid' (25–70m): pose simples (braços e pernas)
   * - 'low' (70–150m): silhueta estática
   */
  public computePose(out: PedestrianPose, lod: LodLevel = 'full'): void {
    out.headPitch = 0;
    out.leftArmX = 0;
    out.leftArmZ = 0.06;
    out.rightArmX = 0;
    out.rightArmZ = -0.06;
    out.leftLegX = 0;
    out.rightLegX = 0;
    out.hipDropY = 0;
    out.jumpY = 0;
    out.torsoLeanX = 0;

    if (lod === 'low') {
      if (
        this.umbrellaOpen &&
        this.state !== 'FLEE' &&
        this.state !== 'DODGE' &&
        this.state !== 'VOLLEY'
      ) {
        out.rightArmX = -1.25;
      }
      return;
    }

    const s = Math.sin(this.animPhase);
    const c = Math.cos(this.animPhase);

    if (lod === 'mid') {
      if (this.state === 'WALK' || this.state === 'JOG' || this.state === 'FLEE' || this.state === 'LIMP') {
        const amp = this.state === 'JOG' || this.state === 'FLEE' ? 0.72 : 0.48;
        out.leftLegX = s * amp;
        out.rightLegX = -s * amp;
        out.leftArmX = -s * amp * 0.75;
        out.rightArmX = s * amp * 0.75;
      } else if (this.state === 'SIT') {
        out.hipDropY = -0.34;
        out.leftLegX = -Math.PI / 2 + 0.12;
        out.rightLegX = -Math.PI / 2 + 0.12;
      }
      if (
        this.umbrellaOpen &&
        this.state !== 'FLEE' &&
        this.state !== 'DODGE' &&
        this.state !== 'VOLLEY'
      ) {
        out.rightArmX = -1.25;
        out.rightArmZ = -0.06;
      }
      return;
    }

    // LOD 'full' (<= 25m)
    switch (this.state) {
      case 'LIMP': {
        const limp = Math.max(0, s);
        out.leftLegX = s * 0.35;
        out.rightLegX = -limp * 0.65;
        out.leftArmX = -s * 0.25;
        out.rightArmX = -0.45;
        out.hipDropY = -limp * 0.14;
        out.torsoLeanX = 0.22;
        break;
      }
      case 'WALK': {
        if (this.archetype === 'skater') {
          const push = Math.max(0, s) * 0.55;
          out.leftLegX = -0.15;
          out.rightLegX = push;
          out.leftArmZ = 0.25;
          out.rightArmZ = -0.25;
          out.torsoLeanX = 0.14;
        } else {
          out.leftLegX = s * 0.52;
          out.rightLegX = -s * 0.52;
          out.leftArmX = -s * 0.42;
          out.rightArmX = s * 0.42;
          out.jumpY = Math.abs(c) * 0.04;
        }
        break;
      }
      case 'JOG': {
        out.leftLegX = s * 0.85;
        out.rightLegX = -s * 0.85;
        out.leftArmX = -s * 0.9 - 0.35;
        out.rightArmX = s * 0.9 - 0.35;
        out.torsoLeanX = 0.18;
        out.jumpY = Math.abs(c) * 0.09;
        break;
      }
      case 'FLEE': {
        out.leftLegX = s * 0.95;
        out.rightLegX = -s * 0.95;
        out.leftArmX = -2.4 + s * 0.35;
        out.rightArmX = -2.4 - s * 0.35;
        out.leftArmZ = 0.28;
        out.rightArmZ = -0.28;
        out.torsoLeanX = 0.22;
        out.jumpY = Math.abs(c) * 0.11;
        break;
      }
      case 'DODGE': {
        out.torsoLeanX = -0.32;
        out.leftArmX = -1.3;
        out.rightArmX = -1.3;
        out.jumpY = Math.max(0, Math.sin((1 - this.stateTimer / 0.65) * Math.PI)) * 0.45;
        break;
      }
      case 'SIT': {
        out.hipDropY = -0.34;
        out.leftLegX = -Math.PI / 2 + 0.12;
        out.rightLegX = -Math.PI / 2 + 0.12;
        out.leftArmX = -0.35;
        out.rightArmX = -0.35;
        break;
      }
      case 'PHONE': {
        out.headPitch = 0.42;
        out.rightArmX = -1.05;
        out.rightArmZ = 0.2;
        break;
      }
      case 'SELFIE': {
        out.rightArmX = -2.05;
        out.rightArmZ = 0.15;
        out.leftArmZ = 0.35;
        out.headPitch = -0.14;
        break;
      }
      case 'CHAT': {
        out.leftArmX = -0.55 + s * 0.35;
        out.rightArmX = -0.45 + c * 0.35;
        out.headPitch = s * 0.08;
        break;
      }
      case 'SHOP': {
        out.rightArmX = -0.8 + s * 0.25;
        out.leftArmX = -0.25;
        break;
      }
      case 'DANCE': {
        out.leftArmX = -1.4 + s * 0.65;
        out.rightArmX = -1.4 - s * 0.65;
        out.leftArmZ = 0.35 + c * 0.2;
        out.rightArmZ = -0.35 - c * 0.2;
        out.leftLegX = s * 0.28;
        out.rightLegX = -s * 0.28;
        out.jumpY = Math.abs(s) * 0.14;
        break;
      }
      case 'VOLLEY': {
        const jump = Math.max(0, s);
        out.jumpY = jump * 0.52;
        out.leftArmX = -2.2 + jump * 0.5;
        out.rightArmX = -2.2 + jump * 0.5;
        out.leftLegX = -jump * 0.25;
        out.rightLegX = -jump * 0.25;
        break;
      }
      case 'BUS_WAIT':
      case 'WAIT_CROSSWALK': {
        out.headPitch = s * 0.05;
        out.leftArmX = s * 0.05;
        out.rightArmX = -s * 0.05;
        break;
      }
    }

    if (
      this.umbrellaOpen &&
      this.state !== 'FLEE' &&
      this.state !== 'DODGE' &&
      this.state !== 'VOLLEY'
    ) {
      out.rightArmX = -1.25;
      out.rightArmZ = -0.06;
    }
  }
}
