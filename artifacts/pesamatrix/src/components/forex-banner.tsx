import { useEffect, useRef } from "react";
import {
  useGetBannerSettings,
  useGetForexRates,
  getGetBannerSettingsQueryKey,
  getGetForexRatesQueryKey,
} from "@workspace/api-client-react";
import type { BannerSettings } from "@workspace/api-client-react";

const ALL_PAIRS = ["EUR/USD","GBP/USD","USD/JPY","USD/CHF","AUD/USD","NZD/USD","USD/CAD","EUR/GBP","EUR/JPY","GBP/JPY"];

function MarketStatusBadge({
  status,
  bullish,
  bearish,
}: {
  status: "OPEN" | "CLOSED" | "OPENING_SOON";
  bullish: string;
  bearish: string;
}) {
  const config = {
    OPEN: { color: bullish, label: "MARKET OPEN" },
    CLOSED: { color: bearish, label: "MARKET CLOSED" },
    OPENING_SOON: { color: "#d97706", label: "MARKET OPENS SOON" },
  }[status];

  return (
    <div className="flex items-center gap-1.5 shrink-0 px-3 border-r border-white/10">
      <span
        className="h-2 w-2 rounded-full animate-pulse"
        style={{ backgroundColor: config.color, boxShadow: `0 0 6px ${config.color}` }}
      />
      <span className="text-[11px] font-semibold tracking-wider whitespace-nowrap" style={{ color: config.color }}>
        {config.label}
      </span>
    </div>
  );
}

function DirectionArrow({ direction, up, down }: { direction: string; up: string; down: string }) {
  if (direction === "up") return <span style={{ color: up }}>&#9650;</span>;
  if (direction === "down") return <span style={{ color: down }}>&#9660;</span>;
  return <span className="text-gray-400">&#8211;</span>;
}

interface ForexRate {
  pair: string;
  bid: number;
  ask: number;
  spread: number;
  midPrice: number;
  change: number;
  changePercent: number;
  direction: string;
}

function PairItem({
  rate,
  bullish,
  bearish,
  fontSize,
}: {
  rate: ForexRate;
  bullish: string;
  bearish: string;
  fontSize: number;
}) {
  const color = rate.direction === "up" ? bullish : rate.direction === "down" ? bearish : "#9ca3af";
  const pctSign = rate.changePercent >= 0 ? "+" : "";

  return (
    <div
      className="flex items-center gap-2 px-4 border-r border-white/10 hover:bg-white/5 transition-colors cursor-default"
      style={{ fontSize }}
    >
      <span className="font-semibold tracking-wide text-white/90 whitespace-nowrap">{rate.pair}</span>
      <span className="font-mono font-bold text-white whitespace-nowrap">{rate.midPrice.toFixed(rate.pair.includes("JPY") ? 3 : 5)}</span>
      <span className="flex items-center gap-0.5 text-[11px] whitespace-nowrap" style={{ color }}>
        <DirectionArrow direction={rate.direction} up={bullish} down={bearish} />
        <span>{pctSign}{rate.changePercent.toFixed(2)}%</span>
      </span>
    </div>
  );
}

function TickerBanner({
  rates,
  marketStatus,
  settings,
}: {
  rates: ForexRate[];
  marketStatus: "OPEN" | "CLOSED" | "OPENING_SOON";
  settings: BannerSettings;
}) {
  const styleId = "forex-ticker-keyframes";
  const speed = settings.tickerSpeed ?? 40;

  useEffect(() => {
    let el = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = styleId;
      document.head.appendChild(el);
    }
    el.textContent = `
      @keyframes forex-ticker-scroll {
        0%   { transform: translateX(0); }
        100% { transform: translateX(-50%); }
      }
      .forex-ticker-track {
        animation: forex-ticker-scroll ${speed}s linear infinite;
        will-change: transform;
      }
      .forex-ticker-track:hover { animation-play-state: paused; }
    `;
  }, [speed]);

  const items = [...rates, ...rates];

  return (
    <div className="overflow-hidden flex-1 flex items-center">
      <div className="forex-ticker-track flex items-center">
        {items.map((r, i) => (
          <PairItem
            key={`${r.pair}-${i}`}
            rate={r}
            bullish={settings.bullishColor ?? "#16a34a"}
            bearish={settings.bearishColor ?? "#dc2626"}
            fontSize={settings.fontSize ?? 13}
          />
        ))}
      </div>
    </div>
  );
}

