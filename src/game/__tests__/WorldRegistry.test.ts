import { describe, expect, it } from 'vitest';
import { ZoneDensityManager } from '../ZoneDensityManager';
import {
  CROSSWALKS,
  DistrictId,
  INTERSECTIONS,
  STREETS,
  TRAFFIC_SIGNALS,
  WORLD_BOUNDS,
  WorldRegistry,
} from '../world/WorldRegistry';

describe('WorldRegistry', () => {
  it('define WORLD_BOUNDS expandido e resolve todos os 12 distritos com identidade visual e densidade próprias', () => {
    expect(WORLD_BOUNDS.minX).toBe(-280);
    expect(WORLD_BOUNDS.maxX).toBe(148);
    expect(WORLD_BOUNDS.minZ).toBe(-280);
    expect(WORLD_BOUNDS.maxZ).toBe(280);
    expect(WorldRegistry.districts).toHaveLength(12);

    const beachX = WorldRegistry.getCoastlineX(0) + 6;
    const expectedProbes: Array<[number, number, DistrictId]> = [
      [beachX, 0, 'praia'],
      [-30, 0, 'centro'],
      [-110, -40, 'comercial'],
      [-30, 90, 'historico'],
      [-100, 80, 'residencial'],
      [-200, 120, 'suburbio'],
      [-200, -245, 'morro'],
      [-80, -180, 'parque'],
      [14, -200, 'campus'],
      [14, 150, 'porto'],
      [-190, -80, 'industrial'],
      [-150, 245, 'heliponto'],
    ];

    const seenThemes = new Set<string>();
    for (const [px, pz, expectedId] of expectedProbes) {
      const dist = WorldRegistry.getDistrictAt(px, pz);
      expect(dist.id).toBe(expectedId);
      expect(dist.baseMaxNpcDensity).toBeGreaterThan(0);
      seenThemes.add(dist.visualTheme);
    }
    expect(seenThemes.size).toBe(12);
  });

  it('calcula elevação topográfica contínua no Morro da Brisa para ladeiras e escadarias', () => {
    expect(WorldRegistry.getTerrainHeightAt(-202, -210)).toBe(0); // Rua do Mirante plana
    const midSlope = WorldRegistry.getTerrainHeightAt(-202, -223);
    const terrace1 = WorldRegistry.getTerrainHeightAt(-202, -238);
    const terrace2 = WorldRegistry.getTerrainHeightAt(-202, -264);

    expect(midSlope).toBeGreaterThan(0.5);
    expect(terrace1).toBeCloseTo(3.2, 1);
    expect(terrace2).toBeCloseTo(6.6, 1);
  });

  it('aplica limites de densidade dinâmica distintos por distrito no ZoneDensityManager', () => {
    const density = new ZoneDensityManager();
    density.updateLimits(14, false, 'clear', 200);
    const weekdayCentro = density.zoneLimits.centro;
    const weekdayCampus = density.zoneLimits.campus;
    const weekdayHeli = density.zoneLimits.heliponto;

    expect(weekdayCentro).toBeGreaterThan(weekdayHeli);
    expect(weekdayCampus).toBeGreaterThan(weekdayHeli);

    density.updateLimits(14, true, 'clear', 200);
    expect(density.zoneLimits.praia).toBeGreaterThan(density.zoneLimits.industrial);
    expect(density.zoneLimits.campus).toBeLessThan(weekdayCampus);

    density.updateLimits(14, false, 'rain', 200);
    expect(density.zoneLimits.comercial).toBeGreaterThan(density.zoneLimits.praia);
  });

  it('gera malha viária por StreetSpec com avenidas (4 faixas + canteiro), secundárias, vielas, rotatórias e orla curva', () => {
    const avenues = STREETS.filter((s) => s.kind === 'avenue');
    const secondary = STREETS.filter((s) => s.kind === 'secondary');
    const alleys = STREETS.filter((s) => s.kind === 'alley');
    const roundabouts = WorldRegistry.getRoundabouts();
    const coastal = STREETS.find((s) => s.kind === 'coastal');

    expect(avenues.length).toBeGreaterThanOrEqual(4);
    expect(avenues.every((a) => a.lanes === 4 && a.medianWidth > 0)).toBe(true);
    expect(secondary.length).toBeGreaterThanOrEqual(6);
    expect(alleys.length).toBeGreaterThanOrEqual(4);
    expect(roundabouts).toHaveLength(3);
    expect(coastal).toBeDefined();
    expect(coastal!.points.length).toBeGreaterThan(10);

    const xValues = new Set(coastal!.points.map((p) => Math.round(p.x)));
    expect(xValues.size).toBeGreaterThan(8);

    expect(WorldRegistry.getStreetAt(WorldRegistry.getCoastalRoadX(24), 24)?.id).toBe('st_beira_mar');
    expect(WorldRegistry.getStreetAt(-60, 0)?.id).toBe('st_central_solara');
    expect(WorldRegistry.getStreetAt(-20, 14)?.kind).toBe('roundabout');
    expect(WorldRegistry.getStreetAt(-50, -30)?.id).toBe('st_beco_neon');
    expect(WorldRegistry.isPointOnRoad(-20, 0, 0, true)).toBe(false);
    expect(WorldRegistry.isPointOnRoad(-60, 0, 0, false)).toBe(false);
    expect(WorldRegistry.isPointOnRoad(-60, 5.5, 0, false)).toBe(true);

    expect(INTERSECTIONS.length).toBeGreaterThan(15);
    expect(INTERSECTIONS.some((i) => i.isRoundabout)).toBe(true);
    expect(INTERSECTIONS.some((i) => i.hasSignal)).toBe(true);
    expect(INTERSECTIONS.every((i) => i.neighborIds.length > 0)).toBe(true);
  });

  it('garante que nenhum prédio dos 12 distritos invade o leito de ruas, avenidas ou rotatórias', () => {
    expect(WorldRegistry.buildings.length).toBeGreaterThanOrEqual(30);
    for (const b of WorldRegistry.buildings) {
      const halfW = b.w * 0.5;
      const halfD = b.d * 0.5;
      const sampleOffsets = [
        [0, 0],
        [-halfW, -halfD],
        [halfW, -halfD],
        [-halfW, halfD],
        [halfW, halfD],
        [0, -halfD],
        [0, halfD],
        [-halfW, 0],
        [halfW, 0],
      ];
      for (const [ox, oz] of sampleOffsets) {
        expect(
          WorldRegistry.isPointOnRoad(b.x + ox, b.z + oz, 1.5, true),
          `Prédio ${b.id} (${b.label}) sobreposto à via em (${b.x + ox}, ${b.z + oz})`
        ).toBe(false);
      }
    }
  });

  it('expõe lojas, serviços públicos, coberturas e eventos com horários coerentes', () => {
    const shops = WorldRegistry.getShops();
    expect(shops).toHaveLength(6);

    const gunShop = shops.find((s) => s.category === 'shop_gun')!;
    expect(WorldRegistry.isShopOpen(gunShop, 14)).toBe(true);
    expect(WorldRegistry.isShopOpen(gunShop, 2)).toBe(false);

    const market = shops.find((s) => s.category === 'shop_market')!;
    expect(WorldRegistry.isShopOpen(market, 3.5)).toBe(true);

    const bars = WorldRegistry.getPoisByCategory('bar');
    expect(bars.length).toBeGreaterThanOrEqual(3);
    expect(WorldRegistry.isShopOpen(bars[0], 23)).toBe(true);
    expect(WorldRegistry.isShopOpen(bars[0], 2)).toBe(true);
    expect(WorldRegistry.isShopOpen(bars[0], 11)).toBe(false);

    const coverCoastal = WorldRegistry.coverPoints[0];
    expect(WorldRegistry.getCoverPointsNear(coverCoastal.x, coverCoastal.z, 10).length).toBeGreaterThan(0);
    expect(WorldRegistry.getEventSpawnsInDistrict('centro').length).toBeGreaterThanOrEqual(2);
    expect(WorldRegistry.getEventSpawnsInDistrict('morro').length).toBeGreaterThanOrEqual(1);
    expect(WorldRegistry.getEventSpawnsInDistrict('heliponto').length).toBeGreaterThanOrEqual(1);
  });

  it('resolve canal, cais, pontes e passarela com colisões laterais corretas', () => {
    const canalZ = WorldRegistry.canal.zCenter;
    // Dentro do canal aberto (entre pontes) -> leito submerso
    expect(WorldRegistry.getTerrainHeightAt(-50, canalZ)).toBeLessThan(-1.0);
    // Oeste da comportas do canal (Av. das Palmeiras / Subúrbio) -> terra seca
    expect(WorldRegistry.getTerrainHeightAt(-132, canalZ)).toBe(0);

    // Tabuleiro das pontes sobre o canal e rampas de acesso
    expect(WorldRegistry.bridges.length).toBeGreaterThanOrEqual(5);
    expect(WorldRegistry.getTerrainHeightAt(-80, canalZ)).toBeCloseTo(1.65, 2);
    expect(WorldRegistry.getTerrainHeightAt(-20, canalZ)).toBeCloseTo(1.65, 2);
    expect(WorldRegistry.getTerrainHeightAt(24, canalZ)).toBeCloseTo(1.65, 2);
    expect(WorldRegistry.getTerrainHeightAt(WorldRegistry.getCoastalRoadX(canalZ), canalZ)).toBeCloseTo(1.65, 2);
    const footbridgeX = WorldRegistry.getCoastlineX(canalZ) - 6.5;
    expect(WorldRegistry.getTerrainHeightAt(footbridgeX, canalZ)).toBeCloseTo(1.55, 2);

    // Guard-rail na ponte contém jogador no tabuleiro; fora da ponte bloqueia queda na água do canal
    const bridgePos = { x: -9.1, y: 1.65, z: canalZ };
    expect(WorldRegistry.resolveInfrastructureCollisions(bridgePos, 0.8)).toBe(true);
    expect(bridgePos.x).toBeLessThan(-9.1);

    const waterPos = { x: -50, y: 0, z: canalZ };
    expect(WorldRegistry.resolveInfrastructureCollisions(waterPos, 0.5)).toBe(true);
    expect(waterPos.z === WorldRegistry.canal.zMin - 0.5 || waterPos.z === WorldRegistry.canal.zMax + 0.5).toBe(true);
  });

  it('suporta múltiplos níveis no Viaduto das Palmeiras e no Túnel Curto do Parque via currentY', () => {
    // Viaduto: pista elevada em z = 65 (sobre Rua Flamingo)
    expect(WorldRegistry.getTerrainHeightAt(-140, 65, 0)).toBe(0); // passando por baixo
    expect(WorldRegistry.getTerrainHeightAt(-140, 65, 5.0)).toBeCloseTo(5.0, 2); // dirigindo em cima
    expect(WorldRegistry.getTerrainHeightAt(-140, 48, 2.2)).toBeCloseTo(2.5, 1); // rampa norte

    // Pilar sob o viaduto colide em y=0, mas não em y=5; guard-rail colide em y=5
    const underPier = { x: -148.2, y: 0, z: 57.2 };
    expect(WorldRegistry.resolveInfrastructureCollisions(underPier, 0.5)).toBe(true);
    const onDeckEdge = { x: -149.0, y: 5.0, z: 65 };
    expect(WorldRegistry.resolveInfrastructureCollisions(onDeckEdge, 0.5)).toBe(true);
    expect(onDeckEdge.x).toBeGreaterThan(-149.0);

    // Túnel Curto do Parque: por dentro (y=0) vs por cima da colina verde (y=5.6)
    expect(WorldRegistry.getTerrainHeightAt(-140, -176, 0)).toBe(0);
    expect(WorldRegistry.getTerrainHeightAt(-140, -176, 5.4)).toBeCloseTo(5.6, 1);
    expect(WorldRegistry.getTerrainHeightAt(-156, -176, 0)).toBeGreaterThan(1.5); // rampa lateral caminhável

    const tunnelWall = { x: -149.0, y: 0, z: -176 };
    expect(WorldRegistry.resolveInfrastructureCollisions(tunnelWall, 0.5)).toBe(true);
    expect(tunnelWall.x).toBeGreaterThan(-149.0);
  });

  it('fornece elevações suaves nos parques e ilhas oceânicas com farol além da costa', () => {
    expect(WorldRegistry.softHills.length).toBeGreaterThanOrEqual(4);
    const h = WorldRegistry.softHills[0];
    expect(WorldRegistry.getTerrainHeightAt(h.x, h.z)).toBeCloseTo(h.height, 2);

    expect(WorldRegistry.islands.length).toBeGreaterThanOrEqual(4);
    expect(WorldRegistry.islands.some((isl) => isl.hasLighthouse)).toBe(true);
    for (const isl of WorldRegistry.islands) {
      expect(isl.x).toBeGreaterThan(WorldRegistry.bounds.maxX);
    }
  });

  it('gera faixas de pedestres e semáforos por cruzamento (4 mãos, em T, orla curva e rotatórias)', () => {
    expect(CROSSWALKS.length).toBeGreaterThan(40);
    expect(TRAFFIC_SIGNALS.length).toBeGreaterThan(20);
    expect(WorldRegistry.crosswalks).toBe(CROSSWALKS);
    expect(WorldRegistry.signals).toBe(TRAFFIC_SIGNALS);

    const signaled = INTERSECTIONS.filter((i) => i.hasSignal && !i.isRoundabout);
    expect(signaled.length).toBeGreaterThan(10);
    for (const inter of signaled) {
      expect(inter.arms.length).toBeGreaterThanOrEqual(2);
      expect(inter.crosswalks.length).toBeGreaterThanOrEqual(2);
      expect(inter.crosswalks.every((cw) => cw.hasSignal)).toBe(true);
      expect(inter.signals.length).toBeGreaterThanOrEqual(1);
      for (const sig of inter.signals) {
        expect(
          WorldRegistry.isPointOnRoad(sig.x, sig.z, 0.1, true),
          `Semáforo ${sig.id} dentro da pista em (${sig.x}, ${sig.z})`
        ).toBe(false);
      }
    }

    const tJunctions = signaled.filter((i) => i.arms.length === 3);
    expect(tJunctions.length).toBeGreaterThan(0);
    for (const tj of tJunctions) {
      expect(tj.crosswalks.length).toBeLessThanOrEqual(3);
    }

    const roundabouts = INTERSECTIONS.filter((i) => i.isRoundabout);
    expect(roundabouts).toHaveLength(3);
    for (const rb of roundabouts) {
      expect(rb.arms.length).toBeGreaterThanOrEqual(3);
      expect(rb.crosswalks.length).toBeGreaterThanOrEqual(3);
      expect(rb.crosswalks.every((cw) => !cw.hasSignal)).toBe(true);
      expect(rb.signals).toHaveLength(0);
    }
  });
});
