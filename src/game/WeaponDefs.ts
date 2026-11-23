export type WeaponId = 'fists' | 'pistol' | 'smg' | 'shotgun' | 'rifle';

export type WeaponCategory = 'melee' | 'handgun' | 'smg' | 'shotgun' | 'rifle';

export type FireMode = 'melee' | 'semi' | 'auto';

export type ReloadMode = 'none' | 'mag' | 'shell';

export type WeaponState = 'idle' | 'firing' | 'reloading' | 'switching';

export const WEAPON_SWITCH_SEC = 0.35;

const DEG_TO_RAD = Math.PI / 180;
const deg = (degrees: number): number => degrees * DEG_TO_RAD;

export interface WeaponDef {
  id: WeaponId;
  slot: 1 | 2 | 3 | 4 | 5;
  name: string;
  shortName: string;
  description: string;
  category: WeaponCategory;
  fireMode: FireMode;
  reloadMode: ReloadMode;
  isFirearm: boolean;
  twoHanded: boolean;
  damage: number;
  headshotMul: number;
  limbMul: number;
  rpm: number;
  pellets: number;
  clipSize: number;
  maxReserve: number;
  reloadSec: number; // mag: total reload; shell: per-shell reload
  switchSec: number;
  muzzleSpeed: number; // m/s
  gravity: number; // m/s^2
  drag: number; // linear drag 1/s
  range: number; // m
  falloffStart: number; // 40% of range -> 100% damage until here
  falloffMinMul: number; // 0.5 at max range
  spreadHip: number; // rad
  spreadAim: number; // rad
  spreadMovePenalty: number; // rad
  spreadPerShot: number; // bloom per shot (rad)
  spreadRecovery: number; // bloom recovery speed (rad/s)
  maxSpread: number; // rad
  recoilPitch: number; // rad
  recoilYaw: number; // rad
  aimFov: number;
  impulseStrength: number; // knockback strength
  price: number;
  ammoPackAmount: number;
  ammoPackPrice: number;
  tracerColorHex: number;
  noiseRadius: number;
}