function CardsBanner({
  rates,
  marketStatus,
  settings,
}: {
  rates: ForexRate[];
  marketStatus: "OPEN" | "CLOSED" | "OPENING_SOON";
  settings: BannerSettings;
}) {
  const bullish = settings.bullishColor ?? "#16a34a";
  const bearish = settings.bearishColor ?? "#dc2626";

  return (
    <div className="w-full overflow-x-auto">
      <div className="flex gap-3 p-3">
        {rates.map((rate) => {
          const color = rate.direction === "up" ? bullish : rate.direction === "down" ? bearish : "#9ca3af";
          const pctSign = rate.changePercent >= 0 ? "+" : "";
          return (
            <div
              key={rate.pair}
              className="shrink-0 rounded-lg border border-white/10 p-3 hover:border-white/20 transition-colors"
              style={{
                backgroundColor: "rgba(255,255,255,0.05)",
                minWidth: 140,
                fontSize: settings.fontSize ?? 13,
              }}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-semibold text-white/90 text-xs tracking-wide">{rate.pair}</span>
                <DirectionArrow direction={rate.direction} up={bullish} down={bearish} />
              </div>
              <div className="font-mono font-bold text-white text-base mb-1">
                {rate.midPrice.toFixed(rate.pair.includes("JPY") ? 3 : 5)}
              </div>
              <div className="text-[11px] text-white/50 space-y-0.5">
                <div>Bid <span className="text-white/70">{rate.bid.toFixed(rate.pair.includes("JPY") ? 3 : 5)}</span></div>
                <div>Ask <span className="text-white/70">{rate.ask.toFixed(rate.pair.includes("JPY") ? 3 : 5)}</span></div>
                <div>Spread <span className="text-white/70">{rate.spread}</span></div>
              </div>
              <div className="mt-1 text-xs font-semibold" style={{ color }}>
                {pctSign}{rate.changePercent.toFixed(2)}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompactBanner({
  rates,
  settings,
}: {
  rates: ForexRate[];
  settings: BannerSettings;
}) {
  const bullish = settings.bullishColor ?? "#16a34a";
  const bearish = settings.bearishColor ?? "#dc2626";

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 flex-1 overflow-hidden">
      {rates.map((rate) => {
        const color = rate.direction === "up" ? bullish : rate.direction === "down" ? bearish : "#9ca3af";
        return (
          <span key={rate.pair} className="flex items-center gap-1 whitespace-nowrap" style={{ fontSize: settings.fontSize ?? 13 }}>
            <span className="text-white/70 text-xs">{rate.pair}</span>
            <span className="font-mono font-semibold text-white">
              {rate.midPrice.toFixed(rate.pair.includes("JPY") ? 3 : 5)}
            </span>
            <span style={{ color }} className="text-[11px]">
              <DirectionArrow direction={rate.direction} up={bullish} down={bearish} />
            </span>
          </span>
        );
      })}
    </div>
  );
}

export function ForexBanner() {
  const fontLinkRef = useRef<HTMLLinkElement | null>(null);

  const { data: settings, isLoading: settingsLoading } = useGetBannerSettings({
    query: { queryKey: getGetBannerSettingsQueryKey(), refetchInterval: 30_000, retry: false },
  });

  const refreshMs = (settings?.refreshRate ?? 10) * 1000;

  const { data: ratesData, isError: ratesError } = useGetForexRates({
    query: {
      queryKey: getGetForexRatesQueryKey(),
      refetchInterval: refreshMs,
      retry: 1,
      enabled: !!settings,
    },
  });

  useEffect(() => {
    if (!settings?.fontFamily) return;
    const family = settings.fontFamily.replace(/ /g, "+");
    const href = `https://fonts.googleapis.com/css2?family=${family}:wght@400;500;600&display=swap`;
    if (!fontLinkRef.current) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      document.head.appendChild(link);
      fontLinkRef.current = link;
    }
    fontLinkRef.current.href = href;
  }, [settings?.fontFamily]);

  if (settingsLoading || !settings) return null;
  if (!settings.enabled) return null;

  const height = settings.bannerHeight ?? 48;
  const bg = settings.backgroundColor ?? "#0a0f1e";
  const textColor = settings.textColor ?? "#f1f5f9";
  const fontFamily = settings.fontFamily ?? "Inter";
  const bullish = settings.bullishColor ?? "#16a34a";
  const bearish = settings.bearishColor ?? "#dc2626";
  const mode = settings.displayMode ?? "ticker";

  const marketStatus = (ratesData?.marketStatus ?? "OPEN") as "OPEN" | "CLOSED" | "OPENING_SOON";
  const rates = (ratesData?.rates ?? []) as ForexRate[];

  return (
    <div
      className="w-full flex items-center border-b border-white/10 overflow-hidden shrink-0"
      style={{
        backgroundColor: bg,
        color: textColor,
        fontFamily,
        height: mode === "cards" ? "auto" : height,
        minHeight: mode === "cards" ? 120 : height,
      }}
    >
      <MarketStatusBadge status={marketStatus} bullish={bullish} bearish={bearish} />

      {ratesError || rates.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-white/40 px-4">
          Market Data Temporarily Unavailable
        </div>
      ) : mode === "ticker" ? (
        <TickerBanner rates={rates} marketStatus={marketStatus} settings={settings} />
      ) : mode === "cards" ? (
        <CardsBanner rates={rates} marketStatus={marketStatus} settings={settings} />
      ) : (
        <CompactBanner rates={rates} settings={settings} />
      )}
    </div>
  );
}
