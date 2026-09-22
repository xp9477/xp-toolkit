import {
  Widget,
  VStack,
  HStack,
  ZStack,
  Text,
  Image,
  Link,
  Button,
  Capsule,
  RoundedRectangle,
  Spacer,
  Divider,
  DateLabel,
  GeometryReader,
  Color,
} from "scripting";
import type { QuotaData, ServiceQuota, ServiceAccountDetail } from "./types";
import { UI, Colors, accentFor, accentFor5h, shortenHint } from "./theme";
import { fetchQuotaData, pctLabel } from "./api";
import { ReloadQuotaIntent } from "./app_intents";

function ProgressBar({
  pct,
  color,
  height = 4,
}: {
  pct: number | null;
  color: any;
  height?: number;
}) {
  const clamped = Math.max(0, Math.min(100, pct ?? 0)) / 100;
  return (
    <VStack frame={{ height }}>
      <GeometryReader>
        {(proxy) => {
          const totalW = proxy.size.width;
          const fillW = Math.max(height, totalW * clamped);
          return (
            <ZStack alignment="leading">
              <Capsule fill={UI.track} frame={{ width: totalW, height }} />
              {clamped > 0 && (
                <Capsule
                  fill={color}
                  frame={{ width: fillW, height }}
                  widgetAccentable
                />
              )}
            </ZStack>
          );
        }}
      </GeometryReader>
    </VStack>
  );
}

function FreshnessBadge({ isCached }: { isCached?: boolean }) {
  return (
    <HStack spacing={3} alignment="center">
      <Text
        font={{ size: 8 }}
        foregroundColor={isCached ? "#F59E0B" : "#10B981"}
      >
        ●
      </Text>
      <Text font={{ size: 9 }} foregroundColor={UI.muted}>
        {isCached ? "缓存" : "在线"}
      </Text>
    </HStack>
  );
}

function ServiceColumn({ service }: { service: ServiceQuota }) {
  const remainingText = pctLabel(service.remainingPct);
  const countNotice =
    service.accountCount && service.accountCount > 1
      ? ` (${service.accountCount}账号)`
      : "";
  const resetText = service.resetHint ? shortenHint(service.resetHint) : service.windowLabel;

  return (
    <Link url={service.url}>
      <VStack alignment="leading" spacing={4}>
        <HStack alignment="center">
          <Text
            font={{ size: 12, weight: "semibold" }}
            foregroundColor={UI.ink}
          >
            {service.name}
          </Text>
          {countNotice && (
            <Text font={{ size: 8 }} foregroundColor={UI.faint}>
              {countNotice}
            </Text>
          )}
          <Spacer />
          {service.plan ? (
            <Text font={{ size: 9 }} foregroundColor={UI.muted}>
              {service.plan}
            </Text>
          ) : null}
        </HStack>

        <HStack alignment="firstTextBaseline" spacing={2}>
          <Text
            font={{ size: 24, weight: "bold" }}
            foregroundColor={accentFor(service.remainingPct)}
            widgetAccentable
          >
            {remainingText}
          </Text>
          <Text font={{ size: 11, weight: "semibold" }} foregroundColor={UI.muted}>
            %
          </Text>
          <Spacer />
          <Text font={{ size: 9 }} foregroundColor={UI.muted}>
            {resetText}
          </Text>
        </HStack>

        <ProgressBar
          pct={service.remainingPct}
          color={accentFor(service.remainingPct)}
          height={5}
        />

        {service.remaining5hPct != null ? (
          <VStack alignment="leading" spacing={2} padding={{ top: 2 }}>
            <HStack alignment="center">
              <Text font={{ size: 8 }} foregroundColor={UI.muted}>
                5h 窗口
              </Text>
              <Spacer />
              <Text
                font={{ size: 9, weight: "semibold" }}
                foregroundColor={accentFor5h(service.remaining5hPct)}
                widgetAccentable
              >
                {pctLabel(service.remaining5hPct)}%
              </Text>
              {service.reset5hHint && (
                <Text font={{ size: 8 }} foregroundColor={UI.faint}>
                  ({shortenHint(service.reset5hHint)})
                </Text>
              )}
            </HStack>
            <ProgressBar
              pct={service.remaining5hPct}
              color={accentFor5h(service.remaining5hPct)}
              height={3}
            />
          </VStack>
        ) : null}
      </VStack>
    </Link>
  );
}

