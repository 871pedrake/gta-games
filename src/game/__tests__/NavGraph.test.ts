import { describe, expect, it } from 'vitest';
import { NavGraph } from '../NavGraph';

describe('NavGraph', () => {
  it('constrói malha conectada com nós de cidade, calçadão, praia e bar noturno', () => {
    const graph = new NavGraph();
    expect(graph.nodes.length).toBeGreaterThan(60);

    expect(graph.getNodesByRegion('city').length).toBeGreaterThan(20);
    expect(graph.getNodesByRegion('promenade').length).toBeGreaterThan(5);
    expect(graph.getNodesByRegion('beach').length).toBeGreaterThan(5);
    expect(graph.getNodesByRegion('night_bar').length).toBeGreaterThan(0);

    const allConnected = graph.nodes.every((n) => n.edges.length > 0);
    expect(allConnected).toBe(true);
  });

  it('alterna corretamente os ciclos semafóricos entre N-S Verde, Transição e L-O Verde', () => {
    const graph = new NavGraph();

    expect(graph.isNsGreen()).toBe(true);
    expect(graph.isEwGreen()).toBe(false);
    expect(graph.isVehicleAxisGreen('z')).toBe(true);
    expect(graph.isVehicleAxisGreen('x')).toBe(false);
    expect(graph.getSignalLabel()).toBe('N-S Verde');

    graph.updateTrafficSignals(6.3, [], []);
    expect(graph.isNsGreen()).toBe(false);
    expect(graph.isEwGreen()).toBe(false);
    expect(graph.getSignalLabel()).toBe('Transição');

    graph.updateTrafficSignals(1.5, [], []);
    expect(graph.isNsGreen()).toBe(false);
    expect(graph.isEwGreen()).toBe(true);
    expect(graph.isVehicleAxisGreen('x')).toBe(true);
    expect(graph.isVehicleAxisGreen('z')).toBe(false);
    expect(graph.getSignalLabel()).toBe('L-O Verde');
  });

  it('respeita autorização de travessia em faixas conforme o semáforo ativo', () => {
    const graph = new NavGraph();
    const nsCrosswalk = graph.nodes
      .flatMap((n) => n.edges)
      .find((e) => e.isCrosswalk && e.crossAxis === 'ns');
    const ewCrosswalk = graph.nodes
      .flatMap((n) => n.edges)
      .find((e) => e.isCrosswalk && e.crossAxis === 'ew');
    const sidewalkEdge = graph.nodes.flatMap((n) => n.edges).find((e) => !e.isCrosswalk);

    expect(nsCrosswalk).toBeDefined();
    expect(ewCrosswalk).toBeDefined();
    expect(sidewalkEdge).toBeDefined();

    expect(graph.canCrossEdge(sidewalkEdge!)).toBe(true);
    expect(graph.canCrossEdge(nsCrosswalk!)).toBe(true);
    expect(graph.canCrossEdge(ewCrosswalk!)).toBe(false);
  });

  it('encontra o nó mais próximo e inclui nós elevados do Morro da Brisa e do Heliponto', () => {
    const graph = new NavGraph();
    const beachNode = graph.findClosestNode(63, 14, 'beach');
    expect(beachNode.region).toBe('beach');
    expect(beachNode.x).toBeGreaterThan(55);

    const morroTopNode = graph.findClosestNode(-202, -264, 'city');
    expect(morroTopNode.y).toBeGreaterThan(5.0);
    expect(morroTopNode.edges.length).toBeGreaterThan(0);

    const heliNode = graph.findClosestNode(-188, 238, 'city');
    expect(heliNode.z).toBeGreaterThan(220);
    expect(heliNode.edges.length).toBeGreaterThan(0);
  });

  it('particiona o grafo em subgrafos por chunk com conexões inter-chunk e busca hierárquica', () => {
    const graph = new NavGraph();
    const chunkGraphs = graph.getChunkGraphs();
    const interLinks = graph.getInterChunkLinks();

    expect(chunkGraphs.size).toBeGreaterThan(15);
    expect(interLinks.length).toBeGreaterThan(20);

    for (const link of interLinks) {
      expect(link.fromChunkKey).not.toBe(link.toChunkKey);
      const fromNode = graph.nodes[link.fromNodeId];
      const toNode = graph.nodes[link.toNodeId];
      expect(fromNode.isChunkBorder).toBe(true);
      expect(toNode.isChunkBorder).toBe(true);
      expect(fromNode.chunkKey).toBe(link.fromChunkKey);
      expect(toNode.chunkKey).toBe(link.toChunkKey);
    }

    const centroChunk = graph.getChunkGraphAtWorld(-20, 0);
    expect(centroChunk).toBeDefined();
    expect(centroChunk!.nodeIds.length).toBeGreaterThan(0);
    expect(centroChunk!.connectedNeighborKeys.length).toBeGreaterThan(0);

    // Rota hierárquica atravessando vários chunks: Morro da Brisa -> Marina/Praia
    const path = graph.findHierarchicalPath(-202, -264, 24, 150);
    expect(path.length).toBeGreaterThan(8);
    const visitedChunks = new Set(path.map((id) => graph.nodes[id].chunkKey));
    expect(visitedChunks.size).toBeGreaterThan(3);

    for (let i = 0; i < path.length - 1; i++) {
      const a = graph.nodes[path[i]];
      const hasStep = a.edges.some((e) => e.to === path[i + 1]);
      expect(hasStep).toBe(true);
    }
  });
});