export const WEAPON_DEFS: Record<WeaponId, WeaponDef> = {
  fists: {
    id: 'fists',
    slot: 1,
    name: 'Punhos',
    shortName: 'Punhos',
    description: 'Soco em cone de 1,6 m com knockback leve e sem mira.',
    category: 'melee',
    fireMode: 'melee',
    reloadMode: 'none',
    isFirearm: false,
    twoHanded: false,
    damage: 12,
    headshotMul: 1.25,
    limbMul: 0.9,
    rpm: 150,
    pellets: 1,
    clipSize: 0,
    maxReserve: 0,
    reloadSec: 0,
    switchSec: WEAPON_SWITCH_SEC,
    muzzleSpeed: 0,
    gravity: 0,
    drag: 0,
    range: 1.6,
    falloffStart: 1.6,
    falloffMinMul: 1.0,
    spreadHip: 0,
    spreadAim: 0,
    spreadMovePenalty: 0,
    spreadPerShot: 0,
    spreadRecovery: 0.1,
    maxSpread: 0,
    recoilPitch: 0.008,
    recoilYaw: 0.004,
    aimFov: 60,
    impulseStrength: 4.5,
    price: 0,
    ammoPackAmount: 0,
    ammoPackPrice: 0,
    tracerColorHex: 0xffffff,
    noiseRadius: 6,
  },
  pistol: {
    id: 'pistol',
    slot: 2,
    name: 'Pistola 9mm',
    shortName: 'Pistola',
    description: 'Semiautomática precisa e ágil, ideal para uso urbano.',
    category: 'handgun',
    fireMode: 'semi',
    reloadMode: 'mag',
    isFirearm: true,
    twoHanded: false,
    damage: 24,
    headshotMul: 2.5,
    limbMul: 0.75,
    rpm: 360,
    pellets: 1,
    clipSize: 12,
    maxReserve: 96,
    reloadSec: 1.35,
    switchSec: WEAPON_SWITCH_SEC,
    muzzleSpeed: 330,
    gravity: 9.81,
    drag: 0.14,
    range: 80,
    falloffStart: 32,
    falloffMinMul: 0.5,
    spreadHip: deg(2.2),
    spreadAim: deg(0.6),
    spreadMovePenalty: deg(0.75),
    spreadPerShot: deg(0.55),
    spreadRecovery: deg(2.8),
    maxSpread: deg(4.2),
    recoilPitch: deg(1.6),
    recoilYaw: deg(0.45),
    aimFov: 48,
    impulseStrength: 7.5,
    price: 250,
    ammoPackAmount: 24,
    ammoPackPrice: 45,
    tracerColorHex: 0xffe066,
    noiseRadius: 48,
  },
  smg: {
    id: 'smg',
    slot: 3,
    name: 'Submetralhadora MP-Solara',
    shortName: 'SMG',
    description: 'Alta cadência automática para combate em curta e média distância.',
    category: 'smg',
    fireMode: 'auto',
    reloadMode: 'mag',
    isFirearm: true,
    twoHanded: true,
    damage: 14,
    headshotMul: 2.0,
    limbMul: 0.75,
    rpm: 780,
    pellets: 1,
    clipSize: 30,
    maxReserve: 240,
    reloadSec: 1.9,
    switchSec: WEAPON_SWITCH_SEC,
    muzzleSpeed: 360,
    gravity: 9.81,
    drag: 0.18,
    range: 70,
    falloffStart: 28,
    falloffMinMul: 0.5,
    spreadHip: deg(3.2),
    spreadAim: deg(1.2),
    spreadMovePenalty: deg(0.9),
    spreadPerShot: deg(0.35),
    spreadRecovery: deg(3.2),
    maxSpread: deg(5.2),
    recoilPitch: deg(0.9),
    recoilYaw: deg(0.6),
    aimFov: 48,
    impulseStrength: 6.0,
    price: 600,
    ammoPackAmount: 60,
    ammoPackPrice: 75,
    tracerColorHex: 0x38bdf8,
    noiseRadius: 56,
  },
  shotgun: {
    id: 'shotgun',
    slot: 4,
    name: 'Escopeta Tática 12',
    shortName: 'Escopeta',
    description: 'Dispara 8 balins por tiro com alto knockback e recarga cartucho a cartucho.',
    category: 'shotgun',
    fireMode: 'semi',
    reloadMode: 'shell',
    isFirearm: true,
    twoHanded: true,
    damage: 11,
    headshotMul: 1.5,
    limbMul: 0.8,
    rpm: 70,
    pellets: 8,
    clipSize: 6,
    maxReserve: 36,
    reloadSec: 0.55,
    switchSec: WEAPON_SWITCH_SEC,
    muzzleSpeed: 300,
    gravity: 9.81,
    drag: 0.42,
    range: 35,
    falloffStart: 14,
    falloffMinMul: 0.5,
    spreadHip: deg(5.5),
    spreadAim: deg(3.2),
    spreadMovePenalty: deg(1.0),
    spreadPerShot: deg(1.1),
    spreadRecovery: deg(2.2),
    maxSpread: deg(7.5),
    recoilPitch: deg(4.5),
    recoilYaw: deg(1.1),
    aimFov: 48,
    impulseStrength: 13.0,
    price: 850,
    ammoPackAmount: 12,
    ammoPackPrice: 80,
    tracerColorHex: 0xff8c38,
    noiseRadius: 70,
  },
  rifle: {
    id: 'rifle',
    slot: 5,
    name: 'Rifle Tático VX',
    shortName: 'Rifle',
    description: 'Precisão e alcance elevados (160 m) com disparo automático.',
    category: 'rifle',
    fireMode: 'auto',
    reloadMode: 'mag',
    isFirearm: true,
    twoHanded: true,
    damage: 38,
    headshotMul: 3.0,
    limbMul: 0.8,
    rpm: 600,
    pellets: 1,
    clipSize: 30,
    maxReserve: 180,
    reloadSec: 2.3,
    switchSec: WEAPON_SWITCH_SEC,
    muzzleSpeed: 820,
    gravity: 9.81,
    drag: 0.08,
    range: 160,
    falloffStart: 64,
    falloffMinMul: 0.5,
    spreadHip: deg(2.6),
    spreadAim: deg(0.35),
    spreadMovePenalty: deg(0.95),
    spreadPerShot: deg(0.42),
    spreadRecovery: deg(3.0),
    maxSpread: deg(4.6),
    recoilPitch: deg(1.3),
    recoilYaw: deg(0.65),
    aimFov: 40,
    impulseStrength: 9.8,
    price: 1200,
    ammoPackAmount: 60,
    ammoPackPrice: 110,
    tracerColorHex: 0xff2e93,
    noiseRadius: 80,
  },
};

export const WEAPONS = WEAPON_DEFS;

export const WEAPON_LIST: WeaponDef[] = [
  WEAPON_DEFS.fists,
  WEAPON_DEFS.pistol,
  WEAPON_DEFS.smg,
  WEAPON_DEFS.shotgun,
  WEAPON_DEFS.rifle,
];

export const WEAPON_BY_SLOT: Record<number, WeaponId> = {
  1: 'fists',
  2: 'pistol',
  3: 'smg',
  4: 'shotgun',
  5: 'rifle',
};

export const ARMOR_VEST_PRICE = 300;

export function isWeaponId(id: string): id is WeaponId {
  return id === 'fists' || id === 'pistol' || id === 'smg' || id === 'shotgun' || id === 'rifle';
}

export function getWeaponDef(id: string): WeaponDef {
  return isWeaponId(id) ? WEAPON_DEFS[id] : WEAPON_DEFS.fists;
}