function SmallServiceRow({ service }: { service: ServiceQuota }) {
  const resetText = service.resetHint ? shortenHint(service.resetHint) : service.windowLabel;
  return (
    <Link url={service.url}>
      <VStack alignment="leading" spacing={2}>
        <HStack alignment="center">
          <Text font={{ size: 11, weight: "semibold" }} foregroundColor={UI.ink}>
            {service.name}
          </Text>
          <Spacer />
          <Text
            font={{ size: 12, weight: "bold" }}
            foregroundColor={accentFor(service.remainingPct)}
            widgetAccentable
          >
            {pctLabel(service.remainingPct)}%
          </Text>
        </HStack>
        <ProgressBar
          pct={service.remainingPct}
          color={accentFor(service.remainingPct)}
          height={4}
        />
        <HStack>
          <Text font={{ size: 8 }} foregroundColor={UI.faint}>
            {resetText}
          </Text>
          <Spacer />
          {service.remaining5hPct != null && (
            <Text font={{ size: 8 }} foregroundColor={accentFor5h(service.remaining5hPct)}>
              5h {pctLabel(service.remaining5hPct)}%
            </Text>
          )}
        </HStack>
      </VStack>
    </Link>
  );
}

function AccountRow({ detail, serviceName }: { detail: ServiceAccountDetail; serviceName: string }) {
  return (
    <HStack alignment="center" spacing={4}>
      <Text font={{ size: 10, weight: "medium" }} foregroundColor={UI.ink}>
        {serviceName} · {detail.name}
      </Text>
      <Spacer />
      <Text font={{ size: 10, weight: "bold" }} foregroundColor={accentFor(detail.remainingPct)}>
        周 {pctLabel(detail.remainingPct)}%
      </Text>
      {detail.resetHint && (
        <Text font={{ size: 8 }} foregroundColor={UI.faint}>
          ({shortenHint(detail.resetHint)})
        </Text>
      )}
      {detail.remaining5hPct != null && (
        <Text font={{ size: 9 }} foregroundColor={accentFor5h(detail.remaining5hPct)}>
          5h {pctLabel(detail.remaining5hPct)}%
        </Text>
      )}
    </HStack>
  );
}

