import { describe, expect, it } from 'vitest';
import { BuildingRegistry } from '../BuildingRegistry';
import { NavGraph } from '../NavGraph';
import { ScheduleSystem } from '../ScheduleSystem';
import { BuildingCollider } from '../types';

const TEST_BUILDINGS: BuildingCollider[] = [
  { x: -42, z: -42, halfW: 8, halfD: 8, height: 18, colorHex: '#222', label: 'Torre Solara' },
  { x: -42, z: 18, halfW: 8, halfD: 8, height: 16, colorHex: '#222', label: 'Residencial Brisa' },
  { x: 14, z: -42, halfW: 8, halfD: 8, height: 22, colorHex: '#222', label: 'Garagem Central' },
  { x: 14, z: 18, halfW: 8, halfD: 8, height: 24, colorHex: '#222', label: 'Hotel Neon' },
  { x: -102, z: 18, halfW: 8, halfD: 8, height: 20, colorHex: '#222', label: 'Clube Flamingo' },
];

describe('ScheduleSystem', () => {
  const registry = new BuildingRegistry(TEST_BUILDINGS);
  const schedule = new ScheduleSystem();
  const graph = new NavGraph();

  it('gera perfis válidos com variação de rotina entre ±30 min e vida entre 60 e 120', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const profile = schedule.createProfile(seed, registry);
      expect(profile.home).toBeDefined();
      expect(profile.workplace).toBeDefined();
      expect(profile.favoriteSpot).toBeDefined();
      expect(profile.scheduleOffsetHours).toBeGreaterThanOrEqual(-0.5);
      expect(profile.scheduleOffsetHours).toBeLessThanOrEqual(0.5);
      expect(profile.maxHealth).toBeGreaterThanOrEqual(60);
      expect(profile.maxHealth).toBeLessThanOrEqual(120);
    }
  });

  it('avalia madrugada em dia útil colocando trabalhadores comuns dormindo dentro de casa', () => {
    const profile = schedule.createProfile(10, registry);
    profile.profession = 'worker';
    profile.personality = 'calm';
    profile.scheduleOffsetHours = 0;

    const directive = schedule.evaluate(profile, 3.5, false, 10);
    expect(directive.routineLabel).toBe('Dormindo em Casa');
    expect(directive.shouldBeInside).toBe(true);
    expect(directive.targetPlace).toBe(profile.home);
  });

  it('mantém guardas em patrulha na madrugada e turistas no lazer durante horário comercial', () => {
    const guard = schedule.createProfile(12, registry);
    guard.profession = 'guard';
    guard.scheduleOffsetHours = 0;
    const nightGuard = schedule.evaluate(guard, 3.5, false, 12);
    expect(nightGuard.shouldBeInside).toBe(false);

    const tourist = schedule.createProfile(5, registry);
    tourist.profession = 'tourist';
    tourist.scheduleOffsetHours = 0;
    const dayTourist = schedule.evaluate(tourist, 10.5, false, 5);
    expect(dayTourist.shouldBeInside).toBe(false);
    expect(dayTourist.targetPlace).toBe(tourist.favoriteSpot);
  });

  it('usa agenda de lazer diferenciada no fim de semana e calcula spawn remoto coerente', () => {
    const profile = schedule.createProfile(22, registry);
    profile.scheduleOffsetHours = 0;

    const weekendDirective = schedule.evaluate(profile, 9.0, true, 22);
    expect(weekendDirective.routineLabel).toBe('Saindo para Lazer');
    expect(weekendDirective.targetPlace).toBe(profile.favoriteSpot);

    const spawn = schedule.computeRemoteSpawnPosition(profile, 8.5, false, graph, 22);
    expect(Number.isFinite(spawn.x)).toBe(true);
    expect(Number.isFinite(spawn.z)).toBe(true);
    expect(spawn.inside).toBe(false);
  });
});
