import * as THREE from 'three';
import { QualityPreset, VEHICLE_LOD_LOW_DIST, VEHICLE_LOD_MID_DIST } from '../../config';
import { VehicleEntity, VehiclePaintFinish } from '../../types';
import { DOOR_OPEN_VIS_ANGLE_RAD } from '../physics/doorPhysics';
import { getVehicleSpec } from '../VehicleSpecs';

export interface VehicleLodRig {
  root: THREE.Group;
  lod0: THREE.Group;
  lod1: THREE.Group;
  lod2: THREE.Group;
}

export interface VehicleSharedMaterials {
  paintMat: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
  whiteDoorMat: THREE.MeshStandardMaterial;
  trimMat: THREE.MeshStandardMaterial;
  glassMat: THREE.MeshStandardMaterial;
  tireMat: THREE.MeshStandardMaterial;
  rimMat: THREE.MeshStandardMaterial;
  headlightMat: THREE.MeshStandardMaterial;
  taillightMat: THREE.MeshStandardMaterial;
}

export function createVehicleLodRig(x: number, z: number, heading: number): VehicleLodRig {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  root.rotation.y = heading;

  const lod = new THREE.LOD();
  const lod0 = new THREE.Group();
  const lod1 = new THREE.Group();
  const lod2 = new THREE.Group();
  lod.addLevel(lod0, 0);
  lod.addLevel(lod1, VEHICLE_LOD_MID_DIST);
  lod.addLevel(lod2, VEHICLE_LOD_LOW_DIST);
  root.add(lod);

  return { root, lod0, lod1, lod2 };
}

function getPaintFinishProperties(finish: VehiclePaintFinish, isUtilityVehicle: boolean) {
  if (isUtilityVehicle) {
    return { roughness: 0.34, metalness: 0.28, clearcoat: 0.45, clearcoatRoughness: 0.18 };
  }
  switch (finish) {
    case 'matte':
      return { roughness: 0.78, metalness: 0.14, clearcoat: 0.06, clearcoatRoughness: 0.68 };
    case 'metallic':
      return { roughness: 0.22, metalness: 0.82, clearcoat: 0.78, clearcoatRoughness: 0.14 };
    case 'pearlescent':
      return { roughness: 0.18, metalness: 0.68, clearcoat: 1.0, clearcoatRoughness: 0.08 };
    case 'gloss':
    default:
      return { roughness: 0.26, metalness: 0.48, clearcoat: 0.9, clearcoatRoughness: 0.12 };
  }
}

export function createVehicleSharedMaterials(
  baseColor: number,
  isSoftwareGl: boolean,
  isUtilityVehicle = false,
  finish: VehiclePaintFinish = 'gloss'
): VehicleSharedMaterials {
  const props = getPaintFinishProperties(finish, isUtilityVehicle);
  const paintMat = isSoftwareGl
    ? new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: props.roughness,
        metalness: props.metalness,
      })
    : new THREE.MeshPhysicalMaterial({
        color: baseColor,
        roughness: props.roughness,
        metalness: props.metalness,
        clearcoat: props.clearcoat,
        clearcoatRoughness: props.clearcoatRoughness,
      });

  return {
    paintMat,
    whiteDoorMat: new THREE.MeshStandardMaterial({
      color: 0xf4f6fc,
      roughness: 0.32,
      metalness: 0.35,
    }),
    trimMat: new THREE.MeshStandardMaterial({
      color: 0x151722,
      roughness: 0.82,
      metalness: 0.15,
    }),
    glassMat: new THREE.MeshStandardMaterial({
      color: 0x16253b,
      roughness: 0.1,
      metalness: 0.88,
    }),
    tireMat: new THREE.MeshStandardMaterial({
      color: 0x141418,
      roughness: 0.9,
      metalness: 0.05,
    }),
    rimMat: new THREE.MeshStandardMaterial({
      color: 0xd9e0ec,
      roughness: 0.2,
      metalness: 0.9,
    }),
    headlightMat: new THREE.MeshStandardMaterial({
      color: 0xfff6d6,
      emissive: 0xffe49e,
      emissiveIntensity: 1.4,
      roughness: 0.2,
    }),
    taillightMat: new THREE.MeshStandardMaterial({
      color: 0xff2040,
      emissive: 0xff1133,
      emissiveIntensity: 1.3,
      roughness: 0.2,
    }),
  };
}

export function addContactShadow(
  lod0: THREE.Group,
  width: number,
  length: number,
  shadowTex: THREE.CanvasTexture
): void {
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(width, length),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = 0.025;
  lod0.add(plane);
}

