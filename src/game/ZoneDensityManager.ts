import { WeatherType } from './types';
import { CELL_MAX_BUDGET, SIDEWALK_SPACING } from './config';
import { WorldRegistry } from './world/WorldRegistry';

export type UrbanZoneId =
  | 'praia'
  | 'centro'
  | 'residencial'
  | 'parque'
  | 'porto'
  | 'historico'
  | 'comercial'
  | 'suburbio'
  | 'morro'
  | 'industrial'
  | 'heliponto'
  | 'campus';

export interface ZoneStats {
  id: UrbanZoneId;
  label: string;
  count: number;
  maxDensity: number;
  overLimit: boolean;
}

export const ALL_ZONE_IDS: UrbanZoneId[] = [
  'praia',
  'centro',
  'comercial',
  'historico',
  'residencial',
  'suburbio',
  'morro',
  'parque',
  'campus',
  'porto',
  'industrial',
  'heliponto',
];

export const ZONE_LABELS: Record<UrbanZoneId, string> = {
  praia: 'Praia',
  centro: 'Centro Fin.',
  comercial: 'Comercial',
  historico: 'Histórico',
  residencial: 'Residencial',
  suburbio: 'Subúrbio',
  morro: 'Morro',
  parque: 'Parque',
  campus: 'Campus',
  porto: 'Porto',
  industrial: 'Industrial',
  heliponto: 'Heliponto',
};

/**
 * Gerencia densidade dinâmica para cada um dos 12 distritos (DistrictSpec) da cidade,
 * respeitando espaçamento de 1 NPC por célula de 6 m (SIDEWALK_SPACING), horários e clima.
 */
export class ZoneDensityManager {
  public readonly zoneCounts: Record<UrbanZoneId, number> = {
    praia: 0,
    centro: 0,
    comercial: 0,
    historico: 0,
    residencial: 0,
    suburbio: 0,
    morro: 0,
    parque: 0,
    campus: 0,
    porto: 0,
    industrial: 0,
    heliponto: 0,
  };

  public readonly zoneLimits: Record<UrbanZoneId, number> = {
    praia: 34,
    centro: 36,
    comercial: 32,
    historico: 24,
    residencial: 24,
    suburbio: 16,
    morro: 28,
    parque: 22,
    campus: 28,
    porto: 16,
    industrial: 14,
    heliponto: 10,
  };

  public readonly alerts: UrbanZoneId[] = [];
  private readonly cellCounts = new Map<number, number>();

  /**
   * Mapeia coordenadas (x, z) da cidade para a zona/distrito definida no WorldRegistry.
   */
  public getZoneAt(x: number, z: number): UrbanZoneId {
    return WorldRegistry.getDistrictAt(x, z).zoneId;
  }

  private hashCell(cx: number, cz: number): number {
    return ((cx + 256) << 10) | (cz + 256);
  }

  /**
   * Atualiza limites máximos dinâmicos a partir dos perfis de cada DistrictSpec,
   * hora do dia, fim de semana, clima e orçamento total visível.
   */
  public updateLimits(
    gameTime: number,
    isWeekend: boolean,
    weather: WeatherType,
    maxVisibleBudget: number
  ): void {
    // Fator diurno suave (pico às 14h, mínimo às 02h)
    const dayAngle = ((gameTime - 14) / 24) * Math.PI * 2;
    const dayWeight = 0.5 + 0.5 * Math.cos(dayAngle);
    const budgetScale = maxVisibleBudget / 200;

    for (const d of WorldRegistry.districts) {
      const timeScale = d.nightDensityScale + dayWeight * (1 - d.nightDensityScale);
      const weekendScale = isWeekend ? d.weekendDensityScale : 1.0;
      const weatherScale =
        weather === 'rain' ? d.rainDensityScale : weather === 'fog' ? 0.86 : 1.0;

      const raw = d.baseMaxNpcDensity * timeScale * weekendScale * weatherScale * budgetScale;
      this.zoneLimits[d.zoneId] = Math.max(3, Math.round(raw));
    }
  }

  /**
   * Reinicia contadores por distrito e ocupação das células de 6 m no início do frame.
   */
  public beginFrame(): void {
    for (const z of ALL_ZONE_IDS) {
      this.zoneCounts[z] = 0;
    }
    this.alerts.length = 0;
    this.cellCounts.clear();
  }

  /**
   * Registra um NPC visível no distrito e na célula de calçada de 6 m.
   */
  public recordVisibleNpc(x: number, z: number): UrbanZoneId {
    const zone = this.getZoneAt(x, z);
    this.zoneCounts[zone]++;
    const cx = Math.floor(x / SIDEWALK_SPACING);
    const cz = Math.floor(z / SIDEWALK_SPACING);
    const key = this.hashCell(cx, cz);
    this.cellCounts.set(key, (this.cellCounts.get(key) ?? 0) + 1);
    return zone;
  }

  /**
   * Verifica ao fim da passagem se algum distrito excedeu seu limite dinâmico.
   */
  public finalizeAlerts(): void {
    this.alerts.length = 0;
    for (const z of ALL_ZONE_IDS) {
      if (this.zoneCounts[z] > this.zoneLimits[z]) {
        this.alerts.push(z);
      }
    }
  }

  public getCellCountAt(x: number, z: number): number {
    const cx = Math.floor(x / SIDEWALK_SPACING);
    const cz = Math.floor(z / SIDEWALK_SPACING);
    return this.cellCounts.get(this.hashCell(cx, cz)) ?? 0;
  }

  /**
   * Retorna false se a célula de 6 m já atingiu CELL_MAX_BUDGET ou se o distrito atingiu maxDensity.
   */
  public canAcceptNpcAt(x: number, z: number): boolean {
    const zone = this.getZoneAt(x, z);
    if (this.zoneCounts[zone] >= this.zoneLimits[zone]) return false;
    return this.getCellCountAt(x, z) < CELL_MAX_BUDGET;
  }

  public isZoneOverLimit(zone: UrbanZoneId): boolean {
    return this.zoneCounts[zone] > this.zoneLimits[zone];
  }

  public getStatsSnapshot(): ZoneStats[] {
    return ALL_ZONE_IDS.map((id) => ({
      id,
      label: ZONE_LABELS[id],
      count: this.zoneCounts[id],
      maxDensity: this.zoneLimits[id],
      overLimit: this.zoneCounts[id] > this.zoneLimits[id],
    }));
  }
}
