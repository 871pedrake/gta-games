import { BuildingRegistry, RegisteredPlace } from './BuildingRegistry';
import { NavGraph } from './NavGraph';

export type NpcProfession =
  | 'tourist'
  | 'volleyball'
  | 'runner'
  | 'executive'
  | 'skater'
  | 'guard'
  | 'worker';

export type NpcPersonality = 'calm' | 'hurried' | 'curious' | 'fearful';

export interface NpcProfile {
  home: RegisteredPlace;
  workplace: RegisteredPlace;
  favoriteSpot: RegisteredPlace;
  marketSpot: RegisteredPlace;
  profession: NpcProfession;
  personality: NpcPersonality;
  scheduleOffsetHours: number; // Variação aleatória ±0.5h (±30 min)
  maxHealth: number; // 60..120 por tipo
}

export interface ScheduleDirective {
  routineLabel: string;
  targetHourLabel: string;
  targetPlace: RegisteredPlace;
  shouldBeInside: boolean;
  /** Em pausas para café ou passeio noturno, NPC circula próximo ao local */
  wanderAround: boolean;
}

/**
 * Sistema de rotinas diárias dirigido exclusivamente por `gameTime` (0–24h) e `isWeekend`.
 * Nenhuma rotina usa timer próprio: o estado previsto é calculado deterministicamente pela hora,
 * mantendo coerência entre NPCs dentro de prédios e vida urbana nas ruas.
 */
export class ScheduleSystem {
  public createProfile(
    seed: number,
    registry: BuildingRegistry
  ): NpcProfile {
    const rand = (n: number) => Math.abs(Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453) % 1;

    const rProf = rand(1);
    let profession: NpcProfession = 'worker';
    if (rProf < 0.24) profession = 'tourist';
    else if (rProf < 0.44) profession = 'executive';
    else if (rProf < 0.62) profession = 'worker';
    else if (rProf < 0.77) profession = 'runner';
    else if (rProf < 0.87) profession = 'volleyball';
    else if (rProf < 0.95) profession = 'skater';
    else profession = 'guard';

    const persPool: NpcPersonality[] = ['calm', 'hurried', 'curious', 'fearful'];
    const personality = persPool[Math.floor(rand(2) * persPool.length)];

    const home = registry.homes[Math.floor(rand(3) * registry.homes.length)];
    const workplace = registry.workplaces[Math.floor(rand(4) * registry.workplaces.length)];
    const marketSpot = registry.markets[Math.floor(rand(5) * registry.markets.length)] ?? workplace;

    // Local favorito varia conforme personalidade e profissão
    let favPool = registry.plazas;
    if (profession === 'volleyball' || profession === 'tourist' || personality === 'curious') {
      favPool = rand(6) < 0.58 ? registry.beaches : registry.bars;
    } else if (personality === 'hurried' || profession === 'executive') {
      favPool = registry.bars;
    } else if (personality === 'calm') {
      favPool = rand(6) < 0.52 ? registry.plazas : registry.beaches;
    }
    const favoriteSpot = favPool[Math.floor(rand(7) * favPool.length)] ?? registry.bars[0];

    // Variação aleatória de ±30 min (±0.5 horas)
    const scheduleOffsetHours = (rand(8) - 0.5) * 1.0;

    // Vida base entre 60 e 120 conforme profissão
    const hpByProf: Record<NpcProfession, number> = {
      guard: 120,
      volleyball: 105,
      runner: 100,
      skater: 95,
      worker: 90,
      executive: 80,
      tourist: 70,
    };
    const maxHealth = Math.round(hpByProf[profession] - 10 + rand(9) * 10);

    return {
      home,
      workplace,
      favoriteSpot,
      marketSpot,
      profession,
      personality,
      scheduleOffsetHours,
      maxHealth: Math.max(60, Math.min(120, maxHealth)),
    };
  }