export function QuotaWidget({
  data,
  family,
}: {
  data: QuotaData;
  family?: string;
}) {
  const f = family || Widget.family;

  if (f === "accessoryInline") {
    return (
      <Text>
        Grok {pctLabel(data.grok.remainingPct)}% · GPT {pctLabel(data.chatgpt.remainingPct)}% · Gem {pctLabel(data.gemini.remainingPct)}%
      </Text>
    );
  }

  if (f === "accessoryRectangular") {
    return (
      <VStack alignment="leading" spacing={2} padding={{ all: 2 }}>
        <HStack alignment="center">
          <Text font={{ size: 9, weight: "bold" }}>AI QUOTA</Text>
          <Spacer />
          <DateLabel date={new Date(data.fetchedAt)} style="relative" font={{ size: 8 }} />
        </HStack>
        <HStack spacing={4} alignment="center">
          <VStack alignment="leading" spacing={1}>
            <Text font={{ size: 8 }} foregroundColor="secondaryLabel">
              Grok
            </Text>
            <Text font={{ size: 11, weight: "bold" }} widgetAccentable>
              {pctLabel(data.grok.remainingPct)}%
            </Text>
          </VStack>
          <Divider />
          <VStack alignment="leading" spacing={1}>
            <Text font={{ size: 8 }} foregroundColor="secondaryLabel">
              GPT
            </Text>
            <Text font={{ size: 11, weight: "bold" }} widgetAccentable>
              {pctLabel(data.chatgpt.remainingPct)}%
            </Text>
          </VStack>
          <Divider />
          <VStack alignment="leading" spacing={1}>
            <Text font={{ size: 8 }} foregroundColor="secondaryLabel">
              Gem
            </Text>
            <Text font={{ size: 11, weight: "bold" }} widgetAccentable>
              {pctLabel(data.gemini.remainingPct)}%
            </Text>
          </VStack>
        </HStack>
      </VStack>
    );
  }

  if (f === "systemSmall") {
    return (
      <VStack
        alignment="leading"
        spacing={6}
        padding={{ all: 12 }}
        widgetBackground="systemBackground"
      >
        <HStack alignment="center">
          <Text font={{ size: 11, weight: "bold" }} foregroundColor={UI.ink}>
            AI Quota
          </Text>
          <Spacer />
          <FreshnessBadge isCached={data.isCached} />
          <DateLabel
            date={new Date(data.fetchedAt)}
            style="relative"
            font={{ size: 8 }}
            foregroundColor={UI.muted}
          />
          <Button intent={ReloadQuotaIntent(undefined)} buttonStyle="plain">
            <Image
              systemName="arrow.clockwise"
              font={{ size: 9, weight: "medium" }}
              foregroundColor={UI.muted}
            />
          </Button>
        </HStack>

        <SmallServiceRow service={data.grok} />
        <Divider />
        <SmallServiceRow service={data.chatgpt} />
        <Divider />
        <SmallServiceRow service={data.gemini} />
      </VStack>
    );
  }

  if (f === "systemLarge") {
    const allDetails: { detail: ServiceAccountDetail; serviceName: string }[] = [];
    if (data.grok.accountDetails) {
      data.grok.accountDetails.forEach((d) => allDetails.push({ detail: d, serviceName: "Grok" }));
    }
    if (data.chatgpt.accountDetails) {
      data.chatgpt.accountDetails.forEach((d) => allDetails.push({ detail: d, serviceName: "ChatGPT" }));
    }
    if (data.gemini.accountDetails) {
      data.gemini.accountDetails.forEach((d) => allDetails.push({ detail: d, serviceName: "Gemini" }));
    }

    return (
      <VStack
        alignment="leading"
        spacing={10}
        padding={{ all: 16 }}
        widgetBackground="systemBackground"
      >
        {/* Top bar */}
        <HStack alignment="center">
          <HStack spacing={6} alignment="center">
            <Text font={{ size: 14, weight: "bold" }} foregroundColor={UI.ink}>
              AI Quota
            </Text>
            <FreshnessBadge isCached={data.isCached} />
            <DateLabel
              date={new Date(data.fetchedAt)}
              style="relative"
              font={{ size: 10 }}
              foregroundColor={UI.muted}
            />
          </HStack>
          <Spacer />
          <Button intent={ReloadQuotaIntent(undefined)} buttonStyle="plain">
            <Image
              systemName="arrow.clockwise"
              font={{ size: 12, weight: "semibold" }}
              foregroundColor={UI.muted}
            />
          </Button>
        </HStack>

        {/* 3 Main Columns */}
        <HStack spacing={12} alignment="top">
          <ServiceColumn service={data.grok} />
          <Divider />
          <ServiceColumn service={data.chatgpt} />
          <Divider />
          <ServiceColumn service={data.gemini} />
        </HStack>

        <Divider />

        {/* Detailed accounts */}
        <VStack alignment="leading" spacing={4}>
          <Text font={{ size: 11, weight: "semibold" }} foregroundColor={UI.muted}>
            多账号明细
          </Text>
          {allDetails.length > 0 ? (
            allDetails.slice(0, 5).map((item, idx) => (
              <AccountRow key={idx} detail={item.detail} serviceName={item.serviceName} />
            ))
          ) : (
            <Text font={{ size: 10 }} foregroundColor={UI.faint}>
              暂无更多子账号数据
            </Text>
          )}
        </VStack>
      </VStack>
    );
  }

  // Default: systemMedium
  return (
    <VStack
      alignment="leading"
      spacing={8}
      padding={{ all: 14 }}
      widgetBackground="systemBackground"
    >
      <HStack alignment="center">
        <HStack spacing={6} alignment="center">
          <Text font={{ size: 13, weight: "bold" }} foregroundColor={UI.ink}>
            AI Quota
          </Text>
          <FreshnessBadge isCached={data.isCached} />
          <DateLabel
            date={new Date(data.fetchedAt)}
            style="relative"
            font={{ size: 10 }}
            foregroundColor={UI.muted}
          />
        </HStack>
        <Spacer />
        <Button intent={ReloadQuotaIntent(undefined)} buttonStyle="plain">
          <Image
            systemName="arrow.clockwise"
            font={{ size: 11, weight: "medium" }}
            foregroundColor={UI.muted}
          />
        </Button>
      </HStack>

      <HStack spacing={12} alignment="top">
        <ServiceColumn service={data.grok} />
        <Divider />
        <ServiceColumn service={data.chatgpt} />
        <Divider />
        <ServiceColumn service={data.gemini} />
      </HStack>
    </VStack>
  );
}

// Widget lifecycle
const data = await fetchQuotaData();
Widget.present(<QuotaWidget data={data} />, {
  policy: "after",
  date: new Date(Date.now() + 15 * 60 * 1000),
});
