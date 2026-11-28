import { useEffect, useState } from 'react';

export type PerfProfile = 'high' | 'low';
export type PerfModeSetting = 'auto' | 'high' | 'low';

export interface DevicePerformanceInfo {
  profile: PerfProfile;
  reasons: string[];
  isMobile: boolean;
  reducedMotion: boolean;
}

function computeInfo(battery?: { level: number; charging: boolean } | null): DevicePerformanceInfo {
  const browserNavigator = typeof navigator === 'undefined' ? undefined : navigator;
  const ua = browserNavigator?.userAgent ?? "";
  const isMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cores = (browserNavigator as { hardwareConcurrency?: number } | undefined)?.hardwareConcurrency || 8;
  const mem = (browserNavigator as { deviceMemory?: number } | undefined)?.deviceMemory || 8;

  const reasons: string[] = [];
  if (isMobile) reasons.push('移动端 / WebView 环境');
  if (reducedMotion) reasons.push('系统开启"减弱动态效果"');
  if (cores <= 4) reasons.push(`低核心数 (${cores} 核)`);
  if (mem <= 4) reasons.push(`低内存 (${mem} GB)`);
  if (battery && !battery.charging && battery.level < 0.25) {
    reasons.push(`低电量未充电 (${Math.round(battery.level * 100)}%)`);
  }

  return {
    profile: reasons.length > 0 ? 'low' : 'high',
    reasons,
    isMobile,
    reducedMotion,
  };
}

/**
 * Detects device capability & power constraints.
 * Works in Electron (Chromium: exposes getBattery, deviceMemory, hardwareConcurrency)
 * and in Android WebView / GeckoView (guards every API so it never crashes).
 */
export function useDevicePerformance(): DevicePerformanceInfo {
  const [info, setInfo] = useState<DevicePerformanceInfo>(() => computeInfo(null));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMqChange = () => setInfo(computeInfo(currentBattery));
    mq.addEventListener?.('change', onMqChange);

    let currentBattery: { level: number; charging: boolean } | null = null;
    let rawBattery: BatteryLike | null = null;
    let onBatteryChange: (() => void) | undefined;
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<BatteryLike>;
    };

    if (nav.getBattery) {
      nav
        .getBattery()
        .then((b) => {
          rawBattery = b;
          currentBattery = { level: b.level, charging: b.charging };
          onBatteryChange = () => {
            currentBattery = { level: b.level, charging: b.charging };
            setInfo(computeInfo(currentBattery));
          };
          b.addEventListener?.('levelchange', onBatteryChange);
          b.addEventListener?.('chargingchange', onBatteryChange);
          setInfo(computeInfo(currentBattery));
        })
        .catch(() => {});
    }

    return () => {
      mq.removeEventListener?.('change', onMqChange);
      if (rawBattery && onBatteryChange) {
        rawBattery.removeEventListener?.('levelchange', onBatteryChange);
        rawBattery.removeEventListener?.('chargingchange', onBatteryChange);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return info;
}

interface BatteryLike { level: number; charging: boolean; addEventListener?: (type: string, listener: () => void) => void; removeEventListener?: (type: string, listener: () => void) => void; }