  /**
   * Avalia onde o NPC deve estar no instante `gameTime` (0–24h) com transições suaves de ocupação predial.
   */
  public evaluate(
    profile: NpcProfile,
    gameTime: number,
    isWeekend: boolean,
    seed: number
  ): ScheduleDirective {
    const t = (gameTime + profile.scheduleOffsetHours + 24) % 24;
    const slot = seed % 100;

    // Guardas e corredores matinais/noturnos possuem exceção na madrugada
    const isNightOwl =
      profile.profession === 'guard' ||
      (profile.profession === 'runner' && t >= 5.0 && t < 8.0);

    if (isWeekend) {
      // Agenda de Fim de Semana: acorda gradualmente, muito lazer na praia/praças/bares
      if (t >= 2.5 && t < 8.0) {
        if (profile.profession === 'guard' || (profile.personality === 'curious' && slot < 12)) {
          return {
            routineLabel: profile.profession === 'guard' ? 'Patrulha Noturna' : 'Passeio na Madrugada',
            targetHourLabel: '08:00',
            targetPlace: profile.profession === 'guard' ? profile.workplace : profile.favoriteSpot,
            shouldBeInside: false,
            wanderAround: true,
          };
        }
        return {
          routineLabel: 'Dormindo em Casa',
          targetHourLabel: '08:00',
          targetPlace: profile.home,
          shouldBeInside: true,
          wanderAround: false,
        };
      }
      if (t >= 8.0 && t < 10.0) {
        return {
          routineLabel: 'Saindo para Lazer',
          targetHourLabel: '10:00',
          targetPlace: profile.favoriteSpot,
          shouldBeInside: false,
          wanderAround: true,
        };
      }
      if (t >= 10.0 && t < 18.0) {
        const goMarket = t >= 12.5 && t < 14.5 && slot % 3 === 0;
        const restingHome = slot < 14; // pequena parcela em casa para realismo
        return {
          routineLabel: restingHome
            ? 'Em Casa'
            : goMarket
            ? 'Almoço / Mercado'
            : 'Lazer de Fim de Semana',
          targetHourLabel: goMarket ? '14:30' : '18:00',
          targetPlace: restingHome ? profile.home : goMarket ? profile.marketSpot : profile.favoriteSpot,
          shouldBeInside: restingHome && profile.home.hasInterior,
          wanderAround: !restingHome,
        };
      }
      // 18h - 02h30: noite de bares/orla com recolhimento gradual após 23h
      const lateHome = (t >= 23.0 || t < 2.5) && slot < 45;
      return {
        routineLabel: lateHome ? 'Descansando em Casa' : 'Lazer Noturno (Orla/Bar)',
        targetHourLabel: '02:30',
        targetPlace: lateHome ? profile.home : profile.favoriteSpot,
        shouldBeInside: lateHome && profile.home.hasInterior,
        wanderAround: !lateHome,
      };
    }

    // Agenda de Dia Útil
    // 02h–06h: maioria dormindo dentro de casa (~85%), poucos guardas e notívagos na rua
    if (t >= 2.0 && t < 6.0) {
      if (isNightOwl || (profile.personality === 'curious' && slot < 12)) {
        return {
          routineLabel: profile.profession === 'guard' ? 'Turno da Madrugada' : 'Madrugada na Orla',
          targetHourLabel: '06:00',
          targetPlace: profile.favoriteSpot,
          shouldBeInside: false,
          wanderAround: true,
        };
      }
      return {
        routineLabel: 'Dormindo em Casa',
        targetHourLabel: '06:00',
        targetPlace: profile.home,
        shouldBeInside: true,
        wanderAround: false,
      };
    }

    // 06h–08h: acordar e sair de casa gradualmente
    if (t >= 6.0 && t < 8.0) {
      const stillWaking = t < 6.7 && slot < 40;
      return {
        routineLabel: stillWaking ? 'Acordando em Casa' : 'Saindo de Casa',
        targetHourLabel: '08:00',
        targetPlace: profile.home,
        shouldBeInside: stillWaking && profile.home.hasInterior,
        wanderAround: !stillWaking,
      };
    }

    // 08h–09h: ir ao trabalho (a pé ou ponto de ônibus)
    if (t >= 8.0 && t < 9.0) {
      return {
        routineLabel: 'Indo ao Trabalho',
        targetHourLabel: '09:00',
        targetPlace: profile.workplace,
        shouldBeInside: false,
        wanderAround: false,
      };
    }

    // 09h–12h e 13h–17h: ocupação realista (~42% em escritórios internos, ~58% circulando/serviços/orla)
    if ((t >= 9.0 && t < 12.0) || (t >= 13.0 && t < 17.0)) {
      if (profile.profession === 'tourist' || profile.profession === 'volleyball') {
        return {
          routineLabel: 'Passeio / Praia',
          targetHourLabel: '17:00',
          targetPlace: profile.favoriteSpot,
          shouldBeInside: false,
          wanderAround: true,
        };
      }
      // Pausa para café ou trabalho externo em campo (mantém calçadas vivas sem superlotar escritórios)
      const indoorShift = slot < 44 && profile.profession !== 'skater' && profile.profession !== 'runner';
      const coffeeBreak =
        (t >= 10.2 && t < 10.75 && slot % 2 === 0) ||
        (t >= 14.9 && t < 15.45 && slot % 3 === 0);

      if (indoorShift && !coffeeBreak) {
        return {
          routineLabel: 'No Trabalho',
          targetHourLabel: t < 12.0 ? '12:00' : '17:00',
          targetPlace: profile.workplace,
          shouldBeInside: profile.workplace.hasInterior,
          wanderAround: false,
        };
      }

      return {
        routineLabel: coffeeBreak ? 'Pausa para Café' : 'Serviço Externo / Rua',
        targetHourLabel: t < 12.0 ? '12:00' : '17:00',
        targetPlace: slot % 2 === 0 ? profile.workplace : profile.marketSpot,
        shouldBeInside: false,
        wanderAround: true,
      };
    }

    // 12h–13h: almoço em barraca, mercado ou restaurante
    if (t >= 12.0 && t < 13.0) {
      return {
        routineLabel: 'Almoço na Orla',
        targetHourLabel: '13:00',
        targetPlace: slot < 50 ? profile.marketSpot : profile.favoriteSpot,
        shouldBeInside: false,
        wanderAround: true,
      };
    }

    // 17h–19h: voltar para casa ou passar em mercado/academia (recolhimento gradual)
    if (t >= 17.0 && t < 19.0) {
      const stopMarket = t < 18.2 && (profile.personality === 'hurried' || slot < 55);
      const enterThreshold = 18.25 + (slot % 10) * 0.07;
      const enterHomeNow = !stopMarket && t >= enterThreshold;
      return {
        routineLabel: stopMarket ? 'Mercado / Academia' : enterHomeNow ? 'Em Casa' : 'Voltando para Casa',
        targetHourLabel: '19:00',
        targetPlace: stopMarket ? profile.marketSpot : profile.home,
        shouldBeInside: enterHomeNow && profile.home.hasInterior,
        wanderAround: stopMarket,
      };
    }

    // 19h–02h: bares, praia, praças e recolhimento gradual após 22h30
    const nightThreshold = 22.3 + (slot % 15) * 0.12;
    const isLateNightHome =
      (t >= nightThreshold || t < 2.0) &&
      profile.profession !== 'guard' &&
      slot < 62;
    if (isLateNightHome) {
      return {
        routineLabel: 'Descansando em Casa',
        targetHourLabel: '06:00',
        targetPlace: profile.home,
        shouldBeInside: profile.home.hasInterior,
        wanderAround: false,
      };
    }

    return {
      routineLabel: 'Vida Noturna / Lazer',
      targetHourLabel: '02:00',
      targetPlace: profile.favoriteSpot,
      shouldBeInside: false,
      wanderAround: true,
    };
  }