/**
 * Cria silhueta simples de piloto/motorista sentado no banco para visibilidade através do vidro ou porta aberta.
 */
export function createSeatedDriverRig(
  trimMat: THREE.MeshStandardMaterial,
  shirtHex = 0x334155,
  skinHex = 0xe6b89c
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'seated_driver';

  const shirtMat = new THREE.MeshStandardMaterial({ color: shirtHex, roughness: 0.72 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skinHex, roughness: 0.65 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.44, 0.22), shirtMat);
  torso.position.set(0, 0.22, -0.04);
  torso.rotation.x = -0.1;

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), skinMat);
  head.position.set(0, 0.54, -0.02);

  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.235, 0.08, 0.235), trimMat);
  hair.position.set(0, 0.63, -0.025);

  const armGeo = new THREE.BoxGeometry(0.09, 0.09, 0.34);
  const leftArm = new THREE.Mesh(armGeo, shirtMat);
  leftArm.position.set(-0.18, 0.31, 0.14);
  leftArm.rotation.x = -0.25;

  const rightArm = new THREE.Mesh(armGeo, shirtMat);
  rightArm.position.set(0.18, 0.31, 0.14);
  rightArm.rotation.x = -0.25;

  group.add(torso, head, hair, leftArm, rightArm);
  return group;
}

/**
 * Reaplica cor e acabamento (gloss/matte/metallic/pearlescent) no material principal do veículo.
 */
export function applyVehiclePaintAndFinish(
  vehicle: VehicleEntity,
  paintHex?: number,
  finish?: VehiclePaintFinish
): void {
  if (paintHex !== undefined) {
    vehicle.paintHex = paintHex;
  }
  if (finish !== undefined) {
    vehicle.finish = finish;
  }
  const mat = vehicle.paintMaterial;
  if (!mat) return;

  if (vehicle.paintHex !== undefined) {
    mat.color.setHex(vehicle.paintHex);
  }
  const isUtility = vehicle.type === 'bus' || vehicle.type === 'ambulance';
  const props = getPaintFinishProperties(vehicle.finish ?? 'gloss', isUtility);
  mat.roughness = props.roughness;
  mat.metalness = props.metalness;
  if ('clearcoat' in mat) {
    (mat as THREE.MeshPhysicalMaterial).clearcoat = props.clearcoat;
    (mat as THREE.MeshPhysicalMaterial).clearcoatRoughness = props.clearcoatRoughness;
  }
  mat.needsUpdate = true;
}

/**
 * Sincroniza transparência dos vidros por qualidade, vão escuro (> 2°) e visibilidade do piloto sentado.
 */
export function syncVehicleCabinVisuals(
  vehicle: VehicleEntity,
  isSoftwareGl: boolean,
  qualityPreset: QualityPreset = 'medium',
  hideDriver = false
): void {
  const visuals = vehicle.cabinVisuals;
  if (!visuals) return;

  const spec = getVehicleSpec(vehicle.type);
  const openTop = spec.hasRoof === false;
  const transparentGlass = !isSoftwareGl && qualityPreset !== 'low';

  for (const glassMat of visuals.glassMats) {
    const nextOpacity = transparentGlass ? 0.42 : 1.0;
    const nextDepthWrite = !transparentGlass;
    if (
      glassMat.transparent !== transparentGlass ||
      glassMat.opacity !== nextOpacity ||
      glassMat.depthWrite !== nextDepthWrite
    ) {
      glassMat.transparent = transparentGlass;
      glassMat.opacity = nextOpacity;
      glassMat.depthWrite = nextDepthWrite;
      glassMat.needsUpdate = true;
    }
  }

  let anyDoorOpen = false;
  const doors = vehicle.doors ?? [];
  for (let i = 0; i < visuals.doorWellGroups.length; i++) {
    const well = visuals.doorWellGroups[i];
    const door = doors[i];
    const open = Boolean(door && !door.detached && door.angle > DOOR_OPEN_VIS_ANGLE_RAD);
    well.visible = open;
    if (open) anyDoorOpen = true;
  }

  if (visuals.interiorGroup) {
    visuals.interiorGroup.visible = openTop || anyDoorOpen || transparentGlass;
  }

  if (visuals.seatedDriverGroup) {
    const occupied = vehicle.driver !== 'none';
    visuals.seatedDriverGroup.visible =
      occupied && !hideDriver && (openTop || anyDoorOpen || transparentGlass);
  }
}
