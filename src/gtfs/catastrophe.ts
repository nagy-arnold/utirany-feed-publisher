import { GtfsMetrics } from './validator.js';

export interface CatastropheProtectionRules {
  readonly minStops: number;
  readonly minRoutes: number;
  readonly minTrips: number;
  readonly minStopTimes: number;
  readonly minAcceptableRatio: number;
}

export const DEFAULT_CATASTROPHE_RULES: CatastropheProtectionRules = {
  minStops: 10,
  minRoutes: 1,
  minTrips: 1,
  minStopTimes: 1,
  minAcceptableRatio: 0.20,
};

export function checkCatastropheDrop(
  candidate: GtfsMetrics,
  lkg: GtfsMetrics | null,
  rules: CatastropheProtectionRules = DEFAULT_CATASTROPHE_RULES,
): { isCatastrophe: boolean; reason: string | null } {
  if (candidate.stopCount < rules.minStops) {
    return {
      isCatastrophe: true,
      reason: `Megállók száma gyanúsan alacsony (${candidate.stopCount} < ${rules.minStops})`,
    };
  }
  if (candidate.routeCount < rules.minRoutes) {
    return {
      isCatastrophe: true,
      reason: `Járatvonalak száma gyanúsan alacsony (${candidate.routeCount} < ${rules.minRoutes})`,
    };
  }
  if (candidate.tripCount < rules.minTrips) {
    return {
      isCatastrophe: true,
      reason: `Menetek száma gyanúsan alacsony (${candidate.tripCount} < ${rules.minTrips})`,
    };
  }
  if (candidate.stopTimeCount < rules.minStopTimes) {
    return {
      isCatastrophe: true,
      reason: `Megállási rekordok száma gyanúsan alacsony (${candidate.stopTimeCount} < ${rules.minStopTimes})`,
    };
  }

  if (!lkg) {
    return { isCatastrophe: false, reason: null };
  }

  if (lkg.stopCount > 0 && candidate.stopCount / lkg.stopCount < rules.minAcceptableRatio) {
    return {
      isCatastrophe: true,
      reason: `Túl nagy megállószám-csökkenés az előző aktív adathoz képest (${candidate.stopCount} vs ${lkg.stopCount})`,
    };
  }

  if (lkg.routeCount > 0 && candidate.routeCount / lkg.routeCount < rules.minAcceptableRatio) {
    return {
      isCatastrophe: true,
      reason: `Túl nagy vonalszám-csökkenés az előző aktív adathoz képest (${candidate.routeCount} vs ${lkg.routeCount})`,
    };
  }

  if (lkg.tripCount > 0 && candidate.tripCount / lkg.tripCount < rules.minAcceptableRatio) {
    return {
      isCatastrophe: true,
      reason: `Túl nagy menetszám-csökkenés az előző aktív adathoz képest (${candidate.tripCount} vs ${lkg.tripCount})`,
    };
  }

  if (lkg.stopTimeCount > 0 && candidate.stopTimeCount / lkg.stopTimeCount < rules.minAcceptableRatio) {
    return {
      isCatastrophe: true,
      reason: `Túl nagy megállási-rekord csökkenés az előző aktív adathoz képest (${candidate.stopTimeCount} vs ${lkg.stopTimeCount})`,
    };
  }

  return { isCatastrophe: false, reason: null };
}