  /**
   * Para NPCs que entram no alcance de 150m vindo de longe ou são promovidos do pool:
   * estima posição coerente no caminho ou no destino previsto pela agenda.
   */
  public computeRemoteSpawnPosition(
    profile: NpcProfile,
    gameTime: number,
    isWeekend: boolean,
    graph: NavGraph,
    seed: number
  ): { x: number; z: number; inside: boolean; directive: ScheduleDirective } {
    const directive = this.evaluate(profile, gameTime, isWeekend, seed);

    if (directive.shouldBeInside && directive.targetPlace.hasInterior) {
      return {
        x: directive.targetPlace.entryX,
        z: directive.targetPlace.entryZ,
        inside: true,
        directive,
      };
    }

    // Se está em trânsito (ex.: 08h-09h indo ao trabalho), interpola entre casa e trabalho
    const t = (gameTime + profile.scheduleOffsetHours + 24) % 24;
    if (t >= 8.0 && t < 9.0) {
      const alpha = t - 8.0;
      const rawX = profile.home.entryX + (profile.workplace.entryX - profile.home.entryX) * alpha;
      const rawZ = profile.home.entryZ + (profile.workplace.entryZ - profile.home.entryZ) * alpha;
      const node = graph.findClosestNode(rawX, rawZ);
      return { x: node.x, z: node.z, inside: false, directive };
    }

    const nearNode = graph.findClosestNode(directive.targetPlace.entryX, directive.targetPlace.entryZ);
    return {
      x: nearNode.x + (Math.random() - 0.5) * 3,
      z: nearNode.z + (Math.random() - 0.5) * 3,
      inside: false,
      directive,
    };
  }
}
